import { createApp } from 'vue'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@plume-canvas/ui-kit-shadcn/styles.css'
// 颜色配方已迁进 @plume-canvas/plugin-theme-components（默认主题）。
// 这个独立页只服务「目验颜色配方」，所以直接从默认主题取页面。
// 包的 exports 已把 "./*" 映射到 "./src/*"，这里不能再写一层 src/
import ThemeStudio from '@plume-canvas/plugin-theme-components/components/theme-studio/ThemeStudio.vue'
import { createStudioPreviewSource } from './themeStudioEntry'
import { defineComponent, h, provide } from 'vue'
import { CANVAS_CONTEXT_KEY, type CanvasContext } from '@plume-canvas/canvas-render'
import { createStudioPreviewContext } from './themeStudioEntry'

const Root = defineComponent({
  setup() {
    const { source } = createStudioPreviewSource()
    const ctx = createStudioPreviewContext()
    provide(CANVAS_CONTEXT_KEY, { ctx } as unknown as CanvasContext)
    return () => h('div', { class: 'theme-lab-page' }, [h(ThemeStudio, { settingsSource: source })])
  },
})

createApp(Root).mount('#app')
