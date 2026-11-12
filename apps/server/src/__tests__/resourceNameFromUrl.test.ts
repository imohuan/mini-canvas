/**
 * 从画布资源地址里取资源名。
 *
 * 真出过的坑：UI 把资源地址交给后台，而 `resolveInput` 当时只认 `res:` 开头 ——
 * 于是路径形态被原样发给 web2api，它在自己机器上按相对路径找 →
 * 报「图片不存在…uploads/api/canvases/…」。
 */
import { describe, it, expect } from 'vitest'
import { parseResourceNameFromUrl } from '../store/canvasResources'

describe('从画布资源地址取名字', () => {
  it('无 origin 的路径形态（UI 就是这么传的）', () => {
    expect(parseResourceNameFromUrl('/api/canvases/c1/resources/8370e3532aee3dcc.png', 'c1')).toBe('8370e3532aee3dcc.png')
  })

  it('带 origin 的完整地址', () => {
    expect(parseResourceNameFromUrl('http://127.0.0.1:8865/api/canvases/c1/resources/8370e3532aee3dcc.png', 'c1')).toBe('8370e3532aee3dcc.png')
  })

  it('画布 id 不匹配时不算数（防串到别的画布）', () => {
    expect(parseResourceNameFromUrl('/api/canvases/other/resources/8370e3532aee3dcc.png', 'c1')).toBeUndefined()
  })

  it('res: 形态已不再被认（兼容已移除）', () => {
    expect(parseResourceNameFromUrl('res:8370e3532aee3dcc.png', 'c1')).toBeUndefined()
  })

  it('普通外部地址不认识（原样不会被误当画布资源）', () => {
    expect(parseResourceNameFromUrl('https://cdn.example.com/x.png', 'c1')).toBeUndefined()
  })
})
