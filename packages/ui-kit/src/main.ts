import { createApp } from 'vue'
import UiKitPreview from './preview/UiKitPreview.vue'

/**
 * ui-kit 独立预览入口。
 * 主应用要接路由时使用 preview/route.ts；这里只负责单独启动时的挂载。
 */
createApp(UiKitPreview).mount('#app')
