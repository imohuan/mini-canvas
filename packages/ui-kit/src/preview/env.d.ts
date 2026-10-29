declare module 'virtual:ui-kit-doc/*'

declare module 'virtual:ui-kit-doc/button' {
  import type { Component } from 'vue'
  export const markdown: string
  export const codeHtml: string[]
  const examples: Component[]
  export default examples
}

declare module 'virtual:ui-kit-doc/split-pane' {
  import type { Component } from 'vue'
  export const markdown: string
  export const codeHtml: string[]
  const examples: Component[]
  export default examples
}

declare module '*.css'
