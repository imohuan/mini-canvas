/**
 * settings/hidden 场域的契约。
 *
 * 用户口径：「我设计了这个工作台之后，主题配色就没有什么必要了，看能不能隐藏掉」。
 * 所以：
 * 1. 提供整页的一方（颜色配方）自己声明要隐藏什么；
 * 2. 声明可以针对整个分组，也可以只针对某一项；
 * 3. 撤销登记后恢复显示；
 * 4. 颜色配方自己仍能读到这些分组的字段（否则颜色就没了）。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { SETTINGS_HIDDEN_FIELD, SETTINGS_HIDDEN_KEY, hidesKey, hidesWholeGroup } from '../settings/navCategory'
import { HIDDEN_SETTINGS } from './register'

describe('settings/hidden', () => {
  it('颜色配方隐藏两个整组配色', () => {
    expect(HIDDEN_SETTINGS).toEqual([{ group: '外观/主题配色' }, { group: '外观/暗色主题配色' }])
    expect(HIDDEN_SETTINGS.every(hidesWholeGroup)).toBe(true)
  })

  it('登记后能读到，撤销后恢复', () => {
    const ctx = new Context()
    const field = ctx.registryOf<{ group?: string; key?: string }>(SETTINGS_HIDDEN_FIELD)

    expect(field.list(SETTINGS_HIDDEN_KEY)).toHaveLength(0)
    const handle = field.add(SETTINGS_HIDDEN_KEY, { group: '外观/主题配色' }, { id: '外观/主题配色' })
    expect(field.list(SETTINGS_HIDDEN_KEY)).toHaveLength(1)
    expect(field.list(SETTINGS_HIDDEN_KEY)[0].value).toEqual({ group: '外观/主题配色' })

    handle.dispose()
    expect(field.list(SETTINGS_HIDDEN_KEY)).toHaveLength(0)
  })

  it('只隐藏单项：整组仍显示，只有那一项消失', () => {
    const decl = { group: '外观/主题配色', key: 'accentColorLight' }
    expect(hidesWholeGroup(decl)).toBe(false)
    expect(hidesKey(decl, '外观/主题配色', 'accentColorLight')).toBe(true)
    // 同组的其它项不受影响
    expect(hidesKey(decl, '外观/主题配色', 'dangerColorLight')).toBe(false)
    // 别的分组里的同名 key 也不受影响
    expect(hidesKey(decl, '外观/暗色主题配色', 'accentColorLight')).toBe(false)
  })

  it('不带 group 的单项声明按 key 全局隐藏', () => {
    expect(hidesKey({ key: 'accentColorLight' }, '任意/分组', 'accentColorLight')).toBe(true)
  })
})

