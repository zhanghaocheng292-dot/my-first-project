// Orchestration only: all source fetching stays in the installed prepare-digest.js.
import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sendTelegram } from '../.agents/skills/follow-builders/scripts/deliver.js';

const DAY = 86400000;
export const beijing = ms => new Date(ms).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', hour12: false,
});

export function selectTweets(prepared, now, sent = {}) {
  const seen = new Set(Object.keys(sent));
  const tweets = [];
  for (const builder of prepared.x || []) {
    for (const tweet of builder.tweets || []) {
      const time = Date.parse(tweet.createdAt);
      if (!Number.isFinite(time) || time < now - DAY || time > now ||
          !/^https:\/\/(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+$/.test(tweet.url || '') ||
          !tweet.text?.trim() || seen.has(tweet.url)) continue;
      seen.add(tweet.url);
      tweets.push({ name: builder.name || builder.handle, handle: builder.handle,
        bio: builder.bio || '', text: tweet.text, url: tweet.url, time,
        score: Number(tweet.likes || 0) + 3 * Number(tweet.retweets || 0) });
    }
  }
  // Prioritize builders at major labs, then engagement. Keep every eligible post.
  return tweets.sort((a, b) =>
    Number(/openai|anthropic|deepmind|google|meta|nvidia|xai|ceo|founder/i.test(b.bio)) -
    Number(/openai|anthropic|deepmind|google|meta|nvidia|xai|ceo|founder/i.test(a.bio)) ||
    b.score - a.score || b.time - a.time);
}

// Split without cutting surrogate pairs, preserving URLs at paragraph boundaries.
export function splitText(text, limit = 3500) {
  const chunks = [];
  while (text.length) {
    let end = Math.min(limit, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end);
      if (newline > limit / 2) end = newline + 1;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    chunks.push(text.slice(0, end));
    text = text.slice(end);
  }
  return chunks;
}

async function request(url, options = {}) {
  // Never propagate fetch errors: Telegram URLs contain the bot token.
  try { return await fetch(url, { ...options, signal: AbortSignal.timeout(60000) }); }
  catch { throw new Error('Network request failed or timed out; credentials omitted'); }
}

async function stateStore() {
  const root = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}`;
  const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`,
    Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  async function api(path, method = 'GET', body) {
    const res = await request(root + path, { method, headers,
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new Error(`State API failed (HTTP ${res.status}); stop before further delivery`);
    try { return await res.json(); }
    catch { throw new Error(`GitHub state API returned non-JSON (HTTP ${res.status})`); }
  }
  const branch = 'follow-builders-state';
  if (!await api(`/git/ref/heads/${branch}`)) {
    await api('/git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: process.env.GITHUB_SHA });
  }
  const path = '/contents/follow-builders-delivery-state.json';
  const file = await api(`${path}?ref=${branch}`);
  let sha = file?.sha;
  const state = file ? JSON.parse(Buffer.from(file.content, 'base64').toString()) : { sent: {}, pending: {} };
  if (!state.sent || typeof state.sent !== 'object') throw new Error('Invalid delivery state');
  state.pending ||= {};
  return { state, async save() {
    const result = await api(path, 'PUT', { branch, message: 'Record Follow Builders delivery',
      ...(sha ? { sha } : {}), content: Buffer.from(JSON.stringify(state)).toString('base64') });
    sha = result.content.sha;
  } };
}

export function formatPostChunks(tweet) {
  const prefix = `${tweet.name} (@${tweet.handle || 'unknown'})\n发布时间（北京时间）：${beijing(tweet.time)}`;
  const suffix = `\n原帖链接：${tweet.url}`;
  const limit = 3500 - prefix.length - suffix.length - 40;
  if (limit <= 0) throw new Error('Post metadata exceeds Telegram message limit');
  const parts = splitText(tweet.text, limit);
  return parts.map((part, index) =>
    `${prefix}\n原帖内容（${index + 1}/${parts.length}）：\n${part}${suffix}`);
}

export async function main() {
  for (const key of ['GH_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'GITHUB_REPOSITORY', 'GITHUB_SHA']) {
    if (!process.env[key]) throw new Error(`Missing required variable: ${key}`);
  }
  // Require a private chat and validate connectivity without printing any identity.
  const chat = await request(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getChat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID }),
  });
  let info;
  try { info = await chat.json(); }
  catch { throw new Error(`Telegram getChat returned non-JSON (HTTP ${chat.status})`); }
  if (!chat.ok || !info.ok || info.result?.type !== 'private') throw new Error('Telegram private chat validation failed');
  const prepared = JSON.parse(await readFile('work/follow-builders/prepared.json', 'utf8'));
  if (prepared.status !== 'ok' || prepared.errors?.some(e => /tweet feed/i.test(e))) {
    throw new Error('Central X feed unavailable or reports errors; no digest sent');
  }
  const now = Date.now();
  const feedTime = Date.parse(prepared.stats?.feedGeneratedAt);
  if (!Number.isFinite(feedTime) || feedTime > now + 300000) throw new Error('Missing or invalid central feed timestamp');
  const store = await stateStore();
  const tweets = selectTweets(prepared, now, store.state.sent);
  const all = (prepared.x || []).flatMap(b => b.tweets || []);
  const times = all.map(t => Date.parse(t.createdAt)).filter(Number.isFinite);
  const stale = now - feedTime > DAY;
  const chosen = stale ? [] : tweets;
  const header = chosen.length ? `AI 核心人物 X 英文原帖\n运行时间（北京时间）：${beijing(now)}\n筛选窗口：${beijing(now - DAY)} — ${beijing(now)}\n中央 feed 更新：${beijing(feedTime)}（距运行 ${((now - feedTime) / 3600000).toFixed(1)} 小时${stale ? '，已过期' : ''}）\n原版中央抓取回看 24 小时；非实时 X 搜索，不保证完整覆盖。\nfeed 内实际帖子范围：${times.length ? `${beijing(Math.min(...times))} — ${beijing(Math.max(...times))}` : '无有效时间'}\n中央 feed 共 ${prepared.x?.length || 0} 人、${all.length} 条；当前窗口去重后 ${tweets.length} 条。\n${stale ? '警告：feed 超过 24 小时未更新，旧帖不作为今日动态推送。' : '仅推送当前 24 小时内未送达的帖子。'}\n` : `当前无可推送的新动态。${stale ? '中央 feed 已超过 24 小时未更新，旧帖不推送。' : ''}\n筛选窗口（北京时间）：${beijing(now - DAY)} — ${beijing(now)}\n中央 feed 更新（北京时间）：${beijing(feedTime)}\n中央 feed 非实时 X 搜索，可能覆盖不完整。`;
  for (const tweet of chosen) {
    // Ignore pending AI summaries from the former mode; keep sent URL history.
    if (store.state.pending[tweet.url]?.format !== 'original-v1') {
      store.state.pending[tweet.url] = { time: now, format: 'original-v1',
        chunks: formatPostChunks(tweet) };
    }
  }
  await store.save(); // Freeze text and part boundaries before any Telegram send.
  let delivered = 0;
  async function deliver(text, key) {
    if (store.state.sent[key]) return;
    // Each call is below the original sender's split threshold; checkpoint each part.
    await sendTelegram(text, process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
    store.state.sent[key] = now;
    await store.save();
    delivered++;
  }
  // Manual dispatch always exercises Telegram even when no new tweets exist.
  await deliver(header, `notice:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT}`);
  for (let i = 0; i < chosen.length; i++) {
    const tweet = chosen[i];
    const chunks = store.state.pending[tweet.url].chunks;
    for (let j = 0; j < chunks.length; j++) {
      await deliver(chunks[j], `part:original-v1:${tweet.url}:${j}`);
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
    store.state.sent[tweet.url] = now;
    delete store.state.pending[tweet.url];
    await store.save();
  }
  // Keep enough history for the 24h window, bounding branch file growth.
  for (const [key, time] of Object.entries(store.state.sent)) if (time < now - 7 * DAY) delete store.state.sent[key];
  for (const [key, plan] of Object.entries(store.state.pending)) if (plan.time < now - 7 * DAY) delete store.state.pending[key];
  await store.save();
  const report = `Telegram delivery confirmed: ${delivered} messages; ${chosen.length} posts. Central feed: ${new Date(feedTime).toISOString()}; stale=${stale}.`;
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Deliberately omit stack/remote bodies, URLs, token, and chat ID.
    const secrets = [process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, process.env.GH_TOKEN].filter(Boolean);
    let message = String(error.message || 'Digest failed');
    for (const secret of secrets) message = message.split(secret).join('[REDACTED]');
    console.error(message);
    process.exitCode = 1;
  });
}
