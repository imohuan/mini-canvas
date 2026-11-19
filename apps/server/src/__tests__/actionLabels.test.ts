/**
 * POST /api/actions/labels —— provider 决定「下拉标题 / 按钮文案」（用户 2026-11-17）。
 *
 * 锁四件事：
 * 1. 声明了 selectLabel / sendLabel 的动作，后台执行后下发字符串；
 * 2. 没声明的不出现在结果里（前端据此回落默认摘要 / 只画图标）；
 * 3. 单个动作抛错 / 返回非字符串只让那一项为空，不影响其它项；
 * 4. 脏请求体不炸（缺失 / 非数组 / 空串 actionId）。
 */
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { actionLabelsRoutes } from '../routes/actionLabels.js'
import { ProviderRegistry } from '../providers/registry.js'
import type { Provider } from '../providers/types.js'

function registryWith(): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.add({
    id: 'demo',
    actions: [
      {
        id: 'demo:with-labels',
        title: '带文案的动作',
        // 用入参算，模拟「按分辨率算价格」
        selectLabel: (input) => input.values?.res === '4k' ? '4K · 0.65积分' : '1K',
        sendLabel: () => '0.65积分',
      },
      {
        id: 'demo:select-only',
        title: '只声明下拉标题',
        selectLabel: () => '只有下拉',
      },
      { id: 'demo:none', title: '没有文案' },
      {
        id: 'demo:throws',
        title: '抛错',
        sendLabel: () => {
          throw new Error('boom')
        },
      },
      {
        id: 'demo:not-a-string',
        title: '返回非字符串',
        // 类型上不该这么写，但目录里是手写 js，必须防住
        sendLabel: () => 42 as unknown as string,
      },
    ],
    async submit() {
      return { done: true }
    },
  } as Provider)
  return registry
}

async function post(app: Hono, body: unknown): Promise<{ status: number; json: any }> {
  const res = await app.request('/api/actions/labels', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

describe('POST /api/actions/labels', () => {
  const app = actionLabelsRoutes(registryWith())

  it('把 provider 算好的两段文案下发', async () => {
    const { status, json } = await post(app, {
      items: [{ actionId: 'demo:with-labels', values: { res: '4k' }, labels: {}, summary: '', resources: { image: 0 } }],
    })
    expect(status).toBe(200)
    expect(json.items).toEqual([
      { actionId: 'demo:with-labels', selectLabel: '4K · 0.65积分', sendLabel: '0.65积分' },
    ])
  })

  it('参数值真的进了 provider（不是写死的）', async () => {
    const { json } = await post(app, {
      items: [{ actionId: 'demo:with-labels', values: { res: '1k' } }],
    })
    expect(json.items[0].selectLabel).toBe('1K')
  })

  it('只声明一半时只回那一半', async () => {
    const { json } = await post(app, { items: [{ actionId: 'demo:select-only' }] })
    expect(json.items[0]).toEqual({ actionId: 'demo:select-only', selectLabel: '只有下拉' })
  })

  it('没声明函数的动作不出现（前端零请求负担）', async () => {
    const { json } = await post(app, { items: [{ actionId: 'demo:none' }, { actionId: 'unknown:id' }] })
    expect(json.items).toEqual([])
  })

  it('单个动作抛错只让那一项为空', async () => {
    const { json } = await post(app, {
      items: [{ actionId: 'demo:throws' }, { actionId: 'demo:with-labels', values: { res: '4k' } }],
    })
    expect(json.items.find((x: any) => x.actionId === 'demo:throws')).toBeUndefined()
    expect(json.items.find((x: any) => x.actionId === 'demo:with-labels').sendLabel).toBe('0.65积分')
  })

  it('返回非字符串当作没有', async () => {
    const { json } = await post(app, { items: [{ actionId: 'demo:not-a-string' }] })
    expect(json.items).toEqual([])
  })

  it('空 items / 缺 items / 脏项都不炸', async () => {
    expect((await post(app, { items: [] })).json.items).toEqual([])
    expect((await post(app, {})).json.items).toEqual([])
    const dirty = await post(app, { items: [null, 'x', { actionId: '' }, { actionId: 3 }] })
    expect(dirty.status).toBe(200)
    expect(dirty.json.items).toEqual([])
  })

  it('请求体不是 JSON 时回 400', async () => {
    const res = await app.request('/api/actions/labels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})
