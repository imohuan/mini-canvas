import { markRaw, type Component } from 'vue'

/** 虚拟文档模块的原始形状：markdown 文本、高亮 HTML、编译好的示例组件。 */
export interface RawDocModule {
  markdown: string
  codeHtml: string[]
  default: Component[]
}

export interface UiKitDoc {
  markdown: string
  examples: Component[]
  codeHtml: string[]
}

export const EMPTY_CODE_HTML: string[] = []

/**
 * 组件对象必须 markRaw：放进 ref 会被 Vue 代理，既触发警告也拖慢渲染。
 * 文档对象本身也 markRaw，页面用 shallowRef 存它，只换引用不深度遍历。
 */
export function toDoc(entry: RawDocModule): UiKitDoc {
  const examples = (entry.default ?? []).map((component) => markRaw(component))
  return markRaw({ markdown: entry.markdown, examples, codeHtml: entry.codeHtml ?? [] })
}
