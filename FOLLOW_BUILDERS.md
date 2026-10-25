# Follow Builders：安装与手动运行

官方项目：https://github.com/zarazhangrui/follow-builders

安装位置：`.agents/skills/follow-builders/`。
固定上游提交：`23eecbb9e39f8524c949394d5c02bf0a50aad162`。
已阅读官方 README.md、SKILL.md；完整复制该提交的 22 个受版本控制文件，未修改原项目代码，也未引入嵌套 Git 仓库。

## 使用偏好

仅在用户手动请求时运行，结果直接在任务中显示，使用简体中文。优先展示与 AI 相关、内容完整的核心人物 X 动态。每条保留 feed 中的原帖 URL 与 createdAt（展示时转为北京时间），分别标注“原帖表述”和“AI 总结”。预测、意见只归属于作者；缺少引用上下文时不推断产品细节。报告 feed 更新时间，不将中央 feed 称为实时 X 搜索。

不设置 cron、Telegram、邮件，不运行中央 feed 生成脚本。无需 API key。
本次未写入用户主目录：原脚本仍读取默认配置（en / daily / stdout），中文和手动模式由当前任务指令覆盖。daily 是原脚本默认元数据，不代表已创建定时任务。后续调用时应同时提供上述中文要求；若需要永久个人配置，可按官方 SKILL.md 设置 `~/.follow-builders/config.json`。

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

安装不依赖 Pull Request。若要把本分支的安装变更合入默认分支，应创建 PR；本次仅创建本地提交。
