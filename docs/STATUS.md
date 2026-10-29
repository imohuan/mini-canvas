# mini-canvas 当前状态

> 这是项目状态的**单一入口**，只记录现在有效的架构、最近完成的工作、待办和验证方式。
> 旧的 6611 行流水账已备份到 `docs/archive/STATUS-2026-10-29-full-history.md`，需要追溯时再去查。
>
> 最后更新：2026-10-29

## 一、现在是什么

mini-canvas 是一个可扩展的画布应用。画布只负责节点、连线、视口和保存；
文本、图片、视频、音频、3D、Agent、插件管理都由插件提供。

依赖方向单向：`kernel ← canvas-data ← canvas-render ← plugins`。
`packages/canvas-core` 和根目录 `src/` 是 v1，明确排除。

当前分支：`main`。最近一次提交：`f14280d7`。

## 二、最近完成（2026-10-29）

### 1. 节点上下栏统一为 `nodeToolbar`

这是本轮最大的架构变化，旧的“底栏自己摆浮层”的做法已经收口。

- `nodeToolbar` 服务由主题插件 `plugin-theme-default` 提供，位置在
  `packages/plugins/plugin-theme-default/src/components/node/nodeToolbarService.ts`。
- 一个节点上下各有一个固定插槽。**位置**（偏移、居中、反缩放）由主题的槽位宿主负责；
  **内容**由模式注册表决定。
- 顶栏和底栏**分开裁决**：同一份注册可以只声明 `topBar`，也可以只声明 `bottomBar`，
  互不覆盖。
- 三种模式地位相同：
  - 默认模式（`default`）：平时显示的顶栏和底栏；
  - 功能模式（如 `image/crop`、`image/expand`、`video/clip`）：临时接管某一根栏；
  - 同一模式 id 可以注册多份，用 `types` 区分节点类型，用 `order` 决定谁赢（小者赢）。
- 会话是纯 UI 状态，不写节点 data，也不进撤销栈。

已经接入的插件：

| 插件 | 接入内容 |
|---|---|
| `plugin-theme-default` | 提供 `nodeToolbar` 服务、`NodeModeTopBar`、`NodeModeBottomBar`、`NodeBottomSlotHost` |
| `plugin-bottom-bar` | 默认底栏内容注册为 `default` 模式，不再自己摆浮层 |
| `plugin-node-image` | 裁剪、扩展注册为功能模式 |
| `plugin-node-video` | 剪辑注册为功能模式 |
| `plugin-node-audio` | 上栏注册为默认模式 |
| `plugin-ui-demo` | 演示用工具栏通过模式注册，order 避免抢默认位置 |

相关提交：`72d375b3`、`25b75609`、`3de4d2bf`、`a1d86d41`、`4a46cfec`、`f14280d7`。

### 2. Agent 面板对齐参考设计

`plugin-agent` 的对话界面按 select-panels 参考稿重做，补了模型品牌图标、
面板阴影改用主题 token、下拉和封面样式对齐。相关提交：`46751d05`、`8ef91361`、`32ffe402`、`7cf6574c`。

### 3. 生成历史与媒体预览

- 生成历史卡片支持在同一标签页里切换前后条目（`bd69d05b`）。
- 图片陆续加载时重排合并到一帧，逐张显示不抖动；摘卡走 `masonry.remove` 并补重排，
  修掉重开面板错位和白块（`dc49ff05`、`33c2709f`）。
- 预览里的可视化界面不再抢焦点，左右键始终归预览器（`a09b4b76`）。

### 4. 底栏标签菜单

标签菜单的悬停预览按源图比例显示、最大边 200；无效引用不显示预览；
菜单宽度固定 268px；图片标签按真实类型显示预览。
相关提交：`2aa64d33`、`419e0369`、`adf382f7`、`85d5beec`。

### 5. 项目文档入口

`AGENTS.md` 已重写为项目入口，说明包结构、开发流程、Chrome 验证、调试方式和红线。
`docs/STATUS.md` 就是本文件，只保留当前状态。

## 三、正在做的事

当前工作区还有几处**未提交**的改动，正在处理媒体预览和生成历史的细节：

- `packages/plugins/plugin-agent/src/components/AgentConversation.vue`
- `packages/plugins/plugin-theme-default/src/components/ui/MediaViewer.vue`
- `packages/ui/src/components/areas/ModalsArea.vue`
- `packages/ui/src/__tests__/historyMediaCardLayout.test.ts`
- 新增：`packages/ui/src/__tests__/mediaViewerControls.test.ts`

这些改动不属于本文档范围，提交前要单独确认。

## 四、接下来

1. 把上面未提交的媒体预览改动验证完，再单独提交。
2. 继续观察 `nodeToolbar` 的兼容面：老的 `bottomBar` 主题槽是否还有调用方，
   有的话迁到模式注册，再删旧入口。
3. 新功能优先往注册场注册，不要为单个功能新增服务。
4. 每个新插件先用 Chrome 实测，再决定是否补 e2e。

## 五、验证命令

```bash
pnpm -C packages/kernel test
pnpm -C packages/canvas-data test
pnpm -C packages/canvas-render test
pnpm -C packages/ui test
pnpm -C packages/plugins/<插件名> test

pnpm -C packages/canvas-render typecheck
pnpm -C packages/ui typecheck
```

测试数量会随开发变化，以实际输出为准；全绿才继续。

## 六、调试

完整说明见 `AGENTS.md`。常用入口：

- 完整服务：`C:\Users\Administrator\Desktop\启动mini-canvas-server.ps1`
- 固定 8060：`C:\Users\Administrator\Desktop\8060-mini-canvas.ps1`
- 插件实时调试协议：`docs/plugin-dev/10-debug-protocol.md`
- 插件 watch 模板：`packages/plugins/plugin-bottom-bar/scripts/watch.mjs`

每个 Agent 用独立端口；插件 watch 指向自己的后台端口。

## 七、关键文档

- 项目入口：`AGENTS.md`
- 架构与注册场：`docs/design/core-layers-and-registry.md`
- 插件教程：`docs/plugin-dev/index.md`
- 各包 API：`docs/代码开发/00-总览与架构.md`
- UI 规范：`docs/design/ui-style-guide.md`
- 历史全文：`docs/archive/STATUS-2026-10-29-full-history.md`

