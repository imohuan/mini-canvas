# canvas-render-host-demo

跟着 [createMiniCanvasHost 用法](/canvas-render/create-host) 那篇写的最小示例：**不需要浏览器、不需要 Vue**，
只用宿主句柄把「建宿主 → 建节点 → 撤销 → 热装插件 → 落盘 → 停用」走一遍。

```bash
pnpm install          # 在仓库根目录（workspace）装依赖
pnpm -C packages/docs/public/examples/canvas-render/create-host start
```

期望输出：启动后一个 welcome 文本节点、加一个新节点、撤销一次、热装/卸一个插件、最后正常停用。
