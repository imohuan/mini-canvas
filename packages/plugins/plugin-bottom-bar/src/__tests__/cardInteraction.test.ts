/**
 * 卡片的点击语义（用户 2026-10-29 明确口径）：
 *
 *   ① 单击卡片**不进全屏预览**（全屏只从 hover 预览框右下角的「全屏」进）；
 *   ② 双击卡片 = 把画布视口聚焦到该卡片对应的节点；
 *   ③ hover 时卡片底部**没有名称条**（以前会盖住右下角 @ 按钮）。
 *
 * 前两条用 SSR 检查「事件绑定挂在卡片上、单击路径里不再调用 openPreview」，
 * 第三条用 CSS 契约（样式块已删除）锁住。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SFC = readFileSync(fileURLToPath(new URL('../NodeBottomBar.vue', import.meta.url)), 'utf8')
const SCRIPT = SFC.slice(0, SFC.indexOf('<template>'))
const TEMPLATE = SFC.slice(SFC.indexOf('<template>'), SFC.indexOf('<style'))

describe('卡片单击：不进全屏预览', () => {
  it('单击的 click 委托里不再调用 openCard / openPreview', () => {
    // onCardsClickCapture 的整个函数体
    const start = SCRIPT.indexOf('function onCardsClickCapture')
    expect(start).toBeGreaterThan(0)
    const body = SCRIPT.slice(start, SCRIPT.indexOf('\n/**', start))
    expect(body).not.toMatch(/openCard\(/)
    expect(body).not.toMatch(/openPreview\(/)
  })

  it('卡片上挂了 dblclick，单击仍然是 click', () => {
    const cardTag = TEMPLATE.slice(
      TEMPLATE.indexOf('class="nb-card"') - 600,
      TEMPLATE.indexOf('class="nb-card"') + 800,
    )
    expect(cardTag).toMatch(/@dblclick\.stop\.prevent="onCardDblClick/)
    expect(cardTag).toMatch(/@click\.stop=/)
  })
})

describe('双击卡片：聚焦到节点', () => {
  it('聚焦实现读 nodeLayout 的真实矩形，并沿用 focusViewportFor 的缩放规则', () => {
    const start = SCRIPT.indexOf('function onCardDblClick')
    expect(start).toBeGreaterThan(0)
    const body = SCRIPT.slice(start, SCRIPT.indexOf('\n/**', start))
    expect(body).toMatch(/getNodeRect\(/)
    expect(body).toMatch(/focusViewportFor\(/)
    expect(body).toMatch(/setCenter\(/)
  })

  it('没有 nodeId 的卡（手打 @名字 待绑定）不强行聚焦', () => {
    const start = SCRIPT.indexOf('function onCardDblClick')
    const body = SCRIPT.slice(start, SCRIPT.indexOf('\n/**', start))
    expect(body).toMatch(/if \(!nodeId\) return/)
  })
})

describe('卡片底部不再有名称条（会盖住 @ 按钮）', () => {
  it('模板里没有 .nb-card-namebar', () => {
    expect(TEMPLATE).not.toContain('nb-card-namebar')
  })

  it('样式里也没有对应规则（避免留一堆死样式）', () => {
    expect(SFC).not.toContain('.nb-card-namebar')
  })
})
