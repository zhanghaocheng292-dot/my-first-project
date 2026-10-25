import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTweets, splitText, beijing, main } from './follow-builders.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendTelegram } from '../.agents/skills/follow-builders/scripts/deliver.js';
import { readJSONResponse } from '../.agents/skills/follow-builders/scripts/json-response.js';

const jsonResponse = value => new Response(JSON.stringify(value), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});

test('non-JSON diagnostics identify the operation without leaking remote body or parser text', async () => {
  for (const operation of ['Telegram getChat', 'Telegram sendMessage',
    'GitHub state API GET /git/ref/heads/follow-builders-state',
    'GitHub Models POST /inference/chat/completions']) {
    for (const body of ['OK\r\n', '', '<html>private-data-token</html>', '{"private-data-token":']) {
      await assert.rejects(readJSONResponse(new Response(body, {
        status: 200, headers: { 'Content-Type': 'text/plain' },
      }), operation), error => {
        assert.ok(error.message.startsWith(operation));
        assert.match(error.message, /HTTP 200; Content-Type text\/plain/);
        assert.match(error.message, /non-JSON response; body omitted/);
        assert.doesNotMatch(error.message, /private-data-token|Unexpected token|<html>/);
        return true;
      });
    }
  }
});

test('JSON objects accepted, JSON primitives rejected, body read failures sanitized', async () => {
  assert.deepEqual(await readJSONResponse(jsonResponse({ ok: true }), 'test operation'), { ok: true });
  for (const value of [null, [], 'OK', true, 7]) {
    await assert.rejects(readJSONResponse(jsonResponse(value), 'test operation'), /expected JSON object/);
  }
  await assert.rejects(readJSONResponse({ status: 200, headers: new Headers(),
    text: async () => { throw new Error('private-data-token'); },
  }, 'test operation'), error => {
    assert.match(error.message, /response body could not be read/);
    assert.doesNotMatch(error.message, /private-data-token/);
    return true;
  });
});

test('24h selection excludes old/future/invalid/no-link/duplicate/already sent posts', () => {
  const now = Date.parse('2026-10-26T01:00:00Z');
  const tweet = (id, age, extra = {}) => ({ url: `https://x.com/builder/status/${id}`,
    text: 'A model release', createdAt: new Date(now - age).toISOString(), ...extra });
  const prepared = { x: [{ name: 'Builder', tweets: [
    tweet(1, 1000), tweet(1, 1000), tweet(2, 86400001), tweet(3, -1),
    tweet(4, 10, { createdAt: 'bad' }), tweet(5, 10, { url: '' }),
    tweet(6, 10), tweet(7, 86400000),
  ] }] };
  assert.deepEqual(selectTweets(prepared, now, { 'https://x.com/builder/status/6': now })
    .map(t => t.url), ['https://x.com/builder/status/1', 'https://x.com/builder/status/7']);
});

test('important builder priority and Beijing conversion', () => {
  const now = Date.now();
  const builder = (id, bio) => ({ name: id, bio, tweets: [{ url: `https://x.com/u/status/${id}`,
    text: 'test', createdAt: new Date(now).toISOString() }] });
  assert.equal(selectTweets({ x: [builder('1', ''), builder('2', 'OpenAI')] }, now)[0].name, '2');
  assert.match(beijing(Date.parse('2026-10-26T01:00:00Z')), /09:00:00/);
});

test('long Chinese/emoji messages split losslessly below Telegram UTF-16 limit', () => {
  const text = ('中文😀\n').repeat(4000);
  const chunks = splitText(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(c => c.length <= 3500 && !/[\uD800-\uDBFF]$/.test(c)));
});

test('original Telegram sender validates API response and sends plain text', async () => {
  const original = globalThis.fetch;
  try {
    let body;
    globalThis.fetch = async (_url, options) => {
      body = JSON.parse(options.body);
      return jsonResponse({ ok: true, result: { message_id: 7 } });
    };
    await sendTelegram('中文_*[]', 'fake-token', 'fake-chat');
    assert.equal(body.parse_mode, undefined);
    assert.equal(body.text, '中文_*[]');
    globalThis.fetch = async () => jsonResponse({ ok: false });
    await assert.rejects(sendTelegram('test', 'fake-token', 'fake-chat'), /delivery failed/);
    globalThis.fetch = async () => new Response('{"ok":false}', { status: 429 });
    await assert.rejects(sendTelegram('test', 'fake-token', 'fake-chat'), /429/);
  } finally { globalThis.fetch = original; }
});

test('two complete runs persist state, send Chinese post once and a status notice each time', async () => {
  const originalFetch = globalThis.fetch;
  const cwd = process.cwd();
  const keys = ['GH_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'GITHUB_REPOSITORY',
    'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_STEP_SUMMARY'];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const dir = await mkdtemp(join(tmpdir(), 'follow-builders-test-'));
  let stored, messages = [], modelCalls = 0, invalidOperation;
  const ok = jsonResponse;
  try {
    process.chdir(dir);
    for (const key of keys) process.env[key] = 'test';
    delete process.env.GITHUB_STEP_SUMMARY;
    await mkdir('work/follow-builders', { recursive: true });
    await writeFile('work/follow-builders/prepared.json', JSON.stringify({ status: 'ok',
      stats: { feedGeneratedAt: new Date().toISOString() }, prompts: {},
      x: [{ name: 'Builder', handle: 'builder', bio: 'OpenAI', tweets: [{
        text: 'We released a model', url: 'https://x.com/builder/status/1',
        createdAt: new Date(Date.now() - 1000).toISOString(),
      }] }] }));
    globalThis.fetch = async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : {};
      if (invalidOperation === 'getChat' && url.endsWith('/getChat') ||
          invalidOperation === 'state read' && url.includes('/git/ref/') ||
          invalidOperation === 'model' && url.includes('models.github.ai') ||
          invalidOperation === 'state write' && options.method === 'PUT') {
        return new Response('OK\r\n', { headers: { 'Content-Type': 'text/plain' } });
      }
      if (url.endsWith('/getChat')) return ok({ ok: true, result: { type: 'private' } });
      if (url.endsWith('/sendMessage')) { messages.push(body.text); return ok({ ok: true, result: { message_id: messages.length } }); }
      if (url.includes('models.github.ai')) {
        modelCalls++;
        return ok({ choices: [{ message: { content: JSON.stringify({ summaries: ['作者宣布发布一个模型。'] }) } }] });
      }
      if (url.includes('/git/ref/')) return ok({ ref: 'exists' });
      if (options.method === 'PUT') { stored = body.content; return ok({ content: { sha: 'test' } }); }
      if (!stored) return { ok: false, status: 404 };
      return ok({ sha: 'test', content: stored });
    };
    for (const [operation, label] of [
      ['getChat', 'Telegram getChat'], ['state read', 'GitHub state API GET'],
      ['model', 'GitHub Models POST /inference/chat/completions'], ['state write', 'GitHub state API PUT'],
    ]) {
      invalidOperation = operation;
      await assert.rejects(main(), error => {
        assert.ok(error.message.startsWith(label));
        assert.match(error.message, /non-JSON response/);
        return true;
      });
      assert.equal(messages.length, 0, 'invalid API responses must not produce Telegram delivery');
    }
    invalidOperation = undefined;
    modelCalls = 0;
    await main();
    process.env.GITHUB_RUN_ID = 'second';
    await main();
    assert.equal(modelCalls, 1);
    assert.equal(messages.length, 3);
    assert.equal(messages.filter(m => m.includes('AI 总结：')).length, 1);
    assert.match(messages[2], /当前无可推送的新动态/);
    assert.ok(JSON.parse(Buffer.from(stored, 'base64')).sent['https://x.com/builder/status/1']);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(cwd);
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
});
