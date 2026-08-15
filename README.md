# DSH Entity Manager

可视化的端侧应用：在本地管理多个**相互独立的 DSH 实体**，每个实体可以
**锁定不同的 DSH 版本**（npm 发布版 / git tag / 本地源码），一键创建、
启动、停止、切换版本、回滚。

```
┌─────────────────────────────────────────────┐
│  可视化层  apps/ui（React）                    │
│  看板 · 创建向导 · 版本管理器 · 内嵌实体GUI      │
└──────────────────┬──────────────────────────┘
                   │ localhost JSON API (:4180)
┌──────────────────▼──────────────────────────┐
│  管理器守护进程  apps/manager（Node）           │
│  实体 CRUD · 进程拉起/停止 · 健康探测 · 版本仓库  │
└───┬──────────────────────┬──────────────────┘
    │ spawn (DSH_HOME=…)   │ 安装/扫描
┌───▼──────────┐   ┌───────▼────────┐
│ 实体 X (vA)   │   │ 版本仓库         │
│ 实体 Y (vB)   │   │ ~/.dsh-entities │
└──────────────┘   └────────────────┘
```

## 核心机制（基于 DSH 的真实机制，不改 DSH 一行代码）

- **数据隔离**：每个实体拥有独立的 `$DSH_HOME` 目录（DSH 的单一数据根：
  配置 / profiles / 会话 / 预设 / 密钥全都在内）。
- **版本隔离**：每个实体 pin 一个 DSH 版本，用该版本的 `dsh` bin 拉起
  （bundle 模块优先从安装本身解析，因此"用哪个版本跑"由执行哪个版本的
  bin 决定）。
- **网络隔离**：每个实体监听独立端口，有自己可访问的 Web GUI 地址。
- **升级安全**：切换版本前自动快照实体配置，支持一键回滚与"克隆实体"。

## 仓库结构

```
apps/
  manager/   管理器守护进程（Node + TS，loopback JSON API）
  ui/        可视化界面（Vite + React）
  shell/     Electron 壳（内嵌 UI + 每实体 webview 标签页）
packages/
  shared/    管理器 / UI / 壳共享的契约类型
docs/plan.md 完整设计方案
```

## 快速开始

需要 Node ≥ 22.19（DSH 的运行时要求；当前骨架对 Node 版本不敏感，M0
拉起实体时需要）。

```bash
pnpm install

# 终端 1：管理器守护进程（默认 127.0.0.1:4180，数据在 ~/.dsh-entities）
pnpm dev:manager

# 终端 2：可视化界面（http://127.0.0.1:5173，/api 代理到管理器）
pnpm dev:ui
```

```bash
# 冒烟：直接探测管理器 API
curl http://127.0.0.1:4180/api/health
curl http://127.0.0.1:4180/api/versions   # 列出 npm 上所有 DSH 版本
curl -X POST http://127.0.0.1:4180/api/entities \
  -H 'content-type: application/json' \
  -d '{"name":"sandbox","version":{"source":"npm","ref":"0.1.0-rc.6"}}'
```

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| 骨架 | 工作区 + 共享类型 + 管理器 API 骨架 + UI 看板占位 + Electron 壳 | ✅ |
| M0 | 实体真实拉起：版本安装（npm/local 源）、start/stop/健康探测/日志、独立 `$DSH_HOME`+端口、双版本并行验证 | ✅ 见 `scripts/verify-m0.sh` |
| M1 | 核心循环完善：创建向导、模型配置、状态推送、实体详情页 | ⏳ 下一步 |
| M2 | 实体详情（内嵌 GUI + 日志流）、端口分配、快照 | |
| M3 | 版本切换 / 升级快照 / 回滚、git-tag 源、实体导入导出 | |
| M4 | Electron 打包分发、托盘、自启；可选 L2/L3 隔离 | |

## 环境变量

| 变量 | 用途 | 默认 |
|---|---|---|
| `DSHM_PORT` | 管理器监听端口 | `4180` |
| `DSHM_HOME` | 管理器数据根（实体 homes / 版本仓库 / 实体清单） | `~/.dsh-entities` |
| `DSHM_DEV_UI_URL` | Electron 开发模式加载的 UI 地址 | `http://127.0.0.1:5173` |
| `DSHM_DEV` | Electron 以开发模式运行 | 未设置 |
