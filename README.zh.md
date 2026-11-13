# dsh-session-deleter

在 DeepSeek Harness 侧栏中永久删除对话，包括已归档的对话，并在删除前确认。
这是一个非官方社区插件，与 DeepSeek 官方无关。

[English](README.md)

DeepSeek Harness 只能归档对话，没有删除操作，归档后的日志会一直留在磁盘上。
本插件在会话行菜单中加入 **永久删除对话**，删除该会话的 Session 日志及其派生状态。

## 功能

- 在共享的会话行菜单（`…` 或右键）中加入一个删除项，普通对话和已归档对话都可用。
- 删除前弹出确认框，支持中英文、焦点限制、Esc 关闭和行内错误提示。
- 删除成功后侧栏行立即消失：删除文件前会先关闭空闲的 live Agent，不再出现
  “先掉进未分组、重启后才消失”的问题。
- 正在运行、或仍有进行中工作（子智能体、后台任务、定时提醒）的对话会被拒绝，
  已归档的对话也会检查。
- 当前在主视图中打开的对话会被拒绝；请先切换到其他对话。
- 删除前校验存储路径与会话 ID 是否一致。
- 关闭 Agent 或删除文件失败时，恢复临时归档状态。

## 环境要求

- DeepSeek Harness `0.2.2-rc.2`，Web GUI（插件声明
  `engines.dsh: ^0.2.2-rc.2`）。
- 无需构建，无运行时依赖。

## 安装

### 从 npm 安装

1. 打开 DeepSeek Harness 的 **设置 → 插件**。
2. 点击 **添加插件**。
3. 输入 `dsh-session-deleter` 并确认。
4. 如果提示需要重启，请重启 DeepSeek Harness。

### 从 GitHub 安装

在 **添加插件** 中输入仓库地址：

```text
https://github.com/2Wren/dsh-session-deleter
```

### 从本地目录安装

克隆仓库后，在 **添加插件** 中输入该目录的绝对路径，或让智能体执行：

```text
plugin_manager install_bundle /absolute/path/to/dsh-session-deleter
```

本地目录安装会链接该目录；替换已加载的副本需要重启。

## 使用

1. 打开侧栏会话行的 `…` 菜单，或右键该行。
2. 选择 **永久删除对话**。
3. 在确认框中确认。

已归档的对话默认隐藏。把侧栏筛选切到 **全部对话（显示已归档）** 或
**仅显示已归档** 即可看到它们。

删除成功后该行会立即消失。删除不可撤销，也没有回收站。

## 删除的内容

- 会话持久化根目录下的 Session 日志目录，包括所有已存储的格式代次和
  `session.lock` 文件。
- 该会话的投影缓存记录。
- 它在工作区中的记账、置顶和归档记录。

## 保留的内容

- 附件按内容寻址，可能被其他对话共享，因此会保留。
- 全文会话搜索索引不会重写；如果启用了该功能，索引条目可能保留到进程重启。
- 项目目录本身以及其他所有对话。

## 工作原理

DeepSeek Harness 没有会话删除 API，所以插件在 Host 端按以下顺序谨慎执行：

1. 在受认证、仅限 owner 的 `/api` 通道上注册 `POST /api/session.delete`，
   只接受 `application/json`，并校验会话 ID。
2. 通过 `ctx.sessionPersistence.stat()` 取得当前日志文件，确认路径形如
   `<项目目录>/<sessionId>/`，否则不触碰文件系统直接拒绝。
3. 询问 Workspace 活动 waterfall 是否有进行中的工作，然后归档该会话，
   让持久化归档门禁阻止新的模型步骤。
4. 插件保留 Agent 注册表本来会丢弃的 handle（包装 `ctx.agents.resume` /
   `create`），并 dispose 空闲的 live Agent。这样会话会从内存存储中移除，
   侧栏立即收到移除事件。
5. 删除 Session 目录、投影缓存记录，并清理工作区记账、置顶和归档记录。
6. 临时归档之后的任何失败都会恢复原归档状态。

实现依赖 DeepSeek Harness 的内部 API，而不只是稳定的公开接口。声明的
`engines.dsh` 范围是兼容性契约的一部分：升级 DSH 后请先测试，再放宽范围。

## 已知限制

- 当前在主视图中打开的对话不能在确认框中删除；按钮会被禁用并说明原因。
- 在本插件版本加载之前就已经打开的对话可能没有保留 handle，日志文件虽然已删除，
  侧栏行可能要等 DeepSeek Harness 重启后才消失。
- 子智能体对话会被拒绝；它们由其父对话管理。
- 版本敏感：DSH 升级可能改变插件使用的内部 API。请固定测试过的版本，
  验证后再放宽 `engines.dsh`。

## 卸载

打开 **设置 → 插件**，找到 `dsh-session-deleter` 并移除。移除插件不会恢复
它已经删除的对话。

## 开发

```bash
git clone https://github.com/2Wren/dsh-session-deleter.git
cd dsh-session-deleter
npm test          # Host、路由、live-disposal 和浏览器工厂测试
npm run pack:check
```

测试只创建临时目录，不会接触真实 profile。项目没有构建步骤：`index.js`
运行在 Host，`client.js` 是由 DeepSeek Harness 模块加载器加载的浏览器包。

在 DeepSeek Harness 中调试时，通过 **添加插件** 输入本地绝对路径安装；
Host 代码变更后需要重启。

提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，发布流程见
[RELEASING.md](RELEASING.md)。

## 许可证

[MIT](LICENSE)。DeepSeek Harness 是另一个独立项目，采用其自己的许可证；
本仓库不包含 DeepSeek Harness 源代码。
