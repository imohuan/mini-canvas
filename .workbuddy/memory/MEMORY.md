# Project Memory

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
