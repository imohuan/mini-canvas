# canvas-core v1 简单节点审核 + v2 组合建议（text / panorama / image-compare）

日期：2026-09-04 · 分支基线：main（f72357d）
审核对象：`packages/canvas-core/src/nodes/{text,panorama,image-compare}` 及其消费的渲染体系
依据：codegraph 检索 + 逐文件精读（NodeRegistry.ts / CustomNode.vue / BaseNode.vue / BaseTitle.vue / BaseToolbar.vue / NodeToolbar.vue / Canvas.vue / useCanvasStore.ts / useCanvasFlow.ts / ContextMenuPlugin.ts / types/CanvasNodeData.ts）。相关上游侦察见同目录 `ui-slots.md`（渲染插槽全貌）、`docs/plan/canvas-core-v2-architecture.md`（v2 五层 + M1–M4）。

---

## 1. 三个节点现状

### 1.1 公共机制：节点怎么被渲染 / 建出来

- 所有业务节点在 VueFlow 里一律是 `type:'custom'`，靠 `data.nodeType` 区分业务类型。
  - 节点实例渲染入口是 `canvas.nodeTypes.custom`（store 里 = `CustomNode.vue`，useCanvasStore.ts:227-230；Canvas.vue:195-209 把它 markRaw 合进 `mergedNodeTypes` 传给 `<VueFlow :node-types>`）。**注意：`useCanvasFlow.ts:36` 另有一份 `nodeTypes={custom: BaseNode}` 并 return 出来，但 Canvas.vue 用的是 store 那份 → `useCanvasFlow` 的 nodeTypes 是死代码/并行的隐患**。
  - `CustomNode.vue` 决定两条渲染路径：
    - **组装路径（非 selfRender）**：CustomNode.vue:54-74 包 `<BaseNode v-bind="$props">`，把 `nodeDef.node` 塞进 `#content`；`#top-toolbar/#bottom-toolbar` 若 nodeDef 有自定义组件则用 `<NodeToolbar><component :is=...>`，否则默认 `<BaseToolbar toolbar-position=top|bottom>`。
    - **自渲染路径（selfRender:true）**：CustomNode.vue:53 直接 `<component :is="ContentComponent">`，由节点组件自己包 `<BaseNode>`、自己填各 slot。
  - 从菜单建节点：ContextMenuPlugin.ts `createNode`(92-120) 读 `nodeRegistry.get(type).defaultSize/resizable/canReceiveInput/canProduceOutput` 生成 `type:'custom'` 节点。
- **默认空画布 `createDefaultCanvasData`（useCanvasBootstrap.ts:6-18）只放 3 个 image 节点 + 1 条边，text/panorama/image-compare 都不在默认画布上，只能从右键/shift+a 菜单创建。**（回答“默认节点结构怎么建”：这几个节点没有内置默认实例。）

### 1.2 text

**Plugin（TextNodePlugin.ts）**注册：
- 节点定义（26-32）：`type:'text'`、`node:TextNode`、`label:'文本'`、`defaultSize:{300,200}`、`menuItem`、`canReceiveInput:false`、`resizable:true`、`titleIcon`。
- 命令（34-39）：注册 6 个**全是 stub** 的命令 `text.bold/fontsize/color/align/copy/delete`，run 都是 `noopCmd`（只打日志）。
- 工具栏（41-46）：`context.toolbars.register('node:text', …)` 注册 4 个 top（bold/fontsize/color/align）+ 2 个 bottom（copy/delete），各带 `nodeTypes:['text']`。
- **没有注册任何 MenuRegistry 项**（删除/复制等没进右键菜单）。
- 卸载：`unregister('text')/unregisterSource`。

**Vue（TextNode.vue）**：纯 content 组件。自带 text 双态（textarea 编辑 vs 只读展示）+ 三档 LOD（full/condensed/icon），用 `props.id` 判断 `nodeDoubleClick` 自定义事件进编辑。**不接触 BaseNode/toolbar**。注意：文本内容本身只存 `data.text`，编辑器关闭时并没有把 `text` 写回 data（v-model 只改本地 ref → 落盘只靠…实际上 finishEdit 只关 editing，不写回 props.data.text）→ **文本编辑不持久化**（坑，见 §2）。

**路径**：组装路径（无 selfRender），top/bottom 都走默认 BaseToolbar。但它 top/bottom 按钮全是 noop stub → **展示了 6 个点了没反应的工具栏按钮**（当前最突兀的“过度/半成品”痕迹）。

### 1.3 panorama

**Plugin（PanoramaNodePlugin.ts）**注册：
- 节点定义（175-183）：`type:'panorama'`、`node:PanoramaNode`、`label:'360全景'`、`defaultSize:{640,400}`、`menuItem(badge:'VR')`、`canReceiveInput:true / canProduceOutput:false / acceptsInputs:['image']`、`titleIcon`。**无 resizable、无 selfRender**。
- 命令（185-188）：`panorama.upload / fullscreen / reset / download`，全部在插件文件里手写大量 VueFlow 操作逻辑（handlePanoramaUpload 自己 findNode/addNodes/addEdges 建一个自动 image 节点再连线；download/reset 手搓 getEdges/filter 取上游）。**大量 `ctx.runtime as any` / `(node.data as any)`，无类型**。
- 工具栏（190-206）：top 4 个 —— upload 用 `customRender: PanoramaUploadButton`（自建上传按钮组件）、fullscreen/reset/download 各带 icon + `nodeTypes:['panorama']`。
- 事件监听（208-286）：
  - `context.on('nodeDoubleClick')` 双击无输入时置 `_editing`；
  - `context.on('paneClick')` 把所有 panorama 的 `_editing` 清掉；
  - `context.on('connect')`：限制单输入 —— 检测第 2 条 target 边时删旧边 + 删自动建的 `image-{panoramaId}-{ts}` 孤儿节点。
  - **这段 connect 过滤逻辑里全是 `console.log` 调试残留**（232-253 等），非常吵。
- 卸载：unregister + 关事件。

**Vue（PanoramaNode.vue）**：content 组件，包着整套手写 three.js 全景查看器（initThree/animate/bindEvents/destroyThree + ResizeObserver + `_editing` 控制拖拽/滚轮）+ 一个 Teleport 到 body 的 fullscreen 浮层。读 `inject(NodeIdInjection)` 拿 nodeId，用 `useUpstreamImages` 从上游 image 节点取 url（connectedImageUrl 优先于自身 data）。**不接触 BaseNode/toolbar**（全屏命令靠 `window.dispatchEvent('panorama:fullscreen')` + `addEventListener` 全局事件桥接，同 TextNode 的 `nodeDoubleClick` 一样是 window 事件 hack）。

**路径**：组装路径（无 selfRender），top 走默认 BaseToolbar + `customRender` 上传按钮。

### 1.4 image-compare

**Plugin（ImageCompareNodePlugin.ts）**注册：
- 节点定义（14-30）：`type:'image-compare'`、`node:ImageCompareNode`、`label:'图片对比'`、`defaultSize:{500,350}`、`menuItem(badge:'Compare')`、`canReceiveInput:true / canProduceOutput:false / acceptsInputs:['image']`、`resizable:false`、`titleIcon`。**不注册任何命令/工具栏/菜单项**。
- 事件（33-73）：`context.on('connect')` 限制**最多 2 条 target 输入**，第 3 条时删除最早那条（保留 newest 边）。**只处理 targetHandle==='target' 的统一输入口**。

**Vue（ImageCompareNode.vue）**：content 组件。从 `useUpstreamImages` 取前 2 个上游 image 做左右 clip-path 分割对比 + 拖分割线。它**自己 watch 图片尺寸去 updateNode 改 cardWidth/cardHeight**（79-91）。**不接触 BaseNode/toolbar**。

**路径**：组装路径（无 selfRender、无 top/bottomToolbar 字段 → 没有工具栏、也没有内容以外的任何东西，只有一个 BaseNode 空壳 + 标题 + 这个 content）。

---

## 2. 逐条问题清单（按严重度 ★ 高 / ▲ 中 / ○ 低；每条给改法）

### ★2.1 文本编辑内容不写回 data → 刷新即丢
TextNode 编辑完只 `finishEdit(){editing=false}`，从不把 `text` 写回 `props.data.text`（TextNode.vue:42-44），v-model 只更新本地 ref。落盘靠 canvas data，所以文本改动不会持久化。
**改法**：编辑失焦/回车时 `updateNode(id,{data:{...data,text}})`；或 v2 里 content 组件经统一 `ctx.updateNodeData` 提交。这也说明 content 组件与 data 之间需要一个“由组件上报改动”的正规渠道，而不是各自 v-model 本地化。

### ★2.2 panorama / image-compare 把“连接数约束”写在插件 connect 监听里，且带大量调试日志
两条几乎逐行重复的 `context.on('connect')` 手搓：查 getEdges→过滤 target→数边数→删旧边/孤儿节点（PanoramaNodePlugin.ts:231-286；ImageCompareNodePlugin.ts:33-73）。panorama 里还有十几条 `console.log`。这种“每个节点插件都要会写图遍历删边”是范式级重复。
**改法**：把“单输入/最多N输入/FIFO 挤旧”提炼成内核/registry 的一个声明式能力（如 node def 加 `inputLimit?: number | 'single'`，由内核在 connect 时统一执行 + 可配孤儿清理钩子）。v2 把这归为连接型插件能力，别让简单节点插件各自抄。

### ★2.3 selfRender 语义与实现自相矛盾 → 两路径无法统一（v2 核心雷）
- `image`/`video` 标 `selfRender:true`，但 ImageNode.vue:332 仍然自己包 `<BaseNode>`、自己填 `#title-icon/#title-label/#top-toolbar/#content/#bottom-toolbar`（ImageNode.vue:331-421）。
- 所以 v1 的“自渲染”不是“自己造 UI”，而是“**节点组件内联 BaseNode，从而能直达 BaseNode 的具名 slot**”；而 text/panorama/image-compare 这类**非 selfRender** 节点被 CustomNode 隔着包一层，只能进 `#content`，**够不到 title-icon/title-extra、无法组合多个 NodeToolbar**。
- 后果：非 selfRender 节点(简单节点)想自定义标题图标、加多个工具栏、加标题右侧徽标 → 只能要么改成 selfRender 复制 ImageNode 那套 import BaseNode/BaseToolbar/NodeToolbar 的样板，要么放弃。**一条让“简单节点”和“复杂节点”能力不对等的墙**。
**改法**（v2）：废弃 `selfRender` 布尔，统一成一个 **`NodeRenderer`**：总是由内核渲染 `<BaseNode>` 壳，content 与各段 UI 一律来自**按 nodeType 命名的 slot**（`node:{type}:content/title/top-toolbar/bottom-toolbar`）＋ toolbar 走统一 `toolbar-provider`。这样简单/复杂节点没有两套写法，能力平等。

### ★2.4 NodeRegistry 不是响应式，与 v1“注册即响应式”矛盾
ToolbarRegistry.ts:13 / MenuRegistry 用 `reactive(new Map())`，**NodeRegistry.ts:50 却是裸 `new Map()`**，非响应式。目前靠“插件注册发生在节点挂载前 + CustomNode/BaseNode 用 computed 每次现查”勉强可用；一旦运行期动态注册/注销节点类型，UI 不会自动更新。v2 目标“registry reactive(Map) 注册即响应式”其实 v1 里 NodeRegistry 就没做到。
**改法**：NodeRegistry 底层改 `reactive(new Map())`（与其余 registry 对齐）；或 v2 统一 registry 基础设施让注册触发 slot/provider 重算。

### ▲2.5 节点定义字段与 BaseNode/BaseToolbar 强耦合、且两路径字段语义分裂
`topToolbar/bottomToolbar/titleIcon/selfRender`（NodeRegistry.ts:31-38）只在**非 selfRender** 路径生效，selfRender 节点完全忽略（NodeRegistry.ts:36-38 注释也这么写）。一个 def 里躺着 4 个字段却有条件生效，调用方无法预知。
**改法**：v2 把这些字段统一成“slot 提供者”：节点定义只声明 nodeType + 默认 slot 内容（content 组件 / 各段默认渲染），不出现“某字段在某些路径被忽略”的条件。

### ▲2.6 BaseNode 具名 slot 只对“节点组件内部”开放，第三方拿不到（任务背景已点名）
CustomNode/BaseNode 的 `#content/#top-toolbar/#title/#bottom-toolbar` 是这两个组件的编译期 slot，谁能填取决于谁在模板里包了它们。registry 里没有“按 nodeType 把外部组件注入某段”的口子 → 第三方插件想给 text 加个 title-extra 徽标、给某个已有节点追加工具栏，办不到。
**改法**：v2 的 SlotRenderer 用 `node:{type}:*` 在渲染层动态解析“注册项→具名 slot”，让宿主编排与插件注入同走一套 slot，不再靠包壳组件的位置决定。

### ▲2.7 节点组件与内核/宿主通信靠 window 自定义事件
TextNode 用 `window.dispatchEvent(new CustomEvent('nodeDoubleClick'))` + `addEventListener`（TextNode.vue:58-67）；Panorama 用 `window.dispatchEvent('panorama:fullscreen')`（PanoramaNodePlugin.ts:110）+ 节点监听（PanoramaNode.vue:225-229）。无类型、无清理依赖、跨层绕。
**改法**：v2 一律走 `ctx.on/emit` 类型化事件（Cordis 内核自带作用域回收，卸载自动解除，正好治这类忘了 removeEventListener 的坑）。

### ▲2.8 panorama 命令把 VueFlow 图操作逻辑塞在 Plugin 的 command handler 里，处处 `as any`
handlePanoramaUpload/handlePanoramaReset/handlePanoramaDownload 里手写 addNodes/removeEdges/findNode 找上游，全 `ctx.runtime as any` / `(node.data as any)`（PanoramaNodePlugin.ts:36-168），与 vue-flow 耦合、类型基本裸奔，还把“自动补一个 image 节点”这种业务揉进上传命令。
**改法**：抽成内核服务（节点输入游标/上游查询/建节点并连线是通用能力，见 useUpstreamImages 已是雏形），command 只写“意图”，图操作交内核。

### ▲2.9 连接语义硬编码在“一条 target 输入边 = 一个上游”的假设里
panorama/image-compare 都只认 `targetHandle==='target'` 的单一输入口，并假定上游就是 image 节点（读上游 `data.imageUrl`）。但 v1 端口只有左进右出单口，`acceptsInputs:['image']` 只是菜单过滤提示，真正取数全靠 useUpstreamImages 按顺序猜。多类型输入（将来 video/任意）会炸。
**改法**：v2 连接模型显式化输入口/输入槽 + 端口类型（不只是“能接”布尔），让“第几个输入”与“什么类型”是 schema 的一部分。

### ▲2.10 panorama 自己的状态靠塞 `data._editing` 魔法字段 + 全局 paneClick 清扫
双击置 `_editing`、paneClick 清所有 panorama 的 `_editing`（PanoramaNodePlugin.ts:208-228），同 TextNode/Image 的 `_overlay` 家族一样是塞进 data 的隐式 UI 态。
**改法**：v2 用 `node:{type}:overlay:{mode}` 显式 overlay-slot + 状态放 store 而非污染可持久化 data（见 ui-slots §2.1.6 / 架构文档雷区）。

### ○2.11 text 节点 6 个工具栏按钮是 stub，点了没反应
TextNodePlugin.ts 的 6 个命令全是 `noopCmd`，工具栏却照常显示 → 用户看到一排“加粗/字号/颜色”却毫无反应，是 v1 半成品的可见伤疤。
**改法**：要么真的接富文本（v2 里 text 用 prosemirror-editor-bundle，仓库已有此包），要么别注册这些按钮；M4 用最简 text 闭环时**先不注册这些 stub 按钮**，等富文本落地再上。

### ○2.12 text LOD 阈值把业务(读 `canvas.state.core.textLodIconZoom`)写死在 content 组件里
TextNode 直接 `useCanvasStore()` 读全局 core 设置算 LOD（TextNode.vue:13-26）。内容组件越级依赖画布全局 store。
**改法**：v2 由 BaseNode/内核统一下发 LOD/zoom 上下文（provide/inject），content 组件只管渲染，别自己读 store。

### ○2.13 createDefaultCanvasData 只建 image，简单节点无“默认范式实例”
默认画布 3 个 image（useCanvasBootstrap.ts:6-18）。想拿 text/panorama/image-compare 当“模板示范”没有落点 —— 这跟 M4 想用“最简节点跑闭环”直接相关：**需要给内核配一个“createNode(type)”API + 一份默认画布 demo 数据**（§3.5）。

---

## 3. 给 v2 的最佳组合

### 3.1 简单节点在 v2 的“模板级示范”怎么写最干净（text 作新手范式）

目标：让新开发者抄一份最小节点就能跑，所有能力走统一 slot 与 registry，**不出现两路径分叉**。建议把节点拆成“**纯 content 组件 + 纯 schema 声明**”，让节点作者永不写 BaseNode/BaseToolbar/NodeToolbar。

最小 text 范式（注册期）示意：
```
ctx.plugin('node:text', (ctx) => {
  ctx.registry.registerNode('text', {
    label: '文本',
    defaultSize: { w: 300, h: 200 },
    menu: { group: '基础', icon: '<svg…>' },
    content: TextContent,        // 只渲染自己内容，经 ctx 拿 nodeId/zoom/LOD/updateData
    title: { icon: '…' },        // 只声明图标；label 由内核(data.label)管
    resizable: true,
    // 不写 topToolbar/bottomToolbar/selfRender —— 默认不渲染工具栏
  })
})
```
要点：
- **schema 只声明“这个类型有哪些段、每段默认是什么”，不含渲染分支条件**。
- content 组件只拿一份 `ctx`（nodeId/zoom/LOD/数据读写/事件），不 import BaseNode/BaseToolbar/NodeToolbar/store。
- “编辑文本要持久化”经 `ctx.updateData`（对应 ★2.1），而不是本地 v-model 后不管。

### 3.2 `node:{type}:*` slot 集合如何覆盖组装路径

slot 集（与 ui-slots §4.2 / 架构文档一致，这里是“它怎么覆盖 v1 组装路径”）：

| v2 slot | 覆盖 v1 的什么 |
|---|---|
| `node:{type}:content` | CustomNode `#content`（`nodeDef.node`） |
| `node:{type}:title`（含 title-icon/label/extra） | BaseNode `#title` → BaseTitle 三段；非 selfRender 节点如今够不到 title-icon/extra → v2 统一可注入 |
| `node:{type}:top-toolbar` | CustomNode 的 `#top-toolbar`；无自定义时默认渲染 `toolbar:top` provider |
| `node:{type}:bottom-toolbar` | 同上 bottom |
| `node:{type}:overlay:{mode}` | 现有 `_overlay._toolbarGroup` 切组（image crop/expand/mask）、panorama `_editing` 模式 |

组合规则（把 CustomNode.vue:54-74 的 if/else 消灭）：
1. **壳固定**：内核永远渲染 `<BaseNode>`，不再有“要不要包 BaseNode”的分叉（selfRender 废弃）。
2. **每段 slot 有默认**：`resolveSlot('node:'+type+':'+seg)` 找到注册项 → 无注册项就渲染“默认 provider”（content 空占位、top/bottom 渲染 `toolbar:{position}` provider、title 渲染 title-icon+data.label）。
3. **toolbar 归 toolbar-provider**：top/bottom 工具栏内容来自 `toolbar:{position}`（按钮注册表），`node:{type}:top-toolbar` 仅当需要“整段替换/自定义组件”才注册覆盖默认 → 一个 slot 能回答“注册填哪 → 渲染层找谁 → 默认组件是啥”。
4. **错误边界 & LOD/zoom/端口统一由 BaseNode 管**，content/slot 组件不再各自处理。

这样一个 text 节点不注册任何 toolbar slot = 无工具栏；想要按钮就 `ctx.registry.registerToolbar({slot:'node:text:top-toolbar',…})` 或走 `toolbar:top`，不会再出现“6 个 noop 按钮”那种为了占位而注册的空转。

### 3.3 CustomNode 两路径如何统一成单一 NodeRenderer

- 干掉 `selfRender` 字段与 CustomNode.vue:53 的分叉。
- 单一 `NodeRenderer.vue`：职责 =（1）查 node def/slot provider；（2）渲染固定 `<BaseNode>` 壳；（3）把各段 slot（`node:{type}:content/title/top-toolbar/bottom-toolbar`）接给 BaseNode 对应具名槽；（4）`toolbar:{position}` provider 兜底 top/bottom；（5）错误边界（现 CustomNode.vue:30-37）+ LOD/zoom 上下文注入。
- ImageNode/VideoNode（原 selfRender）改为只提供 `content` +（可选）`node:image:title/top-toolbar/...` slot 内容，去掉它们模板里手写的 BaseNode/BaseToolbar/NodeToolbar import（ImageNode.vue:331-421 收归内核）。
- 结果：三种节点从“组装 / 自渲染”两套代码，收敛成“都是 content + slot 声明”一套，能力平等、类型可推。

### 3.4 节点定义 schema 建议（接口草案，供 M3 细化）

```
interface CanvasNodeSchema {
  type: string                                   // 'text' | 'panorama' …
  label: string                                  // 菜单/默认标题
  category?: string                              // 菜单分组，替代 menuItem.group 隐式约定
  defaultSize: { w: number; h: number }
  resizable?: boolean

  // 连接能力 —— 从裸布尔升级为带“输入口”语义（对应 ★2.9）
  inputs?: { port: string; accepts: string[]; limit?: number }[]   // [{port:'target',accepts:['image'],limit:1}]
  outputs?: { port: string }[]                                      // [{port:'source'}]

  // UI 段 —— 不再有条件生效字段，全部 = 默认 slot 内容
  content: Component                            // 必填，纯内容渲染
  title?: { icon?: string|Component }            // 缺省 = 无图标 + data.label
  topToolbarSlot?: string                        // 默认 'toolbar:top'；要整段替换才给自定义
  bottomToolbarSlot?: string

  // 声明式连接约束（替代插件里手写 connect 监听，对应 ★2.2）
  onExcessInput?: 'reject' | 'drop-oldest' | 'drop-oldest-with-source-cleanup'  // image-compare=drop-oldest；panorama 需连源头 cleanup
}
```
配套把 `topToolbar/bottomToolbar/titleIcon/selfRender`（NodeRegistry.ts:31-38）全部移除；`canReceiveInput/canProduceOutput/acceptsInputs` 并入上面 `inputs/outputs`。

### 3.5 这三个简单节点能否当 v2 M4 首个 demo 载体 —— 能，且建议分两步

架构文档 M4 目标 = “建内核→装插件→画布渲染→编辑→保存→刷新恢复”闭环，建议用最简节点。结论：
- **text 是首选 demo 载体**（无连接、单组件、最容易验证闭环），但要用**最简版 text**：content 只做“显示 + 双击编辑 + 写回 data”（治 ★2.1），**先别带 6 个 stub 工具栏**（治 ★2.11）。这正好验证：内核 ctx → registry 注册 → `node:text:*` slot → BaseNode 壳渲染 → 编辑 → save(key,value) → 刷新恢复。
- panorama/image-compare **依赖连接模型 + 上游取图（useUpstreamImages）+ 输入口/类型 schema**，而这些是 M4 之后连接系统的活 → **不要在 M4 硬塞**，它们更适合当“M4 之后连接能力就绪”的第二个 demo（验证 `inputs/accepts/limit` 与孤儿清理，直接检验 ★2.2/★2.9 的新声明是否顶用）。
- 若 M4 想一次看“可连”闭环，可加一个**假想的最简可连节点**（上游接一个 image），但全景对比这类重 UI 节点留到连接型 milestone。

---

## 4. 可直接照做的结论清单

1. **改 TextNode**：编辑结束把 `text` 写回 `data`（`updateNode`/`ctx.updateData`）；M4 前删掉 6 个 noop stub 工具栏按钮，别让半成品按钮上线。
2. **改 panorama/image-compare**：删 connect 监听里的 `console.log` 调试残留；把“单输入 / 最多2输入 / 挤旧边+孤儿清理”抽成内核声明式能力（node def 的 `limit` 字段 + 孤儿清理钩子），两插件不再各自手写图遍历。
3. **统一节点渲染**：v2 废弃 `selfRender`，改单一 `NodeRenderer`（永远渲染 BaseNode 壳）+ `node:{type}:*` slot + `toolbar:{position}` provider；ImageNode/VideoNode 去掉内联的 BaseNode/BaseToolbar import，回归纯 content + slot 声明。
4. **清理 NodeRegistry**：底层 `Map` 改 `reactive(new Map())`，与 Toolbar/Menu 对齐，兑现“注册即响应式”；删除字段 `topToolbar/bottomToolbar/titleIcon/selfRender` 的条件生效语义，改统一 schema。
5. **接外部 slot**：让 SlotRenderer 按 `node:{type}:*` 在渲染层解析注册项，让第三方插件能注入/替换 title、content、工具栏段（治“BaseNode 插槽只对内部开放”）。
6. **换通信**：节点组件与宿主的 window 自定义事件（`nodeDoubleClick`/`panorama:fullscreen`）改 `ctx.on/emit` 类型化事件，白拿作用域自动回收。
7. **M4 demo 用最简 text** 跑闭环（不带 stub 工具栏、无连接）；panorama/image-compare 留到“连接系统就绪”的下一个 milestone，正好验证新的输入口/limit schema。
8. **删死代码**：`useCanvasFlow.ts` 那份 `nodeTypes={custom:BaseNode}` 与 store 的重复定义，以及无人调用的 `registerCustomNodeType`（节点走 NodeRegistry+`type:custom`，该机制悬空）—— v2 一并清理，别留双 authority。
9. 各子结论在 v2 里归口对应 slot / registry / save，不放内容组件里越级读 store（LOD 阈值等交 BaseNode/内核下发）。

---
说人话：三个简单节点本身没病，病在它们被 v1 那套“组装/自渲染两条路 + registry 不响应式 + 连接约束靠插件手搓”的架子架空了。v2 里把它们收成“纯 content 组件 + 声明式 schema”，一律走 node:{type}:* slot，就能用最简 text 在 M4 跑通闭环，全景/对比等连接型节点留到连接能力就绪后当第二个 demo。
