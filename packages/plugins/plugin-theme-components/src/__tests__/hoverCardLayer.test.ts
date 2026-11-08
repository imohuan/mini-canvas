/**
 * HoverCard 必须和菜单同档（用户口径 2026-11-07）。
 *
 * 现象：Agent 面板（z-index 1000）里 hover 上下文圆环，浮层在 DOM 里、内容也在，
 * 但被面板正文盖住 —— 用户看到的是「hover 了但什么都没有」。
 *
 * 根因：ui-layers.css 的菜单档清单漏了 [data-slot='hover-card-content']，
 * 浮层退回组件自带的 z-50。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.resolve(HERE, '../styles/ui-layers.css'), 'utf8')

function menuBlock(): string {
  const at = css.indexOf("[data-slot='dropdown-menu-content'],")
  expect(at, '找不到菜单档规则').toBeGreaterThanOrEqual(0)
  const end = css.indexOf('}', at)
  return css.slice(at, end + 1)
}

describe('浮层层级表', () => {
  it('HoverCard 和菜单同档（否则会被 Agent 面板盖住）', () => {
    const block = menuBlock()
    expect(block).toContain("[data-slot='hover-card-content']")
    expect(block).toContain('z-index: var(--ui-layer-menu)')
  })
})
