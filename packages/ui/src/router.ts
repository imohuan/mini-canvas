/**
 * router —— 应用级路由（hash 模式，静态托管下刷新不 404）。
 *
 *   `#/`            → 项目列表页（ProjectsPage）
 *   `#/ui-kit`      → 组件库展示页（页面在 @mini-canvas/ui-kit/preview）
 *   `#/canvas/:id`  → 画布工作台（App.vue，现有那套）
 *
 * 为什么用 hash 而不是 history：cloud-server 把 ui/dist 当静态托管、只对「非文件路径」回落 index.html。
 * hash 路由不需要服务端配合改写，刷新 / 分享链接都稳。
 */
import { createRouter, createWebHashHistory } from 'vue-router'
import ProjectsPage from './components/ProjectsPage.vue'
import UiKitRoute from './components/UiKitRoute.vue'
import CanvasApp from './App.vue'
import { flushPendingSave } from './composables/pendingSave'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'projects', component: ProjectsPage },
    { path: '/ui-kit', name: 'ui-kit', component: UiKitRoute },
    { path: '/canvas/:id', name: 'canvas', component: CanvasApp, props: true },
    // 其它路径（含旧的直接打开根路径）一律回项目页
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

/**
 * 导航守卫：**离开画布前先 await 落盘**。
 *
 * 为什么必须在这里做（而不是只在下拉切换里）：切换画布的路径不止一条 —— 下拉切换、
 * 浏览器返回、地址栏直接改 hash、点「返回项目页」。放在守卫里，所有路径都覆盖：
 * 此刻旧画布组件还挂着、存储适配器还在，flush 能把最后一次编辑真正写完再放行。
 */
router.beforeEach(async (to, from) => {
  const leavingCanvas = from.name === 'canvas' && to.name !== 'canvas'
  const switchingCanvas = from.name === 'canvas' && to.name === 'canvas' && to.path !== from.path
  if (leavingCanvas || switchingCanvas) await flushPendingSave()
  return true
})
