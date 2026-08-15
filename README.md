# DSH Entity Manager

一个本地桌面应用：管理多个独立的 DSH（DeepSeek Harness）实体，每个实体
可锁定不同的 DSH 版本，互不干扰。

## 打包（生成桌面应用产物）

前置要求：Node ≥ 22、pnpm ≥ 9。

```bash
pnpm install
pnpm --filter @dshm/manager build
pnpm --filter @dshm/ui build
pnpm --filter @dshm/shell package
```

产物在 `apps/shell/release/`：

| 平台 | 产物 |
|---|---|
| macOS | `DSH Entity Manager-*-mac.zip`（解压即用）|
| Windows | `*-win-unpacked/` + nsis 安装包 |
| Linux | `*.AppImage` |

## 使用产物

1. 打开应用（macOS 解压 zip 后双击 `.app`，或 `open "DSH Entity Manager.app"`）
2. 首次使用：在 **Versions** 面板点 **install** 安装一个 DSH 版本
   （如 `0.1.0-rc.6`，从 npm 拉取，需联网）
3. 在 **New entity** 里起名、选版本，创建实体
4. 点 **start** 启动，点 **open** 打开该实体的 Web GUI

数据目录默认在 `~/.dsh-entities`（实体数据、版本、快照都在里面）。

## 开发模式（可选）

```bash
pnpm dev:manager   # 管理器 API（http://127.0.0.1:4180）
pnpm dev:ui        # 界面（http://127.0.0.1:5173）
```

## License

[MIT](./LICENSE)
