/**
 * 回车优先给「@ 下拉」用（用户口径 2026-10-25）。
 *
 * 用户原话：输入「@」弹出下拉后，按回车本来是为了**选中那一项**，结果却直接触发了发送。
 * 根因是两套「回车」各管一段：
 *   · ProseMirror 的 keymap 在 `keydown` 的**冒泡阶段**处理 Enter（菜单开着就选菜单项）；
 *   · 组件挂在编辑器根上的 `keydown` 处理提交 —— 它先被编辑器内部拦下，事件再冒到组件时
 *     已经带着「菜单已处理后」的状态，组件的提交判定如果只按「有没有修饰键」就永远判断不了
 *     「此刻回车该归谁」。
 * 于是把判断收进纯函数：**菜单开着 ⇒ 回车归菜单**（哪怕它还没处理，也可能是空列表等边界）。
 * 这样「回车选菜单」和「回车发送」不会互相抢，跟设置里选的提交键也无关。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSubmitShortcut, shouldDeferEnterToMenu } from '../composerKeys'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const conversation = readFileSync(path.resolve(HERE, '../components/AgentConversation.vue'), 'utf8')

const enter = (mods: Record<string, boolean> = {}) => ({
  key: 'Enter',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
  ...mods,
})

describe('shouldDeferEnterToMenu：@ 下拉打开时，回车先归菜单', () => {
  it('菜单开着 + 裸回车 ⇒ 归菜单（哪怕设置了「回车提交」）', () => {
    expect(shouldDeferEnterToMenu(enter(), true)).toBe(true)
  })

  it('菜单开着 + Ctrl+回车 ⇒ 也归菜单（菜单里回车就是「选这一项」）', () => {
    expect(shouldDeferEnterToMenu(enter({ ctrlKey: true }), true)).toBe(true)
  })

  it('菜单关着 ⇒ 不拦（回车照常按设置走）', () => {
    expect(shouldDeferEnterToMenu(enter(), false)).toBe(false)
    expect(shouldDeferEnterToMenu(enter({ ctrlKey: true }), false)).toBe(false)
  })

  it('不是回车 ⇒ 不拦', () => {
    expect(shouldDeferEnterToMenu({ ...enter(), key: 'a' }, true)).toBe(false)
  })

  it('输入法合成中 ⇒ 不拦（那是选词，不是菜单 / 提交）', () => {
    expect(shouldDeferEnterToMenu(enter({ ctrlKey: true }), true, true)).toBe(false)
  })
})

describe('接线：回车交给菜单的判定排在提交判定之前', () => {
  const body = (() => {
    const start = conversation.indexOf('function onEditorKeydown')
    expect(start, '找不到 onEditorKeydown').toBeGreaterThan(-1)
    return conversation.slice(start, conversation.indexOf('\n}', start))
  })()

  it('先问 shouldDeferEnterToMenu，命中就放行（不 preventDefault、不 submit）', () => {
    const deferAt = body.indexOf('shouldDeferEnterToMenu')
    const submitAt = body.indexOf('isSubmitShortcut')
    expect(deferAt).toBeGreaterThan(-1)
    expect(submitAt).toBeGreaterThan(-1)
    expect(deferAt).toBeLessThan(submitAt)
  })

  it('菜单状态来自编辑器的 menuOpen（不是自己去猜 DOM）', () => {
    expect(body).toContain('menuOpen')
    expect(conversation).toContain('menuOpen')
  })
})
