# plugin-theme-gallery

## 一句话

组件展厅。大部分组件通过 `ui` 注册场按名取，做法正确；但它为了展示节点壳/连线，直接启动一块 `CanvasHost` 并装入默认主题，默认主题从可选展示对象变成了硬依赖。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-theme-gallery` |
| 身份 | installable |
| 源码文件 | 4（含 env.d.ts） |
| 测试文件 | 1 |
| 包依赖的其他插件 | `@mini-canvas/plugin-theme-default`（dependencies） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| plugin-theme-default | `themeDefaultPlugin` | 是包入口，但属于插件到插件的直接依赖 | `src/GalleryCanvasStage.vue:18` |
| canvas-render | `CanvasHost`、`useUiComponent` | 是 | `GalleryCanvasStage.vue:17`、`ThemeGalleryOverlay.vue:20` |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `ui` 场 | `useUiComponent` 取 13 个主题件 + `textPreview` | 契约 | `ThemeGalleryOverlay.vue:24-36` |
| `overlay` 槽 | 注册展厅外壳 | 契约 | `src/index.ts:27-33` |
| `doc` | 示例节点创建 | 在 `demoNodes.ts` 中 `inject=['doc']` | `src/demoNodes.ts:55` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `MemoryStorageAdapter` + `scopedKey` | 嵌入画布的预置数据 | 直接依赖 canvas-data 的物理存储键格式 | `GalleryCanvasStage.vue:22-45` |
| 默认主题插件实例 | 嵌入画布必须装它才有节点壳/连线 | 不给默认主题就无法展示画布件 | `GalleryCanvasStage.vue:24` |

## 内部职责与风险

1. **两种展示方式混在一起**：设计系统件走注册场（正确），画布件靠嵌套一个完整 `CanvasHost` + 默认主题（重）。
2. **`textPreview` 是跨插件暗名**：展厅写死 `useUiComponent('textPreview')`，但注册方是 `plugin-node-text`；不装节点插件时缺件，虽有 warn 但展厅内容会空。
3. **`plugin-theme-default` 是 dependencies 而不是 peer**：会让展厅把主题一起打包/绑定，未来换一套主题仍展示默认皮。
4. **示例数据直接写物理 key**：`GRAPH_KEY`、`GRAPH_EDGES_KEY` + `scopedKey` 是 canvas-data 的存储实现细节，不只是公开 API。

## 单独装卸判断

- 不装默认主题：展厅仍能打开，但画布件区块空白，节点壳/连线/背景无法展示。
- 不装 node-text：`textPreview` 缺失，展厅对应卡片为空。
- 卸载：只移除 overlay 槽，不影响主画布。

## 建议改法

1. 展厅增加“展示当前已装主题”的入口：通过主题注册表取 winner，不再写死 `themeDefaultPlugin`。
2. 画布件区块做成可选：没有主题/节点类型时显示说明，而不是启动一块注定空白的画布。
3. `textPreview` 这类件做成“展厅检查表”：从 `ui` 场列出实际存在的名字，缺件用占位说明。
4. 嵌入画布的示例数据改用公开的 seed/适配器接口，避免写死物理 key。

## 待验证

- 展厅的嵌套 `CanvasHost` 是否会与主画布争用全局 `ui`/`theme` 注册表；需要真机检查两次装载的隔离性。
- `demoNodes` 的 `ctx.doc` 直读与 `ctx.get('doc')` 是否等价；当前只核了运行路径。

