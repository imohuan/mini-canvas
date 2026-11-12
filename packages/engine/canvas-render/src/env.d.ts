// canvas-render 编译期 .vue 模块 shim。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}

/**
 * 样式副作用导入（`import './styles/ui-theme.css'`）。
 *
 * 本包 tsconfig 的 `types` 是空的（不引 vite/client），所以 TS 6 会把 ".css" 当成
 * 找不到的类型模块并报 TS2882 —— **被下游插件 typecheck 时会一路串进去**
 * （plugin-agent 的 typecheck 就红在这两行）。css 导入只产生副作用、没有值，
 * 声明成空模块即可，运行时行为完全不变。
 */
declare module '*.css' {}
