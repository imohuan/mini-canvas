# plugin-node-image-compare

## 一句话

图片对比节点把两张上游图片按可拖拽分割线叠在一起，并跟随上游图片的卡片宽度。它自身很小、只依赖 `doc`；跨插件协作主要是读图片节点的 `imageUrl/cardWidth` 字段，以及内核的连接容量语义。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-node-image-compare` |
| 身份 | installable（`package.json:8-13`；当前成品应用故意不冷启动，`packages/ui/src/assembly.ts:17-18,76-78`） |
| 源码文件 | 6 个实现文件 |
| 测试文件 | 5 个 |
| 包依赖的其他插件 | 无（`package.json:26-31`） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| `@mini-canvas/canvas-base` | `Service / PluginModule` | 是 | `src/nodeImageComparePlugin.ts:14` |
| `@mini-canvas/canvas-data` | `DocService` 类型 | 是 | `src/nodeImageComparePlugin.ts:15` |
| `@mini-canvas/canvas-render` | 渲染上下文、边/节点快照 | 是 | `src/ImageCompareContent.vue:21-26` |
| 其它插件 | 无 | — | 无命中 |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` | `inject=['doc']` | 硬 | `src/nodeImageComparePlugin.ts:98-99` |
| `imageCompare` 服务 | 本插件上架，建节点/分割线/FIFO 收敛 | 硬（本包） | `src/nodeImageComparePlugin.ts:31-96` |
| `doc.subscribe` | 边变化后自动把超限输入收敛到最新两张 | 契约 | `src/nodeImageComparePlugin.ts:128-147` |
| `image` 节点字段 | 读上游 `data.imageUrl` 作为左右图 | **跨插件数据契约** | `src/imageCompareEngine.ts:47-60`；`src/ImageCompareContent.vue:28-44` |
| `cardWidth` 字段 | 跟随第一张上游图片的显示宽度 | **跨插件数据契约** | `src/compareFit.ts:12-20,39-57`；`src/ImageCompareContent.vue:46-64` |
| 内核连接容量 | `capacity: INPUT_CAPACITY`，满额由内核挤老边 | 契约 | `src/nodeImageComparePlugin.ts:118-120`；`src/imageCompareEngine.ts:8-20` |
| 底栏 | 无动作 | — | 无命中 |
| 主题 / UI 目录 | 无按名取件；组件自绘 | — | 无命中 |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `document.addEventListener` | 分割线拖拽的 move/up 绑全局 | 低：卸载时摘除 | `src/ImageCompareContent.vue:121-123,138-153` |
| `localStorage` / 固定 URL / `fetch` | 无 | — | 无命中 |
| `cardWidth` | 跟随上游图片的宽度 | 中：图片插件改字段或不再写它，对比宽度不跟随 | `src/compareFit.ts:39-57` |
| `imageUrl` | 左右图来源 | 中：只认这一字段，不认 `resourceId` | `src/imageCompareEngine.ts:47-60` |

## 内部职责与风险

1. **容量语义已经收口到内核**：文件头明确说不再自己删第 3 条，`planOverflowTrim` 只用于恢复/云端合并的历史数据（`src/imageCompareEngine.ts:8-12`）。这是正确方向。
2. **边变化订阅做自愈**：`doc.subscribe` 里扫所有对比节点并 `trimOverflow`，用 `trimming` 防重入（`src/nodeImageComparePlugin.ts:128-147`）。这会全表扫描；节点数量大时有成本，但逻辑可测。
3. **对比节点跟随上游宽度会写节点尺寸**：`compareWidthPatch` 只给 `size`，并做幂等（`src/compareFit.ts:79-91`）。这避免两条撤销记录，但也意味着“对比节点宽度”由上游图片控制，用户手动拖宽会被覆盖（代码注释说只跟宽度、高度留给用户）。
4. **测试覆盖纯逻辑与链式 FIFO**：`src/__tests__/imageCompareChain.test.ts:58-115` 覆盖第 3 张图挤成最新两张、刷新恢复后仍收敛；`src/__tests__/imageCompareWidthRender.test.ts` 覆盖宽度跟随。跨插件边界方面，测试用的是假 `getTypeConn`/真实 `edgeStore`，没有装真实图片插件。
5. **身份是 installable，但代码没有为“未安装”做特殊分支**：节点类型注册与订阅都在 `apply` 里；不装就不会运行。成品应用默认不装（`assembly.ts:17-18`），用户从插件面板安装。

## 单独装卸判断

- **单独装对比、不装图片**：可以建对比节点，但没有上游 `imageUrl`，显示空态；节点自身不崩。
- **单独卸对比**：`imageCompare` 服务、节点类型、`doc.subscribe` 随 scope 回收；没有底栏动作。
- **只装图片、不装对比**：完全不影响。
- **安装顺序**：对比节点依赖 `doc`，宿主恒在；不依赖图片服务，所以先装哪个都可以。

## 建议改法

1. **最小改动：把“上游图片读取”抽成共享纯函数。** 与 3D、底栏、UI 节点共用同一套字段解析；避免 `imageUrl`/`resourceId` 规则四处各写一遍。
2. **给 `cardWidth` 增加“来源已停止写”的降级。** 若上游没有 `cardWidth`，当前跟随逻辑应保持原宽；补一条测试锁住。验证：无 `cardWidth` 的图片节点 → 对比节点不缩成 0。
3. **补真实跨插件测试：装图片 + 对比。** 建两张图片 → 连到对比 → 断言左右图与宽度；再删一张 → 断言 FIFO/空位。
4. **评估 `doc.subscribe` 全表扫描的成本。** 若画布节点上千，可改成只监听边变化并只处理受影响的 target；这需要先量测，不建议盲改。

## 待验证

- `ImageCompareContent.vue` 的全局指针监听在 121-123 行挂、138-153 行摘；非拖拽状态不会持有监听。
- 对比节点宽度跟随与用户手动 resize 的优先级：代码注释说只跟宽度，但未见“用户拖宽后是否停止跟随”的分支；需实测。
- 不装对比插件时，旧画布里的 `image-compare` 节点如何显示未知类型；属于宿主行为，未验证。
