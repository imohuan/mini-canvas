import { describe, it, expect } from 'vitest'
import {
  isResourceRef,
  parseResourceRef,
  resolveRef,
  toRef,
  expandNodes,
  shrinkNodes,
  pendingUploadFields,
} from '../resourceRef'
import { RESOURCE_REF_PREFIX } from '../keys'

describe('引用形态', () => {
  it('前缀与解析', () => {
    expect(RESOURCE_REF_PREFIX).toBe('res:')
    expect(isResourceRef('res:0123456789abcdef.png')).toBe(true)
    expect(isResourceRef('/uploads/x.png')).toBe(false)
    expect(isResourceRef(undefined)).toBe(false)
    expect(parseResourceRef('res:0123456789abcdef.png')).toBe('0123456789abcdef.png')
    expect(parseResourceRef('res:..%2Fevil')).toBeUndefined()
    expect(parseResourceRef('/uploads/x.png')).toBeUndefined()
  })

  it('解析成当前画布下的真地址', () => {
    expect(resolveRef('res:0123456789abcdef.png', 'default')).toBe('/api/canvases/default/resources/0123456789abcdef.png')
    expect(resolveRef('res:0123456789abcdef.png', 'other')).toBe('/api/canvases/other/resources/0123456789abcdef.png')
  })

  it('非引用原样返回（老数据不该因为这次改造而裂图）', () => {
    expect(resolveRef('/uploads/aaaa.png')).toBe('/uploads/aaaa.png')
    expect(resolveRef('https://x/a.png')).toBe('https://x/a.png')
    expect(resolveRef('')).toBeUndefined()
    expect(resolveRef(undefined)).toBeUndefined()
  })

  it('反解：当前画布的资源地址收回 res:', () => {
    expect(toRef('/api/canvases/default/resources/0123456789abcdef.png', 'default')).toBe('res:0123456789abcdef.png')
    // 别的画布的资源地址不动（那是跨画布引用，收不回本画布的 res:）
    expect(toRef('/api/canvases/other/resources/0123456789abcdef.png', 'default')).toBe(
      '/api/canvases/other/resources/0123456789abcdef.png',
    )
    expect(toRef('https://x/a.png')).toBe('https://x/a.png')
  })
})

describe('批量展开 / 收回', () => {
  const ref = 'res:0123456789abcdef.png'
  const url = '/api/canvases/default/resources/0123456789abcdef.png'

  it('展开：九个媒体字段都认（不只是 imageUrl）', () => {
    const patches = expandNodes(
      [
        { id: 'n1', data: { imageUrl: ref } },
        { id: 'n2', data: { videoUrl: ref } },
        { id: 'n3', data: { audioUrl: ref, posterUrl: ref } },
        { id: 'n4', data: { panoUrl: ref } },
        { id: 'n5', data: { leftImageUrl: ref, rightImageUrl: ref } },
        { id: 'n6', data: { thumbUrl: ref, maskUrl: ref } },
      ],
      'default',
    )
    expect(patches.map((p) => p.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
    expect(patches[0].data).toEqual({ imageUrl: url })
    expect(patches[2].data).toEqual({ audioUrl: url, posterUrl: url })
  })

  it('展开：没变的节点不回补丁（免得白触发一次落盘）', () => {
    expect(expandNodes([{ id: 'n1', data: { imageUrl: url, text: 'hi' } }], 'default')).toEqual([])
    expect(expandNodes([{ id: 'n1', data: { text: 'hi' } }], 'default')).toEqual([])
    expect(expandNodes([{ id: 'n1' }], 'default')).toEqual([])
  })

  it('收回：把本画布地址换回 res:（磁盘上只存相对引用）', () => {
    const patches = shrinkNodes([{ id: 'n1', data: { imageUrl: url, text: 'hi' } }], 'default')
    expect(patches).toEqual([{ id: 'n1', data: { imageUrl: ref } }])
  })

  it('展开与收回是互逆的', () => {
    const nodes = [{ id: 'n1', data: { imageUrl: ref, videoUrl: ref } }]
    const expanded = expandNodes(nodes, 'default')[0]
    const back = shrinkNodes([{ id: 'n1', data: expanded.data }], 'default')[0]
    expect(back.data).toEqual({ imageUrl: ref, videoUrl: ref })
  })
})

describe('还没上传的本地地址', () => {
  it('认出 dataURL / blob（后台取不到这两种）', () => {
    expect(pendingUploadFields({ imageUrl: 'data:image/png;base64,AAA' })).toEqual(['imageUrl'])
    expect(pendingUploadFields({ videoUrl: 'blob:http://x/1' })).toEqual(['videoUrl'])
    expect(pendingUploadFields({ imageUrl: 'res:0123456789abcdef.png' })).toEqual([])
    expect(pendingUploadFields({ imageUrl: 'https://x/a.png' })).toEqual([])
    expect(pendingUploadFields(undefined)).toEqual([])
  })
})
