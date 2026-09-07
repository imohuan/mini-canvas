/**
 * CommandDef.keys → 键盘事件匹配 —— 纯函数单测（渲染层绑键用）。
 */
import { describe, it, expect } from 'vitest'
import { commandMatchesKeys, findCommandByKeys } from '../command'

type KE = { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean }

describe('commandMatchesKeys（命令快捷键匹配）', () => {
  it('单键匹配（大小写不敏感）：Delete/Backspace/Escape', () => {
    expect(commandMatchesKeys(['Delete'], { key: 'Delete' })).toBe(true)
    expect(commandMatchesKeys(['Delete'], { key: 'delete' })).toBe(true)
    expect(commandMatchesKeys(['Backspace'], { key: 'Backspace' })).toBe(true)
    expect(commandMatchesKeys(['Escape'], { key: 'Escape' })).toBe(true)
    expect(commandMatchesKeys(['Escape'], { key: 'Delete' })).toBe(false)
  })

  it('ctrl+键 组合匹配', () => {
    expect(commandMatchesKeys(['ctrl+a'], { key: 'a', ctrlKey: true })).toBe(true)
    expect(commandMatchesKeys(['ctrl+a'], { key: 'a' })).toBe(false) // 没按 ctrl
    expect(commandMatchesKeys(['ctrl+a'], { key: 'a', metaKey: true })).toBe(false) // meta 不算 ctrl
    expect(commandMatchesKeys(['ctrl+shift+z'], { key: 'z', ctrlKey: true, shiftKey: true })).toBe(true)
  })

  it('mod=ctrl 或 meta 任一（跨平台）', () => {
    expect(commandMatchesKeys(['mod+a'], { key: 'a', ctrlKey: true })).toBe(true)
    expect(commandMatchesKeys(['mod+a'], { key: 'a', metaKey: true })).toBe(true)
    expect(commandMatchesKeys(['mod+a'], { key: 'a' })).toBe(false)
  })

  it('多组 keys：任一匹配即 true', () => {
    expect(commandMatchesKeys(['Delete', 'Backspace'], { key: 'Backspace' })).toBe(true)
    expect(commandMatchesKeys(['Delete', 'Backspace'], { key: 'Delete' })).toBe(true)
    expect(commandMatchesKeys(['Delete', 'Backspace'], { key: 'x' })).toBe(false)
  })

  it('无 keys 或空数组 → 永不匹配', () => {
    expect(commandMatchesKeys(undefined, { key: 'a' })).toBe(false)
    expect(commandMatchesKeys([], { key: 'a' })).toBe(false)
  })
})

describe('findCommandByKeys（渲染层 keydown 分发扫描）', () => {
  const cmds = [
    { id: 'a', keys: ['mod+a'] },
    { id: 'del', keys: ['Delete', 'Backspace'] },
    { id: 'plain' }, // 无 keys → 跳过
  ]

  it('命中 keys 返回对应命令（按顺序先到先得）', () => {
    expect(findCommandByKeys(cmds, { key: 'a', ctrlKey: true })?.id).toBe('a')
    expect(findCommandByKeys(cmds, { key: 'Delete' })?.id).toBe('del')
    expect(findCommandByKeys(cmds, { key: 'Backspace' })?.id).toBe('del')
  })

  it('无命中返回 undefined', () => {
    expect(findCommandByKeys(cmds, { key: 'x' })).toBeUndefined()
    expect(findCommandByKeys([], { key: 'a', ctrlKey: true })).toBeUndefined()
  })
})


