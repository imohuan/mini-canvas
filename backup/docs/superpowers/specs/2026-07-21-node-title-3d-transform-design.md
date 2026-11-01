# 节点标题参与卡片 3D 效果

## 目标

节点标题不再通过 `NodeToolbar` Teleport 到 viewport，而是渲染在卡片内部，使标题自然继承卡片的 3D transform。

顶部和底部工具栏继续使用现有 Teleport 行为，不跟随卡片倾斜。

## 实现

- 将 `BaseNode` 的标题插槽移动到 `.custom-node-card` 内。
- 标题使用绝对定位，视觉位置仍在卡片左上方。
- 卡片保持 `overflow: visible`，标题不会被内容裁剪层遮挡。
- 保留 `BaseTitle` 和现有标题插槽，不改变节点自定义标题的用法。
- 删除 `BaseNode` 标题对 `NodeToolbar` 的依赖；其他工具栏不变。

## 缩放规则

标题进入节点后会自动受到画布 zoom 影响，因此标题本地缩放需要抵消画布 zoom。

设画布缩放为 `zoom`，标题最小缩放阈值为 `minZoom`：

- 标题本地缩放：`1 / max(zoom, minZoom)`
- 标题本地间距：`nodeTitleOffset / max(zoom, minZoom)`

最终屏幕效果与当前行为一致：

- `zoom >= minZoom` 时，标题视觉大小和距卡片间距保持稳定。
- `zoom < minZoom` 时，标题和间距继续随画布一起缩小。

## 验证

- 为标题布局计算补充测试，覆盖阈值以上、阈值以下和异常 zoom。
- 运行测试与项目构建。
- 在浏览器中触发连接悬停 3D 效果，确认标题和卡片同步倾斜。
- 检查不同缩放比例下标题大小和间距没有明显变化。
- 确认顶部、底部工具栏仍保持原来的屏幕空间行为。
