# plugin-edge-cutting

## 一句话

按住 Alt 拖拽，用“刀光”划过连接线把它删掉。数据写入只走 `doc.removeEdges`，方向正确；主要风险是 8 条 window 监听加 1 条 document 监听、直接拼边路径 DOM 选择器，以及全局 body 类名。

## 清单

| 项 | 值 |
|---|---|
| 包名 `@mini-canvas/plugin-edge-cutting` | 插件名 `edge-cutting` |
| 身份 | builtin |
| 源码 / 测试 | 7 个生产源文件 / 3 个测试文件（全包 10 个文件）；测试只覆盖纯逻辑，未装配真实插件 |
| 包依赖的其他插件 | 无 |
| 是否引用其他插件内部入口 | 否；也不 import canvas-render，只经 `viewport` 取根元素 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | `Context`、`PluginModule`、`ConfigSchema`、`InferConfig`、`registerEventName` | 是 | `src/edgeCuttingConfig.ts:11`；`src/edgeCuttingPlugin.ts:19-20` |
| canvas-data | `DocService`（类型） | 是 | `src/edgeCuttingPlugin.ts:21` |
| 其他插件 / canvas-render | 无运行时 import | — | — |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` | `ctx.get('doc').removeEdges` | 硬 | `src/edgeCuttingPlugin.ts:65-66,218-219` |
| `settings` | 每次手势现读 `enabled/tolerance/sampleStep/colors` | 可选（缺则全默认） | `src/edgeCuttingConfig.ts:78-94`；`src/edgeCuttingPlugin.ts:61-63,234-243` |
| `viewport.getRootEl` | 多画布时限定查询根 | 可选（缺则全局 `.vue-flow`） | `src/edgeCuttingPlugin.ts:186-189`；契约 `packages/canvas-render/src/viewport/viewportService.ts:44,116-117` |
| `edge-cutting:cut` 事件 | 通知外部“切了哪些边” | 自有广播（当前无生产消费方） | `src/edgeCuttingPlugin.ts:220,227` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `window pointerdown/move/up`、`keydown/up`、`wheel`、`blur/focus` | 捕获切割手势 | 高：捕获阶段 + `stopImmediatePropagation`，会抢占其它插件/画布 | `src/edgeCuttingPlugin.ts:127-156` |
| `document visibilitychange` | 切后台时复位 | 低 | `src/edgeCuttingPlugin.ts:121-123,134` |
| `.vue-flow` | 判“是否在画布内”/查询根 | 中：VueFlow 实现细节；多宿主可能串画布 | `src/edgeCuttingPlugin.ts:43-47,189` |
| 边 DOM 选择器（`.edge-hit-area[data-edge-id]` 等 6 条） | 找到真实 SVG path 做几何采样 | **中高**：直接依赖主题节点件的 DOM 结构 | `src/edgeCuttingCore.ts:109-119`；消费 `src/edgeCuttingCore.ts:124-129` |
| `document.body.edge-cutting-active` | 全局鼠标变十字 | 中：无命名空间；会作用于全页面 | `src/edgeCuttingPlugin.ts:159-170`；样式 `src/edgeCuttingOverlay.ts:117-119` |
| 全屏 fixed SVG + style 注入 `document.body/head` | 刀光覆盖层 | 中：全局 DOM，需 `dispose` 清理 | `src/edgeCuttingOverlay.ts:36-52,121-122,225-236` |
| `window.setTimeout` | 延迟清空刀光 | 低：overlay 卸载后仍可能回调，但只操作自身引用 | `src/edgeCuttingOverlay.ts:192-200` |

## 内部职责与风险

1. **数据入口单一**：删边只经 `doc.removeEdges`，可撤销、自动清选中，没有直接改渲染状态。
2. **DOM 采样是必要复杂度**：SVG 曲线命中需要真实 path；但选择器由插件自己维护，主题节点件一改类名/结构，切边静默失效（表现为“划了没反应”）。
3. **捕获阶段事件竞争**：Alt 按下与拖拽会 `preventDefault + stopPropagation + stopImmediatePropagation`，任何更晚注册的 window 监听都收不到；多选框选、快捷键、浏览器 Alt 菜单可能被影响。
4. **body 类无命名空间**：`edge-cutting-active` 很通用，与其它插件/宿主类名冲突风险不为零。
5. **多画布回退不安全**：`viewport.getRootEl()` 缺失时退到全局 `document.querySelector('.vue-flow')`，多画布页面会切到第一张画布。
6. **事件无生产消费方**：`edge-cutting:cut` 已登记并广播，但除自身外没有监听者；属于预留接缝，不是当前耦合点。

## 单独装卸判断

- 不装：无法切边，其它功能不变。
- 卸载：window/document 监听、overlay、style、body 类由 `ctx.effect` → `stop` → `dispose` 清理（`src/edgeCuttingOverlay.ts:225-236`）。
- 只装但不装节点/边主题：仍能切边，但 DOM 选择器可能匹配不到，切边无效。
- 多画布：缺 `viewport` 时只应单画布使用；当前没有保护。

## 建议改法

1. **最小改动**：给 body 类加前缀（如 `mc-edge-cutting-active`），并在 `apply` 开始时先清一次残留类。
2. **契约收口**：在 canvas-render 暴露“按边 id 查询可见 SVG path / 采样点”的公开方法，删除插件自拼的 6 条选择器；这是收益最大的一步。
3. **多画布保护**：缺 `viewport.getRootEl` 时直接不启用，而不是回退全局查询。
4. **事件竞争**：把 Alt 手势改成注册场/命令，让宿主统一决定优先级；至少补一条与多选/框选同时按下的测试。
5. **测试补边界**：补“多画布不串线”“主题节点件改类名后仍能找到边”“卸载后 body 类不残留”三条测试。

## 待验证

- 捕获阶段 `stopImmediatePropagation` 与多选/框选的先后顺序；未做真机竞争测试。
- `window.setTimeout` 在 overlay 卸载后回调是否只操作已置空的 `svg`；代码用可选链，风险低但未测。
- 生产环境是否存在 `edge-cutting:cut` 的消费方；当前仓库只看到发出。

