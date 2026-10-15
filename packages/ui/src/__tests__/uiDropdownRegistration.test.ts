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

  it('声明了 nestedIn 开关（不传 = 普通下拉，行为完全不变）', () => {
    expect(src).toMatch(/nestedIn\?: \(\) => \{ chain: string; open: boolean \} \| undefined/)
    expect(src).toMatch(/nestedIn: undefined,/)
  })

  it('① 打开时把**自己的组链**交给互斥登记表（登记表据它放过祖先）', () => {
    // 关键：claim 必须带上组链，否则内层一开就把外层（它自己的父面板）关掉
    expect(src).toMatch(/claimDropdownExclusive\(close, \(\) => panelChainIds\.value\)/)
  })

  it('② 面板组链 = 父链 + 自己（父菜单借它认出「点的是自己人」）', () => {
    expect(src).toMatch(/const panelChainIds = computed<string\[\]>\(\(\) => \[\.\.\.parentChainIds\.value, chainId\]\)/)
    // 链要真写进面板
    expect(src).toMatch(/:data-floating-chain="panelChain"/)
  })

  it('②b 父链有**两条来源**：显式 nestedIn 优先，其次读自己的 DOM 祖先', () => {
    // 显式声明（锚点不在父面板里，如画布行尾的操作菜单）
    expect(src).toMatch(/const explicit = nestedCtx\.value\?\.chain/)
    // DOM 祖先（触发器就长在父浮层面板里 —— 用户报的「点内部下拉关掉外部」正是这条）
    expect(src).toMatch(/return floatingChainOf\(containerRef\.value\)/)
  })

  it('③ 自己判点外只认自己的 id（点父列表才关得掉子菜单）', () => {
    expect(src).toMatch(/const mine = isNested\.value \? chainId : panelChain\.value/)
    expect(src).toMatch(/isInFloatingGroup\(node, mine\)/)
  })

  it('父浮层关掉时子浮层跟着收（不留没有爹的孤儿菜单）', () => {
    expect(src).toMatch(/isNested\.value && nestedCtx\.value\?\.open === false/)
  })

  it('把开关与组链交给子浮层（defineExpose）', () => {
    expect(src).toMatch(/defineExpose\(\{ openAtPoint, isOpen, chainId \}\)/)
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

  it('箭头 z-index 与浮层同层（--layer-modal / 100000），否则会被画布图层盖住', () => {
    // 层叠带改造后两者都走 --layer-modal 变量（唯一事实源见 canvas-render/contracts/layers.ts）：
    // 断言改成「两边用同一个值」。变量与兜底值都认，但**两边必须一致** —— 这才是本条的契约。
    const zIndexOf = (rule: RegExpMatchArray): string => {
      const m = /z-index:\s*([^;]+);/.exec(rule[1])
      expect(m, '规则里没有 z-index').toBeTruthy()
      return m![1].trim()
    }
    const arrowRule = /\.axd-arrow\s*\{([^}]*)\}/.exec(src)
    expect(arrowRule, '没找到 .axd-arrow 规则').toBeTruthy()
    const menuRule = /\.dd-menu\s*\{([^}]*)\}/.exec(src)
    expect(menuRule, '没找到 .dd-menu 规则').toBeTruthy()
    // 浮层这一层是「模态/菜单」档：写死或走变量都要落在这一档上
    expect(zIndexOf(menuRule!)).toMatch(/100000/)
    // 箭头必须与浮层**同一个值**（同层）——低了会被画布图层盖住（菜单看得见、箭头看不见）
    expect(zIndexOf(arrowRule!)).toBe(zIndexOf(menuRule!))
  })


  /**
   * 箭头横向位置**跟着 align 走**（用户口径 2026-10-07：「下拉左对齐了，但箭头没左对齐」）。
   *
   * 历史：早先跟触发器中心（箭头全挤左边、看着指向左侧）→ 改成菜单中线；
   * 但菜单设了 align=start（左对齐触发器）后，菜单左移、箭头仍在中线，于是又不齐了。
   * 现在按 align 取：start→贴左缘(内缩 PAD)、end→贴右缘、center→中线。
   */
  it('箭头横向跟 align 走（start/end/center 三档）', () => {
    const at = src.indexOf('const arrowStyle = computed')
    const body = src.slice(at, src.indexOf('function clearCloseTimer'))
    // 必须读到 effectiveAlign（不再写死中线）
    expect(body, '箭头横向要读 effectiveAlign').toMatch(/effectiveAlign\.value/)
    // 三档都要有：start 贴左、end 贴右、center 中线
    expect(body, 'start 档应贴菜单左缘').toMatch(/a === 'start'/)
    expect(body, 'end 档应贴菜单右缘').toMatch(/a === 'end'/)
    expect(body, 'center 档仍是中线').toMatch(/ml \+ mw \/ 2/)
    // 不能再读 floating-ui 的 arrow 中间件输出（按打开那一刻的尺寸算，菜单被内容撑宽后就失准）
    const code = body
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join('\n')
    expect(code).not.toMatch(/middlewareData/)
    expect(code).not.toMatch(/d\?\.(x|y)/)
  })
})
