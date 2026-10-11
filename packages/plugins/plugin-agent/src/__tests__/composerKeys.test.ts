/**
 * 输入框提交键：**Ctrl / Cmd + Enter 才提交**，单独 Enter 只换行（用户口径 2026-10-11）。
 *
 * 为什么单测：这条口径**改过**（原来是 Enter 直接发送）。而「按错一下就把半截话发出去」
 * 代价很高，所以分成两头锁：
 *   ① 能真跑的判定用纯函数真跑（含输入法合成、加 Shift 等边角）；
 *   ② 只能看源码的接线盯源码（编辑器是不是真的挂了这个判定，而不是又退回 Enter 直发）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSubmitShortcut } from '../composerKeys'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const conversation = readFileSync(path.resolve(HERE, '../components/AgentConversation.vue'), 'utf8')

/** 造一个按键事件：只给判定用到的字段，够纯函数读就行 */
const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; isComposing: boolean }> = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrlKey,
  metaKey: !!mods.metaKey,
  shiftKey: !!mods.shiftKey,
  isComposing: !!mods.isComposing,
})

describe('isSubmitShortcut：什么才算「提交」', () => {
  it('Ctrl+Enter ⇒ 提交', () => {
    expect(isSubmitShortcut(key('Enter', { ctrlKey: true }))).toBe(true)
  })

  it('Cmd+Enter（macOS）⇒ 提交', () => {
    expect(isSubmitShortcut(key('Enter', { metaKey: true }))).toBe(true)
  })

  it('单独 Enter ⇒ **不**提交（留给换行）', () => {
    expect(isSubmitShortcut(key('Enter'))).toBe(false)
  })

  it('Shift+Enter ⇒ 不提交（软换行）', () => {
    expect(isSubmitShortcut(key('Enter', { shiftKey: true }))).toBe(false)
  })

  it('其它键（哪怕按着 Ctrl）⇒ 不提交', () => {
    expect(isSubmitShortcut(key('a', { ctrlKey: true }))).toBe(false)
    expect(isSubmitShortcut(key('Escape', { ctrlKey: true }))).toBe(false)
  })

  it('输入法合成中 ⇒ 不提交（中文打字时的回车只是在选词）', () => {
    expect(isSubmitShortcut(key('Enter', { ctrlKey: true, isComposing: true }))).toBe(false)
  })
})

describe('模板接线：编辑器接的是这条判定', () => {
  /** 输入框那段模板：`<ProseMirrorEditor` 到它自己的 `/>` */
  const editorBlock = () => {
    const start = conversation.indexOf('<ProseMirrorEditor')
    return conversation.slice(start, conversation.indexOf('/>', start))
  }

  it('不再用「单独 Enter 就提交」的老写法', () => {
    expect(conversation).not.toContain('@keydown.enter.exact.prevent="submit"')
    expect(editorBlock()).not.toContain('keydown.enter')
  })

  it('编辑器挂 onEditorKeydown 这一个入口', () => {
    expect(editorBlock()).toContain('@keydown="onEditorKeydown"')
  })

  it('该入口先问 isSubmitShortcut，命中才 preventDefault + submit', () => {
    const start = conversation.indexOf('function onEditorKeydown')
    expect(start, '找不到 onEditorKeydown 的实现').toBeGreaterThan(-1)
    const body = conversation.slice(start, conversation.indexOf('\n}', start))
    expect(body).toContain('isSubmitShortcut')
    expect(body).toContain('preventDefault')
    expect(body).toContain('submit()')
  })
})
