import { createRouter, createWebHashHistory } from 'vue-router'
import CanvasView from '../views/CanvasView.vue'
import McpCanvasView from '../views/McpCanvasView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'canvas',
      component: CanvasView,
    },
    {
      path: '/mcp',
      name: 'mcp-canvas',
      component: McpCanvasView,
    },
    {
      path: '/ui-test',
      name: 'ui-test',
      component: () => import('../views/UiTestPage.vue'),
    },
  ],
})

export default router
