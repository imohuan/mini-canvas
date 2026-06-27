import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { installConsoleInterceptor } from './installConsoleInterceptor'
import router from './router'
import './style.css'
import App from './App.vue'

installConsoleInterceptor()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
