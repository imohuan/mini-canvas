/**
 * 本地展示页入口：只给宿主路由用，不进入组件库主出口。
 * 用一层 TS 包住 .vue，路由按普通模块导入即可，类型检查也更稳定。
 */
import UiKitPreview from './UiKitPreview.vue'

export default UiKitPreview
export { uiKitPreviewRoute } from './route'
