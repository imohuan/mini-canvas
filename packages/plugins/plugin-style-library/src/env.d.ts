/// <reference types="vite/client" />

// .vue 单文件组件在 tsc --noEmit 下没有自带声明；这里补一条通配声明，
// 让插件里 import Xxx.vue 能过类型检查（运行时由 vite/vue 编译链处理）。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, any>, Record<string, any>, any>
  export default component
}

