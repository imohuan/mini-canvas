/// <reference types="vite/client" />

/**
 * three 的 npm 包不带 .d.ts（0.184 起类型只随 @types/three 发）。
 *
 * 为什么在这里声明而不是装 @types/three：本插件只用到二十来个符号（场景/相机/渲染器/
 * 贴图/OrbitControls），装一整套类型会拉进几十个 d.ts 与额外依赖，收益不抵成本。
 * 声明成 any 的代价只是本包内 three 相关代码没有类型检查 —— 行为由测试与真机验证兜住。
 * 注意：这是**插件自己的** shim；宿主（packages/ui）跨包引用本插件源码时读不到它，
 * 所以宿主侧另有一份同名声明（packages/ui/src/three.d.ts）。
 */
declare module 'three'

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
