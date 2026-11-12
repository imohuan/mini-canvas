/**
 * 「不传 editable = 可编辑」的契约（用户口径 2026-10-30：「Agent 输入框无法输入」）。
 *
 * 症状：Agent 面板的输入框整块点不动、打不了字，`contenteditable` 一直是 "false"。
 * 根因：`editable` 是**布尔 prop**，Vue 会把「没传」折算成 `false`（不是 `undefined`）。
 * 编辑器里 `unref(props.editable) !== false` 那条判断永远拿不到 undefined，
 * 于是没传 editable 的调用方（Agent 对话）被默认锁成只读；底栏传了 `:editable` 才正常。
 *
 * 修法是把「缺省」写在 props 默认值里（`withDefaults(..., { editable: true })`），
 * 而不是靠消费方每次都记得传。这条测试钉的就是这个默认值。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const component = readFileSync(path.join(here, '../index.vue'), 'utf8')
const hook = readFileSync(path.join(here, '../useEditor.ts'), 'utf8')

describe('editable 缺省 = 可编辑', () => {
  it('组件用 withDefaults 把 editable 默认成 true（不传 ≠ 锁死）', () => {
    const at = component.indexOf('defineProps<{')
    expect(at, '没找到 defineProps').toBeGreaterThan(-1)
    // withDefaults 包在 defineProps 外面（前缀），要从更早一点开始截
    const decl = component.slice(Math.max(0, at - 40), at + 4000)
    expect(decl, 'props 必须走 withDefaults，否则布尔 prop 的缺省是 false').toMatch(/withDefaults\(\s*defineProps/)
    expect(decl, 'editable 的默认值必须是 true').toMatch(/editable:\s*true/)
  })

  it('useEditor 只把显式 false 当只读（undefined 仍可编辑）', () => {
    expect(hook).toMatch(/editable:\s*\(\)\s*=>\s*unref\(props\.editable\)\s*!==\s*false/)
  })
})
