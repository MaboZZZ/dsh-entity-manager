# DSH Entity Manager

> Manage multiple **independent DSH (DeepSeek Harness) entities** from one desktop
> app. Each entity pins its **own DSH version** (npm release / git ref / local
> checkout) with an isolated `$DSH_HOME` and port — create, start, stop, switch
> versions, snapshot & rollback, export & import, all from a visual UI.

![CI](https://img.shields.io/github/actions/workflow/status/mabozzz/dsh-entity-manager/ci.yml?branch=main)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

**Zero-intrusion**: not a single line of DSH is modified. It orchestrates DSH's
own public mechanisms — one entity = one `$DSH_HOME` (data root) + one port +
one pinned DSH version.

---

## Features

| Capability | Description |
|---|---|
| 🧩 Multi-version parallel | Entities run different DSH versions side by side (npm / git-tag / local source), fully isolated |
| 🖥 Visual | Entity dashboard, create wizard, detail view with the entity's own Web GUI embedded + live logs |
| 🔄 Version switching | Switch an entity's version with one click and auto-restart; data directory untouched; snapshot before switching, roll back anytime |
| 📦 Snapshot / migration | Export an entity as a bundle file; import it as a brand-new entity (new id + new data home) |
| 🔒 Data isolation | Each entity has its own `$DSH_HOME` — keys, sessions, config are natively isolated |
| ⚡ Desktop app | Electron shell with an in-process manager; tray, menu, open-at-login; stops all entities on quit |

## Architecture

```
┌─────────────────────────────────────────────┐
│  apps/ui (React)  dashboard · wizard · detail│
└──────────────────┬──────────────────────────┘
                   │ loopback JSON API
┌──────────────────▼──────────────────────────┐
│  apps/manager (Node daemon)                  │
│  entity CRUD · spawn/stop · health probe     │
│  version store · snapshots · import/export   │
└───┬──────────────────────┬──────────────────┘
    │ spawn (DSH_HOME=…)   │ install/scan
┌───▼──────────┐   ┌───────▼────────┐
│ entity A (v1) │   │ version store   │
│ entity B (v2) │   │ versions/       │
└──────────────┘   └────────────────┘
```

- **apps/manager** — manager daemon (Node + TS), loopback JSON API. An entity is
  spawned as `node <dsh bin> --profile web --port <n>` with
  `DSH_HOME=<entity dir>`.
- **apps/ui** — the visual interface (Vite + React), 3s polling, embedded entity GUI via iframe.
- **apps/shell** — Electron shell: in-process manager, preload bridge, tray/menu,
  open-at-login; entity processes run via `ELECTRON_RUN_AS_NODE` on Electron's
  bundled Node (22.21, satisfies DSH's ≥22.19 requirement).
- **packages/shared** — contracts shared by all three.

## Quick start

Requirements: Node ≥ 22.19 (only for the daemon/UI dev; the packaged desktop app
ships its own Node), pnpm ≥ 9.

```bash
pnpm install

# terminal 1: manager daemon (http://127.0.0.1:4180, data in ~/.dsh-entities)
pnpm dev:manager

# terminal 2: UI (http://127.0.0.1:5173, /api proxied to the manager)
pnpm dev:ui
```

Desktop app (Electron):

```bash
pnpm --filter @dshm/manager build
pnpm --filter @dshm/ui build
pnpm --filter @dshm/shell dev          # development
pnpm --filter @dshm/shell package      # package (mac dmg/zip, win nsis, linux AppImage)
```

### Smoke test

```bash
curl http://127.0.0.1:4180/api/health
curl http://127.0.0.1:4180/api/versions          # all DSH versions on npm
curl -X POST http://127.0.0.1:4180/api/entities \
  -H 'content-type: application/json' \
  -d '{"name":"sandbox","version":{"source":"npm","ref":"0.1.0-rc.6"}}'
./scripts/verify-m0.sh                            # dual-version independence regression (11 checks)
```

## API (loopback 127.0.0.1:4180)

```
GET    /api/health                     health
GET    /api/entities                   list entities
POST   /api/entities                   create entity
GET    /api/entities/{id}              entity detail
PATCH  /api/entities/{id}              update config / switch version (optional auto-restart)
DELETE /api/entities/{id}              delete
POST   /api/entities/{id}/start|stop   start / stop
GET    /api/entities/{id}/logs         logs (?lines=N)
POST   /api/entities/{id}/snapshot     snapshot (spec + home tarball)
GET    /api/entities/{id}/snapshots    list snapshots
POST   /api/entities/{id}/restore      restore a snapshot
GET    /api/entities/{id}/export       export bundle
POST   /api/entities/import            import a bundle
GET    /api/versions                   versions (live npm + installed)
POST   /api/versions/install           install a version (async job)
POST   /api/versions/register-local    register a local checkout
GET    /api/jobs                       async jobs
```

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DSHM_PORT` | manager port | `4180` |
| `DSHM_HOME` | manager data root (entity homes / version store / snapshots / exports) | `~/.dsh-entities` |
| `DSHM_GIT_PROXY` | proxy for git-tag cloning (e.g. `http://127.0.0.1:7897`) | none |
| `DSHM_DEV_UI_URL` | Electron dev-mode UI URL | `http://127.0.0.1:5173` |

> Network tips (China): set `npm_config_registry=https://registry.npmmirror.com`
> for faster npm installs; set `DSHM_GIT_PROXY` to a local proxy if GitHub
> cloning is unstable.

## Design docs

See [docs/plan.md](./docs/plan.md) (in Chinese): entity model, isolation levels,
version switching & upgrade safety, M0–M4 implementation notes.

## Roadmap

- [x] M0 real entity lifecycle, dual-version parallel verification
- [x] M1 create wizard / entity detail / async install / version switching
- [x] M2 snapshots / rollback / export-import
- [x] M3 version management + git-tag source
- [x] M4 Electron shell + packaging
- [ ] L2/L3 isolation (landlock sandbox / Docker backend)
- [ ] Server-sent events instead of polling
- [ ] CI release artifacts (attach packages to GitHub Releases)

## License

[MIT](./LICENSE)

---

# 中文说明

## 这是什么

**DSH Entity Manager**：在一个可视化桌面应用里管理多个相互独立的
**DSH（DeepSeek Harness）实体**。每个实体锁定**不同的 DSH 版本**
（npm 发布版 / git ref / 本地源码），拥有独立的 `$DSH_HOME` 和端口——
创建、启动、停止、切换版本、快照回滚、导入导出，全可视化操作。

**零侵入**：不改 DSH 一行代码，纯基于 DSH 公开机制编排。

## 功能

- **多版本并行**：不同实体可同时跑不同 DSH 版本，互不干扰
- **可视化**：实体看板、创建向导、详情页内嵌该实体的 Web GUI + 实时日志
- **版本切换**：一键切换版本自动重启，数据保留；切换前快照、随时回滚
- **快照 / 迁移**：实体导出为 bundle，可导入为全新实体
- **数据隔离**：独立 `$DSH_HOME`，密钥 / 会话 / 配置天然隔离
- **桌面应用**：Electron 壳内嵌管理器，托盘 / 菜单 / 开机自启，退出时停止全部实体

## 快速开始

```bash
pnpm install
pnpm dev:manager   # 管理器（http://127.0.0.1:4180）
pnpm dev:ui        # 界面（http://127.0.0.1:5173）
```

桌面版：`pnpm --filter @dshm/manager build && pnpm --filter @dshm/ui build && pnpm --filter @dshm/shell dev`

## 国内网络提示

- npm 安装慢：`npm_config_registry=https://registry.npmmirror.com`
- 从 GitHub 克隆不稳定：`DSHM_GIT_PROXY=http://127.0.0.1:7897`（指向你的本地代理）

## 设计文档

详见 [docs/plan.md](./docs/plan.md)：实体模型、隔离级别、版本切换与升级安全、M0–M4 实测记录（含踩坑）。
