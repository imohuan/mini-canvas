/**
 * @mini-canvas/ui —— 成品应用出口（`package.json` 的 `main`/`types`/`exports` 都指这里）。
 *
 * 这一份公开面说清两件事，别的都不该从这里出去：
 *
 * 1. **应用本体**：`CanvasApp`（= `App.vue`）是"已组装好的画布应用"，含顶部工具条与设置弹窗。
 *    装进任意 Vue 3 应用用 `<CanvasApp/>`，或整体挂载用 `mountCanvasApp(root)`。
 * 2. **装配决定**：`APP_PLUGINS` / `createDefaultStorageAdapter` / `seedDefaultCanvas` 是这一版
 *    装了哪些插件、用哪个存储、空画布塞什么。换一套组合不用改组件，改这里（或 `./assembly`）即可。
 *
 * 有意不从这里导出：`CanvasHost` / `SettingsHost` 等渲染层原语。想要"自己组装一套"的调用方
 * 应当直接依赖 `@mini-canvas/canvas-render` + 自己挑插件 —— 那是另一条路，不是本包的成品出口。
 *
 * 注意：VueFlow 的样式表要由宿主自己引入（本文件刻意不 import CSS，免得非 vite 环境直接报错）：
 *
 *   import '@vue-flow/core/dist/style.css'
 *   import '@vue-flow/core/dist/theme-default.css'
 *
 * （`src/main.ts` 里就是这么做的。）
 */
import { createApp, type App as VueApp } from 'vue'
import CanvasApp from './App.vue'

export { default as CanvasApp } from './App.vue'
export {
  APP_PLUGINS,
  SAMPLE_IMAGE_URL,
  SAMPLE_TEXT,
  createDefaultStorageAdapter,
  seedDefaultCanvas,
} from './assembly'

/**
 * 把成品应用挂到一个 DOM 节点上，返回 Vue 应用实例（调用方 `unmount()` 收尾）。
 *
 * 这是给"只想要一个画布，不想写 Vue 组件"的调用方的一行入口；
 * 已经自带 `createApp` 的宿主直接用 `<CanvasApp/>` 即可，不必经过这里。
 */
export function mountCanvasApp(root: string | Element): VueApp {
  const app = createApp(CanvasApp)
  app.mount(root)
  return app
}
