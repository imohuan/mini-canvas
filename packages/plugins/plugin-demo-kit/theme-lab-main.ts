import { createApp } from 'vue'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@mini-canvas/ui-kit-shadcn/styles.css'
import ThemeLabApp from './src/theme-lab/themeLabApp.vue'
import './src/theme-lab/themeLab.css'

createApp(ThemeLabApp).mount('#app')
