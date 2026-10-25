/**
 * 输入框提交键：默认 **Ctrl / Cmd + Enter**，可在全局设置里换成 Shift+Enter / Enter
 * （用户口径 2026-10-25）。
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
import { isSubmitShortcut, normalizeSubmitKeyMode, SUBMIT_KEY_MODES, loadSubmitKeyMode } from '../composerKeys'

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

describe('isSubmitShortcut：默认 Ctrl / Cmd + Enter 才算「提交」', () => {
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

  it('不再按「无修饰回车」提交（旧默认形态要显式选才生效）', () => {
    expect(isSubmitShortcut(key('Enter'))).toBe(false)
  })
})

describe('可配置：Ctrl+Enter / Shift+Enter / Enter 三选一', () => {
  it('选项列表就是这三种（设置页下拉的数据源）', () => {
    expect(SUBMIT_KEY_MODES.map((m) => m.value)).toEqual(['ctrl-enter', 'shift-enter', 'enter'])
    expect(SUBMIT_KEY_MODES.map((m) => m.label)).toEqual(['Ctrl + 回车', 'Shift + 回车', '回车'])
  })

  it('Ctrl+回车：只认带 Ctrl / Cmd 的回车', () => {
    expect(isSubmitShortcut(key('Enter', { ctrlKey: true }), 'ctrl-enter')).toBe(true)
    expect(isSubmitShortcut(key('Enter', { metaKey: true }), 'ctrl-enter')).toBe(true)
    expect(isSubmitShortcut(key('Enter'), 'ctrl-enter')).toBe(false)
    expect(isSubmitShortcut(key('Enter', { shiftKey: true }), 'ctrl-enter')).toBe(false)
  })

  it('Shift+回车：只认带 Shift 的回车（单独回车留给换行）', () => {
    expect(isSubmitShortcut(key('Enter', { shiftKey: true }), 'shift-enter')).toBe(true)
    expect(isSubmitShortcut(key('Enter'), 'shift-enter')).toBe(false)
    expect(isSubmitShortcut(key('Enter', { ctrlKey: true }), 'shift-enter')).toBe(false)
  })

  it('回车：裸回车就提交（带 Ctrl / Shift 的不算，留给换行 / 其它习惯）', () => {
    expect(isSubmitShortcut(key('Enter'), 'enter')).toBe(true)
    expect(isSubmitShortcut(key('Enter', { shiftKey: true }), 'enter')).toBe(false)
    expect(isSubmitShortcut(key('Enter', { ctrlKey: true }), 'enter')).toBe(false)
  })

  it('任何模式下输入法合成中都不提交', () => {
    for (const m of ['ctrl-enter', 'shift-enter', 'enter'] as const) {
      expect(isSubmitShortcut(key('Enter', { ctrlKey: true, shiftKey: true, isComposing: true }), m)).toBe(false)
    }
  })

  it('坏值 / 缺省一律回落默认 Ctrl+Enter', () => {
    expect(normalizeSubmitKeyMode(undefined)).toBe('ctrl-enter')
    expect(normalizeSubmitKeyMode('')).toBe('ctrl-enter')
    expect(normalizeSubmitKeyMode('bogus')).toBe('ctrl-enter')
    expect(normalizeSubmitKeyMode('enter')).toBe('enter')
    expect(normalizeSubmitKeyMode('shift-enter')).toBe('shift-enter')
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

  it('提交键取自全局设置（不是写死的常量）', () => {
    const start = conversation.indexOf('function onEditorKeydown')
    const body = conversation.slice(start, conversation.indexOf('\n}', start))
    expect(body).toContain('submitKeyMode')
  })
})

describe('读取设置：从 config 桶拿「发送键」', () => {
  it('没存过 / 坏值 / 后台挂了 ⇒ 默认 Ctrl+回车（不抛）', async () => {
    const ok = (values: Record<string, unknown>) => ({
      ok: true,
      json: async () => ({ values }),
    }) as unknown as Response

    expect(await loadSubmitKeyMode({ fetchImpl: async () => ok({}) })).toBe('ctrl-enter')
    expect(await loadSubmitKeyMode({ fetchImpl: async () => ok({ agentComposerPrefs: { submitKeyMode: 'x' } }) })).toBe('ctrl-enter')
    expect(await loadSubmitKeyMode({ fetchImpl: async () => { throw new Error('offline') } })).toBe('ctrl-enter')
  })

  it('存了 shift-enter / enter ⇒ 原样读回', async () => {
    const ok = (values: Record<string, unknown>) => ({ ok: true, json: async () => ({ values }) }) as unknown as Response
    expect(await loadSubmitKeyMode({ fetchImpl: async () => ok({ agentComposerPrefs: { submitKeyMode: 'shift-enter' } }) })).toBe('shift-enter')
    expect(await loadSubmitKeyMode({ fetchImpl: async () => ok({ agentComposerPrefs: { submitKeyMode: 'enter' } }) })).toBe('enter')
  })
})
