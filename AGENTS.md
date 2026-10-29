# AGENTS.md — mini-canvas 项目开工入口

> 本文件是项目入口：说明这是什么、有哪些包、怎么开发、怎么验证、怎么调试。
> `docs/STATUS.md` 只作为历史记录查阅，不再是每次开工必须通读的文件。
> 要动架构、分层、注册机制或加扩展点时，再读 `docs/design/core-layers-and-registry.md`。

## 一、这个项目是什么

mini-canvas 是一个可扩展的画布应用。画布本身只负责节点、连线、视口和保存；
文本、图片、视频、音频、3D 预览、Agent 对话、插件管理这些功能，都由插件加进来。

技术栈：Vue 3 + TypeScript + Vite + VueFlow。仓库用 pnpm workspace 管理多个包。

## 二、packages 里有什么

依赖方向是单向的：`kernel ← canvas-data ← canvas-render ← plugins`。

| 包 | 作用 |
|---|---|
| `packages/kernel` | 纯插件框架：装载、依赖、事件、作用域回收、注册表。没有画布概念，也不依赖 Vue。 |
| `packages/canvas-data` | 数据层和画布语义：`doc` 数据门面、节点/边、保存、撤销、选中、连接校验、节点注册。 |
| `packages/canvas-render` | 渲染层：VueFlow 宿主、DOM、注入令牌、节点布局和视口。 |
| `packages/canvas-base` | 给插件作者的薄入口，重导出 kernel 和 canvas-data 的类型与常用 API。 |
| `packages/ui` | 成品应用：装配插件、路由、外壳和设置面板，开发时用 `pnpm dev` 打开画布。 |
| `packages/plugins/*` | 插件库，当前 38 个插件包，包含主题、节点、工具、Agent、插件管理等。 |
| `packages/cloud-server` | 自托管云端：画布与资源存储、静态页面托管、MCP 接口、Agent 后台。 |
| `packages/docs` | VitePress 文档站，默认端口 5290。 |
| `packages/prosemirror-editor-bundle` | 富文本编辑器组件包，供文本节点使用。 |

`backup/canvas-core` 是已移出的 v1 老版内核，**不再参与构建，也不作为示例**。
`backup/mcp-server` 是已移出的旧 MCP 后端，当前开发以 `packages/cloud-server` 为准。
根目录的 `src/` 是 v1 老版宿主，不碰。

## 三、开发流程

默认遵循 Superpowers 流程。没有明确要求时，按下面的顺序做：

1. **先沟通**：需求不清楚时先问，不要猜着写。
2. **写计划**：列出要改哪些文件、怎么验证、有哪些风险。
3. **计划审核**：把计划交给审核（子代理或独立复核），修正后再给用户确认。
4. **用户确认后执行**：小步改、每步验证；发现计划不成立就停下来重新说明。
5. **收尾**：跑相关测试和类型检查，报告改了什么、怎么验证、还有什么风险。

默认**不创建子代理，也不创建分支**。只有用户明确说“用子代理”或“开分支”时才做。
需要子代理审核计划时，可以先用 `collaboration__spawn_agent` 做一次独立复核，复核完即结束，
不要把审核任务扩大成并行开发。

### Bug 修复

先用 `superpowers:systematic-debugging`，不要直接猜着改代码：

1. 读取错误信息并复现问题。
2. 收集日志、测试结果和调用路径等证据。
3. 定位根因，提出一个明确假设。
4. 用最小实验验证假设；失败后提出新假设，不要叠加猜测性的修复。
5. 找到根因后先写失败测试，再修复根因。
6. 运行原问题测试和回归测试，并检查是否还有相同问题。
7. 通过代码审查和独立验证后，再进入收尾。

## 四、浏览器验证：只用 Chrome 自动化

浏览器操作统一使用 `@Chrome`（`cua_repl` + Chrome 扩展），不要用 Playwright 脚本、
坐标点击或其它浏览器自动化代替。

标准流程：

1. 用 `cua.getState()` 确认 `browsers` 里有 `Chrome`，类型是 `extension`。
2. 用 `cua.getBrowser({ id })` 绑定它，先 `nameSession('🔎 任务名')` 给会话起名。
3. 用 `cua.createBrowserTab(browserId, url, { sessionName })` 开页；超时不等于失败，
   用 `cua.listTabs()` 确认标签页真的开了。
4. 等页面 `load` 后再等 1.5～2.5 秒，SPA 渲染通常比 load 晚。
5. 用语义定位（角色、文字、label）操作；每步之后读回 URL、截图或控制台日志再决定下一步。
6. 需要留给用户看的页面，调用 `markDeliverable()`；下轮还要用的调用 `markHandoff()`。

如果 Chrome 扩展没连上，先看 `docs/STATUS.md` 里的 Chrome 排障记录，
或运行浏览器插件的诊断脚本。不要因为 Chrome 暂时不可用就改用 Playwright。

### 测试顺序

**先 Chrome 实测，再决定要不要写 e2e。**

- 能通过真实浏览器验证的行为，优先用 Chrome 自动化验证。
- 只有需要长期回归、并且 Chrome 已经验证通过时，才补 e2e 脚本。
- 不要为了“看起来有测试”而写一堆 e2e；也不要用 e2e 代替真实浏览器里的目验。
- 单元测试和类型检查仍按包运行，见下一节。

## 五、验证命令

每个包各自跑测试；根目录没有统一 test 脚本。

```bash
pnpm -C packages/kernel test
pnpm -C packages/canvas-data test
pnpm -C packages/canvas-render test
pnpm -C packages/ui test
pnpm -C packages/plugins/<插件名> test

pnpm -C packages/canvas-render typecheck
pnpm -C packages/ui typecheck
```

测试数量和“当前阶段”会变，不要照抄旧数字；以实际输出为准。
全绿才继续。Chrome 实测通过后再考虑补 e2e。

## 六、怎么调试

### 一键启动完整服务

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\Administrator\Desktop\启动mini-canvas-server.ps1" -Port 8865
```

这个脚本会依次构建后台、构建前端与插件资源、释放端口、启动 `cloud-server`。
默认端口是 8865，也可以用 `-Port` 指定。

### 指定端口调试

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\Administrator\Desktop\8060-mini-canvas.ps1"
```

这个脚本固定用 8060，适合另开一份调试环境。

### 每个 Agent 用独立端口

多个 Agent 同时开发时，**每个 Agent 必须自己占一组端口**，不要共用：

- 后台用 `-Port 886x` 或 `-Port 806x`，例如 8865 / 8866 / 8867。
- 前端 dev 用 `pnpm -C packages/ui dev -- --port 528x`，例如 5288 / 5289 / 5290。
- 文档站用 `pnpm -C packages/docs dev -- --port 529x`。
- 插件 watch 用 `MINI_CANVAS_BACKEND=http://127.0.0.1:<你的端口>` 指向自己的后台，
  不要指向别人的 8865。

启动前先确认端口没被占用；脚本会自动释放自己指定的端口，但不要让它误杀别的 Agent。

### 插件实时调试

完整协议见 `docs/plugin-dev/10-debug-protocol.md`。要点：

- 插件 watch 构建成功后，把产物地址写到 `plugin-watch:<插件名>`；
- watch 进程每 10 秒发一次心跳到 `/api/plugin-presence/heartbeat`；
- 调试页根据心跳显示“监听中 / 构建中 / 构建失败 / 已停止”，心跳超时只标记失联，不自动卸载插件。

要复制一份 watch 脚本，以 `packages/plugins/plugin-bottom-bar/scripts/watch.mjs` 为模板：

```bash
cp packages/plugins/plugin-bottom-bar/scripts/watch.mjs packages/plugins/<你的插件>/scripts/watch.mjs
```

然后把 `BACKEND` 改成你自己的后台端口，或启动时传 `--backend http://127.0.0.1:<端口>`。

## 七、文件操作铁律

1. **修改文件只用 `apply_patch`**，不要用 PowerShell 写文件。
2. **每完成一个文件或一组相关修改就 commit**，不要把大量改动堆在工作区。
3. `git checkout` / `git restore` 是危险操作：执行前确认目标文件已提交或已备份。
4. 用户提供的备份文件（如 `* copy.vue`）先提交再使用。
5. 实验失败也要提交或明确回滚，不要留下未提交的实验代码。

## 八、红线

1. **不碰 v1**：根 `src/` 与 `backup/canvas-core`。
2. **核心节点件禁止改坏**：`packages/plugins/plugin-theme-default/src/components/` 下的
   `node/BaseNode.vue`、`node/MovingHandle.vue`、`node/BaseTitle.vue`、`edge/CustomEdge.vue`、
   `edge/ConnectionLine.vue`、`background/DefaultBackground.vue`。
   改动前先读 `docs/tmp/canvas-core-v2-survey/core-node-contract.md`，
   相关规范见 `docs/规则/节点区域与连接线拖拽规范.md`。
3. **kernel 不依赖任何 @mini-canvas 包**，也不 import `.vue`。
4. **写 UI 前先读** `docs/design/ui-style-guide.md`，不自造颜色、圆角、字号。

## 九、找文档

- 项目历史与排障记录：`docs/STATUS.md`（只查阅，不通读）
- 架构与注册场设计：`docs/design/core-layers-and-registry.md`
- 插件作者教程：`docs/plugin-dev/index.md`
- 插件调试协议：`docs/plugin-dev/10-debug-protocol.md`
- 各包 API 手册：`docs/代码开发/00-总览与架构.md`
- UI 规范：`docs/design/ui-style-guide.md`
- 架构决策记录：`docs/adr/`

