/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}

// 样式副作用导入 shim：使用方（两个主题包）会 import 本包的 ./styles/node-theme.css。
// 本包 tsconfig include 只覆盖自身 src，故需就地声明，否则 tsc 报 TS2882。
declare module '*.css' {
  const css: string
  export default css
}
