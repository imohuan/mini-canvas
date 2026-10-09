/**
 * 分组节点「上控制栏」的渲染与交互契约。
 *
 * 用户要求：「这边的操作都是显示在这个上下控制栏里面」—— 分组节点的解组按钮从内容区
 * 搬到 out:top（上控制栏），与普通节点同一套位置语义；多选时由壳统一压掉。
 *
 * 另一件同栏的能力：「分组还支持选择这里的背景颜色，放在它的上浮控制栏中」。
 *
 * 渲染契约用 SSR 拿真 HTML 断言；「点下去真的调到服务」用纯函数 + 源码守卫盯（见文件尾）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp, defineComponent, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import GroupTopToolbar from '../GroupTopToolbar.vue'
import { GROUP_COLOR_SWATCHES, groupServiceOf } from '../groupEngine'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

/**
 * 目录里的 dropdown 替身。真件的菜单是 v-if（收起时不渲染），这里给两个形态对齐该行为：
 * - ClosedDropdown：只渲染触发器（验「收起时工具栏不会被色板撑长」）；
 * - OpenDropdown：触发器 + 默认插槽（验「展开后色板里是哪些色块」）。
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
 * 与 ui 目录（按名取按钮）。**故意只提供 get/tryGet**、不提供 `group` 直属性 ——
 * 真机上 useCanvasRender() 递进来的根 Context 本来就没有那层服务代理（真 bug 的根因）。
 * doc 记录写入，供「点色块真的写了 data」断言。
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
    tryGet: (name: string) => (ctx as { get(n: string): unknown }).get(name),
    // ui 目录：只登记 dropdown（button 故意缺席 → 顺带验「回退原生按钮」那条降级路径）
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

  /**
   * 触发器是「小圆点 + 文字」（用户口径 2026-10-08：「你可以写一个背景，左侧可以设置一个
   * 与你这个圆块稍微小一点的小圆块就行了」）。
   *
   * 顺带守住那个**真 bug**：色点是 <span>，只写 width/height 而不写 display 时，
   * inline 元素会忽略尺寸 → 真机上量到 0×0，屏幕上只剩 1px 描边，看着就是「一个点」。
   * 这条盯源码里的 display，是因为 SSR 拿不到布局盒（无头环境没有排版引擎），
   * 而这条约束一旦丢了，浏览器里就会静默退化成那个点。
   */
  it('背景颜色触发器 = 小圆点 + 文字，且色点有 display（否则 inline span 会塌成 0×0）', async () => {
    const out = await render({ backgroundColor: '#0ea5e9' }, false, ['g1']).html
    expect(out).toContain('group-color-trigger')
    expect(out).toContain('group-color-trigger__dot')
    // 文字标签（用户要的「背景」；与 aria-label 同名，读屏也念得出来）
    expect(out).toContain('背景颜色')
    const src = read('../GroupTopToolbar.vue')
    const block = src.slice(src.indexOf('.group-color-trigger__dot'))
    const rule = block.slice(0, block.indexOf('}'))
    // 成对写：有尺寸就必须有 display（inline 元素的尺寸会被浏览器忽略）
    expect(rule).toMatch(/display:\s*(block|inline-block|flex|inline-flex)/)
    expect(rule).toMatch(/width:\s*\d+px/)
    expect(rule).toMatch(/height:\s*\d+px/)
    // 比色板圆块（26px）小一档：18px（用户口径「稍微小一点」）
    const w = /width:\s*(\d+)px/.exec(rule)
    expect(w).toBeTruthy()
    expect(Number(w![1])).toBeLessThan(26)
    expect(Number(w![1])).toBeGreaterThanOrEqual(14)
  })
  it('只有「恰好单独选中我」时才显示：未选中 / 选中别人 → 整条栏不渲染', async () => {
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
    const out = await render({}, false, ['g1']).html
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

  it('展开后是 7 个预设色块，每个带颜色与无障碍名（没有「自定义」入口）', async () => {
    const out = await render({}, true).html
    const swatches = out.match(/class="group-color-swatch[^"]*"/g) ?? []
    expect(swatches).toHaveLength(7)
    for (const s of GROUP_COLOR_SWATCHES) {
      expect(out).toContain(`background-color:${s.color}`)
      expect(out).toContain(`aria-label="${s.label}"`)
    }
    // 用户拍板：只给预制色，不做自定义取色 —— 色块全是「带色值的色块」，没有取色入口
    // （断言色块集合而不是整段文案，避免撞上模板注释里的「自定义」三个字）
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

  it('色板是一张只有预设色的封闭表（用户拍板：不做自定义取色）', () => {
    // 色板是展开后才渲染的；这里验常量本身（组件 v-for 的就是它，避免两处各列一遍漂移）
    expect(GROUP_COLOR_SWATCHES).toHaveLength(7)
    for (const s of GROUP_COLOR_SWATCHES) {
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(s.label.length).toBeGreaterThan(0)
    }
    // 没有「自定义」这种非色值条目（它是取色入口、不带颜色）
    expect(GROUP_COLOR_SWATCHES.every((s) => typeof s.color === 'string')).toBe(true)
  })

  /**
   * 色板宽度：7 个色块按 4 列排在**比网格更宽**的面板里并水平居中。
   *
   * 用户报「分组颜色的卡片不太对，宽度不够」（2026-10-08）：老实现是 menu-width 112px +
   * 网格 4×22 + gap6 + padding8 = 122px，网格比面板内宽还大，被 overflow-x:hidden 裁掉边缘；
   * 且 4+3 的排布贴着左缘，右下角看起来缺一块。现在面板 ≥ 网格所需（26px 档）且网格居中。
   */
  it('色板面板宽度容得下网格（不再被裁）+ 色块放大到 26px', () => {
    const src = read('../GroupTopToolbar.vue')
    // 面板最小宽（dropdown 的 menu-width）：必须 ≥ 4 列 × 26 + 3 间距 × 6 + 两侧 8 = 138
    const m = /menu-width="(\d+)px"/.exec(src)
    expect(m).toBeTruthy()
    expect(Number(m![1])).toBeGreaterThanOrEqual(138)
    // 网格：4 列 26px + 6 间隙 + 8 内边距，且水平居中（4+3 的排布不再贴左缘缺角）
    expect(src).toMatch(/grid-template-columns:\s*repeat\(4,\s*26px\)/)
    expect(src).toMatch(/justify-content:\s*center/)
    expect(src).toMatch(/\.group-color-swatch\s*\{[\s\S]{0,200}?width:\s*26px/)
  })
})

/**
 * 点「解散分组」**真的调到服务**（真 bug 回归，2026-10-08）。
 *
 * 事故：组件写的是 `ctx.group?.ungroup(id)`。useCanvasRender() 递进来的是**根 Context**，
 * 而 `ctx.<服务名>` 直访靠「每个插件自己的 scope 代理」实现（kernel Context.ts 的 new Proxy）——
 * 根 Context 没那层代理，`ctx.group` 恒为 undefined；可选链 `?.` 又把它吞成静默 no-op，
 * 于是按钮点得动、什么也不发生（用户报的「有时候点击没有生效」）。
 *
 * 两层守卫：
 *   ① **取服务那句**必须走 groupServiceOf（它只认 tryGet/get）—— 纯函数直测；
 *   ② 组件里不能再出现 `ctx.group?.` 这种直属性调用 —— 源码守卫。
 * 回归成老写法时两条都会红（真机行为见 STATUS 的实测记录）。
 */
describe('点「解散分组」调到 group 服务（真 bug 回归）', () => {
  it('groupServiceOf：只从 tryGet/get 取服务，形状不对给 undefined（不抛）', () => {
    const svc = { ungroup: () => {} }
    // 两个口任一在都能取到（根 Context 两个都有；插件 scope 也有）
    expect(groupServiceOf({ tryGet: (n: string) => (n === 'group' ? svc : undefined) })).toBe(svc)
    expect(groupServiceOf({ get: (n: string) => (n === 'group' ? svc : undefined) })).toBe(svc)
    // 缺服务 / 形状不对（没有 ungroup）→ undefined，而不是抛
    expect(groupServiceOf({ tryGet: () => undefined })).toBeUndefined()
    expect(groupServiceOf({ tryGet: () => ({}) })).toBeUndefined()
    expect(groupServiceOf({ tryGet: () => ({ ungroup: 'not a function' }) })).toBeUndefined()
    expect(groupServiceOf(undefined)).toBeUndefined()
  })

  it('组件不再用 ctx.group 直属性（根 Context 没有服务代理 → 会静默 no-op）', () => {
    const src = read('../GroupTopToolbar.vue')
    // 只查**代码**、不查注释：先把注释剥掉再断言，否则解释这条约束的注释自己会踩中。
    // 三类都要剥：块注释、行注释、HTML 注释（模板里的说明也常提到这个写法）。
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
    // 剥完注释后，代码里不能再有「ctx.group 取值后调用」（?. / . / [）这种写法
    expect(code).not.toMatch(/ctx\.group\s*(\?\.|\.|\[)/)
    expect(src).toMatch(/groupServiceOf\(ctx\)/)
  })
})
