/**
 * 打开下拉时「把选中项滚进可视区」的契约（用户口径 2026-10-10）。
 *
 * 用户口径（附截图）：模型下拉里可能有几十条（自建网关几十上百个模型 ID），列表限高只露几行，
 * 而**当前选中的那一条**多半在可视区外 —— 点开根本看不到"我现在用的是哪个"，得自己往下翻。
 * 要求：点开就把选中的那条滚进可视区。
 *
 * 为什么分两头测（照 stickToBottomCore.test.ts / queueUi.test.ts 的先例）：
 *   ① 「该滚到哪」这件事有口径（已可见就不动、从上面被裁对齐上缘、从下面被裁对齐下缘……），
 *      抽成纯函数 scrollTopForVisibleItem 真跑一遍 —— 这是本功能唯一的业务逻辑；
 *   ② 「接线有没有接上」（打开时滚的是列表的滚动区、认的是 aria-selected、量几何用 offsetTop）
 *      只能在源码里看，因为本包 vitest 跑在 node（挂不起整只 AgentConversation）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scrollTopForVisibleItem } from '../selectionScroll'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const host = readFileSync(path.resolve(HERE, '../components/AgentConversation.vue'), 'utf8')

/** 造一份滚动状态：内容总高 scrollHeight、视口 clientHeight、当前 scrollTop */
const box = (scrollTop: number, scrollHeight: number, clientHeight: number) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
})

describe('scrollTopForVisibleItem：选中项该滚到哪', () => {
  // 40 条、每条 58px、视口 270px → 可滚范围 [0, 2050]，一次露 4 条多一点
  const ROW = 58
  const item = (index: number) => ({ top: index * ROW, height: ROW })

  it('已经完整可见 → 原样不动（打开就跳一下很吵）', () => {
    // 视口停在顶部（第 0 条）：第 1 条完整落在 [0, 270) 里
    expect(scrollTopForVisibleItem(box(0, 40 * ROW, 270), item(1))).toBe(0)
  })

  it('被裁在下方 → 下缘对齐容器下缘（选中项露出来，不是"刚露一角"）', () => {
    // 第 37 条（末条）：停在顶部时它远在下方，应滚到底、下缘正好贴容器下缘
    expect(scrollTopForVisibleItem(box(0, 40 * ROW, 270), item(37))).toBe(38 * ROW - 270)
  })

  it('被裁在上方 → 上缘对齐容器上缘', () => {
    // 当前停在第 30 条处，选中项却是第 2 条（在视口上方）
    expect(scrollTopForVisibleItem(box(30 * ROW, 40 * ROW, 270), item(2))).toBe(2 * ROW)
  })

  it('返回值永远夹在可滚范围内（不会滚出内容外）', () => {
    const b = box(0, 40 * ROW, 270)
    expect(scrollTopForVisibleItem(b, item(99))).toBe(40 * ROW - 270)
    expect(scrollTopForVisibleItem(box(100, 40 * ROW, 270), { top: -500, height: ROW })).toBe(0)
  })

  it('内容不足以滚动 → 0（本来全都看得见）', () => {
    expect(scrollTopForVisibleItem(box(0, 200, 270), item(3))).toBe(0)
  })

  it('项比可视区还高 → 对齐上缘（露开头比露结尾有用）', () => {
    expect(scrollTopForVisibleItem(box(0, 40 * ROW, 40), { top: 300, height: 200 })).toBe(300)
  })

  it('pad 给上下留白；负值按 0 处理', () => {
    expect(scrollTopForVisibleItem(box(0, 40 * ROW, 270), item(37), 8)).toBe(38 * ROW - 270 + 8)
    expect(scrollTopForVisibleItem(box(0, 40 * ROW, 270), item(37), -8)).toBe(38 * ROW - 270)
  })
})

describe('AgentConversation 接线：打开模型下拉时滚选中项', () => {
  it('模型列表的滚动区挂着 ref（有它才找得到要滚的容器）', () => {
    expect(host).toMatch(/class="ac-menu-scroll"\s+ref="modelScrollRef"/)
  })

  it('打开时才滚（那一刻面板与列表才在 DOM 里，ref 才有值）', () => {
    expect(host).toMatch(/watch\(modelOpen,[\s\S]{0,400}scheduleScrollSelectedModel/)
    expect(host).toMatch(/function scrollSelectedModelIntoView\(\): void/)
  })

  /**
   * 一次滚不准（用户口径 2026-10-30：点开模型下拉，选中项仍在可视区外）。
   *
   * 两个原因叠在一起：① 浮层入场带 0.14s 的 scale 动画，动画中量出来的 rect 是缩过的；
   * ② inner-scroll 的列表可视高度在动画结束、min-height 生效后还会再变一次（实测 332 → 319）。
   * 所以「打开即算一次」不够，还要有动画后的二次校正 + 尺寸变化时的重新定位。
   */
  it('滚两次并盯着可视高度（入场动画结束后再校正，尺寸一变就重定位）', () => {
    // 二次校正：定时器再滚一次
    const at = host.indexOf('function scheduleScrollSelectedModel')
    expect(at, '没找到 scheduleScrollSelectedModel').toBeGreaterThan(-1)
    const body = host.slice(at, host.indexOf('\nwatch(modelOpen', at))
    expect(body, '要做动画后的二次校正').toMatch(/setTimeout\(\(\) => scrollSelectedModelIntoView/)
    // 尺寸变化兜底：ResizeObserver 盯列表可视高度
    expect(host, '要用 ResizeObserver 盯列表可视高度').toMatch(/new ResizeObserver\(/)
    expect(host, '观察的是模型列表滚动区').toMatch(/observe\(box\)/)
    // 切模式会换一整套列表，位置要重算
    expect(host).toMatch(/watch\(modelView,[\s\S]{0,200}scheduleScrollSelectedModel/)
  })

  it('卸载时断开观察者（不留孤儿回调）', () => {
    expect(host).toMatch(/onBeforeUnmount\(\(\) => \{[\s\S]{0,120}modelBoxObserver\?\.disconnect\(\)/)
  })

  it('认的是 aria-selected="true"（选中态的唯一真相，不另造一个标记）', () => {
    expect(host).toMatch(/querySelector<HTMLElement>\('\[aria-selected="true"\]'\)/)
  })

  /**
   * 几何必须用**真实矩形**换算，不能用 offsetTop 相减（用户口径 2026-10-30）。
   *
   * 原来的理由是「rect 会被入场 scale 动画缩过，offsetTop 不吃 transform」。
   * 但 offsetTop 只在**同一个 offsetParent** 下才可比：模型列表的项与滚动区之间还隔着
   * .ac-panel-body / .ac-menu-scroll 两层，相减出来根本不是项在内容里的位置，
   * 滚完选中项仍贴在下缘外面。动画的影响改成「等动画结束再校一次」来消除。
   */
  it('几何用 getBoundingClientRect 换算（offsetTop 跨 offsetParent 会算错）', () => {
    const at = host.indexOf('function scrollSelectedModelIntoView')
    const body = host.slice(at, host.indexOf('\nfunction ', at + 10))
    expect(body).toMatch(/getBoundingClientRect\(\)\.top - box\.getBoundingClientRect\(\)\.top/)
    expect(body).not.toMatch(/offsetTop\s*-\s*box\.offsetTop/)
    expect(body).toMatch(/scrollTopForVisibleItem\(/)
    // 落点直接写回 scrollTop（打开即到位，不做平滑动画）
    expect(body).toMatch(/box\.scrollTop\s*=/)
  })
})
