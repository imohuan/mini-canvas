# Canvas 菜单与连接创建改动记录

## 目标范围

本次改动围绕画布菜单、节点创建、连接创建和节点位置同步展开。

覆盖场景：

- 右键空白画布，弹出创建菜单。
- 双击空白画布，弹出创建菜单。
- 右键节点，弹出节点菜单。
- 从节点端口拖出连接线，释放到空白区域后弹出创建菜单。
- 从连接创建菜单选择节点后，创建新节点，并自动建立从源端口到新节点的连接。
- 所有新增节点、边、删除节点、删除边、节点位置更新，统一通过 `useCanvasStore.ts` 处理。

## 核心修改逻辑

### 1. 抽出通用菜单组件

新增 `CanvasMenu.vue` 和 `CanvasMenu.types.ts`。

菜单状态统一表达为：

```ts
{
  visible: boolean
  x: number
  y: number
  items: CanvasMenuItem[]
  context?: ...
}
```

菜单自身只负责展示和派发选择事件，不直接操作画布数据。

实际数据变化由 `Canvas.vue` 根据菜单上下文分发到 `useCanvasStore.ts`。

### 2. 画布菜单入口

在 `Canvas.vue` 中接入以下入口：

- 空白画布右键。
- 空白画布双击。
- 节点右键。
- 连接线拖拽到空白区域释放。

不同入口共用同一个菜单组件，但菜单上下文不同：

```text
blank-create      -> 创建独立节点
node-context      -> 节点操作菜单
connection-create -> 创建节点并连接
```

这样避免每个场景各自维护一套菜单 DOM 和关闭逻辑。

### 3. 连接线拖拽到空白区域后的临时目标

连接线释放到空白区域时，需要让用户看到从源端口指向菜单位置的临时线。

实现方式：

- 创建一个不可见的 `tempTarget` 节点。
- 该节点只有 1px 大小，提供 target handle。
- 创建一条 `isTemp` 的临时边。
- 菜单展示在临时目标附近。

用户选择节点后：

1. 关闭菜单。
2. 删除临时边和临时节点。
3. 等待一次 Vue 更新。
4. 创建真实节点。
5. 再等待一次 Vue 更新。
6. 创建真实连接边。

这么做是为了避免 VueFlow 在同一轮更新里同时处理“删除临时节点/边”和“创建真实节点/边”时出现状态丢失。

### 4. 临时边展示隔离

`CustomEdge.vue` 增加 `data.isTemp` 判断。

临时边只展示线条，不显示删除、剪切等交互按钮。

这样连接菜单打开时不会出现误操作入口。

### 5. 数据操作集中到 store

`useCanvasStore.ts` 增加集中式数据 API：

```text
addNode
addEdge
removeNodeById
removeEdgeById
updateNodePosition
getNodeById
getEdgeById
```

`Canvas.vue` 不再直接执行：

```text
nodes.push(...)
edges.push(...)
splice(...)
node.position = ...
```

而是统一调用 store API。

这样可以保证画布数据变化有唯一入口，降低 VueFlow 内部状态和业务状态不一致的概率。

### 6. 节点位置同步

之前拖动节点后，VueFlow 内部位置已变化，但 store 中的位置可能仍是旧值。

当后续新增节点时，VueFlow 会重新读取 store 的 nodes，导致已有节点被旧位置“拉回”。

修复方式：

- 在 `Canvas.vue` 的节点变化回调中监听 position 变化。
- 每次节点位置变化后调用 `canvas.updateNodePosition(...)`。
- 在多选拖拽 `SelectionFrame.vue` 中，也同步调用 `canvas.updateNodePosition(...)`。

现在单节点拖拽、多选拖拽后再新增节点，都不会因为 store 旧位置导致节点回跳。

## 遇到的问题与修复

### 问题 1：连接菜单创建了数据，但节点不渲染

现象：

- 从端口拖线到空白区域。
- 菜单选择新节点。
- store 中已有新节点和新边数据。
- 画布上节点没有正常显示。

原因：

- 临时节点/临时边删除和真实节点/真实边创建发生在同一轮更新里。
- VueFlow 对节点和边的内部同步存在时序问题。
- 同一轮 flush 中同时删除旧结构、创建新结构，容易让真实节点没有进入渲染状态。

修复：

```text
关闭菜单
删除临时边/临时节点
await nextTick()
创建真实节点
await nextTick()
创建真实边
```

通过分阶段提交，让 VueFlow 先完成临时结构清理，再接收真实节点和真实连接。

### 问题 2：连接菜单创建 text 节点后无法连线

现象：

- 从源端口拖出连接线。
- 菜单选择 `text` 节点。
- 节点创建成功，但边创建失败或连接无效。

原因：

- 普通 `text` 节点默认可能没有 target/input handle。
- VueFlow 的连接需要目标节点存在可连接的 target handle。

修复：

- 从连接菜单创建的节点，即使类型是 `text`，也强制补齐目标连接能力。
- 设置目标方向为 `Position.Left`。

结果：

- 从连接菜单创建的节点可以稳定作为连接目标。
- 普通空白菜单创建节点仍保持原有节点行为。

### 问题 3：新增节点导致已有节点移动或回跳

现象：

- 拖动已有节点。
- 再新增一个节点。
- 之前拖动过的节点回到旧位置。

原因：

- VueFlow 内部节点位置已更新。
- store 中节点位置没有同步。
- 新增节点后触发 nodes 重新同步，旧位置覆盖了 VueFlow 内部位置。

修复：

- 在 `Canvas.vue` 的节点变化处理中同步 position 到 store。
- 在 `SelectionFrame.vue` 的多选拖拽处理中同步 position 到 store。

现在位置来源保持一致：

```text
用户拖拽 -> VueFlow 内部位置更新 -> useCanvasStore 位置更新 -> 后续新增节点不会拉回旧位置
```

### 问题 4：VueFlow 类型导致 vue-tsc 报“类型实例化过深”

现象：

构建阶段出现类似错误：

```text
类型实例化过深，且可能无限
```

原因：

- VueFlow 的 `Node` / `Edge` 泛型类型较深。
- store 中如果直接把复杂泛型暴露到响应式状态和 API 边界，TypeScript 容易展开过深。

修复：

- 在 `useCanvasStore.ts` 内部使用较浅的类型别名。
- 在局部边界使用 `any[]` 承接 VueFlow 深层泛型。
- 对外保持明确的数据操作 API，而不是暴露复杂泛型链路。

结果：

- `vue-tsc -b` 可以通过。
- store API 仍能表达节点、边的核心数据操作。

### 问题 5：多选拖拽后仍可能出现节点回跳

现象：

- 单节点拖拽后新增节点不再回跳。
- 但多选框拖拽节点后，再新增节点，仍有回跳风险。

原因：

- 多选拖拽逻辑在 `SelectionFrame.vue` 中独立维护。
- 它更新了 VueFlow 内部位置和本地节点引用，但没有同步 `useCanvasStore.ts`。

修复：

- 在 `SelectionFrame.vue` 中引入 `useCanvasStore()`。
- 多选拖拽每次计算出新位置后，同时调用：

```ts
canvas.updateNodePosition(node.id, newPos)
```

结果：

- 单节点拖拽和多选拖拽的位置更新路径一致。
- 后续新增节点不会把多选拖拽过的节点拉回旧位置。

## 当前验证结果

执行命令：

```bash
npm run build
```

结果：

```text
vue-tsc -b && vite build
✓ built
```

构建通过。

仍存在非阻塞警告：

```text
[INVALID_ANNOTATION] A comment "/* #__PURE__ */" in "node_modules/.pnpm/@vueuse+core.../node_modules/@vueuse/core/dist/index.js" contains an annotation that Rolldown cannot interpret due to the position of the comment.
```

判断：

- 来源是 `@vueuse/core` 依赖包内部注释。
- 不是本次业务代码改动引入。
- 不阻塞构建产物生成。

## 最终状态

当前数据流约束：

```text
用户交互
  -> Canvas.vue / SelectionFrame.vue 捕获交互上下文
  -> 统一调用 useCanvasStore.ts 数据 API
  -> VueFlow 根据 store 数据和内部状态完成渲染
```

当前连接创建链路：

```text
拖出连接线
  -> 空白区域释放
  -> 创建临时目标节点和临时边
  -> 展示创建菜单
  -> 用户选择节点类型
  -> 清理临时结构
  -> 创建真实节点
  -> 创建真实边
```

当前已覆盖的稳定性修复：

- 空白右键创建节点。
- 空白双击创建节点。
- 节点右键菜单。
- 拖线到空白区域后创建并连接节点。
- 新增节点不再导致已有节点回跳。
- 多选拖拽后新增节点不再导致已有节点回跳。
- 临时连接线不会暴露普通边交互。