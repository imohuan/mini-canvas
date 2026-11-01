# 渲染宿主层迁出内核 —— CanvasHost + 渲染令牌 + 默认渲染 收编独立渲染包

日期：2026-09-05 · 分支：feat/cordis-plugin-system · 状态：**待用户批准**
作者：code-developer

> 这是"插件宿主架构重构 / CanvasHost 收编"系列的最后一步：把内核 `@mini-canvas/canvas-core-v2`
> 里残存的**渲染宿主层**整体挪到独立渲染包，使内核只保留**纯逻辑核心**（core + services + 注册机制）。
> 用户已拍板"一起吧"（CanvasHost + 渲染令牌 + theme 默认渲染配套一起挪）。
> 依赖拓扑已实证（`docs/tmp/render-layer-migration/import-graph.md`），工程约定已实证
> （`docs/tmp/render-layer-migration/monorepo-conventions.md`），本计划基于实证编写。

---

## 一、目标形态（为什么做）

现状：内核包 `packages/canvas-core-v2` 名义叫"内核"，却仍物理装着浏览器渲染层
（`src/host/CanvasHost.vue`、`src/host/canvasHostCore.ts`、`src/host/createMiniCanvasHost.ts`、
`src/vueFlowBridge.ts`、`src/contracts/` 渲染令牌），并把它们从顶层 `src/index.ts` re-export 给插件。

目标：拆出一个**渲染宿主包**（建议名 `@mini-canvas/canvas-render`），把内核里的渲染层整块搬走。
内核只剩：
- `core/`：Context/Scope/topo/types + registry(nodeRegistry/nodeRenderer/registerNodeType/registerThemeSlot/themeRegistry)
- `services/`：command/connection/history/nodeFactory/nodeStore/selection/storage（纯逻辑服务）
- 顶层只 re-export 纯逻辑面 + 类型，不再带任何 `.vue` / vue-flow re-export / 渲染令牌。

依赖方向（实证，全部单向、无环）：
```
canvas-core-v2（纯逻辑内核）  ←  canvas-render（渲染宿主，runtime 依赖内核服务）
canvas-render                 ←  plugin-theme-default（默认皮，拿 vue-flow/令牌/edgeGeometry）
canvas-core-v2 + canvas-render ← plugin-node-text（content 拿 HOST_KEY）
（plugin-node-image / plugin-canvas-commands 只依赖内核纯逻辑，不改）
```

---

## 二、渲染包装什么 / 内核删什么（逐文件清单）

### 随迁 → 新渲染包 `@mini-canvas/canvas-render`
内核 `src/` 下这些整块挪走：
1. `src/host/CanvasHost.vue` —— 官方渲染宿主组件（vue 运行时）
2. `src/host/canvasHostCore.ts` —— 纯逻辑映射/主题装配/默认外观（随组件同包，因组件 import 它）
3. `src/host/createMiniCanvasHost.ts` —— 逻辑门面（CanvasHost 依赖它；属渲染宿主装配面，非内核业务）
4. `src/vueFlowBridge.ts` —— vue-flow 精选 re-export（被渲染宿主 + theme 皮共用）
5. `src/contracts/canvasParamKey.ts` —— 渲染外观令牌（供 BaseNode/端口）
6. `src/contracts/contentBridge.ts` —— HOST_KEY（供 content 组件拿宿主）
7. `src/contracts/edgeContext.ts` —— 边外观/选中 令牌（供 CustomEdge）
8. `src/contracts/nodeRegistryKey.ts` —— 节点注册表/写回 令牌（供 BaseNode/content）

> **留在内核**：`src/contracts/edgeGeometry.ts`（用户明确"除 edgeGeometry 外"）——纯算法、供 CustomEdge
> 子路径 import，内核保留并继续从顶层 re-export；其 `contracts/__tests__/edgeGeometry.test.ts` 也留内核。
> `nodeRegistryKey.ts` 对内核 `NodeRegistry` 的引用是 **type-only**，随迁后变成"渲染包→内核"单向 type 依赖，安全。

### 随迁测试
内核 `src/host/__tests__/` 三个测试 import 相对路径（`../canvasHostCore`、`../createMiniCanvasHost`），
随迁到渲染包 `__tests__/`（改写为包内相对 import）：
- `canvasHostCore.test.ts`（纯逻辑）
- `createMiniCanvasHost.test.ts`（纯逻辑）
- `fullchain.test.ts`（集成，需依赖 plugin-node-image/text/canvas-commands 做冷启动验证——渲染包要能吃插件包做集成测试，或该测试留内核？**见待定点 3**）

### 内核顶层导出改动（`src/index.ts`）
移除 re-export：HOST_KEY、NODE_REGISTRY_KEY、NODE_WRITE_KEY、CANVAS_PARAMS_KEY、EDGE_VISUAL_KEY、
EDGE_SELECTION_KEY、`export * from './vueFlowBridge'`、createMiniCanvasHost(+types)、CanvasHost、
FlowNode/ThemeAssembly、CanvasParams/EdgeVisual/EdgeSelection/NodeWrite（渲染专属类型）。

保留并新增 re-export：`edgeGeometry`（从 contracts 保留导出，供 CustomEdge 子路径）。

---

## 三、消费方改造（谁改 import）

| 消费方 | 现状 import | 改为 | 依赖变化 |
|---|---|---|---|
| plugin-theme-default `src/*.vue` + index.ts | 从 `@mini-canvas/canvas-core-v2` 拿 useVueFlow/Handle/Position/EdgeProps/令牌 | vue-flow 原语 + 令牌改从 `@mini-canvas/canvas-render` | 加依赖 render；registerThemeSlot/PluginModule 仍从内核拿 → 保留内核依赖 |
| plugin-theme-default `CustomEdge.vue` | `edgeGeometry` 子路径(内核) | **edgeGeometry 留内核** → 不变，继续从内核子路径 import | 不变 |
| plugin-node-text `TextContent.vue` | `HOST_KEY` from 内核 | HOST_KEY 改从 `@mini-canvas/canvas-render` | 加依赖 render |
| plugin-node-image / commands | 只依赖内核纯逻辑 | 不变 | 不变 |
| canvas-core-v2 demo-web（CanvasDemo / plugin-load*） | 相对源码 import | 改从 `@mini-canvas/canvas-render` import CanvasHost / createMiniCanvasHost / 令牌 | devDep 加 render |
| plugin-theme-default demo-web/App.vue | `CanvasHost` from 内核 | CanvasHost 从 `@mini-canvas/canvas-render` | devDep 加 render |

根项目 `src/` 只依赖 canvas-core(v1)，**零改动**（实证）。

---

## 四、待定点（需用户拍板，其余我按推荐执行）

| # | 问题 | 推荐答案 | 理由 |
|---|---|---|---|
| 1 | **新渲染包放哪个目录 / 叫啥名** | `packages/canvas-render`（建议名 `@mini-canvas/canvas-render`），放 `packages/` 直下 | 内核/工具惯例放 packages/ 直下，插件才进 packages/plugins/（plugins/README 明文）；渲染宿主属"引擎/工具层"非业务插件 |
| 2 | **plugin-theme-default 的默认皮组件(BaseNode/MovingHandle/CustomEdge/DefaultBackground)要不要物理挪进渲染包** | **不挪**。theme-default 仍是独立"默认主题插件"，只是把对 vue-flow/令牌的依赖来源从内核切到渲染包。 | 与既定架构一致：宿主无 UI，皮由插件 registerThemeSlot 提供；BaseNode 等已明确"收编自 core、属插件"。若把它们塞回渲染宿主包，会让宿主重新绑死默认皮、违背插件可替换设计 |
| 3 | **随迁测试中 fullchain.test.ts(要吃插件包冷启动)放哪** | 留在内核？不行——它 import createMiniCanvasHost(随迁) 。方案：移入渲染包，渲染包把 node-image/text/canvas-commands 作 **devDependencies**（仅测用，不 runtime 依赖），跑集成测试。 | 渲染包 runtime 只依赖内核+vue+vue-flow；测试要用业务插件冷启动，放 devDep 即可，不污染 runtime |
| 4 | edgeGeometry 留内核，CustomEdge 继续从内核子路径 import —— 但 theme-default 已依赖渲染包，edgeGeometry 走内核 | 维持现状（theme-default 同时依赖内核拿 edgeGeometry + registerThemeSlot） | 用户已定 edgeGeometry 留内核；theme-default 反正是双依赖 |

> 若你对 #2 选"物理挪进渲染包"，我会改成：渲染包内置 BaseNode/CustomEdge/… + 提供 `themeDefaultPlugin`，
> plugin-theme-default 包则删掉或变成"复用渲染包默认皮的转发插件"。**两套形态执行差异大，需你定。**

---

## 五、实施步骤（每步原子 commit + 验证）

> 包新增/挪动后需 `pnpm install` 让 workspace symlink + exports 生效；`.gitattributes` 已强制 LF，新文件勿写 \r\n。

1. **建渲染包骨架** `packages/canvas-render`：package.json(name/private/type/exports `./*`→`./src/*`/scripts typecheck+test)、
   tsconfig.json（仿内核拆 `tsconfig.vue.json`，DOM lib + vue-tsc 查 .vue）、vitest.config.ts、env.d.ts(`declare module '*.vue'`)。
   deps：`@mini-canvas/canvas-core-v2`(runtime) + `@vue-flow/core` + `vue`；devDeps：插件(测用)+vue-tsc+vitest+vite。
   → commit：feat(canvas-render): scaffold render-host package
2. **把文件物理挪进渲染包**：`git mv` 内核 `src/host/{CanvasHost.vue,canvasHostCore.ts,createMiniCanvasHost.ts}`、
   `src/vueFlowBridge.ts`、`src/contracts/{canvasParamKey,contentBridge,edgeContext,nodeRegistryKey}.ts` 到渲染包 `src/`（扁平或保子目录）。
   改渲染包内相对 import（`../core`→`@mini-canvas/canvas-core-v2`、`../services/...`→包名）。edgeGeometry + 其测试**留内核**。
   → commit：refactor(canvas-render): move CanvasHost/vueFlowBridge/render tokens out of kernel
3. **改渲染包新增导出**：渲染包 `src/index.ts` re-export CanvasHost/canvasHostCore 纯函数/createMiniCanvasHost(+types)/vueFlowBridge/5 令牌。
   → commit：feat(canvas-render): export render host surface
4. **改内核**：`src/index.ts` 删渲染层 re-export，保留 edgeGeometry 导出；删空出的 contracts 文件留 edgeGeometry。
   `git rm` 已挪走的文件。core/services 零改动（实证不触碰）。
   → commit：refactor(canvas-core-v2): strip render-layer surface; keep pure logic + edgeGeometry
5. **随迁测试**：渲染包建 `__tests__/`，迁 canvasHostCore/createMiniCanvasHost 测试（改 import）；fullchain.test 迁渲染包，把
   node-image/text/canvas-commands 加渲染包 devDep。edgeGeometry.test 留内核。
   → commit：test(canvas-render): carry over host core tests
6. **改 theme-default**：package.json 加 `@mini-canvas/canvas-render` 依赖；BaseNode/MovingHandle/CustomEdge/DefaultBackground
   的 vue-flow/令牌 import 从内核切到渲染包；index.ts 的 registerThemeSlot/PluginModule 仍从内核。CustomEdge 的 edgeGeometry 走内核子路径（不变）。
   → commit：refactor(plugin-theme-default): depend on canvas-render for vue-flow/tokens
7. **改 node-text**：TextContent.vue 的 HOST_KEY 从渲染包 import；加 render 依赖。node-image/commands 不动。
   → commit：refactor(plugin-node-text): HOST_KEY from canvas-render
8. **改 demo-web**：canvas-core-v2 demo-web(CanvasDemo/plugin-load*) 与 theme-default demo-web/App.vue 改从 `@mini-canvas/canvas-render` import
   CanvasHost/createMiniCanvasHost/令牌/默认常量；相关 demo devDep 加 render。
   → commit：refactor: demos consume canvas-render
9. **全量回归 + 收尾**：内核 typecheck(tsc) + 内核 vitest；渲染包 typecheck(tsc + vue-tsc tsconfig.vue) + 渲染包 vitest；
   theme-default/node-text typecheck；起两个 demo dev 做浏览器端到端回归（拖/删/连边/撤销/热装），console 零报错。
   → commit：chore: final regression

---

## 六、验证命令
```bash
pnpm install   # workspace 链接新包
# 内核
cd packages/canvas-core-v2 && node ./node_modules/typescript/bin/tsc --noEmit \
  && node ./node_modules/vitest/vitest.mjs run
# 渲染包
cd packages/canvas-render && node ./node_modules/typescript/bin/tsc --noEmit \
  && node ../../node_modules/vue-tsc/bin/vue-tsc.js -p tsconfig.vue.json \
  && node ./node_modules/vitest/vitest.mjs run
# theme-default / node-text typecheck
cd packages/plugins/plugin-theme-default && node ./node_modules/typescript/bin/tsc --noEmit
cd packages/plugins/plugin-node-text && node ./node_modules/typescript/bin/tsc --noEmit
# 浏览器回归（手动 / 交由后续 MCP 端到端）
cd packages/canvas-core-v2 && node <vite>/bin/vite.js   # v2 demo（5199）
cd packages/plugins/plugin-theme-default && node <vite>/bin/vite.js  # theme demo（5310）
```

---

## 七、风险/注意
- **不改任何既有内核纯逻辑**：core/services 文件零改动；只动 index.ts 导出 + 删文件。
- **vue-flow/vue 双实例**：渲染包与 theme-default 都要把 vue/@vue-flow/core 放 peer，避免打两包各带一份。渲染包**不能**把 vue-flow 打进 dependencies 造成重复。
- **edgeGeometry 唯一例外**：留内核、子路径继续可用，防止 CustomEdge 断裂；勿误删。
- **文件行尾 LF**：新渲染包文件用 LF；`git mv` 保留历史。
- **不破坏既有 134 测试**：内核测试数量会因随迁下降（host/ 测试挪走），但 edgeGeometry + core/services 测试全留；渲染包补上随迁测试后总测试覆盖不降。
- **CanvasHost 依赖 createMiniCanvasHost**：若有人质疑"createMiniCanvasHost 是纯逻辑为何跟渲染走"——它 runtime new Context/全部内核服务，属**宿主装配门面**、与窗口 API(window.MiniCanvas)绑定，归渲染宿主层；内核不再暴露"装配/挂 window"能力，只留"纯服务构造"，符合"内核只定义纯逻辑核心"目标。
