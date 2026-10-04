/**
 * themeModeSettings —— 「主题模式」作为渲染层配置的行为锁。
 *
 * 用户报的现象：点右上角调色板切到亮色，刷新又回到暗色（默认写死 dark、且没进配置）。
 * 这里用真 store + 假 DOM 根，钉住三件事：
 *  1. 声明进 settings（key / 分组 / 默认），设置面板才长得出这一项；
 *  2. 落值把亮/暗写进 <html class="dark">（消费方靠它切主题）；
 *  3. 订阅 settings → 改设置立刻落 DOM，且不误触别的键。
 */
import { describe, it, expect } from 'vitest'
import { SettingsStore } from '@mini-canvas/kernel'
import {
  THEME_MODE_KEY,
  THEME_MODE_GROUP,
  THEME_MODE_DEFAULT,
  resolveThemeMode,
  applyThemeMode,
  defineThemeModeSetting,
  installThemeMode,
} from '../themeModeSettings'

/** 假 DOM 元素：只记账 class 与 data 属性（Node 环境无 document） */
function fakeRoot() {
  const classes = new Set<string>()
  const dataset: Record<string, string> = {}
  return {
    classes,
    dataset,
    classList: {
      toggle: (name: string, on: boolean) => void (on ? classes.add(name) : classes.delete(name)),
      contains: (name: string) => classes.has(name),
    },
  } as unknown as HTMLElement
}

describe('resolveThemeMode', () => {
  it('只认 light / dark，其它（缺省 / 坏值）回落默认暗色', () => {
    expect(resolveThemeMode(() => 'light')).toBe('light')
    expect(resolveThemeMode(() => 'dark')).toBe('dark')
    expect(resolveThemeMode(() => undefined)).toBe(THEME_MODE_DEFAULT)
    expect(resolveThemeMode(() => 'blue')).toBe(THEME_MODE_DEFAULT)
  })
})

describe('applyThemeMode', () => {
  it('暗色加 dark class + data-canvas-theme；亮色去掉 class', () => {
    const el = fakeRoot()
    expect(applyThemeMode('dark', el)).toBe(true)
    expect(el.classList.contains('dark')).toBe(true)
    expect(el.dataset.canvasTheme).toBe('dark')

    applyThemeMode('light', el)
    expect(el.classList.contains('dark')).toBe(false)
    expect(el.dataset.canvasTheme).toBe('light')
  })
})

describe('defineThemeModeSetting', () => {
  it('登记进 settings（分组正确、默认暗色）—— 设置面板才看得到这一项', () => {
    const s = new SettingsStore()
    expect(defineThemeModeSetting(s)).toBe(true)
    expect(s.groups()).toContain(THEME_MODE_GROUP)
    expect(s.get(THEME_MODE_KEY)).toBe(THEME_MODE_DEFAULT)
  })

  it('重复声明幂等（多宿主 / 二次 boot 不撞 key）', () => {
    const s = new SettingsStore()
    defineThemeModeSetting(s)
    expect(defineThemeModeSetting(s)).toBe(false)
  })
})

describe('installThemeMode', () => {
  it('启动即按当前值落一次 DOM', () => {
    const s = new SettingsStore()
    defineThemeModeSetting(s)
    const el = fakeRoot()
    const dispose = installThemeMode(s, el)
    expect(el.classList.contains('dark')).toBe(true) // 默认暗色
    dispose()
  })

  it('改设置立刻落 DOM；只认自己的键', () => {
    const s = new SettingsStore()
    defineThemeModeSetting(s)
    s.define('别的组', { other: { type: 'boolean', default: false } }, 'other')
    const el = fakeRoot()
    const dispose = installThemeMode(s, el)

    s.set(THEME_MODE_KEY, 'light')
    expect(el.classList.contains('dark')).toBe(false)
    expect(el.dataset.canvasTheme).toBe('light')

    // 别的键变化不误触（el 状态保持）
    s.set('other', true)
    expect(el.dataset.canvasTheme).toBe('light')
    dispose()
  })

  it('dispose 后不再跟随设置变化', () => {
    const s = new SettingsStore()
    defineThemeModeSetting(s)
    const el = fakeRoot()
    const dispose = installThemeMode(s, el)
    dispose()
    s.set(THEME_MODE_KEY, 'light')
    expect(el.classList.contains('dark')).toBe(true) // 仍是默认暗色（未跟随）
  })
})
