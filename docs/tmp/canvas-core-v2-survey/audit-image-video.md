# canvas-core-v2 专项审核 · image + Video 节点

日期：2026-09-04 · 分支：`feat/cordis-plugin-system` · 范围：image / Video（都是 selfRender，绕 registry 在 `.vue` 里手拼 BaseToolbar，最难迁移的两类）

> 本文依据对 `packages/canvas-core/src/nodes/image|Video/` 全部文件 + `components/Decoration/*`、`components/Toolbar/BaseToolbar.vue`、`CustomNode.vue`、`registry/*`、`types/CanvasNodeData.ts`、`plugins/storage/*` 的一手逐行阅读。结论服务于 v2 自研 Cordis 式内核（ctx.plugin/inject/get/on + registry + UI 命名插槽 + 统一 save）。

---

## 一、现状（image 与 Video 各自怎么工作）

### 1.1 image 节点的数据模型

代码里实际存在**三层相互牵连的"模型"**，不只 `imageModels` 一份：

| 层 | 文件 | 内容 |
|---|---|---|
| 节点运行数据结构 | `types/CanvasNodeData.ts` | `ImageNodeData`（assetId/imageName/imageType/imageWidth/imageHeight/imageUrl + `BaseCanvasNodeData` 的 `_overlay`/cardWidth…）|
| 生成模型 Provider 抽象 | `nodes/image/imageModels.ts` | `ImageModelProvider` 接口、`ImageModelCapability`/`GenerationPayload`/`GenerationResult`/`PollState`/`PollFn`/`RunOutcome`/`RunProgress` 契约 + `LOCAL_MODELS` 本地写死模型表 + `LOCAL_IMAGE_MODEL_PROVIDER` mock 实现 + **模块级全局单例** `currentProvider` + `configureImageModels()` / `getImageModelProvider()` + UI 稳定函数（listModelOptions/getModel/ratioOptions/executeRun 轮询驱动）|
| 后台 Provider 实现 | `nodes/image/backendImageModels.ts` | `BackendImageModelProvider` 实现同一 `ImageModelProvider`（GET `/api/models`、POST `/api/tasks`、轮询 `PollFn`）|

**关键：`configureImageModels()` 是模块级单例切换，不是 DI**——页面 `McpCanvasView.vue` 里 `new BackendImageModelProvider(baseUrl)` + `configureImageModels(backend)`，靠连接态 watch 来回切，断连回落 `null`→内置 mock。

**双份点一（模板重复）**：模板预设 `LOCAL_TEMPLATES`（imageModels.ts）与 `TEMPLATES`（backendImageModels.ts，54-58 行）内容几乎一致，各维护一份。
**双份点二（类型脱节）**：`CanvasNodeData.ImageNodeData/VideoNodeData/_overlay` 已定义结构化类型，但 image/video 的 `.vue` 与全部 command 里**几乎不消费**，通篇 `props.data as any`、`Record<string,unknown>`、逐字段手拼对象；`ImageNode` 还多一个运行时持久化的 `data.options`（`ToolbarConfig`，工具栏配置/生成参数），这个字段**根本不在 `ImageNodeData` 类型里**。→ 类型文件一套、实际字段内联一套，互相不核对。

### 1.2 Video 节点的数据模型

Video **没有**独立模型文件——`videoNodeUtils.ts` 只是纯函数工具库（`fitVideoCardSize`/`clampClipRange`/`makeVideoResultNode`/`makeImageNodeFromFrame`/`downloadVideoFile`，含 `.test.mjs`）。Video 的数据字段（videoWidth/Height/Duration、cropRect/cropSourceWidth/Height、clipStart/End）在 `CanvasNodeData.VideoNodeData` 里，但 `.vue`/Plugin 同样用 `as any` 绕过。Video 无生成模型、无 backend provider。

### 1.3 Plugin.ts 各注册了什么

**image（`ImageNodePlugin.ts`）**
- `canvasNodes.register({ type:'image', selfRender:true, resizable:false, canReceiveInput/Output:true, acceptsInputs:['image','text'] })`
- `commands`：19 个——upload / addSource / crop / cropConfirm / cropCancel / expand / expandConfirm / expandCancel / mask / maskConfirm / maskCancel / maskClear / maskEraser / maskBrushConfig(no-op) / filter / rotate / download。**所有 handler 都 `(ctx.runtime as any).vueFlowInstance` 找节点再 `vf.updateNode` 手拼 data。**
- `menus`：node 菜单只有 `image:download` 一项。
- `toolbars`：
  - top `default` 组：upload(customRender=ImageUploadButton)/crop/expand/mask；
  - top `mask` 组：maskBrushConfig(customRender=MaskBrushButton)/maskClear/maskConfirm/maskCancel（visible 全部 = `_overlay._maskMode`）；
  - bottom：rotate / download（**无 BaseToolbar 渲染它们，见 1.4，实际不可达**）。
  - crop / expand 的 top 组按钮**没注册**（注释说明裁剪确认/取消改由 ImageCropper 内部 `.crop-action-bar` 提供）。

**video（`VideoNodePlugin.ts`）**
- `canvasNodes.register({ type:'video', selfRender:true, ... acceptsInputs:['image','text','video'], titleIcon })`
- `commands`：9 个（crop/cropConfirm/cropCancel、clip/clipConfirm/clipCancel、fullscreen、export-frame、download）。
- `menus`：`video:download`。
- `toolbars`：
  - top `default` 组 5 个（clip/crop/export-frame/download/fullscreen），visible 全 = `!data._overlay`；
  - top `crop` 组：cropConfirm/cropCancel（visible = `_overlay._cropMode`）；
  - top `clip` 组：clipConfirm/clipCancel（visible = `_overlay._clipMode`）。
- `panels.registerSetting('node:video', minClipDuration)`。
- **没有 upload / addSource**（video 文件素材无节点内上传入口）。

### 1.4 `.vue` 如何绕开 registry 拼 BaseToolbar

装配层 `CustomNode.vue`：对**非 selfRender** 节点，会把 `nodeDef.topToolbar/bottomToolbar` 包进 `NodeToolbar`，否则 fallback `<BaseToolbar toolbar-position="top/bottom">`（**走 toolbarRegistry**）。但 `selfRender === true` 时走 `<component :is="ContentComponent">`，**CustomNode 的整套插槽注入/topToolbar/bottomToolbar 字段全被跳过**——插件即使给 image/video 注册了 `node.bottomToolbar`，也不会被渲染。

于是两个 selfRender 节点在 `.vue` 里**复制了 CustomNode 的装配逻辑**：
- `ImageNode.vue`：外包 `<BaseNode>`，手动填 `#title-icon/#title-label/#title-extra/#top-toolbar/#content/#bottom-toolbar` 六个具名插槽；`#top-toolbar` 放 `<BaseToolbar toolbar-position="top"/>`（走 registry ✓）；`#content` 放 `<img>` + 条件渲染 `ImageCropper/ImageExpander/ImageMasker`；`#bottom-toolbar` 放 `ImageRunIndicator`（运行态，常驻 NodeToolbar）+ **自定义 `ImageBottomToolbar`**（不走 registry）。另有全屏 Dialog（Teleport body）里再嵌一份 `ImageBottomToolbar`。
- `VideoNode.vue`：同套 BaseNode 插槽；`#top-toolbar` 放 `<BaseToolbar toolbar-position="top"/>`；`#content` 放 `<video>` + 播放控件 + 裁剪覆盖层；`#bottom-toolbar` 仅在 `isClipping` 时放 `<VideoClipToolbar>`（自带确认/取消），平时 bottom 空。

**"绕开 registry 写死 BaseToolbar"的准确含义**：不是 BaseToolbar 本身绕开 registry（它恰恰是 registry 驱动），而是——(a) selfRender 节点必须**手动 import BaseNode/NodeToolbar/BaseToolbar 并自拼模板**，CustomNode 那一层注入对它们失效；(b) **bottom 工具栏彻底私有化**：image 用 ImageBottomToolbar、video 用 VideoClipToolbar，插件无法给这两个节点的 bottom 追加任何 registry 按钮。

### 1.5 `_overlay._toolbarGroup` 切组逻辑

- 进入模式：Plugin command 写 `data._overlay = { _<mode>Mode:true, _toolbarGroup:'crop'|'expand'|'mask'|'clip', _<rect|range|config> }`。
- 退出：各 cancel/confirm 里 `delete data._overlay`（手工 deep copy 后删字段再 updateNode）。
- 组过滤在 `BaseToolbar.vue` `visibleButtons`：
  ```
  btn.group 存在 且 activeGroup!==undefined 且 btn.group!==activeGroup → 隐藏
  ```
  activeGroup 未定义（无 _overlay）→ 不按组过滤（全显）；标了 group 但 activeGroup 匹配 → 显。
- **现状画像**：
  - image 三种模式的入口/操作**三套不一致**：
    - crop：入口在 top default 组；确认/取消在 `ImageCropper.vue` 内部 `.crop-action-bar`（组件内 action-bar，不走 registry，无 top crop 组按钮）；
    - expand：入口在 top default 组；确认/取消在 `ImageExpander.vue` 内部 `.expand-action-bar`（同左）；
    - mask：入口在 top default 组；确认/取消/清除/画笔在 **top `mask` 组**（走 registry + group + visible 回调）。
  - video 两种模式：crop 的确认/取消在 top `crop` 组；**clip 确认/取消同时出现在 top `clip` 组 与 bottom `VideoClipToolbar` 内建按钮**——同一操作两套入口。
- 按钮级 `visible` 回调（image mask 组、video 全部 top 按钮）与 group 过滤**双重**判断，语义重叠且易错：group 决定"组内要不要显示"，visible 又按 `_overlay._xMode` 再判一次，任意一处理解偏差就出问题。`VideoClipToolbar` 的 visible = `!_overlay` 用"有没有 _overlay"当"是否 default 态"，与 group 语义混着用。

### 1.6 资源上传与 assetId 生命周期

统一落点在 `StoragePlugin.assets = AssetManager`（`saveAsset(blob,fileName,mime) → SHA-256 assetId`，按内容哈希去重；`getObjectURL(assetId) → object URL`，内部缓存并管理 revoke）。

- **image 上传（image.upload / image.addSource）**：`URL.createObjectURL(file)` 直接当 `data.imageUrl` 展示 → `assetManager.saveAsset(file) → data.assetId`。runtime 用的是临时 object URL，assetId 落节点。
- **image 变换产物**：crop/expand/mask confirm → `canvas.toBlob → new File → saveTransformedAsset()` 得 assetId → `createResultNode()` 在源节点**右侧新建** `image-<ts>` 结果节点（sourcePosition/targetPosition 手工补）。mask 的中途蒙版存 `data.maskUrl`（blob URL，运行时态）。
- **video**：`captureFrameAt` → canvas.toBlob → saveAsset → `makeImageNodeFromFrame` 新建一个 **image** 节点（跨类型产物）。video 本体文件素材无节点上传。
- **持久化恢复**：`sanitizeForSave.ts` 把 `imageUrl/videoUrl/maskUrl/thumbUrl/panoUrl/_overlay/_cropRect/_expandRect/_maskConfig/_editing` 等 runtime 字段在保存前删除；`StoragePlugin` 巡检有 `assetId` 的节点，`getObjectURL(assetId)` 重建 object URL 再回填 `imageUrl`。**这套"手工 strip + 按 assetId 重建"是 v1 持久化的核心手写逻辑。**

### 1.7 与后端模型交互

不在 canvas-core 内核里，而在宿主页面 `McpCanvasView.vue`：
```
watch([mcp.connected, mcp.currentCanvasId]) →
  connected&&canvasId ? backend.setCanvasId(canvasId)+configureImageModels(backend)+warmUp()
                     : backend.setCanvasId(null)+configureImageModels(null)   // null→回本地 mock
```
`BackendImageModelProvider.run` → `POST /api/tasks {kind:'image', canvasId, targetNodeId, payload}`，返回轮询 PollFn 查 `/api/tasks/:id`；后台把进度/结果写回该节点 `data.runState` 并经 SSE 广播。`ImageNode` 内 `externalRun` 读 `data.runState` 驱动常驻指示器（`ImageRunIndicator`），done 时把 url 抬升到 `data.imageUrl`。**backend provider 的 baseUrl/canvasId 全靠 `new` + 页面手接，未注入内核；canvas-core 与 mcp-server 约定靠裸 fetch + 硬编码 host。**

---

## 二、逐条问题清单（按严重度）

### 🔴 严重

**P1. selfRender 把 registry/装配层整段架空了（image、video 同病）**
CustomNode 对 `selfRender` 不注入 topToolbar/bottomToolbar，节点被迫手抄一套 `<BaseNode>+<BaseToolbar>` 模板。插件想给 image/video 加按钮只能拼进 image 的 top（因它手动放了 BaseToolbar top），加不了 bottom；`node.bottomToolbar`/`topToolbar` 注册字段对 selfRender 是死字段。
**改法**：v2 把"selfRender"从"整卡自定义"收敛成"仅 content 自定义"，toolbar/title 交给统一 SlotRenderer 注入。设计成：node 组件只声明 `content`（图片 `<img>`/视频 `<video>` + overlay），外壳（标题/top/bottom 工具栏/选中环/handles）由内核 BaseNode 统一渲染；`#top-toolbar` 由 provider 填充 default 组，`#bottom-toolbar` 由 provider 填充——消灭 `.vue` 里手拼 BaseToolbar。

**P2. 工具栏"编辑模式切组"用 `_overlay._toolbarGroup` 字符串 + group 过滤 + visible 回调三层脆判断**
- 三种模式（crop/expand/mask，video 另加 clip）各模式采用**不同机制**（image crop/expand 组件内 action-bar、mask 走 top group、video crop 走 top group、clip 走 top group + bottom 双轨），无统一"模式→该显示哪些工具"模型；
- group 过滤规则依赖 `_overlay` 是否存在与值；visible 回调与 group 语义重叠；
- `_overlay` 同时承担"渲染覆盖层"和"切工具栏"两种职责，一个临时对象塞了 mode/rect/config 三件事。
**改法**：v2 把"编辑模式"固化为**显式 overlay-slot + 模式状态机**，不要用 data 字段当 UI 分派器。每种模式注册成 `node:image:overlay:crop` 插槽 + 独立的 toolbar provider；进入/退出由命令收敛，mode 用内核状态（不落盘），`_overlay` 从持久化数据里彻底消失。

**P3. image/video 的 command + .vue 用 `as any`/`Record<string,unknown>` 手工维护一份与 `CanvasNodeData` 脱节的字段方言**
image 的 data（imageUrl/imageName/assetId/cardWidth/options/_overlay…）、video 的 data（videoUrl/videoWidth/cropRect/clipStart…）在两个文件系统里各描述一遍，改字段两边不同步 → 无数 `as any` 掩盖类型错误；`ImageNodeData` 甚至漏了 `options`。
**改法**：v2 由每个节点插件 `ctx.inject` 一份**强类型节点 schema/model**，内核给该类型提供派生类型 + 默认值 + 序列化钩子；所有 command 只消费 schema 类型，禁止 `as any` 穿节点 data。

**P4. 持久化是"手工 strip runtime 字段 + 按 assetId 重建 URL"的手写管线，无统一 save**
`sanitizeForSave.ts` 用硬编码字段名黑名单删 `imageUrl/videoUrl/maskUrl/_overlay/_cropRect/...`，`StoragePlugin` 再按 assetId 巡检重建。黑名单每次加新节点类型/新 runtime 字段都要手动扩；`maskUrl`、`data.options` 这类字段是否该持久化全靠人工拿捏。这正好是 v2 `save(key,value,type)` 要根治的对象。
**改法**：v2 资源走 `ctx.save(type='resource')`：节点只持久化 `assetId`（+元数据），运行时 object URL 一律由资源服务按 assetId 懒建；"哪些字段是运行时派生、保存时该剥离"收敛成**节点 schema 的序列化声明**，不再有全局黑名单。image/video 的截图/裁剪/蒙版/扩展产物都变成"写 assetId + 建结果节点"，剥离手工 strip。

### 🟠 中

**P5. imageModels / backendImageModels：模板双份 + 模块级单例切换**
`LOCAL_TEMPLATES`（imageModels.ts）与 `TEMPLATES`（backendImageModels.ts）各一份；`configureImageModels()` 是模块级可变单例，页面 `new` + 全局 configure，不是可注入服务。backend provider 需要 baseUrl/canvasId 也靠 `new`+setter 手接。
**改法**：v2 把"模型 Provider"做成 `ctx.inject<ImageModelProvider>` 服务，image 节点插件 `ctx.get` 消费；backend 客户端作为独立服务 `ctx.inject('backend-client')`（或 resource/save 后端）注入，模板收敛成一份数据源（后台 models 接口返回即唯一真源，本地表仅作离线 fallback）。

**P6. image.rotate / image.download（bottom registry 按钮）实际上无 UI 入口**
Plugin 把 rotate/download 注册进 `toolbars` bottom，但 `ImageNode.vue` 的 `#bottom-toolbar` 被自定义 `ImageBottomToolbar` 独占、**没有放 `<BaseToolbar toolbar-position="bottom">`** → rotate/download 按钮永不渲染；`image.rotate`（`_rotation`）整个是死命令；download 仅靠 node 右键菜单 image:download 可达；`image.filter` 是整段注释掉的 dead code 却仍 `register`（`context.commands.register('image.filter')` 在注释块内吗？——实际 filter 的 toolbar 注册被注释，但 `image.filter` command 仍注册在 657 行）。V1 这里 registry 里声明了东西却不被渲染。
**改法**：v2 让 selfRender 节点 bottom 也走 provider（同 P1），则 bottom 注册的按钮自然可达；死命令（rotate/filter）随 P3 schema 一并清理或在 v2 重设计时明确入口，不留"注册了但渲染不到"的半吊子。

**P7. image/video 的 crop/expand/mask 产物"新建结果节点"逻辑与源节点叠加层状态互相污染**
`createResultNode`/`makeVideoResultNode` 在 Plugin.ts 里手写 Node 对象（id=时间戳、position 右移、sourcePosition/targetPosition 手工补、fitCardSize 各算一套）；image 和 video 各写一份几乎相同的"源节点右侧新建带端口结果节点"逻辑（image 用 `saveTransformedAsset`+`createResultNode`，video 用 `makeVideoResultNode`）。mask 的中间态还把 blob URL 写进 `data.maskUrl`。
**改法**：v2 内核提供通用"派生节点工厂"（deep-clone 源 schema + 应用变换结果 + 自动置位/建边 + save resource），image/video 的 crop/clip/mask/expand 只声明"变换算子"（输入 rect/range → 输出新 asset/新节点），不再各自手拼 Node/Position。

**P8. 工具栏/覆盖层的模式切换与 overlay 生命周期散落在 command + .vue + overlay 组件三处**
进入模式在 Plugin command（写 `_overlay` + fitView），确认/取消触发路径既在 overlay 组件内（emit cancel/confirm → ImageNode.vue 里手动 `commandRegistry.execute`），又在 registry top 组按钮（mask/video），还叠加 ESC 全局 keydown（ImageNode.vue/VideoNode.vue 各监听一份 window keydown）；一个模式状态四处手接，无单一状态机。
**改法**：v2 一个"编辑模式控制器"服务（`ctx.on('node:<id>:mode:enter'/'mode:exit')` + 单一 overlay-slot 渲染），覆盖层的 cancel/confirm/ESC 全收敛到该服务分发，节点 `.vue` 不再手绑 window 监听。

### 🟡 轻

**P9. 已入库的调试残留**：`image/ImageBottomToolbar 备份.vue` 与正式版**字节级相同**（`diff` 为空），纯冗余却被 `git ls-files` 跟踪；`image/crop-test.html` 是本地 canvas 调试页也被跟踪。
**改法**：`git rm` 这两个文件；以后 `.vue` 改前先提交，别留 `"xx 备份.vue"` 带空格文件（含空格文件名在 import/git 都是坑）。

**P10. UI 硬编码大量侵入节点组件**
SVG 图标几十段字符串写在各 Plugin.ts/.vue 顶部；`ImageBottomToolbar.vue` 910 行把 ProseMirror 编辑器、@引用资源下拉、媒体卡片、模型/比例/模板下拉、发送按钮、全屏 Dialog 全塞一个组件；硬编码宽度/`650px`/全屏 z-index 99999 等。这些 UI 不来自任何 registry/slot，宿主想换一套图片节点 UI 无从下手。
**改法**：v2 图片 bottom 拆成可组合的 UI 插槽（`node:image:prompt-editor`、`node:image:model-selector`…），编辑器/资源引用等纯 UI 抽到组件库，图标走共享 icon 注册（`ctx.icon`），节点 `.vue` 只留编排。

**P11. MaskBrushButton 用"全图扫节点找唯一 `_maskMode`"定位蒙版目标**
`MaskBrushButton.vue` 不通过 props/nodeId 拿当前节点，而是 `getNodes.value.find(n => n.data?._overlay?._maskMode===true)`——隐式假设"同一时刻只有一个蒙版节点"，多选/复用画布时一旦有第二个 _maskMode 就会错位或失效。
**改法**：v2 画笔配置按钮作为 `node:image:overlay:mask` slot 内的组件，由 slot 上下文注入当前 nodeId/目标节点，消灭全局扫描。

**P12. selfRender 节点 image/video 各自复制了 BaseNode 六插槽 + NodeToolbar 定位 + bottomOffset 读取**
两份几乎一样的插槽模板和 offset 计算（`canvas.state.core.topToolbarOffset/bottomToolbarOffset`），改一处忘另一处就错位（例如 Video 用 bottom 无、Image 跑指示器放 top NodeToolbar 等差异全靠人肉同步）。
**改法**：外壳渲染收敛到内核 BaseNode（同 P1），`.vue` 只提供 content 与若干可覆写小 slot。

---

## 三、给 v2 的最佳组合（image / Video 应如何组织）

### 3.1 注册到哪些 slot（v2 建议 slot 集合）

沿用 v2 架构文档的 `node:{type}:xxx` 命名空间，image 与 video 分别注册：

| Slot | image | video |
|---|---|---|
| `node:image:top-toolbar` | default 组：上传(customRender)/裁剪/扩展/蒙版/下载 | `node:video:top-toolbar` default：剪辑/裁剪/截图/下载/全屏 |
| `node:image:content` | `<img>` 展示组件（真正的"卡片内容"） | `node:video:content`：`<video>` + 播放控件 |
| `node:image:title/title-extra` | 标题 + 分辨率/文件大小 | `node:video:title/title-extra` |
| `node:image:overlay:crop` | ImageCropper | `node:video:overlay:crop`：VideoCropper |
| `node:image:overlay:expand` | ImageExpander | — |
| `node:image:overlay:mask` | ImageMasker | — |
| `node:image:overlay:clip` | — | `node:video:overlay:clip`：VideoClipToolbar |
| `node:image:status` | ImageRunIndicator（运行/失败常驻） | —（video 无生成运行态，不需要） |
| `node:image:bottom` | 提示词/模型/发送面板（拆小） | `node:video:controls`：播放控制条（可保持私有组件） |

工具栏"按编辑模式切组"在 v2 不再用 `_toolbarGroup`，而是 **`overlay:{mode}` 插槽天然就是该模式专属工具栏的容器**——进入 crop 时渲染 `overlay:crop` 插槽（含裁剪矩形 + 它自己的 top 确认/取消组），退出则整个销毁。crop/expand/mask/clip 各自一套完整 UI，天然隔离，无需 group 字符串过滤。

### 3.2 数据模型收敛成一份

- **节点 schema**：以 `ctx.inject` 的服务形式，一个 nodeType 一个强类型 schema（含字段默认值、runtime 派生字段声明、序列化钩子）。image = schema.image、video = schema.video、panorama/image-compare 同法收敛，消灭 `CanvasNodeData` 大 union + `as any` 双份。
- **生成模型 Provider**：`ctx.inject<ImageModelProvider>`，默认实现（本地）与后台实现都通过内核注入，**不再有模块级 `currentProvider` 单例**。模板作为后台 models 接口字段返回（收敛一份），本地模板只是离线兜底。
- 结果：`imageModels.ts` 里"类型契约 + 本地表 + mock + 模块单例 + UI 函数"一锅端拆成 schema.ts / provider 接口 / localProvider / run-执行器，各自归位。

### 3.3 selfRender 如何走 toolbar-provider

取消"selfRender 整卡自定义"，改成**只自定 content + 可选覆盖层**：
```
内核 BaseNode（统一）渲染：标题/top-toolbar/content 容器/bottom-toolbar/handles/选中环
  content slot = 节点插件自渲染的 <img>/<video>（图片/视频是"内容自定义"而非"整卡自定义"）
  top/bottom toolbar = toolbar-provider 按 nodeType + 当前 overlay 模式填充
  overlay:{mode} slot = 编辑覆盖层（裁剪框等）
```
这样 image/video 插件注册按钮（含 bottom、含 overlay 专属组）**全部可达**，`.vue` 不再手写 BaseNode/BaseToolbar/NodeToolbar，V1 里"注册了但 bottom 不渲染、rotate 死命令"的问题随之消失。

### 3.4 资源 assetId 与 `ctx.save(type='resource')` 衔接

- 节点只存 assetId（+ fileName/mime/dims 元数据），**object URL 一律运行时由资源服务按 assetId 生成**，禁止 blob URL / object URL 进节点 data 后手工 strip。
- image/video 的每个产物（crop/expand/mask 图、视频截图、clip 后视频、上传文件）统一：`ctx.resource.save(file/blob) → assetId` → 写结果节点（schema 校验）→ 资源服务懒建 URL 展示。`sanitizeForSave` 整文件废弃。
- `_overlay` 这类"临时 UI 态"不再进持久化数据——mode 由内核状态持有（见 3.1），`ctx.save` 根本碰不到它。

### 3.5 Plugin 应 inject/get 哪些服务

| 服务 | 谁提供 | image/video 插件消费 |
|---|---|---|
| `backend-client`（HTTP + baseUrl + canvasId/画布 authority） | 宿主注入 | BackendImageModelProvider.run 用它，替代裸 fetch + 页面手接 canvasId |
| `resource` / `storage`（save/resolve assetId ↔ URL） | 内核 | 上传/截图/变换产物保存、URL 重建 |
| `image-model-provider` | 默认 local，后台可注入替换 | 模型下拉/run 执行 |
| `save`（统一 key-value 持久化） | 内核 | 节点 schema/设置项落盘（config/shortcut/resource/canvas 分 type）|
| `event`（ctx.on/emit） | 内核 | 编辑模式切换、ESC、结果节点就绪通知（替代 window keydown / window CustomEvent）|
| `icon`（共享图标） | 内核 | toolbar/menu/菜单图标（替代 `.vue`/Plugin.ts 内嵌几十段 SVG 字符串）|
| `settings`（panel） | 内核 | video 的 minClipDuration 等可调项 |

跨节点类型事件：video 的 fullscreen / capture-frame 现在靠 `window.dispatchEvent(new CustomEvent('video:fullscreen'))` 跨 .vue 通信——v2 改 `ctx.emit('video:fullscreen',{nodeId})`，由 node 插件订阅，不再污染 window 全局事件名。

### 3.6 文件怎么拆才干净

**image 目录（建议）**
```
nodes/image/
  plugin.ts               —— ctx.plugin：schema+model服务+toolbar/overlay/命令注册
  imageNodeSchema.ts      —— 强类型节点数据 schema + 默认值 + 序列化（替代 ImageNodeData 手拼）
  components/
    ImageNodeShell.vue    —— 薄：content=<img> + 挂 overlay slot（替代整卡 selfRender）
    ImageUploadButton.vue / MaskBrushButton.vue   —— 走 slot 上下文拿 nodeId（修 P11）
    bottom/               —— 提示词编辑器/模型选择/发送（拆自 910 行 ImageBottomToolbar）
    status/ImageRunIndicator.vue
  overlays/
    ImageCropper.vue / ImageExpander.vue / ImageMasker.vue   —— 纯覆盖层（挂 overlay:{mode} slot）
    useImageDisplay.ts（保留，纯工具）
  providers/
    localImageModels.ts / backendImageModels.ts（收敛模板单源）
```
（约 4~5 个 .ts + 6~8 个 .vue；v1 的 12 个文件 + 备份 + 调试 html → 清清爽爽。）

**Video 目录（建议）**
```
nodes/video/
  plugin.ts / videoNodeSchema.ts / videoNodeUtils.ts（纯函数保留，含 test）
  components/VideoNodeShell.vue（content=<video>+controls）
  overlays/VideoCropper.vue / VideoClipToolbar.vue
```

---

## 四、可直接照做的结论清单

**立即删（git rm，干净历史）**
1. `packages/canvas-core/src/nodes/image/ImageBottomToolbar 备份.vue` —— 与正式版字节相同，纯冗余（P9）。
2. `packages/canvas-core/src/nodes/image/crop-test.html` —— 本地调试残留（P9）。
3. 原则：`.vue`/`.ts` 改版一律走 git，禁止在工作目录留带"备份"字样的文件（含空格文件名尤其别留）。

**v2 吸收 / 重写（M3 Registry+Slots、M4+ 迁移期做）**
4. **BaseNode 外壳化**：内核 BaseNode 统一渲染标题/top/bottom/handles，`content` 开放；image/video 从"selfRender 整卡"降为"content 自渲染 + overlay slot"（治 P1/P6/P12）。
5. **overlay-slot 状态机**：`overlay:{mode}` 显式插槽替代 `_overlay._toolbarGroup` 字符串过滤（治 P2/P8）；`_overlay` 移出节点持久化数据。
6. **强类型节点 schema 服务**（`ctx.inject`），command 与 .vue 停止 `as any`，字段单源（治 P3）。
7. **`ctx.save(type='resource'/'canvas'/'config')` + 资源服务**接管 assetId/URL，废除 `sanitizeForSave.ts` 手工黑名单 strip 与 StoragePlugin 巡检重建（治 P4）。
8. **模型 Provider 服务化 + 模板单源**：`ctx.inject/get` 取代 `configureImageModels` 全局单例；模板由后台 models 返回（本地仅 fallback）（治 P5）。
9. **事件走 `ctx.on/emit`**：替代 `window.addEventListener('keydown'/'video:fullscreen'/'video:capture-frame')` 与跨组件 CustomEvent（治 P8）。
10. **派生节点工厂**收敛 crop/expand/mask/clip 的"新建右侧结果节点"重复逻辑（治 P7）。
11. **MaskBrushButton 改 slot 上下文注入 nodeId**，去掉全图扫节点（治 P11）。

**迁移顺序建议**：先以最简节点跑通 M1–M4（v2 架构文档既定策略）→ 首批迁入 **image**（它把 toolbar-provider、overlay-slot、resource-save、model-provider 全踩一遍，是 v2 能力的最佳试金石）→ 再迁 video（复用 crop/overlay/派生节点工厂）。

---
说人话：image/Video 是两个 selfRender 节点，自己手拼了 BaseNode+BaseToolbar、绕开了 registry 的装配层，图片还带一套 910 行的私有底部工具栏和三套互相打架的编辑模式（裁剪/扩展在组件内放按钮、蒙版走 top 组）。问题根子在"整卡自定义"和"用 _overlay 字符串当 UI 状态机"、资源 URL 靠手工 strip + assetId 重建。v2 把它们降级成"只自定义 content"，工具栏/覆盖层/资源保存全交给统一 slot 与 ctx.save 接管，模型后台接入改成注入服务而不是全局 configure。文档已写到 docs/tmp/canvas-core-v2-survey/audit-image-video.md。
