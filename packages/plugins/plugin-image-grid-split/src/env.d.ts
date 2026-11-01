/// <reference types="vite/client" />

// 样式副作用导入 shim：canvas-render 以源码形式随本包一起编译，其 index.ts 顶部
// import './styles/ui-theme.css'。本包 tsconfig include 只覆盖自身 src，故需就地声明，
// 否则 vue-tsc 报 TS2882（与其它插件包的 *.css shim 同一处理方式）。
declare module '*.css' {
  const css: string
  export default css
}
