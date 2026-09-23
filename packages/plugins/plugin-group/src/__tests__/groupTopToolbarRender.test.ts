/**
 * 分组节点"解组"按钮的渲染契约（SSR 拿真 HTML 断言）。
 *
 * 用户要求："这边的操作都是显示在这个上下控制栏里面" —— 分组节点的解组按钮从内容区
 * 搬到 out:top（上控制栏），与普通节点同一套位置语义；多选时由壳统一压掉。
 *
 * 另一件同栏的能力："分组还支持选择这里的背景颜色，放在它的上浮控制栏中"。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, defineComponent, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import GroupTopToolbar from '../GroupTopToolbar.vue'
import { GROUP_COLOR_SWATCHES } from '../groupEngine'

/**
 * 目录里的 dropdown 替身。真件的菜单是 v-if（收起时不渲染），这里给两个形态对齐该行为：
 * - ClosedDropdown：只渲染触发器（验"收起时工具栏不会被色板撑长"）；
 * - OpenDropdown：触发器 + 默认插槽（验"展开后色板里是哪些色块"）。
 * 两个都只是把插槽摊平，不做定位 —— 本文件验的是内容，不是浮层几何。
 */
const ClosedDropdown = defineComponent({
  name: 'ClosedDropdown',
  setup(_props, { slots }) {
    return () => h('div', { class: 'stub-dropdown' }, [slots.trigger?.()])
  },
})
const OpenDropdown = defineComponent({
  name: 'OpenDropdown',
  setup(_props, { slots }) {
    return () => h('div', { class: 'stub-dropdown' }, [slots.trigger?.(), slots.default?.({ close: () => {} })])
  },
})

/**
 * 最小渲染上下文：本组件用 ctx.get('group')（解组）、ctx.get('doc')（改底色）
 * 与 ui 目录（按名取按钮）。doc 记录写入，供"点色块真的写了 data"断言。
 */
function renderCtx(openMenu = false, selectedIds: string[] = []) {
  const calls: string[] = []
  const writes: Array<{ id: string; data: Record<string, unknown> }> = []
  const selected = new Set(selectedIds)
  const ctx = {
    get: (name: string) => {
      if (name === 'group') return { ungroup: (id: string) => calls.push(id) }
      if (name === 'doc') return { updateNodeData: (id: string, data: Record<string, unknown>) => writes.push({ id, data }) }
      // 控制栏显隐门（useSoleNodeSelected）读它：ids 必须存在，且 onChange 要有
      if (name === 'selection') return { ids: selected, has: (id: string) => selected.has(id), onChange: () => () => {} }
      return undefined
    },
    // ui 目录：只登记 dropdown（button 故意缺席 → 顺带验"回退原生按钮"那条降级路径）
    registryOf: () => ({
      top: (name: string) => (name === 'dropdown' ? { value: openMenu ? OpenDropdown : ClosedDropdown } : undefined),
      list: () => [],
      subscribe: () => ({ dispose() {} }),
    }),
    isDev: false,
  }
  return { ctx, calls, writes }
}

function render(
  data: Record<string, unknown> = {},
  openMenu = false,
  /** 选中集：缺省 = 恰好选中本节点（控制栏该显示） */
  selectedIds: string[] = ['g1'],
): { html: Promise<string>; box: ReturnType<typeof renderCtx> } {
  const box = renderCtx(openMenu, selectedIds)
  const app = createSSRApp({ render: () => h(GroupTopToolbar as Component, { id: 'g1', data }) })
  app.provide(RENDER_CONTEXT_KEY, { ctx: box.ctx } as unknown as CanvasRenderContext)
  return { html: renderToString(app), box }
}

describe('分组节点上控制栏', () => {
  it('只有"恰好单独选中我"时才显示：未选中 / 选中别人 → 整条栏不渲染', async () => {
    // 未选中任何节点
    expect(await render({}, false, []).html).not.toContain('group-top-toolbar')
    // 选中了别的节点（我在选中集之外）
    expect(await render({}, false, ['other']).html).not.toContain('group-top-toolbar')
    // 多选（我和别人一起）→ 壳会压掉，这里组件自身也不该显示
    expect(await render({}, false, ['g1', 'other']).html).not.toContain('group-top-toolbar')
    // 恰好只有我 → 显示
    expect(await render({}, false, ['g1']).html).toContain('group-top-toolbar')
  })

  it('渲染出解组按钮（文案 + 无障碍名齐全）', async () => {
    const { html } = render({}, false, ['g1'])
    const out = await html
    expect(out).toContain('group-top-toolbar')
    expect(out).toContain('解散分组')
    expect(out).toContain('aria-label')
  })

  it('背景颜色入口：收起时只有触发器，没有色块（工具栏不会被撑长）', async () => {
    const out = await render().html
    expect(out).toContain('group-color-trigger')
    expect(out).toContain('背景颜色')
    expect(out).not.toContain('group-color-swatch')
  })

  it('展开后是 7 个预设色块，每个带颜色与无障碍名（没有"自定义"入口）', async () => {
    const out = await render({}, true).html
    const swatches = out.match(/class="group-color-swatch[^"]*"/g) ?? []
    expect(swatches).toHaveLength(7)
    for (const s of GROUP_COLOR_SWATCHES) {
      expect(out).toContain(`background-color:${s.color}`)
      expect(out).toContain(`aria-label="${s.label}"`)
    }
    // 用户拍板：只给预制色，不做自定义取色 —— 色块全是"带色值的色块"，没有取色入口
    // （断言色块集合而不是整段文案，避免撞上模板注释里的"自定义"三个字）
    expect(swatches.every((c) => !c.includes('--custom'))).toBe(true)
    expect(out).not.toContain('type="color"')
  })

  it('当前底色那个色块被标成选中（aria-selected）', async () => {
    const out = await render({ backgroundColor: '#ef4444' }, true).html
    expect(out).toContain('aria-selected="true"')
  })

  it('触发器上的色点 = 当前底色（没设过则回落默认石板灰）', async () => {
    const a = await render().html
    expect(a).toContain('#334155')
    const b = await render({ backgroundColor: '#ef4444' }).html
    expect(b).toContain('#ef4444')
    expect(b).not.toContain('background-color:#334155')
  })

  it('色板是一张只有预设色的封闭表（用户拍板：不做自定义取色）', async () => {
    // 色板是展开后才渲染的；这里验常量本身（组件 v-for 的就是它，避免两处各列一遍漂移）
    expect(GROUP_COLOR_SWATCHES).toHaveLength(7)
    for (const s of GROUP_COLOR_SWATCHES) {
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(s.label.length).toBeGreaterThan(0)
    }
    // 没有"自定义"这种非色值条目（它是取色入口、不带颜色）
    expect(GROUP_COLOR_SWATCHES.every((s) => typeof s.color === 'string')).toBe(true)
  })
})
