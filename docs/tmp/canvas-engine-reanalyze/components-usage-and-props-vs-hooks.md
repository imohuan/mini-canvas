# 后台 VueFlow 能力如何交给主题插件：components 现状 + props vs hooks

> 只分析，不改代码。回答两个问题：① src/components 到底用没用；② 后台把 VueFlow 能力给主题组件，走 props 还是 hooks。

> **更新（本轮已落地两件独立小事，见文末 §五）**：① 内核新增 `vueFlowBridge.ts` 精选导出 VueFlow 能力，主题插件统一从内核 import；② `plugin-theme-default` 两个 vite 配置合并成单文件 command 分支。

---

## 一、`canvas-core-v2/src/components/` 现状：用了，但只是"宿主默认 UI"，没进内核公开 API

逐符号核对 import 链（非 grep 子串误报）：

| 文件 | 谁 import（真实引用） | 结论 |
|---|---|---|
| `BaseNode.vue` | 仅 `demo-web/CanvasDemo.vue:13` | 宿主默认节点外壳 |
| `CustomEdge.vue` | 仅 `demo-web/CanvasDemo.vue:31` | 宿主默认连线 |
| `MovingHandle.vue` | 仅 `BaseNode.vue:12`（外壳内） | 默认端口 |
| `edgeGeometry.ts` | 仅 `CustomEdge.vue` | 边几何纯函数 |
| `edgeContext.ts` | `CustomEdge.vue` + `CanvasDemo.vue:32` | 边外观/选中注入 key |
| `canvasParamKey.ts` | `BaseNode.vue` + `CanvasDemo.vue:15` | 端口外观注入 key |
| `nodeRegistryKey.ts` | `BaseNode.vue` + `CanvasDemo.vue:14` + `contentBridge` | 内容注册表/写回 key |
| `contentBridge.ts` | 仅 `index.ts:10` 再导出 `HOST_KEY` | 内核公开令牌 |

**要点：**
- 内核公开面 `index.ts` **只导出令牌类**（contentBridge/nodeRegistryKey）。BaseNode/CustomEdge/MovingHandle 这些 .vue **不是内核 API**，只有 demo 这一个文件在引用。
- 所以 `src/components/` 是"宿主默认渲染器却物理塞在 core 包内、只被 demo 接线"的半成品状态 —— 正好印证 gap-audit「§一 + 阶段 D：nodeShell/edge/background 应收敛成主题插件槽位，默认实现由 default-theme 插件提供，内核只留槽位+令牌契约」。
- 现状装配（CanvasDemo）：`nodeTypes` 全指 BaseNode、`edgeTypes={custom:CustomEdge}`，主题插件 `registerThemeSlot` 注册 nodeShell/edge 后由 `applyTheme()` 覆盖。

---

## 二、关键事实纠正用户的预设：**边/节点壳的"起点终点位置"本来就是 VueFlow 用 props 给的**

`docs/tmp/vueflow-contract/自定义组件契约.md` 已实读 .d.ts 证明：
- 自定义边组件 = `:edge-types` 的 value，VueFlow 自动把 **EdgeProps 当 props 传**，含 `sourceX/sourceY/targetX/targetY/sourcePosition/targetPosition/sourceHandleId/markerEnd/selected/animated/data…`。
- 自定义节点壳 = `:node-types` 的 value，VueFlow 自动传 **NodeProps**（含 `id/type/selected/data/connectable…`）。

实测佐证：`plugin-theme-default/src/DefaultEdge.vue` 就是 `defineProps<EdgeProps>()` 然后读 `props.sourceX`…——**"起点终点作为 props 传入"已经是引擎契约、已经跑通**。所以：

> 用户想要的"后台把起点/终点状态给主题组件"，**不需要后台再造**——VueFlow 原生就在做，且就是 props 形态。用户"作为 props 传入"的直觉对，而且已经成立。

---

## 三、那 props vs hooks 的分歧点到底在哪？

VueFlow 原生 props 已覆盖"几何 + 选中 + 动画 + marker"。**后台真正要额外给主题渲染组件的能力只剩两类**，而这两类现在的实现正是 gap-audit 点名的偏差源（D2 注入 key / D7 选中集合宿主手搓）：

1. **外观/配置**：边外观（edgeVisual）、端口外观（CanvasParams）——现在经 `EDGE_VISUAL_KEY`/`CANVAS_PARAMS_KEY` provide/inject。
2. **nodeShell 的内容段分发 + 写回**：`NODE_REGISTRY_KEY`（inject 注册表，resolve content/title/toolbar）+ `NODE_WRITE_KEY`。
3. **实例级命令动作**（可选）：删边/建边、拿节点集合——VueFlow 已给 `useVueFlow()`，组件内直接可用，不需要后台包。

### 三选一怎么判

| 通道 | 适合 | 不适合 |
|---|---|---|
| **props（用户倾向）** | 纯数据/配置/内容段句柄；自描述、可单测、类型显式 | 实例级命令动作、要长期订阅多实例动态状态时显啰嗦 |
| **hooks（导出组合式）** | 命令动作 + 需要 flow 实例的内部访问（内部 `useVueFlow()`） | 必须提供上下文才成立；插件 import 后与 Vue 运行时/内部 ref 耦合，单测难；脱离 `<VueFlow>` 子树即失效或造孤儿 store |
| **provide/inject（现状）** | 组件树内共享单例 | 全局隐藏、多画布实例易串、类型散、与"面向插件签名自描述"相悖 |

### 推荐（对齐 Vue 习惯 + 现状最少动）

**分层：能 props 就 props，只有"要实例/命令"才 hooks。**
1. **几何/选中**：什么都不用做，VueFlow 已 props —— 主题边/壳直接 `defineProps<EdgeProps/NodeProps>` 即可（DefaultEdge 已是范本）。
2. **后台核心配置 + 内容段 + 写回**：当 props 传给主题壳/边（user 直觉对）：
   - 壳（nodeShell）收到 `NodeProps` + 追加 props：`content` 段句柄、端口描述数组、可选外观参数。
   - 边收到 `EdgeProps` + 可选追加 props：后台外观覆盖、选中集合引用。
   - 这样把现在的 `EDGE_VISUAL_KEY/CANVAS_PARAMS_KEY/NODE_REGISTRY_KEY` 三个 inject 从"隐式全局"收敛成"显式 props"，签名自描述、好测、多画布安全。
   - 实现细节：host 在渲染 `<component :is="themeEdge">` 处统一 `v-bind="engineProps"`，或由主题组件在 `defineProps` 声明追加字段。**注意别 v-bind 覆盖 VueFlow 已传的 EdgeProps**——追加字段用独立命名（如 `visual` / `segments`），复用 DefaultEdge/CustomEdge 已预留的 `visual?/geometry?` 扩展 props 命名。
3. **实例级命令**（删边/取点/订阅 onConnect）：让插件组件内部 `useVueFlow()`（在 `<VueFlow>` 子树内 = 注入当前实例，不造孤儿 store），或后台提供薄封装 hooks 供需要命令的插件用。**hooks 只有当插件要做"命令/响应式服务"时才需要**，不是所有能力都塞 hooks。

一句话给用户：
> 起点终点那类几何，VueFlow 早用 props 给了，别再做成 hooks（那是重复造引擎）。后台真正自己管的外观配置/内容段，按你的直觉也当 props 下发。hooks 只留给"要动画布的命令动作"这类少数需要 flow 实例的地方。所以是 **props 为主，hooks 只补命令**，跟你"作为 props 传入"的想法一致，方向对。

---

## 四、若往这个方向重构，改动清单（草案，待批准）

- **components 收编**：把 BaseNode/MovingHandle/CustomEdge/edgeGeometry/edgeContext/canvasParamKey 这些"宿主默认渲染器"从 core 挪到 `packages/plugins/plugin-theme-default`（作为默认主题实现），`registerThemeSlot` 注册 nodeShell/edge。
- **内核只留契约**：core 公开 `registerThemeSlot` + 槽位类型 + 令牌；不再硬编码任何 .vue 默认壳。`src/components/` 只留跨插件共享的令牌桥（contentBridge 的 HOST_KEY、nodeRegistryKey 若仍走 inject 则保留）。
- **统一 props 下发**：CanvasDemo 装配 `applyTheme` 时对主题壳/边统一传后台追加 props（外观/内容段/端口描述），删掉三个隐式 inject key 或收敛为 props 兼容。
- gap-audit 阶段 C/D 的连接交互（connection-line / disabled / 3D 反馈）作为后续批次，与本次"能力给法"正交。

> 注意：这会牵动 packages/plugins 的三个插件包 + core 装配点，属架构级改动，牵一发动全身，需先改 `docs/plan/*` 契约再动代码。本次不动。

---

## 五、本轮已落地（2026-09 小步，不动架构）

### A. 内核精选导出 VueFlow 能力 → 主题插件统一从内核 import（commit fc5381b）

- 新增 `packages/canvas-core-v2/src/vueFlowBridge.ts`，精选导出 `Handle/Position/getBezierPath/useVueFlow` + 类型 `EdgeProps/NodeProps`，`index.ts` `export * from './vueFlowBridge'`。
- `plugin-theme-default/src/{DefaultEdge,ThemeShell,DefaultBackground}.vue` 改从 `@mini-canvas/canvas-core-v2` import 这些原语，不再直接 `@vue-flow/core`。
- 副作用：所有 VueFlow 访问收敛到内核一条路，从根上规避"多份 @vue-flow 实例"的双实例 Bug（呼应此前 `Symbol(canvas-v2-host) not found` 的方向）。
- 边界：只精选插件真会用的成员，不 `export *` 整库（避免第三方库成内核泄漏门面）；`demo-web` 预览页自 mount `<VueFlow>`，仍直接 import `@vue-flow/core`（不进内核）。
- 未做：DefaultEdge 仍自己调 `getBezierPath` 算 path —— 这是"能力 props（core 喂算好的 path + 状态）"那条架构级抽象，留待计划批准。

### B. 合并 plugin-theme-default 两个 vite 配置（commit 9940286）

- 原 `vite.demo.config.ts`(dev 预览) + `vite.config.ts`(lib 打包) 本就不冲突（vite 一次只跑一个模式），用 `defineConfig(({ command }) => ...)` 分支合并成单文件 `vite.config.ts`。
- `dev` 脚本去掉 `--config vite.demo.config.ts` 改为 `vite`；删除旧 `vite.demo.config.ts`。
- 验证：`vite build`(lib/UMD 6.00kB) 通过；`vite`(serve 分支) 在 5310 起来正常。
- 未动：plugin-node-text 的 `vite.dev.config.ts`(dev:hmr 跨端口热更场景) 用途不同，不在本轮范围。
