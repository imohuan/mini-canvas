# 拖线吸附到「同类型端口」问题复盘（source→source / target→target）

> 结论速览：BaseNode 用 `v-if` 隐藏端口后，VueFlow 原生 Handle 的吸附仍用**缓存的旧 `handleBounds` 坐标**把线吸到已不存在的端口上；真正修法是 `v-if` 变化时主动 `updateNodeInternals()` 强制 VueFlow 重测 handleBounds。与此前所有"在 BaseNode 用 disabled / v-if 藏端口"的尝试无关。

## 一、现象

从一个节点(source 端口/输出口)拖出连接线时，线的**视觉端点**仍会被吸附到另一个节点的 source 端口位置——即便那个端口已确认不在 DOM（MovingHandle 已用 `v-if` 摘掉）。

即：source→source 这种"输入连输入 / 输出连输出"的非法连线，在拖拽预览阶段仍会出现吸附。

## 二、排查过程（含走过的弯路）

本问题绕了很多圈，每段弯路都值得记录，避免后人重踩：

### 弯路 1：以为是临时拖线方向问题（与本题无关）
- 前序问题「左侧端口拖线方向朝外」牵出 `ConnectionLine.vue` 硬编码 source/target position，已修。
- 与本题的"吸附到同类型端口"是两码事，勿混。

### 弯路 2：想在 BaseNode 用 `:disabled` 藏端口 —— 无效
- 初版：给同类型端口的 MovingHandle 加 `:disabled`。
- **无效原因**：`disabled` 只让 MovingHandle 的按钮不响应 hover/click，**VueFlow 的真实 `<Handle>` DOM 还在**，照样可被原生吸附。

### 弯路 3：改用 `v-if` 藏端口 —— 仍无效（但方向对了）
- 把同类型端口 MovingHandle 及吸附带 `snap-band` 用 `v-if="... && !blockedXxxPort"` 整块从 DOM 摘掉。截图确认 DOM 里确实没 handle 了。
- **仍无效原因**：见下方"真凶"，不是 DOM 残留，而是**数据残留（stale handleBounds）**。

### 弯路 4：以为走自定义 `resolveFromAim` 链路 —— 误判
- 系统有两套吸附/校验：
  - CanvasHost 的 `onDragMouseMove → resolveFromAim`（前端 mouse 上报 aimedTarget，含方向校验 `expectSide`）
  - VueFlow 原生 Handle mousedown → `useHandle.handlePointerDown`（自身 document 监听 + `getClosestHandle`）
- 加了 debug 日志后确认：`connectStart` 打了 `dragSourceHandle=source`（起点正确），但 **`resolveFromAim` 一条日志都没有** → 吸附走的是 **VueFlow 原生链路**，根本不经我们的 `resolveFromAim`。此前想在 resolveFromAim 加方向校验、或在 CanvasSurface 设 `ConnectionMode.Strict`，对这条原生链路都无效（Strict 只管 isValidHandle 那层的类型判定，但 getClosestHandle 的吸附本身不看 connectionMode）。

## 三、真根因（VueFlow 源码实证）

VueFlow 原生吸附链路：

1. 用户从真实 `<Handle>` mousedown → `useHandle.ts handlePointerDown` 自己绑定 document mousemove/mouseup（**不调用我们 CanvasHost 的 resolveFromAim**）。
2. 每帧 mousemove → `utils/handle.ts getClosestHandle()` 遍历 `node.handleBounds.source + target`，找离鼠标最近的 handle 并**吸附**（把线端坐标吸到 handle 位置）。
3. `node.handleBounds` 是 `<Handle>` 组件 `onMounted` 时写入的（Handle.vue:100-137）。**当节点尺寸不变时，VueFlow 不会重测它**。

源码依据（`vendor/vueflow/packages/core/src/store/actions.ts` updateNodeDimensions）：

```ts
const doUpdate = !!(
  dimensions.width &&
  dimensions.height &&
  (node.dimensions.width !== dimensions.width ||
   node.dimensions.height !== dimensions.height ||
   update.forceUpdate)          // ← 尺寸没变 + 非 forceUpdate → doUpdate=false → 不重测
)
if (doUpdate) {
  ...
  node.handleBounds.source = getHandleBounds('source', ...)
  node.handleBounds.target = getHandleBounds('target', ...)
}
```

**死结**：BaseNode 用 `v-if` 移除 MovingHandle（内含 `<Handle>`），但**节点自身尺寸不变** → `doUpdate=false` → `handleBounds.source` 残留旧坐标 → `getClosestHandle` 用旧坐标把线吸到**已不存在的 source 端口位置**。

一句话：**v-if 只改了 DOM，没改 VueFlow 缓存端口坐标的 handleBounds 数据；VueFlow 原生吸附读的是缓存，所以照样吸。**

## 四、修复（BaseNode.vue 加 watch 强制重测）

在 BaseNode 监听 blockedTargetPort/blockedSourcePort（即 v-if 摘/放端口的状态），任一变化时主动调 VueFlow 的 `updateNodeInternals([nodeId])`：

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vfAny = vf as any
watch(
  [blockedTargetPort, blockedSourcePort],
  () => {
    // nextTick: 等 v-if 完成 DOM 摘除/恢复后再重测，否则 VueFlow 仍读到旧 DOM
    nextTick(() => vfAny.updateNodeInternals?.([props.id]))
  },
  { flush: 'post' },
)
```

原理：`updateNodeInternals([id])` → NodeWrapper `onUpdateNodeInternals` → `updateInternals()` → `updateNodeDimensions(..., forceUpdate: true)` → 强制 `doUpdate=true` → **按当前 DOM 真实存在的 `.vue-flow__handle` 重算 `handleBounds`**。被 v-if 摘掉的 Handle 不再计入 → `getClosestHandle` 找不到它 → 不再吸附。

`blockedXxxPort` 定义（用于 v-if 判断"本端口是否与拖拽源同类型、应隐藏"）：
- `blockedTargetPort = isConnecting && 非源节点 && 拖拽源 sourceHandle==='target'`
- `blockedSourcePort = isConnecting && 非源节点 && 拖拽源 sourceHandle==='source'`
- 语义：拖 source 口 → 藏所有其它节点的 source 口；拖 target 口反向 → 藏所有其它节点的 target 口。

## 五、最终代码位置

| 文件 | 作用 |
|---|---|
| `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue` | blocked computed + v-if 摘端口 + watch 强制 updateNodeInternals（**本问题真正修复点**） |

相关 commit（供追溯）：
- `1e05ee6` feat(node): while connecting, disable + hide same-type ports…（弯路：:disabled 版，无效）
- `09757e6` refactor(node): hide blocked port via v-if…（v-if 版，仍无效）
- `cc9e34a` fix(node): force vue-flow updateNodeInternals on blocked port v-if so stale handleBounds do not cause native snap（**真正生效**）

另有两处与本题易混淆、但**不属于本题根因**的提交，保留原因是其本身为正确改动：
- `afaa064` CanvasSurface 设 `ConnectionMode.Strict`（VueFlow 原生 isValidHandle 的类型判定，兜底有用，但对 getClosestHandle 的吸附无效）
- `36580ac` ConnectionLineHost 透传 source/target position（前序"方向朝外"问题）

## 六、经验沉淀

1. VueFlow 的双层机制要分清：**数据层 handleBounds（吸附几何来源）** 与 **DOM handle（交互触发）**。改 DOM 不去刷新 handleBounds，VueFlow 原生吸附不会跟随。
2. `:disabled` 不摘 DOM handle；`v-if` 摘 DOM 但不刷 handleBounds；**只有 `updateNodeInternals([id])` 能强制 VueFlow 重算 handleBounds**。
3. VueFlow 节点内 handle 增删若**不改节点尺寸**，`updateNodeDimensions` 的 `doUpdate` 恒为 false，永不自愈——必须显式 forceUpdate。
4. 判断吸附走哪条链路：打日志看有没有 `resolveFromAim`/aimedTarget 输出。没输出 = VueFlow 原生链路。
