/**
 * ProviderRegistry 单测 —— 纯逻辑（不落盘、不启服务）。
 *
 * 锁三件事：
 * 1. 动作清单是**所有 provider 的并集**（后台加平台 = 前端多一项）；
 * 2. 按 actionId 能反查回它的 provider（任务路由 / 取消都靠它）；
 * 3. 内容版本号会变（前端靠它判断"要不要重拉菜单"）。
 */
import { describe, it, expect } from 'vitest'
import { ProviderRegistry } from '../providers/registry'
import type { ActionDef, Provider } from '../providers/types'

function fakeProvider(id: string, actions: ActionDef[]): Provider {
  return { id, actions, async submit() { return { done: true } } }
}

const A1: ActionDef = { id: 'p1:a', title: 'A1', order: 20 }
const A2: ActionDef = { id: 'p1:b', title: 'A2', order: 10 }
const B1: ActionDef = { id: 'p2:c', title: 'B1', order: 30 }

describe('动作清单是所有 provider 的并集', () => {
  it('两个 provider 的动作都列出来', () => {
    const r = new ProviderRegistry()
    r.load([fakeProvider('p1', [A1, A2]), fakeProvider('p2', [B1])])
    expect(r.listActions().map((a) => a.id).sort()).toEqual(['p1:a', 'p1:b', 'p2:c'])
  })

  it('按 order 升序（没给 order 的排最后）', () => {
    const r = new ProviderRegistry()
    r.load([fakeProvider('p1', [A1, A2]), fakeProvider('p2', [B1, { id: 'p2:d', title: 'no-order' }])])
    const ids = r.listActions().map((a) => a.id)
    expect(ids[0]).toBe('p1:b') // order 10
    expect(ids[1]).toBe('p1:a') // order 20
    expect(ids[2]).toBe('p2:c') // order 30
    expect(ids[3]).toBe('p2:d') // 没给 order → 最后
  })
})

describe('按 actionId 路由到 provider', () => {
  it('找得到归属，且拿到的是那个 provider 本身', () => {
    const r = new ProviderRegistry()
    const p1 = fakeProvider('p1', [A1])
    const p2 = fakeProvider('p2', [B1])
    r.load([p1, p2])
    expect(r.providerOf('p1:a')).toBe(p1)
    expect(r.providerOf('p2:c')).toBe(p2)
    expect(r.providerOf('不存在')).toBeUndefined()
  })

  it('拿得到动作本体（执行时要读 tool / promptMode）', () => {
    const r = new ProviderRegistry()
    r.load([fakeProvider('p1', [{ id: 'p1:a', title: 'A1', tool: 'x/y', promptMode: 'plain' }])])
    expect(r.getAction('p1:a')?.tool).toBe('x/y')
    expect(r.getAction('p1:a')?.promptMode).toBe('plain')
  })
})

describe('内容版本号', () => {
  it('装载会 +1（前端靠它判断要不要重拉）', () => {
    const r = new ProviderRegistry()
    const before = r.contentVersion
    r.load([fakeProvider('p1', [A1])])
    expect(r.contentVersion).toBeGreaterThan(before)
  })

  it('replaceAll 会把删掉的 provider 的动作一起清掉（不留幽灵菜单项）', () => {
    const r = new ProviderRegistry()
    r.load([fakeProvider('p1', [A1]), fakeProvider('p2', [B1])])
    expect(r.listActions()).toHaveLength(2)

    // 重新扫描：p2 的目录被删了
    r.replaceAll([fakeProvider('p1', [A1])])
    expect(r.listActions().map((a) => a.id)).toEqual(['p1:a'])
    expect(r.providerOf('p2:c')).toBeUndefined()
  })
})
