/**
 * 面板拖拽手柄的主题契约（用户口径 2026-10-28：
 * 「两处拖拽线条同一种方式，拖拽时背景按当前主题颜色显示，线条宽度加大一些」）。
 *
 * 两处原来是各画一套白色渐变 —— 亮色主题下几乎看不见，且两边会慢慢长得不一样。
 * 这里盯三件事：两侧都复用同一个手柄、颜色只走 --ui-accent（不写死白/黑）、
 * 拖拽态的线确实比悬停态粗。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

const handleSfc = read('../components/AxResizeHandle.vue')
/** 只看样式段（script 里的泛型 `{ … }` 会把简单的花括号扫描带歪），并去掉注释 */
const handle = (/<style[^>]*>([\s\S]*?)<\/style>/.exec(handleSfc)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
const agent = read('../components/areas/AgentPanel.vue')
const drawer = read('../components/areas/LeftDrawer.vue')

/** 取某个选择器的全部声明块（支持逗号并列选择器，按整段选择器精确匹配） */
function rulesOf(css: string, selector: string): string[] {
  const out: string[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim())
    if (selectors.includes(selector)) out.push(m[0])
  }
  return out
}

function ruleOf(css: string, selector: string): string {
  const first = rulesOf(css, selector)[0]
  if (!first) expect.fail('找不到选择器 ' + selector)
  return first
}

describe('面板拖拽手柄：两处同一套外观、跟随主题色', () => {
  it('左侧抽屉与右侧 Agent 面板都复用 AxResizeHandle（不再各画一套）', () => {
    expect(agent).toMatch(/import AxResizeHandle from '\.\.\/AxResizeHandle\.vue'/)
    expect(drawer).toMatch(/import AxResizeHandle from '\.\.\/AxResizeHandle\.vue'/)
    expect(agent).toContain('<AxResizeHandle')
    expect(drawer).toContain('<AxResizeHandle')
    // 旧的白色 hover 渐变必须去掉（亮色主题下几乎看不见）
    expect(agent).not.toContain('rgba(255, 255, 255, 0.14)')
    expect(drawer).not.toContain('hover:to-white/[0.14]')
  })

  it('线贴面板各自那条边：Agent 在左缘、抽屉在右缘', () => {
    expect(agent).toMatch(/<AxResizeHandle[\s\S]{0,160}?edge="left"/)
    expect(drawer).toMatch(/<AxResizeHandle[\s\S]{0,160}?edge="right"/)
    expect(ruleOf(handle, '.ax-rh--left .ax-rh-line')).toContain('left: 0')
    expect(ruleOf(handle, '.ax-rh--right .ax-rh-line')).toContain('right: 0')
  })

  it('颜色全部走主题强调色，不写死白/黑', () => {
    expect(handleSfc).toContain('var(--ui-accent-soft')
    expect(handleSfc).toContain('var(--ui-accent,')
    // 12px 热区保留，方便抓取；真正画出来的线是 2px
    expect(ruleOf(handle, '.ax-rh')).toContain('width: 12px')
    expect(ruleOf(handle, '.ax-rh-line')).toContain('width: 2px')
  })

  it('拖拽时线加粗、底色按主题色铺开', () => {
    // 悬停态与拖拽态各一条规则：先取后者（源码里在最后）
    const rules = rulesOf(handle, '.ax-rh.is-dragging .ax-rh-line')
    const dragging = rules[rules.length - 1] ?? ''
    expect(dragging).toMatch(/width:\s*4px/)
    expect(dragging).toContain('var(--ui-accent,')
    // 拖拽态的底色：默认透明，按住才显出来
    expect(ruleOf(handle, '.ax-rh::before')).toMatch(/opacity:\s*0/)
    expect(ruleOf(handle, '.ax-rh.is-dragging::before')).toMatch(/opacity:\s*1/)
  })

  it('松手就收掉拖拽态（窗口 pointerup 收尾，拖出热区也不会一直亮）', () => {
    expect(handleSfc).toContain("window.addEventListener('pointerup', stopDrag)")
    expect(handleSfc).toContain("window.addEventListener('pointercancel', stopDrag)")
    expect(handleSfc).toMatch(/function stopDrag[\s\S]{0,200}dragging\.value = false/)
  })
})
