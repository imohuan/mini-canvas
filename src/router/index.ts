import { createRouter, createWebHashHistory } from 'vue-router'
import CanvasView from '../views/CanvasView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'canvas',
      component: CanvasView,
    },
    {
      path: '/ui-test',
      name: 'ui-test',
      component: () => import('../views/UiTestPage.vue'),
    },
  ],
})

export default router
