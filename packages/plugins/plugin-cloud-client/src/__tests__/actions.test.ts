import { describe, it, expect } from 'vitest'
import { toBarAction, diffActions, groupByNodeType, staleActionIds } from '../actions'
import type { ServerAction } from '../apiTypes'

const handlers = { run: () => {}, resume: () => {}, onCancel: () => {} }

describe('后端动作 → 底栏动作', () => {
  it('字段名换算：nodeTypes → types（漏了它模型会对所有节点类型可见）', () => {
    const a = toBarAction({ id: 'x:1', title: 'X', nodeTypes: ['image', 'video'] }, handlers)
    expect(a.types).toEqual(['image', 'video'])
    expect((a as unknown as Record<string, unknown>).nodeTypes).toBeUndefined()
  })

  it('渲染字段照传（底栏按 fields 自己长控件）', () => {
    const fields = [{ key: 'ratio', kind: 'ratio', type: 'select' }]
    const a = toBarAction({ id: 'x:1', title: 'X', fields, needsPrompt: true, group: 'g', order: 3 }, handlers)
    expect(a.fields).toBe(fields)
    expect(a.needsPrompt).toBe(true)
    expect(a.group).toBe('g')
    expect(a.order).toBe(3)
  })

  it('没声明 nodeTypes → 不写 types（底栏理解为"所有类型适用"）', () => {
    const a = toBarAction({ id: 'x:1', title: 'X' }, handlers)
    expect(a.types).toBeUndefined()
  })

  it('后端声明的轮询节奏带过来（长视频不能被共享短超时误杀）', () => {
    const a = toBarAction({ id: 'x:1', title: 'X', pollIntervalMs: 5000, pollTimeoutMs: 600000 }, handlers)
    expect(a.pollIntervalMs).toBe(5000)
    expect(a.pollTimeoutMs).toBe(600000)
  })

  it('后端说"状态由外部管"时带过来（底栏据此不写本地 runState）', () => {
    expect(toBarAction({ id: 'x:1', title: 'X', externalRunState: true }, handlers).externalRunState).toBe(true)
    expect(toBarAction({ id: 'x:1', title: 'X' }, handlers).externalRunState).toBeUndefined()
  })

  it('行为（run / resume / onCancel）来自注入，不是后端下发的', () => {
    const a = toBarAction({ id: 'x:1', title: 'X' }, handlers)
    expect(a.run).toBe(handlers.run)
    expect(a.resume).toBe(handlers.resume)
    expect(a.onCancel).toBe(handlers.onCancel)
  })
})

describe('清单刷新：全量重建的差集', () => {
  const next: ServerAction[] = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
  ]

  it('已消失的要摘掉（否则是幽灵菜单项，点下去必然失败）', () => {
    const r = diffActions(['a', 'gone'], next)
    expect(r.toRemove).toEqual(['gone'])
    expect(r.toRegister.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('新增的一个不落', () => {
    const r = diffActions(['a'], next)
    expect(r.toRemove).toEqual([])
    expect(r.toRegister.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('全是新的（首次注册）', () => {
    const r = diffActions([], next)
    expect(r.toRemove).toEqual([])
    expect(r.toRegister).toHaveLength(2)
  })
})

describe('按节点类型分组', () => {
  it('没声明类型的归到 *（全类型）', () => {
    const g = groupByNodeType([{ id: 'a', title: 'A', nodeTypes: ['image'] }, { id: 'b', title: 'B' }])
    expect(g.image).toEqual(['a'])
    expect(g['*']).toEqual(['b'])
  })
})

describe('清掉同名族的残留动作', () => {
  // 本地插件（web2api）与后台动作 id 同名是**有意的约定**：同一道菜只出现一次。
  // 但本地插件有"等底栏装好再试一次"的重试路径，可能在云插件之后又注册一遍 ——
  // 那会把后台的顶回去。所以云插件每次核对时顺手清掉"该族里不在清单中的"。
  it('清掉同名族里不在清单中的（本地重试路径留下的 / 后台已删的）', () => {
    const existing = ['web2api:a', 'web2api:gone', 'other:keep']
    const server = ['web2api:a']
    expect(staleActionIds(existing, server)).toEqual(['web2api:gone'])
  })

  it('其它族的动作不动（不是我们该管的）', () => {
    expect(staleActionIds(['image.rotate', 'web2api:gone'], [])).toEqual(['web2api:gone'])
  })

  it('清单里的一个都不清（那是后台在管的）', () => {
    expect(staleActionIds(['web2api:a', 'web2api:b'], ['web2api:a', 'web2api:b'])).toEqual([])
  })

  it('可自定义家族前缀（将来接别的本地插件也能用）', () => {
    expect(staleActionIds(['mine:x'], [], ['mine:'])).toEqual(['mine:x'])
  })
})
