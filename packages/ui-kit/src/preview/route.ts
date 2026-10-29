import UiKitPreview from './UiKitPreview.vue'

/**
 * 组件库展示页的路由定义。
 *
 * ui-kit 不依赖 vue-router：这里只声明路径和页面组件，宿主把它接到自己的 router 即可。
 * 这样预览页的代码、配置面板、文档全部住在 ui-kit/preview 内。
 */
export const uiKitPreviewRoute = {
  path: '/ui-kit',
  name: 'ui-kit',
  component: UiKitPreview,
} as const
