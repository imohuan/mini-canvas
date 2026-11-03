/**
 * 帮助面板状态的时序与隔离。
 *
 * 拆分时曾把 `useShortcutHelpPanel` 的状态写在**模块顶层**：本文件随 ShortcutHelpPanel.vue
 * 一起被 import，那一刻 `apply()` 还没跑，`getShortcutManager()` 是 undefined，
 * 于是列表被固化成空、之后再也不刷新（面板第一次打开是白板）。
 * 同时 searchQuery / remappingId 成了所有实例共享的单例。
 * 这两条都在这份测试里钉住。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createV2ShortcutManager, type V2ShortcutManager } from '../v2ShortcutManager'
import { setShortcutManager } from '../shortcutState'
import { useShortcutHelpPanel } from '../shortcut-help-panel/useShortcutHelpPanel'

const commands = [
  { id: 'command:delete', title: '删除选中', keys: ['Delete', 'Backspace'] },
  { id: 'command:undo', title: '撤销', keys: ['mod+z'] },
]

function install(): V2ShortcutManager {
  const manager = createV2ShortcutManager({
    list: () => commands,
  } as never) as V2ShortcutManager
  setShortcutManager(manager)
  return manager
}

afterEach(() => {
  // 复位成"apply 之前"的状态，避免污染其它用例
  setShortcutManager(undefined as unknown as V2ShortcutManager)
})

describe('帮助面板状态', () => {
  it('apply 之后创建的面板能拿到列表与冲突（不再是空列表）', () => {
    install()
    const panel = useShortcutHelpPanel()
    expect(panel.filteredHelpList.value.length).toBeGreaterThan(0)
    const total = panel.filteredHelpList.value.reduce((n, g) => n + g.items.length, 0)
    // 两个命令共 3 个键位，每个键位一行
    expect(total).toBe(3)
  })

  it('每个实例各有一份搜索词与展开行，互不影响', () => {
    install()
    const a = useShortcutHelpPanel()
    const b = useShortcutHelpPanel()
    a.searchQuery.value = 'undo'
    a.openRemap({ id: 'x' } as never)
    expect(b.searchQuery.value).toBe('')
    expect(b.remappingId.value).toBeNull()
    expect(a.searchQuery.value).toBe('undo')
  })

  it('apply 之前创建的面板不会抛错，只是列表为空', () => {
    setShortcutManager(undefined as unknown as V2ShortcutManager)
    expect(() => useShortcutHelpPanel()).not.toThrow()
    expect(useShortcutHelpPanel().filteredHelpList.value).toEqual([])
  })
})
