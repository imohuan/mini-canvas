/**
 * 全局下拉的**注册契约**（用户口径 2026-10-03：「你必须在 package UI 这个库里进行 drop down
 * 组件的注册。因为如果两个地方同时注册，优先级最高的地方会优先使用」）。
 *
 * 要钉住三件事：
 * 1. 同一个场（registryOf('ui') 的 dropdown 键）里两份都登记着 —— 主题默认件没被删掉，
 *    用户移除本插件即可回退；
 * 2. `top('dropdown')` 是**包 UI 这一份**（order -1 比默认件 0 小，谁小谁赢）；
 * 3. 本包下拉的互斥登记表是**本包自己那一份**（用户口径 2026-10-15：插件各自独立，
 *    不跨包共享、不动核心层）；与主题默认件那份只共享 `data-floating-chain` DOM 契约。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Context } from '@mini-canvas/canvas-data'
// 本包自己的那份（不是核心层、也不是主题包的）
import { claimDropdownExclusive, openDropdownCount, releaseDropdown } from '../components/hooks/dropdownExclusive'
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

describe('下拉互斥登记表：本包自带一份', () => {
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

  it('不来自核心层：实现住在本包内（改动不动 canvas-render）', () => {
    const src = readFileSync(new URL('../components/hooks/dropdownExclusive.ts', import.meta.url), 'utf-8')
    expect(src).toMatch(/export function claimDropdownExclusive/)
    expect(src).not.toMatch(/from '@mini-canvas\/canvas-render'/)
  })
})

/**
 * 子浮层 —— 「两个下拉并存」的合法情形。两条来源：
 *   ① 显式 `nestedIn`（2026-10-09，画布行尾的操作菜单：锚点不在父面板里，只能由调用方告知）；
 *   ② **DOM 祖先**（2026-10-14，嵌在父浮层面板里的下拉，如底栏参数面板里的「格式」）。
 *
 * 用户口径（2026-10-09）：「触发这个菜单的时候，你的画布的这个菜单消失了，有没有办法」。
 * 用户口径（2026-10-14）：「当我点击内部的下拉时，它触发了外部下拉的关闭」。
 *
 * 两条都要满足同一组判据，缺一条就退回「一开内层，外层当场消失」：
 *   ① 打开时把**自己的组链**交给互斥登记表（登记表据它**放过自己的祖先**，只关平级/无关的）；
 *   ② 面板组链写成「父链 + 自己」（父菜单的点外判定才知道点的是自己人）；
 *   ③ 自己判「点外」只认自己的 id（否则点父列表时以为还在组内、菜单赖着不关）。
 */
describe('子浮层（nestedIn）：两个菜单并存', () => {
  const src = readFileSync(new URL('../components/AxDropdown.vue', import.meta.url), 'utf-8')
  const kit = readFileSync(new URL('../../../ui-kit/src/components/dropdown/useDropdown.ts', import.meta.url), 'utf-8')
  const kitVue = readFileSync(new URL('../../../ui-kit/src/components/dropdown/Dropdown.vue', import.meta.url), 'utf-8')

  it('适配层保留 nestedIn 开关，并转成库的 parentChain（不传 = 普通下拉）', () => {
    expect(src).toMatch(/nestedIn\?: \(\) => \{ chain: string; open: boolean \} \| undefined/)
    expect(src).toMatch(/nestedIn: undefined,/)
    expect(src).toMatch(/:parent-chain="parentChain"/)
  })

  it('① 库打开时把**自己的组链**交给互斥登记表（登记表据它放过祖先）', () => {
    // 唯一实现：ui-kit 的 useDropdown。适配层不再自己维护登记表。
    expect(kit).toMatch(/claimFloating\(closeInstance, \(\) => chain\.value\)/)
    expect(src).not.toMatch(/claimDropdownExclusive/)
  })

  it('② 库算出的组链 = 父链 + 自己，并写进面板（父菜单借它认出「点的是自己人」）', () => {
    expect(kit).toMatch(/const ancestors = explicit \? explicit\.split/)
    expect(kit).toMatch(/return \[\.\.\.ancestors, chainId\]/)
    // 新旧两份属性都写：宿主与库互相识别父子关系
    expect(kitVue).toMatch(/:data-mck-floating-chain="api\.chain\.value\.join\(' '\)"/)
    expect(kitVue).toMatch(/:data-floating-chain="api\.chain\.value\.join\(' '\)"/)
  })

  it('②b 父链有**两条来源**：显式 parentChain 优先，其次读自己的 DOM 祖先', () => {
    // 显式声明（锚点不在父面板里，如画布行尾的操作菜单）
    expect(kit).toMatch(/const explicit = props\.parentChain\?\.trim\(\)/)
    // DOM 祖先（触发器就长在父浮层面板里 —— 用户报的「点内部下拉关掉外部」正是这条）
    expect(kit).toMatch(/floatingChainOf\(triggerRef\.value\)/)
  })

  it('父浮层关掉时子浮层跟着收（不留没有爹的孤儿菜单）', () => {
    expect(kit).toMatch(/props\.parentOpen\?\.\(\)/)
  })

  it('适配层交出 openAtPoint 与链 id（子浮层要拿父的链）', () => {
    expect(src).toMatch(/function openAtPoint/)
    expect(src).toMatch(/defineExpose\(\{ openAtPoint/)
    expect(src).toMatch(/chainId: computed\(\(\) => kit\.value\?\.chainId\)/)
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
  // 箭头已经收进 ui-kit：契约改为直接读库里的唯一实现。
  const kitVue = readFileSync(new URL('../../../ui-kit/src/components/dropdown/Dropdown.vue', import.meta.url), 'utf-8')
  const kitCss = readFileSync(new URL('../../../ui-kit/src/components/dropdown/dropdown.css', import.meta.url), 'utf-8')
  const kit = readFileSync(new URL('../../../ui-kit/src/components/dropdown/useDropdown.ts', import.meta.url), 'utf-8')
  const adapter = readFileSync(new URL('../components/AxDropdown.vue', import.meta.url), 'utf-8')

  it('箭头是浮层的**兄弟节点**（子节点会把探出量算进浮层可滚溢出）', () => {
    // 判据：箭头标签出现在 </Transition> **之后**（与浮层平级）。若它挪进浮层 div 内部，
    // 就会落在 </Transition> 之前 —— 这条会红。
    const transitionClose = kitVue.indexOf('</Transition>')
    const at = kitVue.indexOf('class="mck-dropdown__arrow dd-arrow"')
    expect(at, '模板里没找到箭头').toBeGreaterThan(-1)
    expect(at, '箭头必须在 </Transition> 之后（浮层外，做兄弟节点）').toBeGreaterThan(transitionClose)
  })

  it('箭头与浮层用同一个层级（适配层统一传 --layer-modal），否则箭头会被画布图层盖住', () => {
    // 层级由同一个 prop 同时写给面板与箭头：两边必须一致，这才是本条的契约。
    expect(adapter).toContain(":z-index=\"'var(--layer-modal, 100000)'\"")
    expect(kit).toMatch(/if \(props\.zIndex !== undefined[\s\S]{0,80}style\.zIndex = String\(props\.zIndex\)/)
    // 面板与箭头各写一次，缺一处就会“菜单看得见、箭头看不见”
    expect((kit.match(/style\.zIndex = String\(props\.zIndex\)/g) ?? []).length).toBe(2)
    // 库自身仍保留 Provider 派生的档位（独立使用时不必依赖宿主层叠带）
    expect(kitCss).toMatch(/z-index:\s*var\(--mck-z-dropdown/)
  })


  /**
   * 箭头横向位置**跟着触发器中心走**（用户口径 2026-10-30：「菜单设了宽度，箭头没跟着 trigger」）。
   *
   * 历史：① 跟触发器中心 → 菜单被 shift 推走时看着偏；② 改跟 align 取菜单左缘/中线/右缘
   * → 菜单一宽（如 Agent 面板 320↔586）箭头就离按钮很远。
   * 现在：取触发器中心，只夹进菜单范围内。菜单怎么变宽、怎么被推，箭头都还在按钮正上方。
   */
  it('箭头横向跟触发器中心走（再夹进菜单）', () => {
    const at = kit.indexOf('const arrowStyle = computed')
    const body = kit.slice(at, kit.indexOf('/**\n   * slot 里的 close'))
    // 必须读触发器中心，并夹进菜单范围
    expect(body, '箭头横向要读触发器中心').toMatch(/center = tr\.left \+ tr\.width \/ 2/)
    expect(body, '横向要夹进菜单范围').toMatch(/clamp\(center - half/)
    // 纵向换边时也要跟触发器中心（left/right 方位）
    expect(body, '纵向要读触发器中心').toMatch(/const center = tr\.top \+ tr\.height \/ 2/)
    // 不能再按菜单边缘取点，否则菜单一宽箭头就飞走
    const code = body
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join('\n')
    expect(code).not.toMatch(/effectiveAlign\.value/)
    // 也不能读 floating-ui 的 arrow 中间件输出（按打开那一刻的尺寸算，菜单被内容撑宽后就失准）
    expect(code).not.toMatch(/middlewareData/)
    expect(code).not.toMatch(/d\?\.(x|y)/)
  })

  it('适配层只给箭头挂类名，不再自己算位置', () => {
    expect(adapter).toContain("arrow-class=\"'axd-arrow'\"")
    expect(adapter).not.toMatch(/arrowStyle|triggerCenter/)
  })
})
