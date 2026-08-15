# DSH Entity Manager

> 可视化地管理多个**相互独立的 DSH（DeepSeek Harness）实体**：每个实体可以锁定
> **不同的 DSH 版本**（npm 发布版 / git ref / 本地源码），一键创建、启动、停止、
> 切换版本、快照回滚、导入导出——装在一个本地桌面应用里。

![CI](https://img.shields.io/github/actions/workflow/status/mabozzz/dsh-entity-manager/ci.yml?branch=main)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

**零侵入**：不修改 DSH 一行代码。基于 DSH 的公开机制编排：每个实体 =
一个独立 `$DSH_HOME`（数据根）+ 独立端口 + 独立 DSH 版本。

---

## 功能

| 能力 | 说明 |
|---|---|
| 🧩 多版本并行 | 不同实体可同时跑不同 DSH 版本（npm / git-tag / 本地源码），互不干扰 |
| 🖥 可视化 | 实体看板、创建向导、实体详情页内嵌该实体的 Web GUI + 实时日志 |
| 🔄 版本切换 | 一个实体随时切换版本并自动重启，数据目录保留；切换前可快照，一键回滚 |
| 📦 快照 / 迁移 | 实体导出为 bundle 文件，可导入为全新实体（新 id + 新数据目录） |
| 🔒 数据隔离 | 每个实体独立 `$DSH_HOME`，密钥 / 会话 / 配置天然隔离 |
| ⚡ 桌面应用 | Electron 壳内嵌管理器；托盘、菜单、开机自启；退出时自动停止所有实体 |

## 架构

```
┌─────────────────────────────────────────────┐
│  apps/ui（React）  看板 · 向导 · 详情 · 版本管理 │
└──────────────────┬──────────────────────────┘
                   │ localhost JSON API
┌──────────────────▼──────────────────────────┐
│  apps/manager（Node 守护进程）                 │
│  实体 CRUD · 进程拉起/停止 · 健康探测 · 版本仓库  │
│  快照/回滚 · 导入/导出 · 异步安装任务            │
└───┬──────────────────────┬──────────────────┘
    │ spawn (DSH_HOME=…)   │ 安装/扫描
┌───▼──────────┐   ┌───────▼────────┐
│ 实体 A (v1)   │   │ 版本仓库         │
│ 实体 B (v2)   │   │ versions/      │
└──────────────┘   └────────────────┘
```

- **apps/manager** — 管理器守护进程（Node + TS），loopback JSON API；
  实体 = `node <dsh bin> --profile web --port <n>` + `DSH_HOME=<实体目录>`。
- **apps/ui** — 可视化界面（Vite + React），3 秒轮询状态，iframe 内嵌实体 GUI。
- **apps/shell** — Electron 壳：内嵌管理器、preload 桥、托盘/菜单、开机自启；
  实体进程以 `ELECTRON_RUN_AS_NODE` 用 Electron 自带 Node 拉起。
- **packages/shared** — 三端共享契约类型。

## 快速开始

要求：Node ≥ 22.19（DSH 运行时要求；桌面版自带 Node 22.21，无此限制）、pnpm ≥ 9。

```bash
pnpm install

# 终端 1：管理器守护进程（默认 http://127.0.0.1:4180，数据在 ~/.dsh-entities）
pnpm dev:manager

# 终端 2：可视化界面（http://127.0.0.1:5173，/api 代理到管理器）
pnpm dev:ui
```

桌面应用（Electron）：

```bash
pnpm --filter @dshm/manager build
pnpm --filter @dshm/ui build
pnpm --filter @dshm/shell dev          # 开发模式
pnpm --filter @dshm/shell package      # 打包（mac dmg/zip、win nsis、linux AppImage）
```

### 冒烟验证

```bash
curl http://127.0.0.1:4180/api/health
curl http://127.0.0.1:4180/api/versions          # 列出 npm 上全部 DSH 版本
curl -X POST http://127.0.0.1:4180/api/entities \
  -H 'content-type: application/json' \
  -d '{"name":"sandbox","version":{"source":"npm","ref":"0.1.0-rc.6"}}'
./scripts/verify-m0.sh                            # 双版本独立性回归（11 项检查）
```

## API 一览（loopback 127.0.0.1:4180）

```
GET    /api/health                    健康状态
GET    /api/entities                  实体列表
POST   /api/entities                  创建实体
GET    /api/entities/{id}             实体详情
PATCH  /api/entities/{id}             改配置 / 切版本（可自动重启）
DELETE /api/entities/{id}             删除
POST   /api/entities/{id}/start|stop  启动 / 停止
GET    /api/entities/{id}/logs        日志（?lines=N）
POST   /api/entities/{id}/snapshot    快照（spec + home 打包）
GET    /api/entities/{id}/snapshots   快照列表
POST   /api/entities/{id}/restore     回滚到某快照
GET    /api/entities/{id}/export      导出 bundle
POST   /api/entities/import           从 bundle 导入
GET    /api/versions                  版本列表（npm 实时 + 已安装）
POST   /api/versions/install          安装版本（异步任务，返回 job id）
POST   /api/versions/register-local   注册本地 checkout
GET    /api/jobs                      异步任务列表
```

## 环境变量

| 变量 | 用途 | 默认 |
|---|---|---|
| `DSHM_PORT` | 管理器端口 | `4180` |
| `DSHM_HOME` | 管理器数据根（实体 homes / 版本仓库 / 快照 / 导出） | `~/.dsh-entities` |
| `DSHM_GIT_PROXY` | git-tag 源克隆用的代理（如 `http://127.0.0.1:7897`） | 无 |
| `DSHM_DEV_UI_URL` | Electron 开发模式 UI 地址 | `http://127.0.0.1:5173` |

> 国内网络提示：npm 安装慢可设 `npm_config_registry=https://registry.npmmirror.com`；
> 从 GitHub 克隆 DSH 不稳定可设 `DSHM_GIT_PROXY` 指向本地代理。

## 设计文档

详见 [docs/plan.md](./docs/plan.md)：实体模型、隔离级别、版本切换与升级安全、
M0–M4 实测记录（含踩坑）。

## 路线图

- [x] M0 实体真实拉起，双版本并行验证
- [x] M1 创建向导 / 实体详情 / 异步安装 / 版本切换
- [x] M2 快照 / 回滚 / 导出导入
- [x] M3 版本管理与 git-tag 源
- [x] M4 Electron 桌面壳 + 打包
- [ ] L2/L3 隔离（landlock 沙箱 / Docker 容器后端）
- [ ] 状态推送（SSE）替代轮询
- [ ] CI 产物分发（GitHub Release 附打包产物）

## License

[MIT](./LICENSE)
