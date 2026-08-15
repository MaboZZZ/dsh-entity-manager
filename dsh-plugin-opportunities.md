# dsh 插件生态机会地图：哪些部分能长出插件

> 依据：`docs/architecture.zh.md`（新行为归属表）、`docs/cookbook/extension-cookbook.md`（功能→机制映射）、`packages/README.md`（现有包全景）。
> 结论先行：**dsh 的扩展点全在"服务 seam 的提供方、工具注册表、事件监听、会话上下文、UI 节点、组装层"六类上；官方只实现了每个 seam 的 1~2 个默认提供方，空白远大于已覆盖。**

---

## 一、六类可长出插件的扩展点（对应机制）

| 类别 | 挂载机制 | 官方示例（可当模板） |
|---|---|---|
| **① 能力 Seam 提供方** | `ctx.<key>` 注册实现（`ctx.provide` / Service 子类） | `llm-deepseek`、`web-search-exa`、`fs-local`、`subprocess-local`、`session-persistence-sqlite`、`credentials-local` |
| **② 面向模型的工具** | `ctx.tools.register()`（schema 自动进提示词组装） | `tool-bash`、`tool-fs`、`tool-web`、`tool-subagent`、`tool-todo` |
| **③ 钩子 / 策略** | `ctx.on()` / `ctx.waterfall()` 监听扩展点 | `guard/repeat-tool-reminder`、`tool-call-timeout-policy`、`permission-presets`、`plan-mode` |
| **④ 会话上下文** | `ctx.systemPrompt.section()` + `agent.inject()` | `context/time-context`、`agent-instructions`、`skill-filesystem`、`session-title` |
| **⑤ UI / 外部协议** | `ConversationNodeDefinition` + keyed renderer；`ctx.agents` 适配 | `acp`（协议服务器）、`client-ui-*` 系列、`host-*` |
| **⑥ 组装层（一键体验）** | bundle（`dsh.bundle` → `cordis.patch.yml`）、preset、schedule | `bundle/base`、`bundle/web-app`、`examples/web-schedule` |

---

## 二、现有覆盖 vs 空白（基于 packages/ 全景）

### 已覆盖（官方实现的存在，意味着接口稳定、可照着写）
- LLM：`deepseek`、`pi-ai`（**仅 2 家**）
- Web：`deepseek`、`exa`、`perplexity` 搜索 + `http` 抓取
- 执行：`bash`(local/sandbox)、`pwsh`、`terminal-bash`、`subprocess-local`、`code-runtime-worker-thread`
- 沙箱：`sandbox-local`（bwrap/Landlock/Seatbelt）、`e2b` 远程
- 数据：`session-persistence-{jsonl,sqlite}`、`storage-{json,sqlite}`、`session-query-sqlite`、`attachment-local`、`spill-local`
- 凭据/设置：`credentials-local`（env/.env）、`settings-file`
- 子代理：`in-process`、`acp`、`codex`、`claude-code`、`dsh-sdk`
- 其他：`mcp-client`（通用）、`compaction-basic`、`skill-filesystem`、`telemetry-otel`、`schedule`、`workflow`

### 空白（生态机会，按价值排序）

**🔴 第一梯队：缺口最大、需求明确**
1. **第三方 LLM 适配器** —— 官方只有 DeepSeek 和 Pi。OpenAI 兼容协议 / Anthropic / Gemini / Ollama / vLLM / 国产各家（通义、Kimi、豆包、文心…），每个是一个 `dsh-llm-<vendor>` 包。有现成教程 `docs/cookbook/adding-an-llm-adapter.md` 和模板 `packages/llm/llm-deepseek`。
2. **Web 搜索/抓取提供方** —— Brave、Tavily、SearXNG、Google/Bing、arXiv、GitHub、RSS、以及**浏览器渲染抓取**（Playwright 后端，解决 JS 页面）。模板 `packages/web/web-search-exa`。
3. **远程/容器执行后端** —— `ctx.subprocess` + `ctx.fs` + `ctx.shell` 的 Docker 容器后端、SSH 远程后端、WSL 后端。E2B 证明了这个方向官方认可（POC 状态，空白仍大）。

**🟠 第二梯队：小而美、上手快**
4. **凭据提供方** —— macOS Keychain / Windows Credential Manager / 1Password CLI / Bitwarden。模板 `credentials-local`，接口极简。
5. **持久化后端** —— PostgreSQL / Redis 的 `session-persistence` 与 `storage` 后端；云同步（跨机器续会话）。
6. **MCP 封装包** —— cookbook 明说 "one plugin per server"：把常用 MCP server 封装成一行配置即可用的工具包。
7. **Skill 分发** —— `ctx.skills` 的 Git 仓库提供方 / skill 市场；作者只写 markdown 也能贡献（skill 本身就是文件）。
8. **会话记忆/压缩策略** —— 基于 LLM 的语义摘要压缩（替换 `compaction-basic` 的简单截断）；向量化会话检索（替换 `session-query-sqlite` 的关键词检索）。

**🟡 第三梯队：进阶但很有影响力**
9. **聊天平台桥** —— 把 dsh agent 接到 Slack / Discord / Telegram / 微信 / 飞书（`ctx.agents` + `session/event`，参考 `acp` 的协议驱动模式；输入走 `followup()`，输出监听 `assistant/chunk`）。
10. **UI 业务节点** —— 图表渲染、数据库结果查看器、diff 视图、代码运行预览等 `ConversationNodeDefinition`。
11. **Hook 协议桥** —— 兼容其他 CLI agent 的 hook 配置格式（官方已有 `hooks-claude-code`、`hooks-codex` 模板）。
12. **审批/交互通道** —— 手机推送、Slack/Discord 里的 `ctx.approval` 应答器（模板：`acp` 的 one-shot permission answerer）。
13. **语言 SDK** —— 基于 `sdk/` 的 JSON-RPC 协议写 Go/Rust/Java SDK（现有 TS + Python）。
14. **自指插件** —— 借助 `extensions/tool-cordis` 做"生成插件的插件"（动态定义、挂载、收回）。
15. **一键 bundle / preset** —— 把一组插件打包成 `cordis.patch.yml` 层，用户一行配置启用（"应用商店"形态）。

---

## 三、发布与贡献路径

1. **代码形态**：一个 npm 包（scope 自定，社区用 `dsh-plugin-<name>` 或 `@yourscope/dsh-<name>` 均可；官方包在 monorepo 内为 `@deepseek-ai/dsh-*`）。依赖 **Service Definition 包**（如 `@deepseek-ai/dsh-llm`），绝不依赖具体提供方。
2. **关键清单**（`docs/cookbook/adding-a-package.md`）：`type: module`、`@deepseek-ai/cordis` 同时出现在 peer + devDependencies、源码用 `.ts` 后缀导入、`Config` 用 `@deepseek-ai/schemastery`。
3. **组装层包**：在 package.json 里声明 `dsh.bundle`（指向 `cordis.patch.yml`）或 `dsh.profile`；用户通过 profile / `--patch` 装载。
4. **分发**：npm 发布（`publishConfig.access: public`）；给仓库打 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题；在 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 分享。
5. **进官方仓库**：先看 `CONTRIBUTING.md` 与 `docs/development.md`；新增包走 `adding-a-package` 清单 + `pnpm run constraints/typecheck/lint/hygiene` 门禁；`docs/architecture.md` 要求"新行为挂到已有文档记录的扩展点"。

---

## 四、怎么选第一个贡献（决策指南）

| 你的背景 | 推荐起点 | 模板/教程 |
|---|---|---|
| 用过多家 LLM API | **LLM 适配器**（价值最大、教程最全） | `adding-an-llm-adapter.md` + `llm-deepseek` |
| 前端/React | **UI 业务节点**（ConversationNode） | `adding-a-conversation-node.md` + `client-ui-*` |
| 后端/数据 | **持久化/存储/凭据后端**（小而独立） | `session-persistence-sqlite`、`credentials-local` |
| 有特定数据源/站点 | **Web 搜索提供方** 或 **MCP 封装包** | `web-search-exa`、`mcp-client` |
| 全栈/爱折腾 | **聊天平台桥**（Slack/Discord/微信） | `acp`（协议驱动模式） |
| 只写文档/示例 | **skill**（纯 markdown）+ 示例 bundle | `examples/web-schedule` |

> 生态准则（官方口径）：**扩展插件只依赖 Service Definition，绝不依赖具体提供方**；拦截优先用事件（waterfall），直接能力调用优先用服务方法；每个注册都应有 disposer（`ctx.effect` 自动处理）。
