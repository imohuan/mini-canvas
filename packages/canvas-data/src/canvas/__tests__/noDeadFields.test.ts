import { describe, expect, it } from 'vitest'
import { Context } from '../context'
import { NodeStore } from '../../nodeStore'
import { createDocService } from '../../docService'
import { NodeRegistry } from '../registry/nodeRegistry'
import { ThemeRegistry } from '../registry/themeRegistry'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory } from '../nodeFactory'

/**
 * 决策 D1：这五个场在生产代码里零读取，值却要每次多写一遍 —— 删掉写入，
 * 自省改从真实容器取。这里先钉"写完之后场仍是空的"。
 */
async function bootHeadless() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  ctx.inject('doc', createDocService({ nodeStore }))
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  await ctx.start()
  return { ctx, nodeStore }
}

describe('五个零读取场不再被写', () => {
  it('注册节点类型 / 主题槽 / 槽位 / 设置项后，五个死场仍为空', async () => {
    const { ctx } = await bootHeadless()
    ctx.nodes.register({ type: 'x', label: 'X', size: { w: 100, h: 100 }, create: () => 'n1' })
    ctx.theme.register('edge', {})
    ctx.slots.register('overlay', { id: 'a', component: {} })
    ctx.settings.define('g', { k: { type: 'text', default: '' } })
    for (const kind of ['node/type', 'node/creator', 'setting', 'theme', 'slot']) {
      expect(ctx.registryOf(kind).keys()).toEqual([])
    }
  })

  it('真实容器仍收到注册（节点类型 / 主题赢家 / 槽 / 设置）', async () => {
    const { ctx, nodeStore } = await bootHeadless()
    ctx.nodes.register({ type: 'x', label: 'X', size: { w: 100, h: 100 }, create: () => 'n1' })
    ctx.theme.register('edge', { name: 'edge-comp' }, { id: 'e1' })
    ctx.slots.register('overlay', { id: 'a', component: { name: 'comp' } })
    ctx.settings.define('g', { k: { type: 'text', default: 'v' } })
    expect(nodeStore.types.get('x')).toBeDefined()
    expect(ctx.get<ThemeRegistry>('themeRegistry').winner('edge')).toBeDefined()
    expect(ctx.get<{ ordered(s: string): unknown[] }>('slots').ordered('overlay')).toHaveLength(1)
    expect(ctx.get<{ groups(): string[] }>('settings').groups()).toContain('g')
    expect(ctx.get<NodeFactory>('nodeFactory').creatableTypes()).toEqual(['x'])
  })
})
