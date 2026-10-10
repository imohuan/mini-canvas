# canvas-host-demo

跟着 [CanvasHost / CanvasSurface](/canvas-render/canvas-host) 那篇写的示例：**一行 `<CanvasHost>` 出画布**，
再用 `@ready` 拿到的宿主句柄驱动「加节点 / 撤销 / 换连线颜色」，业务 UI 放 `<template #ui>`。

```bash
pnpm install            # 在仓库根目录（workspace）装依赖
pnpm -C packages/docs/public/examples/canvas-render/canvas-host dev
```

验证点：

1. 点「加文本节点」→ 画布上出现文本节点（走 `command:create-node`）。
2. 点「撤销」→ 节点消失（走 `graph.undo()`）。
3. 拖出一条连线后点「换连线颜色」→ 连线颜色实时变（响应式外观对象生效）。
4. 控制台 `MiniCanvasHostDemo.listPlugins()` → `['theme-default', 'text']`（不含被隐藏的 `canvas-base`）。
