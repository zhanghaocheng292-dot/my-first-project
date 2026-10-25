# Follow Builders：安装与自动推送

官方项目：https://github.com/zarazhangrui/follow-builders

安装位置：`.agents/skills/follow-builders/`。
固定上游提交：`23eecbb9e39f8524c949394d5c02bf0a50aad162`。
已阅读官方 README.md、SKILL.md；完整复制该提交的 22 个受版本控制文件，未修改原项目代码，也未引入嵌套 Git 仓库。

## 使用偏好

使用简体中文。优先展示与 AI 相关、内容完整的核心人物 X 动态。每条保留 feed 中的原帖 URL 与 createdAt（展示时转为北京时间），标注“AI 总结”。预测、意见只归属于作者；缺少引用上下文时不推断产品细节。报告 feed 更新时间，不将中央 feed 称为实时 X 搜索。

现已通过根目录 GitHub Actions 工作流自动推送 Telegram，详见下文。安装的嵌套 `.github/workflows/generate-feed.yml` 不会作为本仓库工作流运行，也不运行中央 feed 生成脚本。原版 prepare-digest.js 保留不变，自动化覆盖其默认语言与投递方式，不写主目录配置。

## 运行方式

在仓库根目录执行：

```bash
npm install --prefix .agents/skills/follow-builders/scripts --ignore-scripts --no-audit --no-fund
NODE_USE_ENV_PROXY=1 node .agents/skills/follow-builders/scripts/prepare-digest.js
```

由 agent 阅读原脚本输出的 JSON，按其中 prompts 及上述用户要求生成摘要；不另行搜索或补造内容。stdout 直接显示即可，不需要运行 deliver.js。

Codex 执行工具需要为这些命令启用支持的网络权限。保留环境代理和 TLS 验证；Node.js 24 通过 NODE_USE_ENV_PROXY=1 使用环境代理。

## 2026-10-26 试运行记录（北京时间）

- 环境：Node.js v24.19.0、npm 11.9.0、非 OpenClaw。
- 默认执行沙箱：curl/git 无法连接 proxy:8080；npm 报 connect EPERM，prepare-digest.js 报 fetch failed。
- 启用执行工具的网络权限后：官方 git clone 成功，npm install 成功，prepare-digest.js 退出码 0。
- 输出生成时间：2026-10-26 06:07:28；中央 feed 时间：2026-10-25 14:39:19。
- 数据：11 位 X 人物、23 条帖子、1 期播客、0 篇博客；无 errors。
- 22 个上游文件逐字节核对一致。node_modules、缓存和原始试运行日志不提交。
- 试运行摘要仅取自原脚本 JSON，直接显示在任务结果中；未访问 X 原站独立核验。

## GitHub Actions 自动化

工作流：`.github/workflows/follow-builders.yml`，名称 **Follow Builders Telegram Digest**。合并到 main 后，每天 UTC 01:00（北京时间 09:00）运行。GitHub 定时任务可能排队延迟，不能保证准点；公共仓库长时间无活动也可能被 GitHub 停用定时任务。

- 原版 `prepare-digest.js` 负责获取中央 feed 和提示词，不自行访问 X，不重新实现抓取。播客、博客虽由原脚本一并获取，但不推送。
- 使用 `npm ci` 和原版 lockfile 安装依赖，Node.js 24 保留代理和 TLS 校验。GitHub 托管 runner 需要访问 `registry.npmjs.org`、`raw.githubusercontent.com`、`api.github.com`、`models.github.ai`、`api.telegram.org`；不需要 X API key。
- `scripts/follow-builders.mjs` 从原版 JSON 中按运行时刻严格筛选最近 24 小时、有原帖链接和有效时间、尚未送达的帖子，优先主要实验室/创始人及高互动内容。每条都保留人物、发布时间、原帖链接。
- 中文摘要使用 GitHub Models 的 `openai/gpt-4o-mini` 免费额度；内置 `GITHUB_TOKEN` 需要 `models: read`，仓库/组织需允许 Models 使用。**不启用付费 Models**，额度不足或 HTTP 401/403/429 时明确失败；不会发送英文原文或原始 JSON 冒充中文摘要。不能承诺免费额度永久可用。
- Telegram 使用已有 Secrets `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`，只接受私聊。需先在 Telegram 向机器人发送 `/start`。Secret 仅注入发送步骤，不写入文件、不输出值、请求 URL、远端错误体或消息全文。
- 沿用原版 `deliver.js` 的 Telegram 函数，改为可导入、纯文本发送、检查 HTTP 与 `ok`/`message_id`、添加超时，避免 Markdown 回退失败却报成功。编排层按 3500 个 UTF-16 单元分段，每段持久化回执并限速。
- 每次通知明确标注运行窗口、中央 feed 更新时间、feed 内实际帖子时间范围及人物/帖子数。原版中央生成器回看 24 小时，但两次抓取之间可能有覆盖缺口。feed 超过 24 小时未更新时，只发送过期提示，不把旧帖包装为实时动态。无法取得 X feed 时失败。
- 去重保存在独立 `follow-builders-state` 分支的 `follow-builders-delivery-state.json`，不依赖可能过期的 Actions cache/artifact，也不写 main。串行执行定时与手动任务；发送前冻结摘要，发送后逐段记录，再标记原帖 URL，保存 7 天。状态不含 Secrets/私聊 ID，包含原帖链接与待送摘要，继承仓库可见性。
- 若 Telegram 已收消息但网络超时，或 Telegram 成功后 GitHub 状态写入失败，无法保证严格 exactly-once；任务会失败并停止。重试前先查看 Telegram 最后一条，避免重复。不要删除状态分支来“修复”任务，否则去重记录丢失。

## 手动测试与成功判断

1. 将本 PR 合并到 **main**（定时和网页手动入口需工作流存在于默认分支）。
2. 打开仓库 **Actions → Follow Builders Telegram Digest → Run workflow**，选择 **main**，再点 **Run workflow**。无需填写 token 或 chat ID。也可运行 `gh workflow run follow-builders.yml --ref main`。
3. 查看本次运行：依赖安装、测试、原版 Prepare、Summarize and deliver 应全部绿色。Summary 显示 `Telegram delivery confirmed: N messages; M posts` 和中央 feed 时间；`N` 必须大于 0。每条成功都要求 Telegram 返回 `ok=true` 和 `message_id`，且状态写入成功。
4. 在 Telegram 私聊核对收到时间说明及摘要，检查中文观点、北京时间和原帖链接。没有新帖或 feed 过期也会收到一条明确状态通知，便于验证通道；这不表示今天有新动态。
5. 再手动运行一次：若中央 feed 没有新增符合条件的帖子，应只收到状态通知，旧帖不重复推送。不要仅靠 Actions 绿色判断用户已读；Telegram 客户端实际收到才完成端到端确认。

常见失败：`Missing required variable` 检查 Secret 名称/作用域；私聊校验失败检查 `/start`、私聊 ID、bot 权限；Models 401/403 检查仓库/组织 Models 开关与 `models: read`；429 等额度恢复后重试；State API 403 检查 Actions `contents: write` 是否受组织策略/分支规则限制。网络超时检查上述域名。日志不会打印 Secret 值，请勿为排错添加 `set -x` 或输出环境变量。

## 本次验证范围

已在当前环境使用网络权限成功 `npm ci`，运行原版 prepare 脚本得到 11 位人物、23 条帖子，中央 feed 更新时间为北京时间 **2026-10-25 14:39:19**，无 errors；通过时间窗口/去重、人物优先级、中文 emoji 分段和 Telegram 成功/失败回执模拟测试。PR 也运行不含 Secrets 的验证任务。

当前 GitHub 身份读取 Actions 管理权限端点返回 403，因此不能证明仓库管理策略允许所有配置。当前环境未提供 Telegram Secrets 的值，不能在本地实际发送；生产 runner 的 Models 授权、Telegram 私聊送达与状态写入需按上述手动运行验证，未将它们标为已成功。
