/**
 * 全局下拉的**注册契约**（用户口径 2026-10-03：「你必须在 package UI 这个库里进行 drop down
 * 组件的注册。因为如果两个地方同时注册，优先级最高的地方会优先使用」）。
 *
 * 要钉住三件事：
 * 1. 同一个场（registryOf('ui') 的 dropdown 键）里两份都登记着 —— 主题默认件没被删掉，
 *    用户移除本插件即可回退；
 * 2. `top('dropdown')` 是**包 UI 这一份**（order -1 比默认件 0 小，谁小谁赢）；
 * 3. 两处下拉的互斥登记表**是同一份**。
 *
 * 第 3 条为什么单独钉：`dropdownRegistry` 此前是本插件内一份、主题插件内一份。两份表 →
 * 用不同实现的两个下拉会同时开着。真源收进 canvas-render 后，这条测试就是防止它再裂开。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Context } from '@mini-canvas/canvas-data'
import { claimDropdownExclusive, openDropdownCount, releaseDropdown } from '@mini-canvas/canvas-render'
import { Dropdown as ThemeDefaultDropdown, themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { uiDropdownPlugin, DROPDOWN_ID } from '../uiDropdownPlugin'
import AxDropdown from '../components/AxDropdown.vue'

describe('ui-dropdown 注册件：包 UI 这一份顶替主题默认件', () => {
  it('两份都在场里；top 是包 UI 的；默认件仍能按 id 取回（可回退）', async () => {
    const ctx = new Context()
    ctx.plugin(themeDefaultPlugin)
    ctx.plugin(uiDropdownPlugin)
    await ctx.start()

    const field = ctx.registryOf<unknown>('ui')
    const stack = field.list('dropdown')
    // 默认件没被删：用户把本插件从装配里去掉，就自然回退到它
    expect(stack.map((e) => e.id).sort()).toEqual(['default', DROPDOWN_ID].sort())
    // 谁 order 小谁赢 → 包 UI 那一份
    expect(field.top('dropdown')?.id).toBe(DROPDOWN_ID)
    expect(field.top('dropdown')?.value).toBe(AxDropdown)
    expect(field.get('dropdown', 'default')?.value).toBe(ThemeDefaultDropdown)
    ctx.stop()
  })

  it('插件卸载后条目回收，目录里只剩默认件（热卸不留残渣）', async () => {
    const ctx = new Context()
    ctx.plugin(themeDefaultPlugin)
    ctx.plugin(uiDropdownPlugin)
    await ctx.start()
    ctx.uninstallPlugin(DROPDOWN_ID)
    const field = ctx.registryOf<unknown>('ui')
    expect(field.list('dropdown').map((e) => e.id)).toEqual(['default'])
    expect(field.top('dropdown')?.value).toBe(ThemeDefaultDropdown)
    ctx.stop()
  })
})

describe('下拉互斥登记表：两种实现共用同一份', () => {
  it('claim 会把别的先关掉；release 幂等', () => {
    const a = () => {}
    const b = () => {}
    claimDropdownExclusive(a)
    expect(openDropdownCount()).toBe(1)
    claimDropdownExclusive(b)
    expect(openDropdownCount()).toBe(2)
    releaseDropdown(b)
    releaseDropdown(b) // 幂等
    expect(openDropdownCount()).toBe(1)
    releaseDropdown(a)
    expect(openDropdownCount()).toBe(0)
  })
})

/**
 * 箭头怎么放、放哪一层 —— 两条都是实测踩过才钉的。
 *
 * 用户报的问题（2026-10-03）：「所有抓不到它的箭头都不见了，只有快捷键面板才有」。
 * 根因有两个，缺一条都会重演：
 *   ① 箭头是浮层的**子节点**时，它探出浮层边缘那 7px 会被算进浮层的可滚溢出 →
 *      inner-scroll 模式（"只当外框、只有列表区滚"）当场破功；
 *   ② 箭头 z-index 比浮层（100000）小（曾经是 1）时，它挂在 body 下会被画布的
 *      vue-flow 图层盖住 —— 菜单看得见、箭头看不见。快捷键面板那块恰好没有画布覆盖，
 *      所以"只有它还有箭头"，正是这条的症状。
 *
 * 这两条都只能在浏览器里量，单测量不到；但**源码里的结构**（兄弟节点 + 同层）可以直接断言，
 * 于是把结构钉住，浏览器回归（agent-e2e）负责量效果。
 */
describe('箭头的位置契约（结构层）', () => {
  const src = readFileSync(new URL('../components/AxDropdown.vue', import.meta.url), 'utf-8')

  it('箭头是浮层的**兄弟节点**（子节点会把探出量算进浮层可滚溢出）', () => {
    // 判据：箭头标签出现在 </Transition> **之后**（与浮层平级）。若它挪进浮层 div 内部，
    // 就会落在 </Transition> 之前 —— 这条会红。
    const transitionClose = src.indexOf('</Transition>')
    const at = src.indexOf('class="axd-arrow"')
    expect(at, '模板里没找到 axd-arrow').toBeGreaterThan(-1)
    expect(at, '箭头必须在 </Transition> 之后（浮层外，做兄弟节点）').toBeGreaterThan(transitionClose)
  })

  it('箭头 z-index 与浮层同层（100000），否则会被画布图层盖住', () => {
    const arrowRule = /\.axd-arrow\s*\{([^}]*)\}/.exec(src)
    expect(arrowRule, '没找到 .axd-arrow 规则').toBeTruthy()
    expect(arrowRule![1]).toMatch(/z-index:\s*100000/)
    const menuRule = /\.dd-menu\s*\{([^}]*)\}/.exec(src)
    expect(menuRule![1]).toMatch(/z-index:\s*100000/)
  })

  /**
   * 箭头**居中**在它贴着的那条边上（用户口径 2026-10-03：「箭头好像都是指向左侧的，
   * 我希望你把这些全部改成居中显示」）。
   *
   * 之前跟的是**触发器中心**，而多数菜单是 bottom-start / top-start（左缘对齐触发器、
   * 从按钮往左铺开），触发器中心换算进去就落在最左边 —— 箭头全挤在左下角，看着像指向左侧。
   * 现在取菜单自己的中线，所以这里钉横向公式是 mw / 2。
   */
  it('箭头横向取菜单中线（不是触发器中轴、也不是 arrow 中间件的 x）', () => {
    const at = src.indexOf('const arrowStyle = computed')
    const body = src.slice(at, src.indexOf('function clearCloseTimer'))
    expect(body, '箭头横向应是 ml + mw / 2').toMatch(/cx = ml \+ mw \/ 2/)
    // 不能再读 floating-ui 的 arrow 中间件输出（按打开那一刻的尺寸算，菜单被内容撑宽后就失准）
    // —— 判据：代码里不该再出现 d?.x / d?.y 那种取值（注释里提到 middlewareData 是说明，不算）
    const code = body
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join('\n')
    expect(code).not.toMatch(/middlewareData/)
    expect(code).not.toMatch(/d\?\.(x|y)/)
  })
})
