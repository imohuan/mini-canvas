// 本包经 canvas-render index 重导出 .vue（CanvasHost.vue 等），tsc 跟随解析需 *.vue shim 兜底
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}
