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

- 进入特殊模式（裁剪等）→ `node.data._overlay = { _cropMode: true, _toolbarGroup: 'xxx' }`
- 退出 → `delete node.data._overlay` 一步恢复所有状态
- `BaseCanvasNodeData._overlay?: CanvasNodeOverlay`（types/CanvasNodeData.ts）
