import { describe, it, expect } from 'vitest'
import { isXmlUnsafeComment } from '../xmlSanitize'

describe('xmlSanitize：导出前清理 XML 非法注释', () => {
  it('含两个连续减号的注释会被识别（开发期模板注释常见写法）', () => {
    expect(isXmlUnsafeComment('统一圆角用 --radius；主按钮取 --radius-panel')).toBe(true)
    expect(isXmlUnsafeComment('v-if')).toBe(false)
    expect(isXmlUnsafeComment('')).toBe(false)
  })

  it('整段注释只要有一处非法就整体摘掉（注释不参与渲染）', () => {
    const text = '按钮圆角\n读 --radius\n其它说明'
    expect(isXmlUnsafeComment(text)).toBe(true)
  })

})
