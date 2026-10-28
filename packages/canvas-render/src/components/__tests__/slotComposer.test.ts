/**
 * SlotComposer / SlotAnchor 合约。
 *
 * 两组事实：
 * 1. 纯逻辑（id 规范、合并顺序）不依赖 Vue，Node 可直测；
 * 2. 组件对外契约由 SSR 跑一遍：锚点 + 插件条目一起排序、sharedProps 下发给两项、
 *    不合法 id 被忽略、锚点不额外包一层 DOM。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Context } from '@mini-canvas/canvas-data'
import type { CanvasHostHandle, MiniCanvasApi } from '../../host/createMiniCanvasHost'
import type { PluginManager } from '../../host/pluginManager'
import { CANVAS_CONTEXT_KEY, type CanvasContext } from '../../contracts/canvasContext'
import SlotComposer from '../SlotComposer.vue'
import SlotAnchor from '../SlotAnchor.vue'
import { isSlotItemId, isSlotName } from '@mini-canvas/kernel'
import { mergeSlotEntries } from '../slotComposer'

function baseContext(ctx: Context): CanvasContext {
  return {
    ctx,
    host: {} as CanvasHostHandle,
    api: {} as MiniCanvasApi,
    manager: {} as PluginManager,
  }
}

describe('slotComposer · 纯逻辑', () => {
  it('条目 id 必须是 owner/name（斜杠），槽名用点', () => {
    expect(isSlotItemId('host/agent')).toBe(true)
    expect(isSlotItemId('my-plugin/export')).toBe(true)
    // 中文条目名要放行：设置左树的一级分组名就是中文（host/settings-节点）
    expect(isSlotItemId('host/settings-节点')).toBe(true)
    expect(isSlotItemId('host/settings-常规')).toBe(true)
    expect(isSlotItemId('shell.dock.agent')).toBe(false)
    expect(isSlotItemId('agent')).toBe(false)
    expect(isSlotItemId('host/a b')).toBe(false)
    expect(isSlotItemId('host/a/b')).toBe(false)
    expect(isSlotName('shell.dock')).toBe(true)
    expect(isSlotName('shell/dock')).toBe(false)
  })

  it('合并时本地锚点在前（同 id 本地赢）', () => {
    const merged = mergeSlotEntries([{ id: 'host/a' }], [{ id: 'host/a' }, { id: 'plugin/b' }])
    expect(merged.map((e) => e.id)).toEqual(['host/a', 'host/a', 'plugin/b'])
  })
})

describe('SlotComposer · SSR', () => {
  it('内置锚点与插件条目一起排序；before 指向条目 id', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.slots.register('shell.dock', {
      id: 'plugin/export',
      order: 900,
      before: 'host/agent',
      component: defineComponent({ render: () => h('button', { 'data-plugin': 'export' }, '导出') }),
    })

    const app = createSSRApp({
      render: () =>
        h(
          SlotComposer,
          { slot: 'shell.dock' },
          () => [
            h(SlotAnchor, { id: 'host/add', order: 100 }, () => h('button', { 'data-host': 'add' }, '添加')),
            h(SlotAnchor, { id: 'host/agent', order: 800 }, () => h('button', { 'data-host': 'agent' }, 'Agent')),
          ],
        ),
    })
    app.provide(CANVAS_CONTEXT_KEY, baseContext(ctx))
    const html = await renderToString(app)

    const order = ['data-host="add"', 'data-plugin="export"', 'data-host="agent"'].map((k) => html.indexOf(k))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order[0]).toBeLessThan(order[1]!)
    expect(order[1]).toBeLessThan(order[2]!)

    ctx.stop()
  })

  it('sharedProps 下发给锚点插槽内容与插件组件', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.slots.register('shell.dock', {
      id: 'plugin/x',
      component: defineComponent({
        props: { label: { type: String, default: '' } },
        render() {
          return h('button', { 'data-plugin': this.label }, this.label)
        },
      }),
    })

    const app = createSSRApp({
      render: () =>
        h(
          SlotComposer,
          { slot: 'shell.dock', sharedProps: { label: '来自宿主' } },
          () => [h(SlotAnchor, { id: 'host/a', order: 100 }, () => h('i', { 'data-host': 'a' }, 'A'))],
        ),
    })
    app.provide(CANVAS_CONTEXT_KEY, baseContext(ctx))
    const html = await renderToString(app)
    expect(html).toContain('data-plugin="来自宿主"')
    expect(html).toContain('data-host="a"')
    ctx.stop()
  })

  it('多个条目 after 同一内置项：按 order 紧跟其后（不被甩到最前）', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.slots.register('shell.status', {
      id: 'plugin/a',
      order: 40,
      after: 'host/zoom',
      component: defineComponent({ render: () => h('i', { 'data-a': '1' }, 'A') }),
    })
    ctx.slots.register('shell.status', {
      id: 'plugin/b',
      order: 41,
      after: 'host/zoom',
      component: defineComponent({ render: () => h('i', { 'data-b': '1' }, 'B') }),
    })

    const app = createSSRApp({
      render: () =>
        h(
          SlotComposer,
          { slot: 'shell.status' },
          () => [
            h(SlotAnchor, { id: 'host/assets', order: 100 }, () => h('i', { 'data-host': 'assets' }, 'A')),
            h(SlotAnchor, { id: 'host/zoom', order: 600 }, () => h('i', { 'data-host': 'zoom' }, 'Z')),
          ],
        ),
    })
    app.provide(CANVAS_CONTEXT_KEY, baseContext(ctx))
    const html = await renderToString(app)

    const at = ['data-host="assets"', 'data-host="zoom"', 'data-a="1"', 'data-b="1"'].map((k) =>
      html.indexOf(k),
    )
    expect(at.every((i) => i >= 0)).toBe(true)
    expect(at[0]).toBeLessThan(at[1]!)
    expect(at[1]).toBeLessThan(at[2]!)
    expect(at[2]).toBeLessThan(at[3]!)

    ctx.stop()
  })

  it('插槽与条目都带可检索标记；debug 打开时显示插槽名标签', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.slots.register('demo.slot', {
      id: 'plugin/x',
      order: 10,
      component: defineComponent({ render: () => h('i', 'X') }),
    })

    const renderOnce = (debug: boolean) => {
      const app = createSSRApp({
        render: () =>
          h(SlotComposer, { slot: 'demo.slot', debug, label: '演示' }, () => [
            h(SlotAnchor, { id: 'host/a', order: 1 }, () => h('i', 'A')),
          ]),
      })
      app.provide(CANVAS_CONTEXT_KEY, baseContext(ctx))
      return renderToString(app)
    }

    const plain = await renderOnce(false)
    expect(plain).toContain('data-slot="demo.slot"')
    expect(plain).toContain('data-slot-id="plugin/x"')
    expect(plain).not.toContain('is-slot-debug')

    const debug = await renderOnce(true)
    expect(debug).toContain('is-slot-debug')
    expect(debug).toContain('演示 · demo.slot')
    ctx.stop()
  })

  it('插槽调试会显示条目的 before / after / order', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.slots.register('demo.slot', {
      id: 'plugin/x',
      order: 20,
      after: 'host/a',
      component: defineComponent({ render: () => h('i', 'X') }),
    })
    ctx.slots.register('demo.slot', {
      id: 'plugin/y',
      order: 30,
      before: 'host/b',
      component: defineComponent({ render: () => h('i', 'Y') }),
    })

    const app = createSSRApp({
      render: () =>
        h(SlotComposer, { slot: 'demo.slot', debug: true }, () => [
          h(SlotAnchor, { id: 'host/a', order: 10 }, () => h('i', 'A')),
          h(SlotAnchor, { id: 'host/b', order: 40 }, () => h('i', 'B')),
        ]),
    })
    app.provide(CANVAS_CONTEXT_KEY, baseContext(ctx))
    const html = await renderToString(app)

    expect(html).toContain('plugin/x · order 20 · after host/a')
    expect(html).toContain('plugin/y · order 30 · before host/b')
    expect(html).toContain('data-slot-after="host/a"')
    expect(html).toContain('data-slot-before="host/b"')
    ctx.stop()
  })

  it('非法条目 id 不渲染（不静默变成别的项）', async () => {
    const ctx = new Context()
    await ctx.start()
    const app = createSSRApp({
      render: () =>
        h(
          SlotComposer,
          { slot: 'shell.dock' },
          () => [
            h(SlotAnchor, { id: 'shell.dock.bad', order: 100 }, () => h('b', '不该出现')),
            h(SlotAnchor, { id: 'host/ok', order: 200 }, () => h('b', '正常')),
          ],
        ),
    })
    app.provide(CANVAS_CONTEXT_KEY, baseContext(ctx))
    const html = await renderToString(app)
    expect(html).toContain('正常')
    expect(html).not.toContain('不该出现')
    ctx.stop()
  })

  it('中文锚点 id 正常渲染（设置左树场景）', async () => {
    const ctx = new Context()
    await ctx.start()
    const app = createSSRApp({
      render: () =>
        h(
          SlotComposer,
          { slot: 'settings.nav', class: 'flex flex-col' },
          () => [
            h(SlotAnchor, { id: 'host/settings-节点', order: 100 }, () => h('button', '节点')),
            h(SlotAnchor, { id: 'host/settings-常规', order: 200 }, () => h('button', '常规')),
          ],
        ),
    })
    app.provide(CANVAS_CONTEXT_KEY, baseContext(ctx))
    const html = await renderToString(app)
    expect(html).toContain('节点')
    expect(html).toContain('常规')
    expect(html).toContain('flex flex-col')
    ctx.stop()
  })
})
