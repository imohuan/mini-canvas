/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/**
 * 样式副作用导入。
 *
 * 本包 typecheck 会连带编译依赖包 canvas-render 的源码，它会 `import './styles/ui-theme.css'`。
 * tsconfig 的 `types` 是空的、没引 vite/client，TS 6 会把 ".css" 判成找不到类型模块（TS2882）。
 * css 导入只产生副作用、没有值，声明成空模块即可。
 */
declare module '*.css' {}
