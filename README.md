# DSH Entity Manager

一个本地桌面应用：管理多个独立的 DSH（DeepSeek Harness）实体，每个实体
可锁定不同的 DSH 版本，互不干扰。

## 打包（生成桌面应用产物）

### 一键打包（推荐，无需编程经验）

- **macOS**：双击项目根目录的 **`build-app.command`**，脚本会自动：
  安装依赖 → 构建 → 生成安装包 → 打开产物文件夹并提示安装包位置。
- **Windows**：双击项目根目录的 **`build-app.bat`**，流程相同。

（首次使用需已安装 Node.js 与 pnpm，见下方前置要求；打包机需要能联网下载依赖。）

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
   （如 `0.1.0-rc.6`，从 npm 拉取，需联网；一次只装一个，安装时版本行
   右侧会出现进度动画，点最右的 `▾` 可展开看安装状态）
3. 本地版本：点 **+ add local version** 注册你本机的 DSH 源码目录
   （如 `~/Documents/deepseek-harness`），实体可直接用本地代码运行
4. 在 **New entity** 里起名、选版本（可选手动端口，或自动分配），创建实体
5. 点 **start** 启动，点 **open** 打开该实体的 Web GUI
   （创建时可选隔离级别：process / sandbox(Linux) / container(Docker)）

## 数据都放哪

| 数据 | 位置 |
|---|---|
| 管理器数据根 | `~/.dsh-entities`（可用 `DSHM_HOME` 改）|
| 已安装的版本 | `~/.dsh-entities/versions/<版本号>/`（每个版本独立安装）|
| 实体数据 | `~/.dsh-entities/homes/<实体id>/`（即实体的 `$DSH_HOME`）|
| 快照 / 导出 | `~/.dsh-entities/snapshots/`、`~/.dsh-entities/exports/` |

**Import Entity bundle**：把之前导出的实体包（spec + 数据目录）导入为全新
实体，用于备份恢复或迁移（输入导出文件在本机的路径）。

## 开发模式（可选）

```bash
pnpm dev:manager   # 管理器 API（http://127.0.0.1:4180）
pnpm dev:ui        # 界面（http://127.0.0.1:5173）
```

> 国内网络：版本安装走 npm，可用 `DSHM_NPM_REGISTRY=https://registry.npmmirror.com`
> 加速（从终端启动管理器时设置该环境变量即可）。

## License

[MIT](./LICENSE)
