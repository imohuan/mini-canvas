// 文件：packages/docs/public/examples/canvas-render/canvas-host/src/main.ts
// 格式：TypeScript 模块（应用入口）
// 位置：把应用挂到页面上；VueFlow 的两份样式必须由宿主自己引（本包刻意不 import CSS）
import { createApp } from 'vue'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import App from './App.vue'

createApp(App).mount('#app')
