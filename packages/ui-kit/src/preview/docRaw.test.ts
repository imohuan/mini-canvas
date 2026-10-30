import { describe, expect, it } from 'vitest'
import { isProxy, isReactive, markRaw } from 'vue'
import { toDoc } from './docRaw'

describe('文档模块', () => {
  it('toDoc 返回的文档和示例组件都不会被响应式代理', () => {
    const Example = markRaw({ name: 'DemoExample', render: () => null })
    const doc = toDoc({ markdown: '# 标题', codeHtml: ['<pre/>'], default: [Example] })
    expect(isReactive(doc)).toBe(false)
    expect(isProxy(doc.examples[0])).toBe(false)
    expect(doc.examples).toHaveLength(1)
    expect(doc.markdown).toBe('# 标题')
  })
})
