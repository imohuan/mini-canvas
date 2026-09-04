// canvas-core-v2 编译期 .vue 模块 shim。
// 本包 src 自身无 .ts→.vue 导入，但当它编译跟随依赖(如 plugin-* 外部包)时，
// 被跟随的 .ts 可能 import .vue，需本程序内有一份 *.vue 声明兜底。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}
