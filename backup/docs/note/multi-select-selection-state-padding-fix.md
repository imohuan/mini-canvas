# 多选状态持久化与边距配置修复记录

> 记录本次围绕 `SelectionFrame.vue`、`useCanvasStore.ts`、`Pannel.vue`、`Canvas.vue` 的修改逻辑、遇到的报错与处理结果。

## 1. 背景问题

本次处理三个问题：

1. 多选后出现 `SelectionFrame.vue`，刷新页面后多选框仍然出现。
2. 多选后点击空白区域理论上应取消多选，但实际存在偶发不取消的问题；有时必须单击其他节点才能取消。
3. `SelectionFrame.vue` 的边距 padding 原本写死在组件内，需要移动到 `useCanvasStore.ts`，并在 `Pannel.vue` 中可配置。

## 2. 根因判断

### 2.1 刷新后仍显示多选框

多选框显示依赖选中状态：

```text
selectedNodeIds / selectedEdgeIds
节点自身 selected 字段
```

刷新后仍显示，说明选中态被持久化了。

本次确认到两个持久化来源：

- `canvas-state` 中保存了 `selectedNodeIds` / `selectedEdgeIds`。
- `canvas-nodes` / `canvas-edges` 中也可能带有 VueFlow 的 `selected` 字段。

所以只清空 store 中的 selected 集合不够，还要避免节点和边记录里残留 `selected`。

### 2.2 空白点击偶发不取消多选

当前系统里存在多套选中同步来源：

```text
VueFlow 内部 selected 状态
  ↓ nodes-change / edges-change
Canvas.vue 同步到 Pinia store
  ↓
SelectionFrame.vue 根据 store / live node selected 计算显示

MultiSelectPlugin 内部 selectedNodeIds / selectedEdgeIds
  ↓ selection:change / canvas:setFlag
Canvas.vue 再同步到 Pinia store
```

空白点击取消多选时，如果完全依赖 VueFlow 原生事件链，某些时序下 store 或插件内部集合没有被同步清空，`SelectionFrame.vue` 就可能继续显示。

因此本次修复选择在 `Canvas.vue` 的空白点击入口显式清空：

```text
pane click
  → 清空 canvas.state.selectedNodeIds
  → 清空 canvas.state.selectedEdgeIds
  → selectionVersion + 1
  → 通知 multi-select 插件清空内部状态
```

### 2.3 多选框边距写死

`SelectionFrame.vue` 原本直接使用固定值：

```text
paddingX = 16
paddingTop = 34
paddingBottom = 16
```

这导致 UI 调整必须改组件源码，不符合当前面板可配置的设计。

本次改为：

```text
useCanvasStore.ts
  ├─ selectionFramePaddingX
  ├─ selectionFramePaddingTop
  └─ selectionFramePaddingBottom

Pannel.vue
  └─ 新增“多选框”配置区

SelectionFrame.vue
  └─ 从 canvas.state 读取边距
```

## 3. 修改逻辑

### 3.1 `useCanvasStore.ts`

处理内容：

- `canvas-state` 读取时，不再恢复 `selectedNodeIds` / `selectedEdgeIds`。
- `canvas-state` 写入时，始终把 `selectedNodeIds` / `selectedEdgeIds` 写成空数组。
- `selectionVersion` 写入时重置为 `0`。
- 节点和边序列化时剥离 `selected` 字段。
- 新增多选框边距配置。

状态边界调整后：

```text
持久化状态：画布配置、节点、边、插件配置
非持久化状态：当前选中节点、当前选中边、多选框显示状态
```

### 3.2 `Canvas.vue`

处理内容：

- 新增空白点击清选逻辑。
- 在 `@pane-click` 中先执行清选，再继续向插件事件总线派发 `paneClick`。
- 将 `selectionFramePaddingX`、`selectionFramePaddingTop`、`selectionFramePaddingBottom` 通过 `v-model` 传给 `Pannel.vue`。

清选链路变为：

```text
用户点击空白区域
  → Canvas.vue 主动清空 Pinia 选中态
  → selectionVersion 递增
  → 通知 MultiSelectPlugin 清空内部选中态
  → SelectionFrame.vue 重新计算后隐藏
```

### 3.3 `Pannel.vue`

处理内容：

- props 新增：
  - `selectionFramePaddingX`
  - `selectionFramePaddingTop`
  - `selectionFramePaddingBottom`
- emits 新增：
  - `update:selectionFramePaddingX`
  - `update:selectionFramePaddingTop`
  - `update:selectionFramePaddingBottom`
- 新增独立“多选框”配置区。

配置项：

```text
左右：selectionFramePaddingX
上：selectionFramePaddingTop
下：selectionFramePaddingBottom
```

### 3.4 `SelectionFrame.vue`

处理内容：

- 移除组件内写死 padding。
- 改为从 `canvas.state` 读取：
  - `selectionFramePaddingX`
  - `selectionFramePaddingTop`
  - `selectionFramePaddingBottom`
- 顺手修复一处异常 CSS：

```text
position: （）absolute;
```

修复为：

```text
position: absolute;
```

## 4. 遇到的报错与处理

### 4.1 `Pannel.vue` props 漏声明

第一次构建时报错：

```text
src/canvas/core/Pannel.vue(265,65): error TS2551: Property 'connectionSnapInnerRatio' does not exist on type ... Did you mean 'connectionSnapOuterRatio'?
src/canvas/core/Pannel.vue(268,68): error TS2551: Property 'connectionSnapInnerRatio' does not exist on type ... Did you mean 'connectionSnapOuterRatio'?
src/canvas/core/Pannel.vue(273,67): error TS2551: Property 'connectionSnapHeightRatio' does not exist on type ... Did you mean 'connectionSnapOuterRatio'?
src/canvas/core/Pannel.vue(276,68): error TS2551: Property 'connectionSnapHeightRatio' does not exist on type ... Did you mean 'connectionSnapOuterRatio'?
```

原因：

```text
扩展 props 时误把原本已有的 connectionSnapInnerRatio / connectionSnapHeightRatio 漏掉了。
模板仍在使用这两个值，所以类型检查失败。
```

处理：

```text
在 defineProps 中补回 connectionSnapInnerRatio 和 connectionSnapHeightRatio。
```

### 4.2 `selected` 不是 Node / Edge 类型字段

第一次构建还报错：

```text
src/canvas/core/useCanvasStore.ts(33,21): error TS2353: Object literal may only specify known properties, and 'selected' does not exist in type 'Node<any, any, string>'.
src/canvas/core/useCanvasStore.ts(37,21): error TS2322: Type ... is not assignable to type 'CanvasEdge'.
Object literal may only specify known properties, and 'selected' does not exist in type 'DefaultEdge<any, any, string>'.
```

原因：

```text
最初尝试用 { ...node, selected: false } / { ...edge, selected: false } 清理选中状态。
但当前 @vue-flow/core 的 Node / Edge 类型定义不接受 selected 字段。
```

处理：

```text
改为通过解构剥离 selected 字段，而不是写入 selected: false。
```

最终策略：

```text
const { selected: _selected, ...rest } = node as CanvasNode & { selected?: boolean }
return rest
```

边也采用同样方式处理。

### 4.3 构建通过后的依赖警告

最终构建通过，但仍出现依赖包警告：

```text
[INVALID_ANNOTATION] A comment "/* #__PURE__ */" in "node_modules/.pnpm/@vueuse+core@14.3.0_vue@3.5.38_typescript@6.0.3_/node_modules/@vueuse/core/dist/index.js" contains an annotation that Rolldown cannot interpret due to the position of the comment.
```

含义：

```text
这是 @vueuse/core 打包产物中的 pure annotation 位置警告。
构建最终成功，不是本次业务代码修改导致的类型错误。
```

## 5. 验证结果

执行命令：

```bash
pnpm build
```

结果：

```text
vue-tsc -b && vite build
✓ built
```

补充说明：

- 类型检查已通过。
- Vite 构建已通过。
- 仍存在 `@vueuse/core` 的 Rolldown annotation 警告，但不阻塞构建。

## 6. 当前行为

修复后行为：

```text
多选节点
  → 显示 SelectionFrame

刷新页面
  → 不恢复 selectedNodeIds / selectedEdgeIds
  → 不恢复节点/边 selected 字段
  → SelectionFrame 不再自动出现

点击空白区域
  → 主动清空 Pinia 选中态
  → 同步清空 MultiSelectPlugin 内部选中态
  → SelectionFrame 隐藏

调整 Pannel.vue 中“多选框”配置
  → 更新 useCanvasStore.ts 中对应配置
  → SelectionFrame 边距实时变化
```