/**
 * GET /api/actions 单测 —— 前端菜单的数据来源。
 *
 * 锁两件事：清单给的是全部 provider 的并集；带 ifVersion 且没变时只回版本号。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { ProviderRegistry } from '../providers/registry'
import { actionsRoutes } from '../routes/actions'
import type { ActionDef, Provider } from '../providers/types'

function p(id: string, actions: ActionDef[]): Provider {
  return { id, actions, async submit() { return { done: true } } }
}

let app: Hono
let registry: ProviderRegistry
beforeEach(() => {
  registry = new ProviderRegistry()
  registry.load([
    p('web2api', [{ id: 'web2api:doubao-image-seedream45', title: '豆包 Seedream 4.5', nodeTypes: ['image'] }]),
    p('mine', [{ id: 'mine:txt2img', title: '我的模型', nodeTypes: ['image'] }]),
  ])
  app = new Hono()
  app.route('/', actionsRoutes(registry))
})

const j = (r: Response) => r.json() as Promise<any>

describe('GET /api/actions', () => {
  it('吐出全部动作 + 版本号', async () => {
    const body = await j(await app.request('/api/actions'))
    expect(body.ok).toBe(true)
    expect(typeof body.version).toBe('number')
    expect(body.actions.map((a: ActionDef) => a.id).sort()).toEqual(['mine:txt2img', 'web2api:doubao-image-seedream45'])
  })

  it('动作带齐前端渲染需要的字段', async () => {
    const body = await j(await app.request('/api/actions'))
    const a = body.actions.find((x: ActionDef) => x.id === 'mine:txt2img')
    expect(a.title).toBe('我的模型')
    expect(a.nodeTypes).toEqual(['image'])
  })

  it('ifVersion 与当前版本相同 → 只回版本号与 changed:false（不搬整份清单）', async () => {
    const first = await j(await app.request('/api/actions'))
    const again = await j(await app.request('/api/actions?ifVersion=' + first.version))
    expect(again.changed).toBe(false)
    expect(again.actions).toEqual([])
  })

  it('provider 变了 → 版本号变，ifVersion 对不上就重发清单', async () => {
    const first = await j(await app.request('/api/actions'))
    registry.add(p('third', [{ id: 'third:x', title: 'X' }]))
    const after = await j(await app.request('/api/actions?ifVersion=' + first.version))
    expect(after.changed).toBe(true)
    expect(after.version).toBeGreaterThan(first.version)
    expect(after.actions.map((a: ActionDef) => a.id)).toContain('third:x')
  })
})
