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

/* 注释里也会出现 `:focus-visible` / `:where(...)` 这样的字面文本（说明为什么这么写），
   先整段剥掉，免得它们被当成选择器 —— 本文件只认真的 CSS 规则。 */
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '')

interface Block {
  selector: string
  body: string
}

/** 粗暴切出顶层 CSS 规则（本文件的样式段没有嵌套规则，够用） */
function blocks(): Block[] {
  const out: Block[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cssNoComments))) out.push({ selector: (m[1] ?? '').trim(), body: m[2] ?? '' })
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

/**
 * 全界面关掉焦点环（用户口径 2026-10-14）。
 *
 * 现象（用户原话）：「这边去掉这个黑色的边框，这应该是那种按钮或 table 聚焦的效果，
 * 是浏览器的一个默认行为。按理说，这边树状图里面的所有内容都不支持聚焦，应该说整个页面的
 * 内容都不支持聚焦，除了弹出框最底下的几个按钮。」随后收口：
 * 「我是不太希望你显示这个焦点环的，能不能在全局把它给关掉」。
 *
 * 那根黑框是浏览器自带的 UA 焦点环（深色主题下实测 `outline: rgb(16,16,16) auto 1px`）；
 * 触发路径：点资产行开预览 → Esc 关掉 → 焦点还给行按钮，Esc 属键盘操作就判成 :focus-visible。
 *
 * 为什么必须是 `*` + `!important`：全仓约 30 处组件级 focus 样式
 * （`.cf-trigger:focus-visible{outline:2px solid …}` 这类）特异性都高于 `*:focus-visible`，
 * 不加 !important 就只关掉一半 —— 用户要的是全关。
 *
 * 这条测试就是防止有人"顺手"把它去掉或降级成低特异性选择器，
 * 让黑框又从某个角落冒出来。
 */
describe('全界面关掉焦点环（去掉浏览器黑框）', () => {
  const ring = () => blocks().find((b) => b.selector.includes(':focus-visible'))

  it('app.css 里有一条把 outline 压掉的全局规则', () => {
    const hit = ring()
    expect(hit, 'app.css 里没有全局 :focus-visible 规则').toBeTruthy()
    expect(hit!.body).toMatch(/outline:\s*none/)
  })

  it('压 outline 必须带 !important（否则组件级焦点样式会盖回来，只关一半）', () => {
    expect(ring()!.body).toMatch(/outline:\s*none\s*!important/)
  })

  it('选择器是通配 `*`（要真的"全局"，不能只覆盖某几个标签）', () => {
    expect(ring()!.selector.trim()).toMatch(/^\*\s*:focus-visible$/)
  })
})
