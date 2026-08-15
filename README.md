# DSH Entity Manager

一个本地桌面应用：管理多个独立的 DSH（DeepSeek Harness）实体，每个实体
可锁定不同的 DSH 版本，互不干扰。

## 打包（生成桌面应用产物）

### 一键打包（推荐，无需编程经验）

- **macOS**：双击项目根目录的 **`build-app.command`**，脚本会自动：
  安装依赖 → 构建 → 生成安装包 → 打开产物文件夹并提示安装包位置。
- **Windows**：双击项目根目录的 **`build-app.bat`**，流程相同。

（首次使用需已安装 Node.js 与 pnpm；打包机需要能联网下载依赖。）

### 手动打包

前置要求：Node ≥ 22、pnpm ≥ 9。

```bash
pnpm install
pnpm --filter @dshm/manager build
pnpm --filter @dshm/ui build
pnpm --filter @dshm/shell package
```

产物在项目一级目录 `release/`：

| 平台 | 产物 |
|---|---|
| macOS | `DSH Entity Manager-*-mac.zip`（解压即用）|
| Windows | `*-win-unpacked/` + nsis 安装包 |
| Linux | `*.AppImage` |

## 使用产物

1. 打开应用（macOS 解压 zip 后双击 `.app`，或 `open "DSH Entity Manager.app"`）
2. 首次使用：在 **Versions** 面板点 **install** 安装一个 DSH 版本
   （如 `0.1.0-rc.6`，从 npm 拉取，需联网；一次只装一个，安装进度和
   安装位置会直接显示在版本行中间）
3. **版本数据目录**：点 Versions 面板的 **+ 版本数据目录**，用原生文件夹
   选择器自选存放已安装版本的位置（切换时已装版本自动迁移）
4. 本地版本：点 **+ add local version** 注册你本机的 DSH 源码目录
   （如 `~/Documents/deepseek-harness`），实体可直接用本地代码运行
5. 在 **New entity** 里起名、选版本，创建实体
6. 点 **start** 启动，点 **open** 打开该实体的 Web GUI
   （创建时可选隔离级别：process / sandbox(Linux) / container(Docker)）
7. 界面右上角可切换 **中文 / English**

> 应用关闭（正常退出或关闭窗口）时会自动停止所有实体实例，不留残留进程。

## 数据都放哪

| 数据 | 位置 |
|---|---|
| 管理器数据根 | `~/.dsh-entities`（可用 `DSHM_HOME` 改）|
| 已安装的版本（可在界面中自选目录）| 默认 `~/.dsh-entities/versions/<版本号>/`（每个版本独立安装）|
| 实体数据 | `~/.dsh-entities/homes/<实体id>/`（即实体的 `$DSH_HOME`）|
| 快照 / 导出 | `~/.dsh-entities/snapshots/`、`~/.dsh-entities/exports/` |

**导出 / 导入**：实体行和实体面板的 **Export All** 可把实体包导出到自选目录；
**Import** 按钮直接选择实体包文件导入为全新实体（备份恢复 / 迁移）。

## 开发模式（可选）

```bash
pnpm dev:manager   # 管理器 API（http://127.0.0.1:4180）
pnpm dev:ui        # 界面（http://127.0.0.1:5173）
```

> 国内网络：版本安装走 npm，可用 `DSHM_NPM_REGISTRY=https://registry.npmmirror.com`
> 加速（从终端启动管理器时设置该环境变量即可）。

## License

[MIT](./LICENSE)
