import { describe, it, expect } from 'vitest'
import { BarRegistry } from '../barRegistry'
import type { BarAction } from '../barTypes'
import { Context } from '@mini-canvas/kernel'

function action(id: string, types?: string[]): BarAction {
  return { id, types, title: id, run: () => ({ ok: true }) }
}

describe('BarRegistry：按节点类型筛选 + 排序（纯逻辑）', () => {
  it('types 省略 = 所有类型都适用', () => {
    const reg = new BarRegistry()
    reg.add(action('all'))
    reg.add(action('img-only', ['image']))
    expect(reg.list({ type: 'image' }).map((a) => a.id)).toEqual(['all', 'img-only'])
    expect(reg.list({ type: 'text' }).map((a) => a.id)).toEqual(['all'])
  })

  it('排序：显式 order 升序在前，没给 order 的一律排最后（保插入序）', () => {
    const reg = new BarRegistry()
    reg.add({ id: 'no-order-1', title: 'a', run: () => ({ ok: true }) })
    reg.add({ id: 'late', title: 'b', order: 10, run: () => ({ ok: true }) })
    reg.add({ id: 'no-order-2', title: 'c', run: () => ({ ok: true }) })
    reg.add({ id: 'early', title: 'd', order: -5, run: () => ({ ok: true }) })
    expect(reg.list().map((a) => a.id)).toEqual(['early', 'late', 'no-order-1', 'no-order-2'])
  })
})

/**
 * 真实内核下的回归：**两个插件注册同一个动作 id，卸载后者不能把前者一起带走**。
 *
 * 复现的是用户实测报的 bug：内置 web2api 与云端 cloud-client 都注册 web2api:* 动作
 * （见 plugin-cloud-client 的 staleActionIds 注释 —— 同 id 是"同一道菜只出现一次"的约定）。
 * 早先注册场的 add 是"同 id 破坏性替换"，web2api 一卸载，cloud-client 那条也就没了。
 * 修复后同 id 叠层：卸载上层露出下层。
 */
describe('node/bar 场 · 同 id 跨插件叠层（真实内核）', () => {
  function barAction(id: string, title: string): BarAction {
    return { id, title, run: () => ({ ok: true }) }
  }

  it('cloud-client 先注册 → web2api 注册同名 → 卸载 web2api → cloud-client 的动作仍在', async () => {
    const ctx = new Context()
    ctx.plugin({
      name: 'cloud-client',
      apply(c) {
        const a = barAction('web2api:doubao-image', '云端动作')
        c.registryOf<BarAction>('node/bar').add(a.id, a, { id: a.id })
      },
    })
    ctx.plugin({
      name: 'web2api-tools',
      apply(c) {
        const a = barAction('web2api:doubao-image', '内置动作')
        c.registryOf<BarAction>('node/bar').add(a.id, a, { id: a.id })
      },
    })
    await ctx.start()

    const field = ctx.registryOf<BarAction>('node/bar')
    // 两个都在跑时：后注册的内置动作在外（只看得见它，符合"同一道菜只出现一次"）
    expect(field.get('web2api:doubao-image', 'web2api:doubao-image')!.value.title).toBe('内置动作')

    // 卸载内置插件
    expect(ctx.uninstallPlugin('web2api-tools')).toBe(true)
    const after = ctx.registryOf<BarAction>('node/bar').get('web2api:doubao-image', 'web2api:doubao-image')
    // 修复核心：云端那条必须露出来，而不是整条消失
    expect(after).toBeDefined()
    expect(after!.value.title).toBe('云端动作')
    expect(after!.source).toBe('cloud-client')

    ctx.stop()
  })

  it('卸载不注册同名动作的插件，不影响别人的动作（反向验证不误伤）', async () => {
    const ctx = new Context()
    ctx.plugin({
      name: 'cloud-client',
      apply(c) {
        const a = barAction('web2api:a', '云端')
        c.registryOf<BarAction>('node/bar').add(a.id, a, { id: a.id })
      },
    })
    ctx.plugin({
      name: 'other',
      apply(c) {
        const a = barAction('other:b', '别的')
        c.registryOf<BarAction>('node/bar').add(a.id, a, { id: a.id })
      },
    })
    await ctx.start()
    ctx.uninstallPlugin('other')
    const field = ctx.registryOf<BarAction>('node/bar')
    expect(field.get('web2api:a', 'web2api:a')!.value.title).toBe('云端')
    expect(field.has('other:b')).toBe(false)
    ctx.stop()
  })
})
