/**
 * 整页不可选中文本（用户口径 2026-10-04：Package UI 整个页面要有 select-none，
 * 不能让界面文本被鼠标选中）。
 *
 * 钉两条：
 *   1. 页面根默认 \`user-select: none\`（此前 v2 的成品壳丢了 v1 的 body 兜底，
 *      画布节点标题能被拖蓝选中）；
 *   2. 输入面（textarea / contenteditable / ProseMirror）必须 override 成 \`text\`，
 *      否则节点文本编辑、标题编辑、Agent 输入框连字都选不了。
 *
 * 为什么读源码而不是渲染：app.css 是全局 CSS 入口，node 环境没有真实样式表；
 * 与 uiDropdownRegistration / stylesCompile 同款「源码结构契约」手法。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf-8')

interface Block {
  selector: string
  body: string
}

/** 粗暴切出顶层 CSS 规则（本文件的样式段没有嵌套规则，够用） */
function blocks(): Block[] {
  const out: Block[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) out.push({ selector: (m[1] ?? '').trim(), body: m[2] ?? '' })
  return out
}

describe('整页 select-none（不可选中文本）', () => {
  it('页面根默认 user-select: none（body 必须在内）', () => {
    const hit = blocks().find((b) => /\bbody\b/.test(b.selector) && /user-select:\s*none/.test(b.body))
    expect(hit, 'app.css 里没有给页面根（body）设置 user-select: none').toBeTruthy()
  })

  it('输入面例外：textarea / contenteditable / ProseMirror 放行选中（否则没法编辑）', () => {
    const all = blocks()
    for (const sel of ['textarea', 'contenteditable', 'ProseMirror']) {
      const hit = all.find((b) => b.selector.includes(sel) && /user-select:\s*text/.test(b.body))
      expect(hit, `没有为 ${sel} 放行 user-select: text`).toBeTruthy()
    }
  })
})
