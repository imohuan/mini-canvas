import { describe, it, expect } from 'vitest'
import { shortcutText } from '../shortcutText'

describe('shortcutText（右键菜单快捷键可读化）', () => {
  it('mod → Ctrl/⌘ 平台键；单字母大写', () => {
    const t = shortcutText(['mod+z'])
    expect(t).toMatch(/^(Ctrl|⌘)\+Z$/)
  })
  it('组合键逐段可读化', () => {
    const t = shortcutText(['mod+shift+z'])
    expect(t).toMatch(/^(Ctrl|⌘)\+Shift\+Z$/)
  })
  it('多条 keys 用 / 分隔', () => {
    expect(shortcutText(['Delete', 'Backspace'])).toBe('Del / ⌫')
  })
  it('空/缺省返回空串', () => {
    expect(shortcutText(undefined)).toBe('')
    expect(shortcutText([])).toBe('')
  })
  it('普通键可读化', () => {
    expect(shortcutText(['Escape'])).toBe('Esc')
    expect(shortcutText(['ArrowLeft'])).toBe('←')
  })
})
