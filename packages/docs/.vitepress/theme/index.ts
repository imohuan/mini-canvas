import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import PluginCapabilityTable from './components/PluginCapabilityTable.vue'
import ComponentPreview from './components/ComponentPreview.vue'
import ComponentPreviewFrame from './components/ComponentPreviewFrame.vue'
import SurfaceReport from './components/SurfaceReport.vue'
import RegistryPlayground from './components/RegistryPlayground.vue'
import './styles.css'

/**
 * 主题入口：沿用默认主题，只往全局注册几个文档专用组件。
 * 注册之后，任意 MD 页面都能直接写 <ComponentPreview/>，不必 import。
 */
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('PluginCapabilityTable', PluginCapabilityTable)
    app.component('ComponentPreview', ComponentPreview)
    app.component('ComponentPreviewFrame', ComponentPreviewFrame)
    app.component('SurfaceReport', SurfaceReport)
    app.component('RegistryPlayground', RegistryPlayground)
  },
} satisfies Theme
