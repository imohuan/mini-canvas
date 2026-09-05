// 本包 src 无 .ts→.vue 导入；但当它编译跟随 @mini-canvas/canvas-core-v2 的 index.ts（其 re-export CanvasHost.vue）
// 时，tsc 会跟随解析 .vue，故需一份 *.vue 模块 shim 兜底（与 plugin-node-text 的 env.d.ts 同源）。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}
