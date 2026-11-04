/**
 * 标题条分宽契约：**右侧那一格必须能完整显示**（用户口径 2026-10-11）。
 *
 * 用户报的问题（附截图）：缩放变小后，标题右侧的尺寸文字被截成 `20...`。
 * 根因是旧的比例写法把两侧写死了 —— 标签恒占 80%、右侧最多 20%：
 * 节点一窄（卡片宽 × 缩放），20% 只剩几十像素，尺寸文字必然被省略号吃掉。
 *
 * 用户的要求很明确：「主要希望左右两侧不要"打架"就行。右侧最多也就是 9 个字符，
 * 左侧文字可能会多一些。我希望右侧的 size 可以完整显示」。
 * 所以契约是：右侧按自己要的宽度先拿（不收缩），左侧吃剩余宽度、不够才省略。
 *
 * 为什么用源码断言而不是 SSR：这三条全是 CSS 的**布局**事实 ——
 * SSR 只产出 HTML 字符串，看不见 flex 分配（本仓 ui 包的 settingsPanelTree 同样理由用源码断言）。
 * 真正的像素级验证由 Chrome MCP 真机实测完成（见 STATUS 追记）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../BaseTitle.vue', import.meta.url), 'utf-8')
/** 只要 <style> 段里的 CSS（模板里的 class 名不算证据） */
const CSS = /<style[^>]*>([\s\S]*?)<\/style>/.exec(SRC)?.[1] ?? ''

/** 取某条规则的声明块（`选择器 { ... }`；取第一条匹配的） */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(CSS)
  expect(m, `样式里找不到 ${selector} 这条规则`).not.toBeNull()
  return m![1]
}

describe('标题条左右分宽：右侧按内容宽先拿，左侧让位', () => {
  it('右侧那一格不收缩（内容有几个字符就占几个字符）', () => {
    const body = ruleBody('.base-title__extra')
    // flex: 0 0 auto → 不伸长、不收缩，绝不被压缩成残缺文本
    expect(body.replace(/\s+/g, ' ')).toContain('flex: 0 0 auto')
    // 旧写法把上限压在 20%，窄节点上就是这一条把尺寸文字截成 `20...`
    expect(body).not.toContain('max-width: 20%')
  })

  it('左侧标签是可伸缩的剩余宽（放不下才省略，不写死比例）', () => {
    const body = ruleBody('.base-title-label')
    expect(body.replace(/\s+/g, ' ')).toContain('flex: 1 1 auto')
    // min-width: 0 是 flex 子项能真正缩下去的前提（默认 min-width:auto 会顶住容器）
    expect(body.replace(/\s+/g, ' ')).toContain('min-width: 0')
    // 旧写法把标签写死 80%（含 width/max-width/flex-basis 三处）
    expect(body).not.toContain('80%')
  })

  it('左侧长标题仍然会省略（不是把名字撑破容器）', () => {
    const body = ruleBody('.base-title-label')
    expect(body).toContain('overflow: hidden')
    expect(body).toContain('text-overflow: ellipsis')
    expect(body).toContain('white-space: nowrap')
  })

  it('右侧内容本身也不收缩（被压扁就变成读不出来的残缺文本）', () => {
    const body = ruleBody('.base-title__extra> :deep(span)')
    expect(body.replace(/\s+/g, ' ')).toContain('flex: 0 0 auto')
  })

  it('根仍是单行 flex + 裁剪（两侧"不打架"的前提）', () => {
    const body = ruleBody('.base-title')
    expect(body).toContain('display: flex')
    expect(body).toContain('overflow: hidden')
  })
})
