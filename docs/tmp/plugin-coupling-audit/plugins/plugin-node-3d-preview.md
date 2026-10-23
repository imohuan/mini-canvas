# plugin-node-3d-preview

## 一句话

3D 全景预览节点用 three.js 把一个上游图片贴到球体内壁。它只依赖渲染层和 `doc`/`selection`，没有直接引用其它插件；跨插件协作靠 `image` 节点字段与 `ui` 目录，主要风险是全景图来源规则和图片插件字段绑定。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-node-3d-preview` |
| 身份 | builtin（`package.json:6-11`） |
| 源码文件 | 9 个实现文件 |
| 测试文件 | 8 个 |
| 包依赖的其他插件 | 无（`package.json:26-32`） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| `@mini-canvas/canvas-base` | `Service / PluginModule` | 是 | `src/node3dPreviewPlugin.ts:14` |
| `@mini-canvas/canvas-data` | `DocService` 类型 | 是 | `src/node3dPreviewPlugin.ts:15` |
| `@mini-canvas/canvas-render` | 渲染上下文、`RenderEvents` | 是 | `src/PanoramaContent.vue:29` |
| `three` | 全景渲染 | 第三方依赖，非插件 | `src/PanoramaContent.vue:27` |
| 其它插件 | 无 | — | 无命中 |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` | `inject=['doc']` | 硬 | `src/node3dPreviewPlugin.ts:69-70` |
| `selection` | 快捷键 `f/r` 的 `when` 现算选中节点 | 可选（缺则快捷键让位） | `src/node3dPreviewPlugin.ts:116-120` |
| `panorama3d` 服务 | 本插件上架，`addPreviewNode/setImageUrl` | 硬（本包） | `src/node3dPreviewPlugin.ts:27-65` |
| `image` 节点字段 | 从上游边读 `data.imageUrl` 作为贴图 | **跨插件数据契约** | `src/textureSource.ts:28-37` |
| `RenderEvents.PaneClick` | 点画布空白退出全屏/交互 | 契约 | `src/PanoramaContent.vue:424` |
| `command` | 注册 `3d-preview:fullscreen` / `3d-preview:reset` | 契约 | `src/node3dPreviewPlugin.ts:122-150` |
| `ui` 目录 | 无直接消费（顶栏/按钮不走目录） | — | 无命中 |
| 底栏 | 无动作 | — | 无命中 |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `window.addEventListener('keydown')` | `f`/`r` 快捷键与 Esc 退出 | 低：卸载时摘除 | `src/PanoramaContent.vue:399,429` |
| `document.documentElement` | 读主题 CSS 变量给 three.js 上色 | 中：依赖 `--canvas-*` 变量名 | `src/PanoramaContent.vue:98-102` |
| `window.devicePixelRatio` | 渲染器像素比上限 2 | 低 | `src/PanoramaContent.vue:222` |
| `requestAnimationFrame` | 全景渲染循环 | 中：必须成对取消，文件有 dispose 注释 | `src/PanoramaContent.vue:181` |
| `localStorage` / 固定 URL | 无 | — | 无命中 |

## 内部职责与风险

1. **贴图来源规则是跨插件字段契约**：`findUpstreamImageUrl` 只看上游节点的 `data.imageUrl`（`src/textureSource.ts:28-37`）。图片节点有该字段，但任何生产 `imageUrl` 的节点都能触发；若未来图片插件改字段（例如改存 `resourceId`），3D 预览会静默变空。
2. **快捷键与画布命令竞争**：`f`/`r` 只有在恰好选中一个 3D 节点时才接管，否则让位给 `auto-layout:focus-selected`/`fit-view`（`src/node3dPreviewPlugin.ts:112-120`）。测试覆盖了让位（`src/__tests__/node3dShortcuts.test.ts:83-100`），边界清楚。
3. **three.js 生命周期集中在一个 565 行组件**：场景、相机、贴图、全屏 DOM 搬移、交互都在 `PanoramaContent.vue`。纯数学已抽到 `panoramaView.ts`、模式判定在 `panoramaMode.ts`，但资源释放仍靠组件内 dispose（`src/PanoramaContent.vue:25`）。
4. **节点尺寸固定 420×280，可 resize**：没有跟图片比例走；全景图通常是 2:1，卡片比例与贴图无关，这是产品选择（`src/node3dPreviewPlugin.ts:101-105`）。
5. **测试覆盖纯逻辑与快捷键，缺少“真实上游图片”测试**：`textureSource.test.ts` 存在（8 个测试文件之一），但未见装载真实图片插件后连边取图的端到端断言。

## 单独装卸判断

- **单独装 3D、不装图片**：可以建 3D 节点并手填图片地址（`PanoramaContent.vue:464-475` 的 URL 表单）；从上游连图没有来源，空态提示“把图片节点连进来，或填图片地址”（`src/PanoramaContent.vue:463`）。
- **单独卸 3D**：`panorama3d` 服务、节点类型、两条快捷键命令随 scope 回收；没有底栏动作需要摘除。
- **只装图片、不装 3D**：完全不影响。
- **与图片包同时装卸**：图片字段契约是单向读取，卸载图片不会让 3D 崩，只会没有上游贴图。

## 建议改法

1. **最小改动：把“从上游取图片地址”抽成共享纯函数。** 底栏 `panelSource.collectUpstreamMaterials`、UI 节点 `buildNodeContext`、3D `findUpstreamImageUrl` 都在做同一件事的不同子集；收成 `canvas-data` 的 `upstreamImageUrl(edges, targetId, getData)` 可避免字段规则三处漂移。
2. **给 `imageUrl` 字段加契约测试。** 装真实图片插件 → 建图片节点 → 连到 3D → 断言贴图取到；再改字段名做一次负向测试。
3. **把 `PanoramaContent.vue` 的全屏 DOM 搬移抽成独立 composable。** 565 行里，视角数学已独立，剩下最重的是全屏容器与资源释放；抽后可单测卸载清理。
4. **主题变量名收口。** `themeColor()` 直接拼 `--canvas-node-*` 字符串；若主题改名，3D 背景色会静默回落。与主题页的“UI 目录名收口”同一条思路。

## 待验证

- `themeColor` 读取的变量名与主题 `node-theme.css` 的完整清单是否一一对应；本轮只看了前 100 行。
- 全景图 2:1 的假设是否在空态/错误态下也成立；未做真机截图。
- 全屏时 three.js canvas 被搬进另一个 DOM 容器后，`ResizeObserver` 是否仍能正确重建；代码有注释，未实测。
