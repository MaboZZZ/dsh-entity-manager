# DSH Entity Manager — 设计方案

> 状态：M0 完成（2025-08）。本文件是已确认方案的权威记录；实现偏离时
> 先改这里。

## 1. 目标

一个**可视化的端侧应用**（Electron 桌面应用），管理多个相互独立的
**DSH 实体**：

- 每个实体 = 一个独立运行的 DSH（DeepSeek Harness）实例；
- 每个实体可**锁定不同的 DSH 版本**（npm 发布版 / git tag / 本地源码），
  互不影响、可并行存在；
- 可视化完成创建、启动、停止、打开 GUI、切换版本、回滚。

## 2. 已验证的事实（机制依据）

| 事实 | 依据 |
|---|---|
| `@deepseek-ai/dsh` 已在 npm 公开，版本 `0.0.1-rc.1 … 0.1.0-rc.6`（latest rc.6） | npm registry |
| `DSH_HOME` 是单一数据根：配置 / profiles / 会话 / 预设 / 密钥全部在此，优先级 显式路径 > `$DSH_HOME` > `~/.dsh` | `packages/util/home-paths` |
| `dsh --profile web` 启动；profile 目录 `$DSH_HOME/profiles/<name>/`，首次使用从模板自动初始化（web = `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`） | `packages/boot/app-boot/src/profile.ts` |
| Web 服务可配 host（`127.0.0.1`/`0.0.0.0`）与 port（0 = 系统分配） | `packages/host/webserver` |
| bundle 模块解析优先从 dsh 安装本身解析 ⇒ 版本 pin 由"执行哪个版本的 bin"决定 | `app-boot/src/profile.ts` |
| 仓库无 Dockerfile；Linux 有原生 landlock 沙箱可作为更深的隔离层 | 仓库根 / `native/landlock-run` |
| CLI 要求 Node ≥ 22.19（本机 22.18，M0 前需升级） | `package.json` engines |

**核心洞察**：DSH 的"单根数据目录 + 可配置端口 + 版本化 npm 包"三个机制
就是多实例容器化的三个天然杠杆。本项目是纯外层编排，不改 DSH 一行。

## 3. 实体模型

```
实体 = {
  spec: {                        // 声明式、持久化
    id, name,
    version: { source: 'npm'|'git-tag'|'local', ref },   // 版本 pin
    profile: 'web' | 'headless' | 自定义,
    port,                        // 0 = 系统分配
    isolation: 'process' | 'sandbox' | 'container',
    homeDir,                     // 实体的 $DSH_HOME
    args, env, createdAt,
  },
  status: {                      // 易变、运行期
    phase, pid, port, startedAt, error, version,
  },
}
```

## 4. 架构

三层，manager 与 ui 之间只有 loopback JSON API。

### 4.1 管理器守护进程（apps/manager）

- 持久化：`~/.dsh-entities/entities.json`（原子写），状态可重建；
- 进程生命周期：spawn `node <版本安装>/node_modules/@deepseek-ai/dsh/lib/bin.js
  --profile <profile>`，注入 `DSH_HOME=<实体 homeDir>` 与端口 patch，
  健康探测 web server 就绪后置为 running；
- 版本仓库（apps/manager/src/versions.ts）：
  - npm 源：`npm view @deepseek-ai/dsh versions`（用独立 `npm_config_cache`，
    不碰系统缓存）；
  - 安装（M0）：`npm pack @deepseek-ai/dsh@<v>` 解包到
    `~/.dsh-entities/versions/<v>/`，写 manifest 边车文件；
  - git-tag 源（M3）：clone/checkout 到版本目录；
  - local 源（M1）：注册当前开发 checkout（如本仓库）为"开发版"。

### 4.2 可视化层（apps/ui，React + Vite）

- 实体看板：卡片（名称 / 状态灯 / 版本徽章 / 端口 / 打开 / 日志）；
- 创建向导：起名 → 选版本（对比视图）→ 隔离级别 → 模型供应商 → profile → 端口；
- 实体详情：内嵌 GUI、日志流、配置编辑；
- 版本管理器：浏览 / 安装 / 切换 / 回滚，升级前快照。

### 4.3 Electron 壳（apps/shell）

- 主进程**内嵌管理器**（`createManagerServer`，端口 4180 被占时自动换口）；
- 实体子进程以 `ELECTRON_RUN_AS_NODE=1` 用 Electron 自带 Node（22.21）拉起，
  顺带满足 DSH 的 Node ≥ 22.19 要求；应用退出时自动停止全部实体；
- 渲染进程通过 preload 桥（`window.dshm.managerUrl`）拿到管理器地址，
  不依赖 vite 代理；管理器 API 对 loopback 开放 CORS（仅绑 127.0.0.1）；
- 托盘 / 菜单（开管理器、开实体 GUI 独立窗口、开机自启开关）/ 退出清理；
- 打包：electron-builder（mac dmg/zip、win nsis、linux AppImage），
  UI 以 extraResources 进 `process.resourcesPath/ui-dist`。

已知问题：`app-builder-lib@26.15.3` 声明 `@electron/get@^3.0.0` 但实际需要
3.1.0 才有的 `ElectronDownloadCacheMode` → pnpm override 强制 3.1.0。

## 5. 隔离级别

| 级别 | 说明 | 状态 |
|---|---|---|
| L1 process | 独立 `$DSH_HOME` + 端口 + 版本 pin（默认） | M0 实现 |
| L2 sandbox | Linux landlock 白名单（复用 DSH 自带沙箱） | 预留 |
| L3 container | 每版本 Docker 镜像，容器拉起 | 预留 |

## 6. 版本切换与升级安全

- 实体记录 version pin；切换 = 停止 → 用目标版本 bin 重启，数据目录不变；
- 升级前强制快照实体配置（`~/.dsh-entities/snapshots/<id>/<ts>/`）；
- 回滚 = 重 pin 旧版本（数据保留）；
- "克隆实体" = 复制数据目录到新实体并 pin 新版本，旧实体原样保留；
- 跨版本数据格式可能不兼容（rc 阶段），UI 对版本差异给出提示。

## 6.1 M0 实测记录（2025-08）

- `dsh --profile web --port <n>` + `DSH_HOME=<dir>` 是最小拉起面；`--host`
  仅允许 `127.0.0.1`（`0.0.0.0` 被安全拒绝），正好满足 loopback 编排；
- 本地 checkout（source tree）用 `node --import tsx/esm apps/cli/src/bin.ts`
  直接拉起，无需构建；Node 22.18 实际可跑（engines 仅提示不强制）；
- 实体生命周期全链路已验证：创建 → start（自动分配端口并**持久化进 spec**，
  重启端口稳定）→ 健康探测置 running → stop（SIGTERM→SIGKILL）→ 重启后
  reconcile 把残留 running 校正为 stopped；
- 每个实体独立 `$DSH_HOME`（`storages/workspace.json` + `profiles/`），
  互不可见；`npm install --ignore-scripts` 隔离安装 DSH 版本到版本仓库；
- 管理器 API：`/api/entities/{id}/start|stop|logs`、`/api/versions/install`、
  `/api/versions/register-local`；UI 看板已可操作（start/stop/open/logs/install）。

## 7. 数据布局

```
~/.dsh-entities/
├── entities.json              # 实体清单
├── versions/<ref>/            # 版本仓库（每版本隔离安装 + manifest.json）
├── homes/<entity-id>/         # 各实体 $DSH_HOME（数据）
├── snapshots/<entity-id>/     # 升级前快照
├── logs/<entity-id>.log       # 实体 stdout/stderr
└── .npm-cache/                # 管理器专用 npm 缓存
```

## 8. 风险与取舍

- 跨版本数据兼容性 → 快照 + 克隆 + 差异提示；
- 端口冲突 → 管理器分配与探测；
- 密钥管理 → 存在各实体自己的 `$DSH_HOME`，UI 掩码显示；
- 与官方未来安装器可能重叠 → 定位为社区贡献的独立工具，复用公开机制。

## 9. 环境

- Node ≥ 22.19（M0 拉起实体所需；骨架开发 22.18 可编译）
- pnpm ≥ 11.7（与 DSH 一致）
- 平台：macOS 优先（当前开发机），Windows/Linux 随 Electron 打包覆盖
