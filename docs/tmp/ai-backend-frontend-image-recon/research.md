# mini-canvas 前端 image 节点生成链路侦察（供后端对齐）

> 侦察人：code-developer｜日期：2026-09-04
> 目的：后端移植 `imageModels`、实现 SSE / 插件同步前，弄清前端「image 节点从用户触发到真正发起生成」的完整链路，以及 options/data/端口/上游识别等精确格式。
> 阅读文件均为 `packages/canvas-core/src/nodes/image/` 与 `packages/canvas-core/src/composables/` 下的绝对路径。

---

## 0. 关键文件清单

| 文件 | 作用 |
|---|---|
| `nodes/image/ImageNode.vue` | 节点主组件；持有**生成运行态**（runStatus/runProgress），执行 `executeRun` |
| `nodes/image/ImageBottomToolbar.vue` | 底部工具栏；读/写 `data.options`（持久化配置），点「发送」组装 `GenerationPayload` |
| `nodes/image/imageModels.ts` | **Provider 对接层**（模型能力 + executeRun + configureImageModels），后端移植主战场 |
| `nodes/image/ImageNodePlugin.ts` | 节点/命令/toolbar 注册；含「建源节点+自动连线」实现 `handleImageAddSource` |
| `nodes/image/ImageRunIndicator.vue` | 节点上常驻的进度/失败浮层（读 RunProgress） |
| `nodes/image/index.ts` | 仅 re-export ImageNode/ImageCropper/ImageMasker |
| `nodes/image/useImageDisplay.ts` | object-contain 显示几何（供裁剪/扩展/蒙版内部用，与生成链路无关） |
| `composables/useUpstreamResources.ts` | **识别上游资源**（image/video/text），@ 引用 + connectedMediaResources |
| `composables/useUpstreamImages.ts` | 识别上游 image 节点原始数据（url/name/width/height） |
| `types/CanvasNodeData.ts` | node data 的类型定义 |
| `plugins/storage/sanitizeForSave.ts` / `mcp-server/src/storage/sanitize.ts` | 保存前字段清洗（同构 JSON） |

---

## 1. 节点 type 与 data 字段结构

### 1.1 注册的节点 type
- **VueFlow 节点 `type` = `'custom'`**（见 `handleImageAddSource` / `createResultNode` 里 `vf.addNodes([{ type: 'custom', ... }])`）。
- **画布自定义类型 `data.nodeType` = `'image'`**，这是全项目语义层用到的 key。
- 插件名 `node:image`（`ImageNodePlugin.name`），注册入口 `context.canvasNodes.register({ type: 'image', node: markRaw(ImageNode), label: '图片', ... canReceiveInput: true, canProduceOutput: true, acceptsInputs: ['image','text'], ... })`。
  - 注意：`register({type:'image'})` 里这个 `type` 是**画布插件层的类型 id**（语义同 `data.nodeType`），而真正写进 VueFlow 的 node 是 `type:'custom'`（由框架根据 nodeType 映射成自定义组件渲染）。

### 1.2 `data` 里存的字段（实测样例见 §7）
类型定义 `types/CanvasNodeData.ts`：

- `ImageNodeData extends BaseCanvasNodeData`：
  - 基础：`nodeType: 'image'`、`label?`、`cardWidth?`、`cardHeight?`、`resizable?`、`_overlay?`（临时覆写状态）
  - 图片：`assetId?`、`imageName?`、`imageType?`、`imageSize?`（bytes）、`imageWidth?`、`imageHeight?`、`imageUrl?`（**runtime only，保存前删除**）
- **`options?` 字段不在类型定义里**，是 ImageNode 动态写进的持久化配置（见 §3），保存时不会被 strip，**会落盘**（RUNTIME_FIELDS 无 `options`）。

### 1.3 有没有 status / progress / result 字段？
- **`data` 上没有任何 status/progress/result 字段**。
- 生成运行态完全由 **ImageNode.vue 组件内的本地 ref 持有**，不写进 data、不持久化：
  - `runStatus: Ref<ImageRunStatus>`（`'idle'|'running'|'success'|'error'`）
  - `runProgress: Ref<RunProgress>`（`{progress?, message?, taskId?}`）
  - `runError: Ref<string>`
  - 成功时**立即复位为 idle**（`runStatus.value = 'idle'`），仅在 running/error 时显示浮层。
- 参考图路径/url 存在上游节点的 `data.imageUrl` / `data.panoUrl`（保存前删除的临时 url，http 持久 url 保留）。

---

## 2. ImageBottomToolbar 读/写 options 的字段名（精确 ToolbarConfig）

持久化配置统一存 `data.options`，类型 `ToolbarConfig`（定义于 ImageBottomToolbar.vue）：

```ts
export interface ToolbarConfig {
  promptText: string          // 必填
  promptDoc?: any             // ProseMirror 富文本 doc
  selectedModel: string       // 必填，默认 'chatgpt-gpt-image-2'
  selectedRatio?: string      // 画面比例，默认 '1:1'
  selectedResolution?: string // 分辨率档位，默认 ''
  selectedTemplate?: string   // 模板 id，默认 ''
}
```

- **没有** `selectedStyle?`/`selectedSize?` 字段，前端用的是 `selectedRatio` + `selectedResolution`。
- **写入机制**：ImageNode 用本地 `toolbarConfig` ref 双向同步到 `data.options`：
  - 本地编辑 → `watch(toolbarConfig, ...)` → `updateNode(id, { data: { ...data, options: full } })`，`full = { ...defaultToolbarConfig(), ...val }`（**写完整字段集，防止丢字段**）。
  - 外部（如 MCP）写 `data.options` → `watch(() => props.data?.options)` → `initToolbarFromData()` 合并回本地（带 `applyingLocal` / `sameAsToolbar` 打破 watch 循环）。
  - 默认值：`{ promptText:'', promptDoc:null, selectedModel:'chatgpt-gpt-image-2', selectedRatio:'1:1', selectedResolution:'', selectedTemplate:'' }`。
  - 兜底：若持久化 `selectedModel` 不在 provider 注册表（`!getModel(...)`）则回落默认模型并清 ratio/resolution/template。
- **切模型原子清理**：`selectedModel` setter 里若新模型无 `ratio` 则 `selectedRatio=''`；无 `resolution` 则 `selectedResolution=''`。

---

## 3. 「发送」→ 生成完整链路

### 3.1 onSend 组装 payload（ImageBottomToolbar.vue）
```ts
function onSend() {
  if (props.isRunning) return
  const payload: GenerationPayload = {
    promptText: promptText.value,
    promptDoc: promptDoc.value,
    resources: connectedMediaResources.value,
    model: props.config.selectedModel,
    ratio: selectedRatio.value || undefined,
    resolution: selectedResolution.value || undefined,
    template: selectedTemplate.value || undefined,
  }
  emit('action', 'send', payload)
}
```
`connectedMediaResources` = `useUpstreamResources(id)` 里 `modelAcceptsInput(currentModel, kind)` 过滤后 map 成 `GenerationResource`（`{ id, kind, name, url?, value? }`），**kind 来自资源实际 kind**（image/video/text）。

### 3.2 事件上抛 + 父组件执行（ImageNode.vue）
`ImageNode.vue` 模板 `<ImageBottomToolbar ... :config="toolbarConfig" :is-running="isRunning" @update:config="toolbarConfig=$event" @action="onToolbarAction" />`：
```ts
function onToolbarAction(action, value?) {
  if (action === 'send') runGeneration(value as GenerationPayload)
  else if (action === 'more') showExpandDialog.value = !showExpandDialog.value
}
```
> 发送动作 = 字符串事件名 **`'send'`**；其它事件：`'more'`、`'input'`、`'template-apply'`。

### 3.3 executeRun 驱动（ImageNode.vue `runGeneration`）
```ts
const seq = ++runSeq
runStatus.value = 'running'; runProgress.value = {}; runError.value = ''
const result = await executeRun(payload, {
  interval: 650,                       // 轮询间隔 ms
  timeoutMs: 120_000,                  // 超时
  onProgress: (p) => { if (seq===runSeq) runProgress.value = p },
})
```
`executeRun`（定义于 imageModels.ts §executeRun）逻辑：
1. `outcome = await currentProvider.run(payload)`；
2. 若 outcome **不是函数**（是 `GenerationResult`）→ 同步返回；
3. 若是 **PollFn** → 死循环每 `interval` 调一次 `outcome()`：`running` 态经 `onProgress({progress,message,taskId})` 广播、超时返回 `{ok:false,error:'生成轮询超时'}`；`done` 态返回 `last.result`。

### 3.4 结果（生成图）如何写回节点显示 —— ⚠️ 关键现状
**当前生成的图并不写回 image 节点的 `data.imageUrl`，也不写任何 `result` 字段。**
`runGeneration` 成功后只做：
```ts
if (result.ok) {
  runStatus.value = 'idle'
  if (result.urls?.length) notifySuccess('已生成 1 张画面', { images: result.urls })  // toast 里带缩略图
  else notifySuccess('生成完成')
} else { runStatus='error'; runError=...; notifyError(...) }
```
- `result.urls` 只是传给 `notifySuccess`（vue-sonner 的 AxToast 缩略图）展示，**没有 updateNode 写回节点图片内容**。当前本地 provider 是 mock（返回 dataURL 渐变图），所以“生成图显示”目前是 toast 而非节点内。
- 因此后端若要“结果写回节点”，需要**新增**的落点：更新该节点 `data.imageUrl`/`imageName`/`imageWidth`/`imageHeight`/`assetId`，参考 ImageNodePlugin 里 `handleImageUpload`（`vf.updateNode(nodeId,{data:{...}})`)与 `createResultNode`（新建下游结果节点）两种既有写图范式。
- 运行态 `status/progress` 字段如果要落 data 持久化/同步，目前也**尚未实现**（只在组件 ref），是后端要做的前端改动点。

---

## 4. 上游资源识别（useUpstreamResources / useUpstreamImages）

### 4.1 查找上游的方式（两文件一致）
只追踪「边拓扑」，用 VueFlow `getEdges` + `findNode`：
```ts
edges
  .filter(e => e.target === nodeId && (e.targetHandle || 'target') === 'target')  // 进入本节点的边
  .map(e => findNode(e.source))                                                    // 取边的 source 节点
  .forEach(...按 source 的 data 分派资源...)
```

### 4.2 useUpstreamResources（语义全集：@ 引用 / payload.resources 来源）
`UpstreamResource`：
```ts
{ id: string;                 // = edge.source（上游节点唯一 id，@ 引用/序列化的稳定身份 key）
  kind: 'image' | 'video' | 'text'
  name: string;               // 优先 node.data.label（可重命名），否则 imageName 等文件名，兜底 '素材'/'视频'/'文本'
  url: string;                // 图片/视频类 = data.imageUrl || data.panoUrl / videoUrl；文本类 ''
  value: string;              // 文本类 = data.text；图片/视频 ''
  connected: true }
```
分派顺序（按 source 节点 data）：
1. 有 `imageUrl` 或 `panoUrl` → `kind:'image'`；
2. 有 `videoUrl` → `kind:'video'`；
3. `nodeType==='text'` → `kind:'text'`，`value=data.text`。
> 同一边只算一次（`seen` Set 去重），同一上游只会出现一个资源。

### 4.3 useUpstreamImages（只取图片，返回原始字段）
`UpstreamImageData`：`{ url, name, width, height }`，取 `data.imageUrl / imageName|label / imageWidth / imageHeight`。`useUpstreamImages` 目前在 image 生成链路里**没被直接用到**（仅裁剪/扩展内部或潜在消费），生成用的一律是 `useUpstreamResources`。

### 4.4 上游资源卡片语义（ImageBottomToolbar）
- `connectedMediaCards` = upstreamResources 里 `kind==='image'||'video'` 的子集 → 输入区顶部正方形小卡片（url 缩略，点击全屏预览）。
- `connectedImages`（给 ProseMirror @ 菜单）= upstreamResources 里 `supportsKind(kind)` 通过的子集，映射成 `ResourceItem`（id=上游 node id，name=显示名，category='素材'；文本无 url 走 data-value，图片带 url 缩略，视频带播放角标）。
- 文本里 `@token` 即上游节点 id，`resolveResource(token)` 回查。
- payload 的 `resources` 用的是 `connectedMediaResources`（不含纯 UI 卡片、只含模型可接受类型，见 §3.1）。

---

## 5. ImageNodePlugin 里「建节点/连线/自动连上游」现成实现

关键词命中：`handleImageAddSource`（注册为命令 `image.addSource`），ImageBottomToolbar 的 `onAddFileChange` 在选文件后调用它。这就是「创建新图片源节点 + 自动连线到当前节点输入端口」的**完整现成范式**：

1. `ctx.node.id` = 当前节点（target）；
2. `readImageDims(file)` 拿原图尺寸 → `fitCardSize` 缩到预览卡；
3. `vf.addNodes([{ id: `image-${nodeId}-source-${Date.now()}`, type:'custom', position:{ x: targetPos.x - cardWidth - 60, y: 垂直居中 }, data:{ nodeType:'image', label:file.name, imageUrl, imageName, imageType, imageSize, imageWidth/Height, cardWidth/Height }, sourcePosition:'right', targetPosition:'left' }])` —— **新源节点放当前节点左侧**；
4. `await 0` 等挂载 → `vf.addEdges([{ id:`e-${newNodeId}-${nodeId}-${Date.now()}`, type:'custom', source:newNodeId, target:nodeId, sourceHandle:'source', targetHandle:'target' }])`；
5. 通过 `runtime.getPluginAPI('storage').assets.saveAsset(file,...)` 持久化资产。

另有两个新建节点范式：`createResultNode`（源节点右侧建变换结果节点）、`handleImageUpload`（就地 updateNode 换当前节点图）。命令都经 `runtime.commandRegistry.execute('image.addSource', { runtime, node, nodeType:'image', ... }, { file })` 触发。

---

## 6. image 节点端口(handle) id 与命名

- **port 是单 source / 单 target**，VueFlow 约定：
  - `sourceHandle: 'source'`（输出，右，`sourcePosition:'right'`）
  - `targetHandle: 'target'`（输入，左，`targetPosition:'left'`）
- 上/下游判定均以 **`e.targetHandle === 'target'`** 为准（useUpstreamResources/useUpstreamImages 都 filter 这个）。
- **把参考图源连到生成节点输入**：建 source 节点 + `addEdges({ source: 源id, target: 生成节点id, sourceHandle:'source', targetHandle:'target' })`（见 §5 `handleImageAddSource`，可直接复用）。
- 生成节点能收 image/text 输入由其注册 `acceptsInputs:['image','text']` 决定（节点插件层），模型层再按 `supportsInput` 收窄。

---

## 7. 「前端创建 image 节点数据结构样例」（实测采自代码路径）

以下 data 形状可直接作后端反序列化/生成节点的对齐基准：

**a) 普通图片源节点**（`handleImageAddSource` 产物）：
```jsonc
{
  "id": "image-<targetNodeId>-source-<ts>",
  "type": "custom",                       // VueFlow 渲染类型，恒为 custom
  "position": { "x": 0, "y": 0 },
  "sourcePosition": "right",
  "targetPosition": "left",
  "data": {
    "nodeType": "image",                  // 语义类型 key
    "label": "photo.png",
    "imageUrl": "blob:...",               // 或 http 持久 url；保存前临时 url 会被删
    "imageName": "photo.png",
    "imageType": "image/png",
    "imageSize": 12345,                   // bytes
    "imageWidth": 1920,
    "imageHeight": 1080,
    "cardWidth": 360,                     // 预览卡宽
    "cardHeight": 270,
    "assetId": "asset-xxx"                // 可选，storage 持久化后
  }
}
```

**b) 生成(image)节点** = 上面 a 的结构 + `options`（持久化工具栏配置）：
```jsonc
"data": {
  "nodeType": "image",
  "label": "...",                         // 或用户改名
  "options": {                            // ToolbarConfig；会落盘（sanitize 不删）
    "promptText": "一只猫",
    "promptDoc": { /* ProseMirror doc，可选 */ },
    "selectedModel": "chatgpt-gpt-image-2",   // model id，见 LOCAL_MODELS
    "selectedRatio": "1:1",               // 仅模型声明 ratio 时
    "selectedResolution": "",             // 仅模型声明 resolution 时（如 apimart 的 1k/2k/4k）
    "selectedTemplate": ""                // 模板 id
  },
  "imageUrl": "...", "imageName": "...", "imageWidth": ..., "imageHeight": ..., "cardWidth": 360, "cardHeight": 270,
  "_overlay": { "_maskMode": false }      // 临时模式态，可选；保存前 strip
}
```

**c) 端口/边样例**：
```jsonc
{ "id": "e-image-A-source-img-123-B-456", "type": "custom",
  "source": "image-...-source-...", "target": "<生成节点id>",
  "sourceHandle": "source", "targetHandle": "target" }
```

**d) GenerationPayload（发送时）**：
```ts
{
  promptText: string, promptDoc?: any,
  resources: [{ id: '<上游node id>', kind: 'image'|'text'|'video', name: string, url?: string, value?: string }],
  model: string, ratio?: string, resolution?: string, template?: string
}
```

**e) RunProgress / GenerationResult / PollState（进度与结果契约，imageModels.ts）**：
```ts
RunProgress     = { progress?: number /*0-100*/, message?: string, taskId?: string }
GenerationResult= { ok: true; urls: string[]; taskId?: string } | { ok: false; error?: string }
PollState       = { status:'running'; taskId?; progress?; message? } | { status:'done'; result: GenerationResult }
RunOutcome      = GenerationResult | PollFn   // run() 可返回其一或其 Promise
```

---

## 8. configureImageModels / executeRun 等在哪里被 import / 调用（后端接管切换点）

`imageModels.ts` 暴露的统一函数接口（**UI 只依赖这些，不直接摸 provider**）：

| 符号 | 被 import / 调用位置 |
|---|---|
| `executeRun(payload, {interval,timeoutMs,onProgress})` | 仅 `ImageNode.vue` L208（runGeneration 内） |
| `getModel(modelId)` | `ImageNode.vue` L16/L138（迁移兜底）；`ImageBottomToolbar.vue` L275 |
| `listModelOptions()` | `ImageBottomToolbar.vue` L278 |
| `modelAcceptsInput(cap,kind)` | `ImageBottomToolbar.vue` L292/L401 |
| `ratioOptions(cap)` / `resolutionOptions(cap)` / `templatesForModel(modelId)` | `ImageBottomToolbar.vue` L281/L284/L288 |
| 类型 `GenerationPayload/GenerationResult/RunProgress/GenerationInputType` | `ImageNode.vue`、`ImageBottomToolbar.vue`、`ImageRunIndicator.vue`（type-only import） |
| `configureImageModels(provider)` | **目前只在 imageModels.ts 的注释/文档字符串里被提及，无任何运行时调用点**。这是预留的“一行切换后台 provider”端口 |
| `getImageModelProvider()` | 仅 imageModels.ts 自述，暂无外部调用 |

### 后端接管的含义
- **现状 provider = `LOCAL_IMAGE_MODEL_PROVIDER`（mock）**，run() 返回 PollFn 模拟异步进度与失败——UI 已按“异步轮询”形态写死，对真后台透明。
- 后端只要实现一个 `ImageModelProvider`（`listModelOptions/getCapability/listTemplates/acceptsInput/run`）并**在某引导处调用一次 `configureImageModels(backendProvider)`** 即可全局替换，UI 零改动。当前缺失该“引导调用点”，需新增（入口可能在 canvas bootstrap / useCanvasBootstrap / app 启动，本次未深挖）。
- **切换后前端仍由 ImageNode 的 runGeneration 持有运行态并驱动 executeRun**。若后端要走 SSE/事件流而非轮询，则：
  - 轻量方案：后端 `run()` 仍返回 PollFn（内部把 SSE 事件灌进一个可轮询的状态），前端 executeRun 无需改；
  - 或在 executeRun 层新增事件订阅路径（目前只支持 PollFn 轮询与同步返回两种形态）。

---

## 9. 给后端的对齐要点（速记）

1. 节点唯一身份 key = `data.nodeType`（image）→ VueFlow `type:'custom'`；边判上游靠 `sourceHandle:'source' / targetHandle:'target'`。
2. options 字段名以 ToolbarConfig 为准：`promptText/promptDoc/selectedModel/selectedRatio/selectedResolution/selectedTemplate`（无 selectedStyle/selectedSize）。
3. payload 字段名：`promptText/promptDoc/resources/model/ratio/resolution/template`；resource = `{id,kind,name,url?,value?}`。
4. run 契约：`run(payload)` 返回 `GenerationResult | PollFn`；进度快照 `RunProgress={progress,message,taskId}`；终态 `{ok,urls[],taskId?} | {ok:false,error?}`。
5. 后端主模型能力字段：`ImageModelCapability = {model,label?,ratio?,resolution?,supportsInput?,templates?,description?,mcpTool?,mcpModel?}`；当前 LOCAL_MODELS 5 个（apimart/chatgpt gpt-image-2、doubao-seedream-5lite/45/40）。
6. **待办/缺口**：生成结果目前只进 toast，未写回节点 `data`；status/progress 未落 data。后端若要结果/进度同步到节点，需前端新增 updateNode 落点（可复用 handleImageUpload 就地写图 / createResultNode 新建下游 两种范式）。
7. 切换端口 `configureImageModels(provider)` 已设计、未接线，需新增启动调用点。
