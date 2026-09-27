// 本包无 .ts→.vue 导入；但类型检查跟随 @mini-canvas/canvas-data 的 index.ts（re-export CanvasHost.vue）
// 时会解析 .vue，故留一份 shim 兜底（与其它插件包同源）。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}

// 样式副作用导入 shim：canvas-render 以源码形式随本包一起编译，其 index.ts 顶部
// import './styles/ui-theme.css'。本包 tsconfig include 只覆盖自身 src，故需就地声明，
// 否则 tsc 报 TS2882（与各包的 *.vue shim 同一处理方式）。
declare module '*.css' {
  const css: string
  export default css
}
