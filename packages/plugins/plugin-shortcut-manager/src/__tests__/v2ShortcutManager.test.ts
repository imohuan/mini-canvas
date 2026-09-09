import { describe, it, expect } from 'vitest'
import { CommandRegistry } from '@mini-canvas/canvas-core-v2'
import {
  buildV2HelpList,
  groupV2HelpList,
  v2GroupOf,
  findV2Conflicts,
  normalizeCombo,
  createV2ShortcutManager,
} from '../v2ShortcutManager'

function makeCommands() {
  const c = new CommandRegistry()
  c.register({ id: 'command:undo', title: '撤销', keys: ['mod+z'], order: 1, run: () => {} })
  c.register({ id: 'command:redo', title: '重做', keys: ['mod+shift+z'], order: 2, run: () => {} })
  c.register({ id: 'command:delete', title: '删除选中', keys: ['Delete', 'Backspace'], order: 3, run: () => {} })
  c.register({ id: 'node-find:open', title: '搜索节点', keys: ['mod+f'], areas: ['pane'], order: 30, run: () => {} })
  c.register({ id: 'no-key', title: '无键命令', order: 9, run: () => {} })
  return c
}

describe('v2GroupOf 分组语义', () => {
  it('撤销/删除/复制 → edit；搜索/聚焦 → view；布局/对齐 → canvas；其余 → plugin', () => {
    expect(v2GroupOf({ id: 'x', title: '撤销' })).toBe('edit')
    expect(v2GroupOf({ id: 'x', title: '搜索节点' })).toBe('view')
    expect(v2GroupOf({ id: 'x', title: '自动布局' })).toBe('canvas')
    expect(v2GroupOf({ id: 'x', title: '其它插件动作' })).toBe('plugin')
  })
})

describe('buildV2HelpList / groupV2HelpList', () => {
  it('只收带 keys 命令；多键拆多行', () => {
    const c = makeCommands()
    const list = buildV2HelpList(c.list())
    expect(list.some((i) => i.commandId === 'no-key')).toBe(false)
    expect(list.filter((i) => i.commandId === 'command:delete')).toHaveLength(2)
  })
  it('按 v1 组顺序输出', () => {
    const c = makeCommands()
    const groups = groupV2HelpList(buildV2HelpList(c.list()))
    const seq = groups.map((g) => g.group)
    const expectedOrder = ['system', 'edit', 'canvas', 'view', 'plugin'].filter((g) => seq.includes(g as never))
    expect(seq).toEqual(expectedOrder)
  })
})

describe('normalizeCombo / findV2Conflicts', () => {
  it('大小写与空格归一', () => {
    expect(normalizeCombo(' Ctrl + Z ')).toBe('ctrl+z')
  })
  it('同键位冲突检出', () => {
    const items = [
      { id: 'a:mod+f', commandId: 'a', command: 'A', keys: 'mod+f', group: 'plugin', priority: 1 },
      { id: 'b:mod+f', commandId: 'b', command: 'B', keys: 'mod+f', group: 'plugin', priority: 2 },
    ] as const
    const conflicts = findV2Conflicts(items as never)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].entries.map((e) => e.commandId)).toEqual(['a', 'b'])
  })
})

describe('createV2ShortcutManager 重映射', () => {
  it('remapCombo 替换单条键位且保留其它键；conflict 拒绝', () => {
    const c = makeCommands()
    const mgr = createV2ShortcutManager(c)
    // delete 有 Delete + Backspace → 把 Delete 换成 mod+del，Backspace 保留
    const r = mgr.remapCombo('command:delete', 'Delete', 'mod+del')
    expect(r.ok).toBe(true)
    const keys = c.get('command:delete')?.keys
    expect(keys).toEqual(expect.arrayContaining(['mod+del', 'Backspace']))
    expect(keys).toHaveLength(2)
  })
  it('把 mod+f 改成已占用键 → 冲突拒绝且不改', () => {
    const c = makeCommands()
    const mgr = createV2ShortcutManager(c)
    const r = mgr.remapCombo('command:undo', 'mod+z', 'mod+f')
    expect(r.ok).toBe(false)
    if (!r.ok && 'conflict' in r && r.conflict) {
      expect(r.conflict.entries.some((e) => e.commandId === 'node-find:open')).toBe(true)
    }
    expect(c.get('command:undo')?.keys).toEqual(['mod+z'])
  })
  it('resetDefaults 只还原 remap 过的命令', () => {
    const c = makeCommands()
    const mgr = createV2ShortcutManager(c)
    mgr.remapCombo('command:undo', 'mod+z', 'mod+u')
    expect(c.get('command:undo')?.keys).toEqual(['mod+u'])
    mgr.resetDefaults()
    expect(c.get('command:undo')?.keys).toEqual(['mod+z'])
    // 未 remap 的命令不受影响
    expect(c.get('command:redo')?.keys).toEqual(['mod+shift+z'])
  })
  it('exportKeymap 只导脏映射；loadKeymap 还原', () => {
    const c = makeCommands()
    const mgr = createV2ShortcutManager(c)
    mgr.remapCombo('command:redo', 'mod+shift+z', 'mod+y')
    const exported = mgr.exportKeymap()
    expect(exported['command:redo']).toBe('mod+y')
    expect(exported['command:undo']).toBeUndefined()
    // 新实例 loadKeymap 导入
    const c2 = makeCommands()
    const mgr2 = createV2ShortcutManager(c2)
    mgr2.loadKeymap(exported)
    expect(c2.get('command:redo')?.keys).toContain('mod+y')
  })
})
