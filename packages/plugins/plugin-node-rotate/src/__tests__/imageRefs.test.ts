import { describe, expect, it } from 'vitest'
import { readImageSourceFields } from '../imageRefs'

describe('readImageSourceFields', () => {
  it('两个来源字段都认：有引用或有旧地址都算「有图」', () => {
    expect(readImageSourceFields({ resourceId: 'res-1' })).toEqual({ resourceId: 'res-1', legacyUrl: '' })
    expect(readImageSourceFields({ imageUrl: 'blob:x' })).toEqual({ resourceId: '', legacyUrl: 'blob:x' })
  })

  it('没有图 / 脏数据 → 两个字段都是空串（入口按钮不该出现）', () => {
    expect(readImageSourceFields(undefined)).toEqual({ resourceId: '', legacyUrl: '' })
    expect(readImageSourceFields({})).toEqual({ resourceId: '', legacyUrl: '' })
    expect(readImageSourceFields({ resourceId: 123, imageUrl: null })).toEqual({ resourceId: '', legacyUrl: '' })
  })
})
