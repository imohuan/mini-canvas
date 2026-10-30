/**
 * ui-kit 文档虚拟模块的类型声明（宿主应用也能检查到这些 import）。
 *
 * 真正的模块由 @mini-canvas/ui-kit/vite 在构建期生成；这里只声明形状，
 * 与 ui-kit/src/preview/env.d.ts 里的声明保持一致。
 */
declare module 'virtual:ui-kit-doc/*' {
  import type { Component } from 'vue'
  export const markdown: string
  export const codeHtml: string[]
  const examples: Component[]
  export default examples
}
