# Project Memory

## SelectionFrame Toolbar 偏移坐标空间不匹配

### 问题

多选时 BaseToolbar → NodeToolbar 的 toolbar 偏移随画布缩放变化。zoom=0.6 时 gap=+25px，zoom=1.4 时 gap=-1.8px（toolbar 钻进 frame 里）。单节点 NodeToolbar 无此问题（gap 恒定 12px）。

### 根因分析（git diff 唯一实质性修改：`SelectionFrame.vue:276`）

**两套独立的坐标系统：**

1. **SelectionFrame 框架定位**（CSS transform）：
   ```
   .selection-frame-wrapper { transform: translate(viewport.x, viewport.y) scale(viewport.zoom); }
   .selection-frame { left: canvasBounds.x, top: canvasBounds.y }  // canvas 坐标
   ```
   canvasBounds.y = rawBounds.y - paddingTop，CSS transform 将 canvas 坐标映射到 screen：
   ```
   frameTop(screen) = (rawBounds.y - paddingTop) * zoom + viewport.y
   ```

2. **NodeToolbar 定位**（`getTransform` 手动计算）：
   ```js
   // NodeToolbar.vue — Teleport 到 viewportRef（脱离 SelectionFrame 的 CSS transform）
   pos[1] = nodeRect.y * zoom + viewport.y - offset   // 手动 canvas→screen 换算
   ```
   offset 是 screen 像素值，**不乘 zoom**。toolbar 底部 screen 位置：
   ```
   toolbarBottom(screen) = rawBounds.y * zoom + viewport.y - offset
   ```

**Gap 公式推导：**
```
gap = frameTop - toolbarBottom
    = (rawBounds.y - paddingTop) * zoom - rawBounds.y * zoom + offset
    = offset - paddingTop * zoom
```

`offset = topToolbarOffset(12) + extraOffset`

修复前 `extraOffset = paddingTop`：
```
gap = 12 + paddingTop - paddingTop * zoom = 12 + paddingTop * (1 - zoom)
```
→ gap 随 zoom 线性变化（实测：zoom=0.61→gap=25.2, zoom=0.93→gap=14.5, zoom=1.4→gap=-1.8）✗

修复后 `extraOffset = paddingTop * zoom`：
```
gap = 12 + paddingTop * zoom - paddingTop * zoom = 12
```
→ gap 恒定 = topToolbarOffset(12px)，与 zoom 无关 ✓

### 为什么之前 3 轮分析失败

纯靠代码阅读推断，从未运行时验证。systematic-debugging 要求"收集证据"——用 playwright 在 3 个 zoom 级别测量 DOM 位置，公式与实测完全吻合后，一次确认根因。

### 关键认知

- `Teleport to="viewportRef"` 使 NodeToolbar 脱离 SelectionFrame 的 CSS transform 坐标空间
- toolbar 位置由 `getTransform`（手动计算）和 CSS transform（SelectionFrame 框架）**两套独立系统**决定
- canvas 空间 → screen 空间的值必须在传递给另一套系统前完成换算
- 此类多坐标系统 bug 必须用浏览器实际测量 DOM 位置来验证，静态代码阅读无法可靠定位

## Canvas 图片处理规则

- **不要用 `drawImage(HTMLImageElement)` 画 blob URL 图片** — 在部分浏览器/图片格式下 canvas 位图为全透明（testPixel 全 0），即使 `onload` fire、`naturalWidth` 正确
- **用 `fetch + createImageBitmap` 代替** — ImageBitmap 使用 GPU 侧独立解码器，不依赖 `<img>` 渲染管线
- **`createImageBitmap(blob, sx, sy, sw, sh)` 裁剪可能返回 0×0**，先 `createImageBitmap(blob)` 完整解码，再 `createImageBitmap(fullBitmap, sx, sy, sw, sh)` 裁剪

## 节点 Toolbar 组件注册

- `CanvasNodeDefinition` 新增 `topToolbar?: Component`、`bottomToolbar?: Component`
- 节点插件注册时传入自定义 toolbar 组件，CustomNode 按 nodeType 查 registry 动态渲染
- 未注册则 fallback 到默认 BaseToolbar（现有行为零改动）
- 自定义 toolbar 组件接收 `v-bind="$props"`（NodeProps），完全自由渲染

## 节点 Toolbar 工具组切换

- `BaseRegistryItem.group?: string` 标记按钮归属组
- `node.data._overlay._toolbarGroup` 记录当前激活组（仅在 _overlay 内）
- `BaseToolbar.vue` activeGroup 只从 `_overlay._toolbarGroup` 读取
- 未设 group 的按钮永远显示；已设 group 的按钮只在匹配当前激活组时显示
- `_overlay` 不存在（undefined）→ 不做 group 过滤（向后兼容）

## _overlay 临时状态模式

- 进入特殊模式（裁剪/扩展等）→ `node.data._overlay = { _cropMode: true, _toolbarGroup: 'xxx' }`
- 退出 → `delete node.data._overlay` 一步恢复所有状态
- `BaseCanvasNodeData._overlay?: CanvasNodeOverlay`（types/CanvasNodeData.ts）
- `_overlay` 存在时 BaseNode 隐藏选中边框（`showSelectionOutline` computed 检查 `!props.data?._overlay`）

## 图片扩展（Outpaint）功能

- **`ImageExpander.vue`** — `Teleport :to="viewportRef"`（非 body），`position: absolute; inset: 0`
- 与裁剪的关键差异：裁剪容器 = 节点大小（overflow hidden），扩展容器 = 全 viewport（允许向外拖拽超出原图边界）
- 交互层 `pointer-events: auto`，backdrop `pointer-events: none`
- expand rect 坐标用图片像素，x/y 可为负（向左/上扩展），w/h 可超原图尺寸（向右/下扩展）
- Toolbar 按钮：用 `ToolbarButton` 渲染 registry `group:'expand'` 的按钮，定位在 expand 框底部
- 根因：不能用 `Teleport to="body"`（stacking context 高于 viewport，压住所有 toolbar）

### _overlay 完整结构
```ts
_overlay: {
  _cropMode: true,
  _expamdMode: true,
  _maskMode: true,
  _toolbarGroup: 'expand' | 'crop' | 'mask',
  _cropRect: { x, y, width, height },     // ← 全在 _overlay 内，非顶层
  _expandRect: { x, y, width, height },   // ← 同上
  _maskConfig: { brushSize, brushColor, brushOpacity, isErasing }, // ← 蒙版画笔配置
}
```

## 图片蒙版（Mask）功能

- **`ImageMasker.vue`** — `Teleport to="body"`（同 ImageCropper），双 canvas 层（背景图 + 绘制层）
- brushSize/brushColor/brushOpacity/isErasing 通过 `_overlay._maskConfig` 配置
- 蒙版绘制数据通过 `maskUrl`（blob URL）存在 node.data 顶层，持久化走 assetManager
- 橡皮擦用 Canvas `destination-out` composite
- toolbar group 使用 `'mask'`，按钮：大小下拉/颜色下拉/橡皮擦/清除/确认/取消

### Storage 双重清理
- `sanitizeForSave` — RUNTIME_FIELDS 含 `_overlay`, `_cropRect`, `_cropMode`, `_expandRect`, `_expandMode`
- `loadCanvas` — 加载时对每个 node 直接 `delete _overlay`（防御刷新后残留模式）
- 退出模式一律 `delete data._overlay` 一步清空

## Vue Render 阶段禁止写入 Reactive State

- **模板表达式/插槽中调用的函数禁止写入 reactive state** — 会导致 `Maximum recursive updates exceeded`
- 典型反模式：`<template #slot>{{ updateState() }}</template>` 中的 `updateState` 写入 Pinia ref
- **修复**：用 `nextTick(() => { state.value = x })` 迁出 render 阶段
- 已在 `useCanvasConnection.ts` 的 `buildConnectionEdgeProps` 中应用此修复（hoverNode 写入）

## 节点自渲染模式 (selfRender)

- `CanvasNodeDefinition.selfRender?: boolean` — true 时 CustomNode 不做 BaseNode 组装，直接渲染 node 组件
- 自渲染节点接收完整 `NodeProps`，内部自由使用 BaseNode（填充所有 slot）或完全自定义
- 注册时不需要 `titleIcon`/`topToolbar`/`bottomToolbar` 等碎片字段 — 全由组件内部控制
- `BaseNode.vue` 的 `title-extra` slot 默认空，不再包含任何节点类型特定逻辑
- 当前只有 `image` 节点使用 selfRender，其他节点类型保持原有组装模式

### selfRender 节点模板模式

```vue
<template>
  <BaseNode v-bind="$props">
    <template #title-icon>...</template>
    <template #title-label>...</template>
    <template #title-extra>...</template>
    <template #top-toolbar>...</template>
    <template #content>...</template>
    <template #bottom-toolbar>...</template>
  </BaseNode>
</template>
```

## 图片对比节点 (image-compare)

- 节点类型 `'image-compare'`，单一 target 输入端口，最多 2 条连接（FIFO 淘汰）
- 视图用 CSS `clip-path: inset()` 实现滑块对比效果
- 从上游 image 节点读取 `imageUrl`，不依赖自身 data 存储图片
- `leftImageUrl`/`rightImageUrl` 是 runtime-only blob URL，已加入 `RUNTIME_FIELDS`
- `dividerPosition`/`compareMode` 是持久化配置字段
