// 本包无 .ts→.vue 导入；但类型检查跟随 @mini-canvas/canvas-core-v2 的 index.ts（re-export CanvasHost.vue）
// 时会解析 .vue，故留一份 shim 兜底（与其它插件包同源）。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}
