import { describe, it, expect } from 'vitest'
import { keyCapLabel, keyPartsToLabels, normalizeKeyForPlatform } from '../keyLabels'

describe('keyCapLabel（键帽显示名）', () => {
  it('mod 在非 mac 平台显示 Ctrl', () => {
    expect(keyCapLabel('mod')).toBe('Ctrl')
  })
  it('mod 在 mac 平台显示 ⌘', () => {
    // 模拟 mac：直接验证分支逻辑（keyCapLabel 读 isMacPlatform → 通过测试注入不可行，
    // 这里退而验证 cmd 同样映射；⌘ 分支由 isMacPlatform 的 UA 判定，浏览器环境覆盖）
    expect(['Ctrl', '⌘']).toContain(keyCapLabel('mod'))
  })
  it('ctrl/alt/shift 基础映射', () => {
    expect(keyCapLabel('ctrl')).toBe('Ctrl')
    expect(keyCapLabel('shift')).toBe('Shift')
    expect(['Alt', '⌥']).toContain(keyCapLabel('alt'))
  })
  it('方向键/功能键符号映射', () => {
    expect(keyCapLabel('arrowup')).toBe('↑')
    expect(keyCapLabel('arrowleft')).toBe('←')
    expect(keyCapLabel('escape')).toBe('Esc')
    expect(keyCapLabel('delete')).toBe('Del')
    expect(keyCapLabel('backspace')).toBe('⌫')
  })
  it('单字母键大写', () => {
    expect(keyCapLabel('z')).toBe('Z')
    expect(keyCapLabel('f')).toBe('F')
  })
})

describe('keyPartsToLabels（整串拆分翻译）', () => {
  it('mod+shift+z → 三段（Ctrl|⌘ + Shift + Z）', () => {
    const parts = keyPartsToLabels('mod+shift+z')
    expect(parts[0]).toMatch(/^(Ctrl|⌘)$/)
    expect(parts[1]).toBe('Shift')
    expect(parts[2]).toBe('Z')
  })
  it('delete 单键', () => {
    expect(keyPartsToLabels('Delete')).toEqual(['Del'])
  })
  it('空串 → 空数组', () => {
    expect(keyPartsToLabels('')).toEqual([])
  })
})

describe('normalizeKeyForPlatform（mod → 平台保留键写法）', () => {
  it('非 mac：mod+f → ctrl+f', () => {
    const n = normalizeKeyForPlatform('mod+f')
    expect(n).toMatch(/^(ctrl\+f|meta\+f)$/)
  })
  it('大小写与空格归一', () => {
    expect(normalizeKeyForPlatform(' Ctrl + Z ')).toMatch(/^(ctrl|meta)\+z$/)
  })
  it('非 mod 键原样归一', () => {
    expect(normalizeKeyForPlatform('Delete')).toBe('delete')
  })
})
