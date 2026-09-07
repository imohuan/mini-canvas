// *.vue shim：本包 tsc 跟随 canvas-core-v2 的 index.ts 时可能解析到 .vue 模块，兜底声明（与 plugin-canvas-commands 同源）。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}
