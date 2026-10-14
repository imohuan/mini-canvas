/// <reference types="vite/client" />

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

// `?raw` 文本导入：vite / vitest 原生支持（内容以字符串导出）。
// 用户口径 2026-10-14：手册正文抽成独立 MD，用 `?raw` 加载到一个变量里。
// 后台那半走 esbuild，由 scripts/build-server.mjs 的 raw-text 插件提供同一语义。
declare module '*.md?raw' {
  const text: string
  export default text
}

