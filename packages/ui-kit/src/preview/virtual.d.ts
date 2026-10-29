declare module 'virtual:ui-kit-doc/*' {
  import type { Component } from 'vue'
  const examples: Component[]
  const markdown: string
  export { markdown }
  export default examples
}
