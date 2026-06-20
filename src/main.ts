import { createApp } from 'vue'
import { createPinia } from 'pinia'
// import { installConsoleInterceptor } from './installConsoleInterceptor'
import './style.css'
import App from './App.vue'

// installConsoleInterceptor()

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
