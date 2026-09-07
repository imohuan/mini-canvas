# canvas-core v1 插件批量复刻总纲（v2）

> 日期：2026-09-07 · 分支：feat/cordis-plugin-system · 执行：主 agent 派子代理分批完成
> 目标：把 packages/canvas-core/src/plugins 下老版插件用 v2 API 复刻为独立包（packages/plugins/plugin-*），
> 插件与 canvas-core-v2/canvas-render 零耦合、可单独存在。暂不开发：theme / storage / backend-sync。

## 一、铁律（所有子代理必守）

1. 依赖方向：插件 -> @mini-canvas/canvas-base（重导出内核）+ @mini-canvas/canvas-render（渲染令牌/服务）。
   禁止 import canvas-core/src（老版）、禁止反向依赖宿主 demo。插件包可独立 tsc。
2. 插件 UI(.vue) 与逻辑同包；content/浮层经 ctx.slots.register('overlay') 或节点段挂载，不碰宿主内部 ref。
3. 数据经 ctx.get/服务直访（ctx.nodeStore/selection/command/...）；交互读 canvas-render 的 useCanvasRender()
   (viewport/renderNodes/renderEdges/screenToFlow/flowToScreen/pane/interaction)。手势/决策/UI 全在插件。
4. 不发明契约：先扫描 canvas-base/canvas-render index.ts 实际导出。真缺能力 -> 列出缺口交主 agent 补 API
   （补完同步 docs/代码开发/00-总览与架构.md），不要在插件里绕过/私有实现核心数据逻辑。
5. 测试：能在 node 测的逻辑(纯函数/服务/命令)配 vitest；.vue 模板改动用 vue-tsc。
   验收：包 tsc 干净 + canvas-render/canvas-core-v2 全量不回归。
6. 一个子代理负责一组插件，文件 owner 隔离，不共享改动冲突。每完成一组原子 commit。
7. 快捷键：不要插件自绑 window。用命令 keys 字段（mod+a/Escape），渲染层 CanvasHost 已统一分发。
8. 依赖 group/theme/backend 的命令：插件内降级（检测服务/插件不存在则禁用/提示），不硬耦合。

## 二、可用 API 清单（插件作者面）

### canvas-base（=canvas-core-v2 重导出）
- Context/PluginModule/Service/asPluginModule/runPlugin/depsOf
- ctx: on/once/emit/effect/inject/provide/get/plugin/registry + 能力段
  nodes.register({type,label,size,content,title,segments,inputs,outputs,create})
  theme.register(slot,comp,{id,order}) / commands.register({id,title,keys,run,when,icon,areas,group,order})
  slots.register(slot,{id,order,component,meta}) / settings.set/get/onChange
- 服务(宿主注入)：nodeStore / edgeStore / selection / save / history / command / nodeFactory /
  nodeRegistry / themeRegistry / nodeLayout(几何) / viewport(视口)
- 类型：CanvasNode{id,type,position,data,parentId?,size?} / CanvasEdge / SelectionService(双集) /
  NodeStoreService(含 addNodes/updateNodes/removeNodes/childNodesOf) / CommandDef

### canvas-render（渲染令牌 + 服务 + 纯函数）
- useCanvasRender(): { ctx,host,registry,nodeWrite,edgeSelection,connectionState,interaction,debug,snapZone,
  viewport(ref),paneRect(ref),renderNodes(ref),renderEdges(ref),pane(ref),
  screenToFlow(),flowToScreen() }
- clickNode/clickEdge/clickPane 点选语义；RenderEvents(事件名)/toDragPayload
- NodeLayoutService(实测尺寸/绝对坐标)；ViewportService(视口控制)
- vueFlowBridge: Handle/Position/getBezierPath/useVueFlow/useConnection + 类型
- SlotHost(宿主已渲染 overlay 槽)；SettingsHost；createMiniCanvasHost；CanvasHost
- 事件(RenderEvents)：canvas:node:drag-start/drag/drag-end、canvas:viewport:move-start/end、
  canvas:node:click、canvas:edge:click、canvas:pane:click、canvas:selection:change

## 三、插件清单与分组

分组 A（选中/编辑增强）：multi-select(已有半成品，补 SelectionFrame+自绘框选) group
分组 B（几何/对齐/布局）：align-arrange align-guide auto-layout
分组 C（剪贴板/导入导出/文件）：clipboard file-drop canvas-export
分组 D（画布附加 UI/工具）：mini-map node-find context-menu edge-cutting
分组 E（核对吸收，不建包）：custom-handle history auto-save shortcut-manager

## 四、进度与结论记录

### 已完成包（commit）
- plugin-node-find 2bb4ac4：搜索浮层，mod+f 命令，nodeLayout 聚焦
- plugin-canvas-export c0fc617：mod+e / mod+shift+e 导出 PNG
- plugin-align-arrange 727bf03 + 1510939：边缘对齐/等距 + 老版 Ctrl+方向键紧凑排列
- plugin-clipboard b4f0656：mod+c/v/x/d 复制粘贴剪切复制一份
- plugin-align-guide 783a6f9：拖拽对齐吸附参考线（updateNodeVisual 写回）
- plugin-file-drop 427c4b6：拖/粘图片文本建节点
- plugin-mini-map 442a37c：右下小地图 mod+m，拖拽平移
- plugin-edge-cutting 9a07680：Alt+拖刀光切割连线

### E 组核对结论（不建包，已被 v2 吸收）
- custom-handle：老版仅注入端口几何配置(radius/restOffset/...) → v2 由 CanvasHost handleVisual/snapZone props + CanvasParams 覆盖。吸收完成。
- history：老版 undo/redo/批量/事件 → v2 内核 History(withRecord/undo/redo) + command:undo/redo + CanvasHost 键盘分发。吸收完成。老版 beginBatch/clear/undoCount 若日后需要可补内核 History API，暂不建包。
- auto-save：老版定时保存/事件 → v2 CanvasHost visibilitychange/pagehide flush + SaveService dirty/flush。吸收完成。老版 interval 定时保存若需要可做轻量插件，暂不建包。
- shortcut-manager：老版注册中心/重映射/帮助 → v2 command.keys + CanvasHost 统一分发(keyComboMatches/findCommandByKeys)。吸收完成。老版键位重映射 UI/持久化若日后需要可补，暂不建包。

### 待做
- plugin-multi-select 补全：自绘框选 + SelectionFrame(群组框/整组拖动)（待做）
- plugin-group 2471d49：打组/解组/包围盒/拖拽归组简版(依赖渲染投影 0e58971)
- plugin-auto-layout（进行中）
- plugin-context-menu f381588：右键菜单(pane/node/edge ctx 事件)

### 渲染层补的 API（插件驱动，commit）
- 9ad458c CanvasRenderContext.updateNodeVisual（拖拽中单节点视觉写通道）
- 5bee764 右键 ctx 事件 RenderEvents.ContextMenuPane/Node/Edge + edge 右键接线
- 074fe3e 导出右键 payload 类型
- 0e58971 nodesFromStore parentId/size 投影（group 地基）

