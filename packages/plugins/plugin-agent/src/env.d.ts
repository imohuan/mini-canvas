/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/**
 * 样式副作用导入。
 *
 * 本包 typecheck 会把依赖包的源码一起编译（canvas-render / prosemirror-editor-bundle），
 * 它们里面都有 `import './xxx.css'`。tsconfig 的 `types` 是空的、也没引 vite/client，
 * TS 6 会把 ".css" 判成找不到类型模块（TS2882），三条报错全部来自这里 ——
 * 与被检查的业务代码无关。css 导入只产生副作用、没有值，声明成空模块即可。
 */
declare module '*.css' {}
