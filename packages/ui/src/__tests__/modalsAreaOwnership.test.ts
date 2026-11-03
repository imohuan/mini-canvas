/**
 * 浮层归属：每个弹窗只允许由 ModalsArea 渲染一次。
 *
 * 拆分 HistoryModal 时曾把 ShortcutModal 与 DirectorSettingsDialog 的标签一起留在里面，
 * 而 ModalsArea 也在渲染它们 —— 于是快捷键面板和 Director 设置会被挂两遍。
 * 未注册时表现为 Vue「Failed to resolve component」警告，注册后就是两张弹窗叠在一起。
 * 这里按「谁拥有这个组件」钉住结构，避免以后再被搬回去。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

const modalsArea = read('../components/areas/ModalsArea.vue')
const historyModal = read('../components/areas/modals-area/HistoryModal.vue')

describe('浮层归属：每个弹窗只由一个组件渲染', () => {
  it('ModalsArea 拥有快捷键、生成历史、Director 三块', () => {
    expect(modalsArea).toMatch(/<ShortcutModal\b/)
    expect(modalsArea).toMatch(/<HistoryModal\b/)
    expect(modalsArea).toMatch(/<DirectorSettingsDialog\b/)
  })

  it('HistoryModal 只渲染历史相关节点，不重复挂兄弟弹窗', () => {
    expect(historyModal).not.toMatch(/<ShortcutModal\b/)
    expect(historyModal).not.toMatch(/<DirectorSettingsDialog\b/)
    // 它自己的两个弹窗要在
    expect(historyModal).toMatch(/<AppDialog\b/)
    expect(historyModal).toMatch(/<HistoryDetailDialog\b/)
  })
})
