/**
 * 动作文案（参数下拉标题 / 发送按钮文字）—— 用户 2026-11-17。
 *
 * 锁四件事：
 * 1. 没声明函数就不发请求（老 provider 零负担）；
 * 2. 后台回了什么就用什么，空串当作「没有」；
 * 3. 后台挂了 / 404 / 超时都静默回落默认，不抛；
 * 4. 同一份输入不重复问（拖滑块时会连续触发）。
 */
import { describe, expect, it, vi } from 'vitest'
import { createLabelMemo, fetchActionLabels, labelCacheKey } from '../actionLabels'
import { countResourcesByKind } from '../node-bottom-bar/useActionLabels'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const INPUT = {
  actionId: 'apimart:gpt-image-2.6-sunburst',
  values: { resolution: '4k', quality: 'high' },
  labels: { resolution: '4K', quality: '超清' },
  summary: '4K · 超清',
  resources: { image: 0, video: 0, audio: 0, text: 0 },
}

describe('fetchActionLabels', () => {
  it('拿到后台算好的两段文案', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, items: [{ actionId: INPUT.actionId, selectLabel: '4K · 0.65积分', sendLabel: '0.65积分' }] }),
    ) as unknown as typeof fetch

    const out = await fetchActionLabels([INPUT], { fetchImpl })
    expect(out[INPUT.actionId]).toEqual({ selectLabel: '4K · 0.65积分', sendLabel: '0.65积分' })
  })

  it('空串当成「没有」，由前端回落默认', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, items: [{ actionId: INPUT.actionId, selectLabel: '', sendLabel: '   ' }] }),
    ) as unknown as typeof fetch

    const out = await fetchActionLabels([INPUT], { fetchImpl })
    expect(out[INPUT.actionId]).toBeUndefined()
  })

  it('后台 500 / 非 JSON 都不抛，返回空表', async () => {
    const bad500 = vi.fn(async () => jsonResponse({ ok: false }, 500)) as unknown as typeof fetch
    expect(await fetchActionLabels([INPUT], { fetchImpl: bad500 })).toEqual({})

    const notJson = vi.fn(
      async () => new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ) as unknown as typeof fetch
    expect(await fetchActionLabels([INPUT], { fetchImpl: notJson })).toEqual({})
  })

  it('网络异常吞掉，不让底栏变红', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    expect(await fetchActionLabels([INPUT], { fetchImpl: boom })).toEqual({})
  })

  it('空输入不发请求', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    expect(await fetchActionLabels([], { fetchImpl })).toEqual({})
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0)
  })

  it('请求打到 /api/actions/labels，POST + JSON', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, items: [] })) as unknown as typeof fetch
    await fetchActionLabels([INPUT], { fetchImpl, baseUrl: 'http://127.0.0.1:8865/' })
    const [url, init] = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8865/api/actions/labels')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toContain(INPUT.actionId)
  })
})

describe('labelCacheKey', () => {
  it('同一份输入得到同一个键', () => {
    expect(labelCacheKey(INPUT)).toBe(labelCacheKey({ ...INPUT, values: { ...INPUT.values } }))
  })

  it('参数或参考图数量变了就是新键', () => {
    const k0 = labelCacheKey(INPUT)
    expect(labelCacheKey({ ...INPUT, values: { resolution: '2k', quality: 'high' } })).not.toBe(k0)
    expect(labelCacheKey({ ...INPUT, resources: { image: 2, video: 0, audio: 0, text: 0 } })).not.toBe(k0)
  })
})

describe('createLabelMemo', () => {
  it('键没变就返回上一份结果，变了返回 undefined', () => {
    const memo = createLabelMemo()
    expect(memo.get('a')).toBeUndefined()
    memo.set('a', { sendLabel: '0.65积分' })
    expect(memo.get('a')).toEqual({ sendLabel: '0.65积分' })
    expect(memo.get('b')).toBeUndefined()
    memo.clear()
    expect(memo.get('a')).toBeUndefined()
  })
})

describe('countResourcesByKind', () => {
  it('只数四种媒体类型，未知 kind 与空项忽略', () => {
    expect(
      countResourcesByKind([
        { kind: 'image' },
        { kind: 'image' },
        { kind: 'video' },
        { kind: 'audio' },
        { kind: 'text' },
        { kind: 'weird' },
        {},
      ]),
    ).toEqual({ image: 2, video: 1, audio: 1, text: 1 })
  })

  it('undefined / 空数组给全 0', () => {
    expect(countResourcesByKind(undefined)).toEqual({ image: 0, video: 0, audio: 0, text: 0 })
    expect(countResourcesByKind([])).toEqual({ image: 0, video: 0, audio: 0, text: 0 })
  })
})
