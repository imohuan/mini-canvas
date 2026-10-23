# plugin-node-image

## 一句话

图片节点把上传、裁剪、旋转、扩展、缩略图分档和生成结果写回放在一个包里。它正确地把生成动作发布给底栏，但源码直接 import 底栏；包里还留着一份已被迁移走的 `ImageGeneratePanel.vue` 旧实现，对当前已不存在的 `runImageGeneration` 产生死 import。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-node-image` |
| 身份 | builtin（`package.json:6-11`） |
| 源码文件 | 21 个实现文件 |
| 测试文件 | 12 个 |
| 包依赖的其他插件 | `@mini-canvas/plugin-bottom-bar`（dependencies，`package.json:26-33`）；`@mini-canvas/plugin-theme-default` 只在 devDependencies（`package.json:37-40`） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| `@mini-canvas/plugin-bottom-bar` | `registerBarAction / registerBarApplier / publishToolActions` | 是包根出口，但仍是插件间源码依赖 | `src/nodeImagePlugin.ts:22` |
| `@mini-canvas/canvas-base` | `Service / PluginModule / bindTypeDefaultSize` | 是 | `src/nodeImagePlugin.ts:14` |
| `@mini-canvas/canvas-data` | `DocService` 类型 | 是 | `src/nodeImagePlugin.ts:15` |
| `@mini-canvas/canvas-render` | `Rect`、顶栏/浮层的渲染上下文与通用媒体浮层 | 是 | `src/nodeImagePlugin.ts:28`，`src/ImageFrameOverlay.vue:14-17` |
| `prosemirror-editor-bundle` | 旧生成面板的编辑器 | 是共享运行时，但只被死文件使用 | `src/ImageGeneratePanel.vue:20-21` |
| 其它插件内部路径 | 无 | — | 无命中 |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` | `inject=['doc']` | 硬 | `src/nodeImagePlugin.ts:66-67` |
| `nodeBar` | `ctx.tryGet('nodeBar')`，缺则等 `ctx:plugin-installed` | 可选 | `src/nodeImagePlugin.ts:136-165` |
| `node/bar` / `node/bar-applier` | 旋转、下载、生成图片写入器 | 可选 | `src/nodeImagePlugin.ts:141-157` |
| `tools` | `publishToolActions({ produces:'image' })` | 可选 | `src/nodeImagePlugin.ts:139` |
| `settings` | 默认尺寸、图片适配上限、缩略图三档 | 可选（缺则回落默认） | `src/imageFit.ts:63-69`，`src/thumbTier.ts:82-93` |
| `resources` | 上传/生成结果写资源库，返回可显示地址与引用 | 可选（缺则不落地，回落 objectURL 或原地址） | `src/imageOps.ts:150-195`，`src/imageApplierDeps.ts:35-56` |
| `command` | 浮层确认/取消经命令执行 | 契约 | `src/ImageFrameOverlay.vue:57` |
| `ui` 目录 | 顶栏按名取 `button / select` | 可选（缺目录则按钮缺失） | `src/ImageTopToolbar.vue:21-23` |
| `overlay` / `out:top` / `over:inset` | 注册顶栏与编辑浮层 | 契约 | `src/nodeImagePlugin.ts:196-202` |
| 视频包的 `image` 类型假设 | 视频截图会创建 `type:'image'` 节点并写 `imageUrl/imageWidth/imageHeight` | 跨插件数据契约 | 见本目录 `plugin-node-video.md`；消费方 `packages/plugins/plugin-node-video/src/videoOps.ts:473-478` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `document.createElement('input')` | 选图片文件 | 低：上传动作自身职责 | `src/imageTransform.ts:182-194` |
| `Image` / `canvas` | 量尺寸、生成缩略图、裁剪/旋转 | 中：依赖浏览器 API，Node 测试用注入假货 | `src/imageApplierDeps.ts:12-22`，`src/thumbCanvas.ts:1-20` |
| `fetch` | 把远程图/生成结果取成 Blob 再入资源库 | 中：网络失败需回落 | `src/imageApplierDeps.ts:42` |
| `localStorage` | 无直接使用；注释强调不把 base64 写进去 | 低 | `src/imageTransform.ts:7`，`src/imageOps.ts:241` |
| `cardWidth/cardHeight` 卡片镜像 | 由节点尺寸派生；多个插件都读 | 中：跨插件共享隐式字段 | `src/imageFit.ts:98-120` |

## 内部职责与风险

1. **死文件 `ImageGeneratePanel.vue`**：它不在任何生产入口被 import（`src/index.ts` 只导出 `nodeImagePlugin`，`nodeImagePlugin.ts` 不 import 它），却仍 `import { runImageGeneration } from './imageRun'`（`src/ImageGeneratePanel.vue:33`），而 `imageRun.ts` 已明确只保留 `writeGeneratedImage`（`src/imageRun.ts:4-7,51-69`）。这是确定的源码不一致。
2. **包里的 `panelSource.ts` 也成了重复实现**：底栏已有一份更完整的 `collectUpstreamMaterials`（`packages/plugins/plugin-bottom-bar/src/panelSource.ts:60-143`），图片包的这份只服务死面板（`src/panelSource.ts:50-104`）。两份规则已出现差异：底栏版收音频、支持 `refOrder`，图片版不收音频。
3. **节点本体职责偏多**：上传、裁剪、扩展、旋转、下载、适配尺寸、缩略图三档、生成写入器、资源库接线都在一个包。优点是单独装图片节点就完整；代价是包内 21 个文件、测试 12 个，任何拆分都要同时动渲染与写回。
4. **图片尺寸规则与主题共享常量**：卡片下限注释写“与 theme-default 的 CARD_MIN_WIDTH/HEIGHT 同值”（`src/imageFit.ts:29`），但没有共享常量；主题改下限，图片包不会自动跟。
5. **底栏写入器依赖包内私有装配**：`createImageOpsWriteDeps` 把 `createImageOps` 的读写与资源库接线复用到写入器（`src/imageApplierDeps.ts:25-57`）。这条缝是包内 API，底栏只拿到一个 `BarApplier` 函数，耦合被收在注册处，方向可接受。
6. **测试覆盖了纯逻辑与组件渲染，但不覆盖底栏注册。** `imageToolbarsRender.test.ts` 明确说底栏渲染断言已迁走（`src/__tests__/imageToolbarsRender.test.ts:3-6`）；`imageRun.test.ts` 只测 `writeGeneratedImage`（`src/__tests__/imageRun.test.ts:11-13`）。`ImageGeneratePanel.vue` 不在生产入口，也不在测试引用里。

## 单独装卸判断

- **单独装图片、不装底栏**：顶栏上传/裁剪/旋转/下载仍可用；生成图片入口没有，因为生成动作由底栏发布。节点可正常显示。
- **单独卸图片**：视频截图会检查 `image` 类型是否存在（`packages/plugins/plugin-node-video/src/videoOps.ts:452-453`），不存在就返回 null，不建孤儿节点。图片节点数据留在画布上会变成未知类型，需宿主处理。
- **只装底栏、不装图片**：图片动作不出现；底栏不崩。
- **热装底栏**：图片包监听 `ctx:plugin-installed` 补注册（`src/nodeImagePlugin.ts:160-165`），缺测试。

## 建议改法

1. **最小改动：删除或归档 `ImageGeneratePanel.vue` 与只服务它的 `panelSource.ts`。** 这是已迁移的旧实现，保留会让 typecheck/构建出现死 import，也会让读者误以为还有两条生成路径。验证：`pnpm -C packages/plugins/plugin-node-image typecheck` 与 test。
2. **把底栏注册糖改为契约包 import。** 与底栏页同一条整改；图片包只需要动作类型与注册函数。
3. **把卡片尺寸下限与主题常量收口。** 在 `canvas-render` 暴露 `CARD_MIN_WIDTH/HEIGHT`，主题与图片/视频/对比共用。验证：三处现有测试的期望值不变。
4. **补一条真实跨插件测试：装主题 + 图片 + 底栏。** 断言 `image.rotate/image.download` 与 `tool:*` 动作出现，底栏顶栏按名取到按钮；卸载底栏后动作消失。

## 待验证

- `ImageGeneratePanel.vue` 当前是否已让 typecheck 失败；本轮只读，未运行 typecheck。按 `tsconfig include: ["src"]` 会扫到它，理论上会产生“找不到 `runImageGeneration`”的诊断，需实际跑一次确认。
- `ImageGeneratePanel.vue` 与 `panelSource.test.ts` 仍存在于 `src` 下；虽然入口不引用，但 `tsconfig include: ["src"]` 会扫描它们，删除前要确认没有测试再引用旧面板。当前 `panelSource.test.ts` 直接 import 了 `../panelSource`（`src/__tests__/panelSource.test.ts:23`）。
- `imageTransform.ts` 的下载 `.click()` 在 162-167 行，文件选择在 182-194 行；两者都需要在非浏览器环境有保护。
- 图片包与视频包对 `imageUrl/imageWidth/imageHeight` 的字段契约没有共享类型；目前靠字符串约定，需在拆包前补一对契约测试。
