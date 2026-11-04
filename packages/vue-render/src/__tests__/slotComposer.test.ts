/**
 * SlotComposer / SlotAnchor 合约（从 canvas-render 迁来）。
 *
 * 两组事实：
 * 1. 纯逻辑（id 规范、合并顺序）不依赖 Vue，Node 可直测；
 * 2. 组件对外契约由 SSR 跑一遍：锚点 + 插件条目一起排序、sharedProps 下发给两项、
 *    不合法 id 被忽略、锚点不额外包一层 DOM。
 *
 * 这个包不依赖 canvas-data：上下文用最小桩（只给 slots / on / get），
 * 与 SlotComposer 源码里"极简上下文也能跑"的写法对齐。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { SlotRegistry, isSlotItemId, isSlotName } from '@mini-canvas/kernel'
import type { ContextWithSlots } from '../context'
import { CANVAS_CONTEXT_KEY } from '../context'
import SlotComposer from '../components/SlotComposer.vue'
import SlotAnchor from '../components/SlotAnchor.vue'
import { mergeSlotEntries } from '../components/slotComposer'

/** 最小上下文桩：只提供 SlotComposer 用到的 ctx.slots / ctx.on / ctx.get。 */
function makeCtx() {
  const slots = new SlotRegistry()
  const noop = { dispose: () => undefined }
  const ctx = {
    slots: {
      occupants(slot: string) {
        return slots.ordered(slot).map((e) => ({
          id: e.id,
          order: e.order,
          ...(e.before !== undefined ? { before: e.before } : {}),
          ...(e.after !== undefined ? { after: e.after } : {}),
          component: e.value,
        }))
      },
    },
    on: () => noop,
    get: () => slots,
  }
  return { ctx: ctx as unknown as ContextWithSlots, slots }
}

function provideCtx(app: ReturnType<typeof createSSRApp>, ctx: ContextWithSlots) {
  app.provide(CANVAS_CONTEXT_KEY, { ctx })
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
    const { ctx, slots } = makeCtx()
    slots.add('shell.dock', {
      id: 'plugin/export',
      order: 900,
      before: 'host/agent',
      value: defineComponent({ render: () => h('button', { 'data-plugin': 'export' }, '导出') }),
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
    provideCtx(app, ctx)
    const html = await renderToString(app)

    const order = ['data-host="add"', 'data-plugin="export"', 'data-host="agent"'].map((k) => html.indexOf(k))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order[0]).toBeLessThan(order[1]!)
    expect(order[1]).toBeLessThan(order[2]!)
  })

  it('sharedProps 下发给锚点插槽内容与插件组件', async () => {
    const { ctx, slots } = makeCtx()
    slots.add('shell.dock', {
      id: 'plugin/x',
      value: defineComponent({
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
    provideCtx(app, ctx)
    const html = await renderToString(app)
    expect(html).toContain('data-plugin="来自宿主"')
    expect(html).toContain('data-host="a"')
  })

  it('多个条目 after 同一内置项：按 order 紧跟其后（不被甩到最前）', async () => {
    const { ctx, slots } = makeCtx()
    slots.add('shell.status', {
      id: 'plugin/a',
      order: 40,
      after: 'host/zoom',
      value: defineComponent({ render: () => h('i', { 'data-a': '1' }, 'A') }),
    })
    slots.add('shell.status', {
      id: 'plugin/b',
      order: 41,
      after: 'host/zoom',
      value: defineComponent({ render: () => h('i', { 'data-b': '1' }, 'B') }),
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
    provideCtx(app, ctx)
    const html = await renderToString(app)

    const at = ['data-host="assets"', 'data-host="zoom"', 'data-a="1"', 'data-b="1"'].map((k) =>
      html.indexOf(k),
    )
    expect(at.every((i) => i >= 0)).toBe(true)
    expect(at[0]).toBeLessThan(at[1]!)
    expect(at[1]).toBeLessThan(at[2]!)
    expect(at[2]).toBeLessThan(at[3]!)
  })

  it('插槽与条目都带可检索标记（调试 UI 不在组件里）', async () => {
    const { ctx, slots } = makeCtx()
    slots.add('demo.slot', {
      id: 'plugin/x',
      order: 10,
      value: defineComponent({ render: () => h('i', 'X') }),
    })

    const renderOnce = (debug: boolean) => {
      const app = createSSRApp({
        render: () =>
          h(SlotComposer, { slot: 'demo.slot', debug, label: '演示' }, () => [
            h(SlotAnchor, { id: 'host/a', order: 1 }, () => h('i', 'A')),
          ]),
      })
      provideCtx(app, ctx)
      return renderToString(app)
    }

    const plain = await renderOnce(false)
    expect(plain).toContain('data-slot="demo.slot"')
    expect(plain).toContain('data-slot-id="plugin/x"')
    expect(plain).not.toContain('is-slot-debug')

    // 组件不认识"调试"：不接收 debug 参数，也不输出任何调试 DOM；
    // 高亮与面板由主题覆盖层读这些数据属性完成。
    expect(plain).not.toContain('slot-debug')
  })

  it('条目的 before / after / order 进数据属性', async () => {
    const { ctx, slots } = makeCtx()
    slots.add('demo.slot', {
      id: 'plugin/x',
      order: 20,
      after: 'host/a',
      value: defineComponent({ render: () => h('i', 'X') }),
    })
    slots.add('demo.slot', {
      id: 'plugin/y',
      order: 30,
      before: 'host/b',
      value: defineComponent({ render: () => h('i', 'Y') }),
    })

    const app = createSSRApp({
      render: () =>
        h(SlotComposer, { slot: 'demo.slot', debug: true }, () => [
          h(SlotAnchor, { id: 'host/a', order: 10 }, () => h('i', 'A')),
          h(SlotAnchor, { id: 'host/b', order: 40 }, () => h('i', 'B')),
        ]),
    })
    provideCtx(app, ctx)
    const html = await renderToString(app)

    expect(html).toContain('data-slot-after="host/a"')
    expect(html).toContain('data-slot-before="host/b"')
    expect(html).toContain('data-slot-order="20"')
    expect(html).toContain('data-slot-order="30"')
    // 不再生成调试小点；数据属性足够覆盖层定位与展示
    expect(html).not.toContain('slot-debug-dot')
  })

  it('非法条目 id 不渲染（不静默变成别的项）', async () => {
    const { ctx } = makeCtx()
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
    provideCtx(app, ctx)
    const html = await renderToString(app)
    expect(html).toContain('正常')
    expect(html).not.toContain('不该出现')
  })

  it('中文锚点 id 正常渲染（设置左树场景）', async () => {
    const { ctx } = makeCtx()
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
    provideCtx(app, ctx)
    const html = await renderToString(app)
    expect(html).toContain('节点')
    expect(html).toContain('常规')
    expect(html).toContain('flex flex-col')
  })
})
