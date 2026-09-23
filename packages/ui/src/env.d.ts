// @mini-canvas/ui 编译期 .vue 模块 shim。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}

// 静态图片资源 shim（vite 负责转成 URL；本包 tsconfig types:[] 未引入 vite/client）
declare module '*.png' {
  const src: string
  export default src
}
