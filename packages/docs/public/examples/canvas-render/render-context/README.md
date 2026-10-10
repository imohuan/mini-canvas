# plugin-note-demo

跟着 [渲染上下文与 content 组件](/canvas-render/render-context) 那篇写的示例插件：

- `src/index.ts`：注册 `note` 节点类型（尺寸 / 端口 / 可 resize / 建节点），把 `NoteContent.vue` 挂到区域词 `in`；
- `src/NoteContent.vue`：content 组件 —— 壳注入的 `{ id, data }` props、`useCanvasRender().nodeWrite` 写回、
  双击进编辑、编辑态 `nowheel` 拦画布滚轮。

装配到任何宿主（例如 `packages/ui` 的 `APP_PLUGINS`）即可在画布上加便签节点。
