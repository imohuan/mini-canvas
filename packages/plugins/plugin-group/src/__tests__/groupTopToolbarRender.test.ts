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
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp, defineComponent, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@plume-canvas/canvas-render'
import GroupTopToolbar from '../GroupTopToolbar.vue'
import { groupServiceOf } from '../groupEngine'

/**
 * shadcn 的菜单内容在真实运行时走 Teleport，SSR 的 renderToString 返回值里看不到。
 * 这里只把菜单容器换成「按开关渲染插槽」的薄壳，色板网格、色块、选中态与宽度
 * 仍然是 GroupTopToolbar 的真实模板/CSS 在渲染，断言没有降级。
 *
 * 组件本身不再 import 组件库，而是从 ui 目录按名取；这里给以下三件最小替身：
 * Button（摊平成 <button>）、DropdownMenu / Trigger / Content（按开关渲染插槽）。
 */
const mockMenuState = vi.hoisted(() => ({ open: false }))
const StubDropdownMenu = defineComponent({
  name: 'StubDropdownMenu',
  setup(_props, { slots }) {
    return () => h('div', { class: 'stub-dropdown' }, slots.default?.())
  },
})
const StubDropdownMenuTrigger = defineComponent({
  name: 'StubDropdownMenuTrigger',
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => slots.default?.()
  },
})
const StubDropdownMenuContent = defineComponent({
  name: 'StubDropdownMenuContent',
  inheritAttrs: false,
  setup(_props, { slots, attrs }) {
    return () => (mockMenuState.open ? h('div', attrs, slots.default?.()) : null)
  },
})

/**
 * 背景颜色面板替身：真实实现（预置色 + 自定义取色）住在默认主题的 colorSwatchPicker，
 * 由主题插件自己的测试覆盖；这里只验「分组确实用了那个共用件、传对了参数」。
 */
const StubColorSwatchPicker = defineComponent({
  name: 'StubColorSwatchPicker',
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: '' },
    label: { type: String, default: '' },
    trigger: { type: String, default: '' },
    closeOnPick: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () =>
      h(
        'div',
        {
          ...attrs,
          class: 'group-color-trigger',
          'data-label': props.label,
          'data-trigger': props.trigger,
          'data-color': props.modelValue,
          'data-close-on-pick': String(props.closeOnPick),
          onClick: () => emit('update:modelValue', '#22c55e'),
        },
        props.label,
      )
  },
})

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

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
    // 目录里要有组件按名取的那几件；菜单三件给 SSR 可渲染的薄壳。
    registryOf: () => ({
      top: (name: string) => {
        if (name === 'Button') {
          return {
            value: defineComponent({
              name: 'StubButton',
              inheritAttrs: false,
              setup(_props, { slots, attrs }) {
                return () => h('button', attrs, slots.default?.())
              },
            }),
          }
        }
        if (name === 'DropdownMenu') return { value: StubDropdownMenu }
        if (name === 'DropdownMenuTrigger') return { value: StubDropdownMenuTrigger }
        if (name === 'DropdownMenuContent') return { value: StubDropdownMenuContent }
        // 背景颜色面板：与绘制模式共用同一个件（真实实现在默认主题，本包不重写）
        if (name === 'colorSwatchPicker') return { value: StubColorSwatchPicker }
        return undefined
      },
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
  mockMenuState.open = openMenu
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
  /**
   * 用户 2026-11-15：「分组节点可以参考绘制模式里的颜色，完全复刻都行」。
   * 所以这里不再自己画色板，而是把「背景颜色」接上默认主题的共用取色面板，
   * 并保留「小圆点 + 文字」的触发器口径（用户 2026-10-08）。
   */
  it('背景颜色用的是与绘制模式同一个取色面板，触发器等宽文案「背景颜色」', async () => {
    const out = await render({ backgroundColor: '#0ea5e9' }, false, ['g1']).html
    expect(out).toContain('group-color-trigger')
    // 文字标签（用户要的「背景」；与 aria-label 同名，读屏也念得出来）
    expect(out).toContain('背景颜色')
    // 小圆点 + 文字：触发器形态由共用件的 trigger="label" 决定；色点尺寸/display
    // 的回归由主题侧 colorSwatchPicker 的测试守住（本地 SSR 拿不到布局盒，不在这里重复）。
    expect(out).toContain('data-trigger="label"')
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

  it('触发器上的色点 = 当前底色（没设过则回落默认石板灰）', async () => {
    const a = await render().html
    expect(a).toContain('#334155')
    const b = await render({ backgroundColor: '#ef4444' }).html
    expect(b).toContain('#ef4444')
    expect(b).not.toContain('data-color="#334155"')
  })

  it('选色仍写回分组节点（面板发出 update 后走 doc.updateNodeData）', async () => {
    const src = read('../GroupTopToolbar.vue')
    expect(src).toMatch(/updateNodeData\(props\.id/)
    expect(src).toContain('backgroundColor')
    // 面板来自 ui 目录，不在本包重画色板
    expect(src).toContain("useUiComponent('colorSwatchPicker')")
    expect(src).not.toMatch(/group-color-swatch/)
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
