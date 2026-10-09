import { describe, it, expect } from 'vitest'
import { pendingUploadFields } from '../resourceRef'

describe('还没上传的本地地址', () => {
  it('认出 dataURL / blob（后台取不到这两种）', () => {
    expect(pendingUploadFields({ imageUrl: 'data:image/png;base64,AAA' })).toEqual(['imageUrl'])
    expect(pendingUploadFields({ videoUrl: 'blob:http://x/1' })).toEqual(['videoUrl'])
    expect(pendingUploadFields({ imageUrl: 'https://x/a.png' })).toEqual([])
    expect(pendingUploadFields({ imageUrl: '/api/canvases/default/resources/0123456789abcdef.png' })).toEqual([])
    expect(pendingUploadFields(undefined)).toEqual([])
  })

  it('九个媒体字段都认（不只是 imageUrl）', () => {
    expect(pendingUploadFields({ panoUrl: 'data:image/png;base64,AAA' })).toEqual(['panoUrl'])
    expect(pendingUploadFields({ leftImageUrl: 'blob:http://x/1', maskUrl: 'data:image/png;base64,AAA' })).toEqual([
      'maskUrl',
      'leftImageUrl',
    ])
  })
})
