import { describe, it, expect } from 'vitest'
import { buildUpstreamApiUrl, readUpstreamMediaPayload } from '../upstreamApi'

describe('readUpstreamMediaPayload：新接口的返回形状', () => {
  it('直接给引用 / 地址', () => {
    expect(readUpstreamMediaPayload({ resourceId: '824e/abc.png' })).toEqual({ resourceId: '824e/abc.png' })
    expect(readUpstreamMediaPayload({ url: '/api/x/a.png' })).toEqual({ url: '/api/x/a.png' })
  })

  it('常见包装层：data / upstream / value', () => {
    expect(readUpstreamMediaPayload({ ok: true, data: { resourceId: 'r1' } })).toEqual({ resourceId: 'r1' })
    expect(readUpstreamMediaPayload({ upstream: { imageUrl: '/api/x/b.png' } })).toEqual({ url: '/api/x/b.png' })
    expect(readUpstreamMediaPayload({ value: { ref: 'r2', src: '/api/x/c.png' } })).toEqual({
      resourceId: 'r2',
      url: '/api/x/c.png',
    })
  })

  it('资源列表：取第一项；也接受裸数组', () => {
    expect(readUpstreamMediaPayload({ resources: [{}, { resourceId: 'r9' }] })).toEqual({ resourceId: 'r9' })
    expect(readUpstreamMediaPayload([{ imageUrl: '/a.png' }])).toEqual({ url: '/a.png' })
  })

  it('认不出 / 空串 / 坏类型 → null（不猜）', () => {
    expect(readUpstreamMediaPayload(null)).toBeNull()
    expect(readUpstreamMediaPayload('x')).toBeNull()
    expect(readUpstreamMediaPayload({ resourceId: '  ', url: '' })).toBeNull()
    expect(readUpstreamMediaPayload({ resources: [] })).toBeNull()
    expect(readUpstreamMediaPayload({ resourceId: 5 })).toBeNull()
  })
})

describe('buildUpstreamApiUrl：配置里的地址', () => {
  const ctx = { canvasId: 'c 1', nodeId: 'n/2' }

  it('留空 = 不请求接口', () => {
    expect(buildUpstreamApiUrl('', ctx)).toBe('')
    expect(buildUpstreamApiUrl('   ', ctx)).toBe('')
  })

  it('占位符替换并转义', () => {
    expect(buildUpstreamApiUrl('/api/upstream/{canvasId}/{nodeId}', ctx)).toBe('/api/upstream/c%201/n%2F2')
  })

  it('没有占位就自动带查询参数（保留原查询串）', () => {
    expect(buildUpstreamApiUrl('/api/upstream', ctx)).toBe('/api/upstream?canvasId=c%201&nodeId=n%2F2')
    expect(buildUpstreamApiUrl('/api/upstream?full=1', ctx)).toBe('/api/upstream?full=1&canvasId=c%201&nodeId=n%2F2')
  })

  it('只给一个占位时只替换那一个，不再追加', () => {
    expect(buildUpstreamApiUrl('/api/upstream/{nodeId}', ctx)).toBe('/api/upstream/n%2F2')
  })
})
