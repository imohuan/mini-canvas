import { describe, expect, it } from 'vitest'
import { buildShortcutHelpList, toGroupedRows } from '../shortcutGroups'

const cmds = [
  { id: 'command:undo', title: '撤销', keys: ['mod+z'], order: 1, areas: ['pane'] },
  { id: 'command:redo', title: '重做', keys: ['mod+shift+z'], order: 2, areas: ['pane'] },
  { id: 'command:delete', title: '删除选中', keys: ['Delete', 'Backspace'], order: 3, areas: ['pane'] },
  { id: 'no-key-cmd', title: '无键命令', order: 0 },
  { id: 'node-find:open', title: '查找节点', keys: ['mod+f'], group: '视图', order: 1 },
]

describe('buildShortcutHelpList', () => {
  it('只收带 keys 的命令；无 keys 跳过', () => {
    const list = buildShortcutHelpList(cmds)
    expect(list.some((i) => i.id.startsWith('no-key'))).toBe(false)
  })

  it('一条命令多组 keys → 展开多条', () => {
    const list = buildShortcutHelpList(cmds)
    expect(list.filter((i) => i.label === '删除选中')).toHaveLength(2)
  })

  it('归组：显式 group 优先；areas pane → 画布', () => {
    const list = buildShortcutHelpList(cmds)
    const undo = list.find((i) => i.id === 'command:undo:mod+z')
    const find = list.find((i) => i.id === 'node-find:open:mod+f')
    expect(undo?.group).toBe('画布')
    expect(find?.group).toBe('视图')
  })

  it('排序：分组固定顺序内按 order 升序', () => {
    const list = buildShortcutHelpList(cmds)
    const labels = list.map((i) => i.label)
    expect(labels.indexOf('撤销')).toBeLessThan(labels.indexOf('重做'))
  })
})

describe('toGroupedRows', () => {
  it('组头只在组变化时插入一次', () => {
    const list = buildShortcutHelpList(cmds)
    const rows = toGroupedRows(list)
    const groups = rows.filter((r) => r.kind === 'group')
    expect(groups.length).toBeGreaterThanOrEqual(1)
    // 连续项之间无重复组头
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].kind === 'group') expect(rows[i - 1].kind).not.toBe('group')
    }
  })
})
