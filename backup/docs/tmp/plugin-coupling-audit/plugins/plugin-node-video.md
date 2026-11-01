# plugin-node-video

## 一句话

视频节点自带上传、裁剪、剪辑、截图、下载和分档帧图。它通过底栏发布动作，但源码直接 import 底栏；更关键的是“截图”会创建 `image` 类型节点并写图片字段，等于把图片插件的数据契约变成了自己的运行时依赖。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-node-video` |
| 身份 | builtin（`package.json:6-11`） |
| 源码文件 | 22 个实现文件（含一份 `VideoContent copy.vue` 备份） |
| 测试文件 | 8 个 |
| 包依赖的其他插件 | `@mini-canvas/plugin-bottom-bar`（dependencies，`package.json:26-33`） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| `@mini-canvas/plugin-bottom-bar` | `registerBarAction / publishToolActions` | 是包根出口，但仍是插件间源码依赖 | `src/nodeVideoPlugin.ts:32` |
| `@mini-canvas/canvas-base` | `Service / PluginModule / bindTypeDefaultSize` | 是 | `src/nodeVideoPlugin.ts:20` |
| `@mini-canvas/canvas-data` | `DocService` 类型 | 是 | `src/nodeVideoPlugin.ts:21` |
| `@mini-canvas/canvas-render` | `Rect`、渲染上下文、通用媒体浮层 | 是 | `src/nodeVideoPlugin.ts:28-31` |
| `@mini-canvas/plugin-theme-default` | 不在 package.json，也不直接 import；通过 `ui` 目录按名取 | 契约 | `src/VideoTopToolbar.vue:25-27`，`src/VideoFullscreenOverlay.vue:20` |
| 其它插件内部路径 | 无 | — | 无命中 |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` | `inject=['doc']` | 硬 | `src/nodeVideoPlugin.ts:93-94` |
| `nodeBar` | `ctx.tryGet('nodeBar')`，缺则等安装事件 | 可选 | `src/nodeVideoPlugin.ts:175-192` |
| `node/bar` | 剪辑动作（带自定义 `panel: VideoClipPanel`） | 可选 | `src/nodeVideoPlugin.ts:180-186` |
| `tools` | `publishToolActions({ produces:'video' })` | 可选 | `src/nodeVideoPlugin.ts:178` |
| `image` 节点类型 | 截图前检查 `doc.types.has('image')`，再创建该类型节点 | **跨插件硬契约** | `src/videoOps.ts:452-453,473-478` |
| `resources` | 视频与截图字节落地；缺则上传回落 objectURL、截图放弃 | 可选 | `src/videoOps.ts:140-157,184-188` |
| `settings` | 视频适配上限、最短剪辑、缩略图三档、`minZoom` | 可选（缺则默认） | `src/videoFit.ts:68-75`，`src/videoThumbTier.ts:69-79`，`src/VideoContent.vue:94-110` |
| `command` | 顶栏/浮层执行裁剪、剪辑确认与取消 | 契约 | `src/VideoTopToolbar.vue:81`，`src/VideoFrameOverlay.vue:48`，`src/VideoClipPanel.vue:126,134` |
| `ui` 目录 | 注册 `videoPreview`，顶栏取 `button / select`，全屏浮层取 `mediaViewer` | 可选（缺目录则按钮/预览缺失） | `src/nodeVideoPlugin.ts:169-171`，`src/VideoTopToolbar.vue:26-27`，`src/VideoFullscreenOverlay.vue:20` |
| `overlay` 槽 | 注册视频全屏预览浮层（order 43） | 契约 | `src/nodeVideoPlugin.ts:162-167` |
| `RenderEvents.PaneClick` | 点画布空白时退出裁剪/交互 | 契约 | `src/VideoContent.vue:824` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `window.setTimeout` | 控件延迟收起、帧门、重载 | 低：属于播放器交互 | `src/VideoContent.vue:180,511,514,648,730` |
| `document` | 未直接查询；裁剪指针绑元素 | 低 | 无 querySelector 命中；`src/VideoContent.vue` 只有 `window.setTimeout` |
| `fetch` | 截图 dataURL → Blob | 低 | `src/videoOps.ts:463` |
| `image` 类型 + `imageUrl/imageWidth/imageHeight` | 截图产出一个图片节点 | **高**：图片插件没装或改字段，视频截图静默失效 | `src/videoOps.ts:452-478` |
| `videoUrl/videoName/videoWidth/videoHeight/videoDuration/videoSize/cropRect` | 节点数据字段，底栏素材收集按名读 | 中：跨插件隐式字段 | `src/videoOps.ts:192-200`；消费方 `packages/plugins/plugin-bottom-bar/src/panelSource.ts:94-120` |
| `VideoContent copy.vue` | 1020 行历史备份，仍在 src 下 | 中：不会被入口 import，但会进搜索/评审视野，且有旧全屏实现 | 文件存在（46,626 字节）；`src/nodeVideoPlugin.ts:26` 只 import `./VideoContent.vue` |

## 内部职责与风险

1. **截图创建 `image` 节点**：`captureFrameNode` 先查 `hasType('image')`，再 `createNode('image', ...)` 写 `imageUrl/resourceId/imageName/imageWidth/imageHeight`（`src/videoOps.ts:444-479`）。它不是直接 import 图片包，但把图片节点的类型名、字段名和“图片插件会补尺寸”的行为写进了视频包（注释明确提到 `plugin-node-image` 的 `missingCardSizePatch`，`src/videoOps.ts:437-440`）。这符合 L3 的“写死对方实现细节”。
2. **底栏 import 与“只依赖渲染层”的注释不一致**：文件头写“不反向依赖宿主/其它节点插件”（`src/nodeVideoPlugin.ts:17-18`），但第 32 行直接 import 底栏包。底栏不是节点插件，仍是插件间依赖。
3. **顶部/浮层/播放器/会话四层职责**：`VideoContent.vue` 1243 行，`VideoPreview.vue` 592 行，`videoThumbCanvas.ts` 563 行，`VideoClipPanel.vue` 297 行。裁剪会话、剪辑会话、全屏预览、帧图缓存分散在多个文件，边界靠注释维持。
4. **两套全屏预览总线**：视频包有自己的 `mediaPreviewBus.ts`（`src/mediaPreviewBus.ts:1-35`），底栏有 `mediaPreview.ts`（`packages/plugins/plugin-bottom-bar/src/mediaPreview.ts:1-91`）。两者都叫 `openPreview/closePreview/previewItem`，但状态不共享。用户同时开底栏预览和节点双击预览时，可能出现两个浮层。
5. **测试覆盖较实**：`src/__tests__/videoOps.test.ts:300-343` 明确测了“图片类型没注册 → null，不留孤儿节点”，说明作者知道这条跨插件依赖；`src/__tests__/nodeVideoSmoke.test.ts:70-82` 测了展示段与命令，但没有底栏注册断言。跨插件边界只在“类型不存在”这一条上有测试。
6. **备份文件 `VideoContent copy.vue`**：项目规则要求用户提供的备份先提交再使用；当前它仍在 src 下，未被入口引用。建议归档到 docs 或删除，避免被误当生产代码。

## 单独装卸判断

- **单独装视频、不装图片**：视频本体、播放、裁剪、剪辑、下载都可用；截图动作会检查类型并返回 null，UI 上表现为“点了没反应”（命令返回 false）。`captureFrameNode` 有测试锁这条降级（`src/__tests__/videoOps.test.ts:325-331`）。
- **单独装视频、不装底栏**：没有剪辑入口（剪辑动作由底栏发布），但视频仍可播放、裁剪、截图、下载；全屏预览仍挂 overlay。
- **单独卸视频**：节点类型、服务、overlay、UI 目录项随 scope 回收；底栏里的 `video.clip` 动作随调用方 scope 回收。
- **先装底栏后装视频**：`ctx:plugin-installed` 补注册路径存在；缺测试。

## 建议改法

1. **最小改动：把截图产出的“图片节点创建”改成契约调用。** 优先 `ctx.tryGet('image')?.addImageNode(position, url)`（图片服务已公开 `addImageNode`，见 `plugin-node-image/src/nodeImagePlugin.ts:30-36,46-56`）；拿不到服务再回落当前 `doc` 建节点。这样字段写入由图片插件负责，视频包不再知道 `imageWidth/imageHeight`。注意：截图还需要 `resourceId/imageName` 等字段，当前 `addImageNode` 签名不够，需先扩服务。
2. **把底栏注册糖改为契约包 import。** 与底栏页同一条整改。
3. **合并两套媒体预览总线。** 在 `canvas-render` 或契约包提供 `openMediaPreview` 会话，底栏与视频节点都调同一份；避免双浮层与重复状态。
4. **处理 `VideoContent copy.vue`。** 归档到 docs 或删除；保留会让后续审查误判生产代码。
5. **补跨插件测试：装视频 + 图片 + 底栏。** 断言截图走 `image` 服务、字段由图片包写；再测不装图片时命令返回 false 且没有孤儿节点。

## 待验证

- 视频全屏预览与底栏媒体预览同时打开时的实际层叠行为；代码显示是两套独立状态，未做真机验证。
- `image` 服务的 `addImageNode` 是否足以表达截图需要的 `resourceId/imageName/imageWidth/imageHeight`；当前签名只接收 `imageUrl`，若要迁移需扩展服务契约。
- `VideoContent copy.vue` 是否曾被 `vite` 的 glob 或测试扫描到；入口未引用，但构建配置未逐行核对。
