import { describe, expect, it } from 'vitest'
import {
  buildMenuItems,
  commandVisibleInMode,
  sortMenuItems,
  type MenuCommandLike,
  type MenuNodeTypeLike,
} from '../menuBuilder'

const nodeTypes: MenuNodeTypeLike[] = [
  { type: 'text', label: '文本' },
  { type: 'image', label: '图片' },
]

/** 造命令 */
function cmd(partial: Partial<MenuCommandLike> & { id: string }): MenuCommandLike {
  return partial
}

describe('commandVisibleInMode', () => {
  it('areas 未声明或空 = 通用命令，所有模式可见', () => {
    expect(commandVisibleInMode(cmd({ id: 'a' }), 'pane')).toBe(true)
    expect(commandVisibleInMode(cmd({ id: 'a', areas: [] }), 'node')).toBe(true)
    expect(commandVisibleInMode(cmd({ id: 'a', areas: [] }), 'edge')).toBe(true)
  })

  it('areas 声明了 → 仅当包含当前 mode 可见', () => {
    const c = cmd({ id: 'a', areas: ['node'] })
    expect(commandVisibleInMode(c, 'node')).toBe(true)
    expect(commandVisibleInMode(c, 'pane')).toBe(false)
    expect(commandVisibleInMode(c, 'edge')).toBe(false)
  })
})

describe('buildMenuItems', () => {
  it('pane 模式：新建节点区在前，再排 pane/通用命令', () => {
    const commands = [
      cmd({ id: 'multi-select:select-all', title: '全选', areas: ['pane'], order: 10 }),
      cmd({ id: 'clipboard:paste', title: '粘贴', areas: ['pane'], group: 'clipboard', order: 20 }),
    ]
    const items = buildMenuItems('pane', commands, nodeTypes)
    expect(items.map((i) => i.id)).toEqual([
      'create-node:text',
      'create-node:image',
      'multi-select:select-all',
      'clipboard:paste',
    ])
    expect(items[0].kind).toBe('create-node')
    expect(items[0].nodeType).toBe('text')
    expect(items[3].kind).toBe('command')
    expect(items[3].commandId).toBe('clipboard:paste')
  })

  it('node 模式：只显示 node 区命令，不显示新建节点区', () => {
    const commands = [
      cmd({ id: 'context-menu:delete-node', title: '删除节点', areas: ['node'], order: 10 }),
      cmd({ id: 'clipboard:paste', title: '粘贴', areas: ['pane'], group: 'clipboard' }),
      cmd({ id: 'align-arrange:align-left', title: '左对齐', group: 'align-arrange' }),
    ]
    const items = buildMenuItems('node', commands, nodeTypes)
    // pane 区命令不显示；无 areas 的通用命令显示；node 区命令显示
    expect(items.map((i) => i.id)).toContain('context-menu:delete-node')
    expect(items.map((i) => i.id)).toContain('align-arrange:align-left')
    expect(items.map((i) => i.id)).not.toContain('clipboard:paste')
    expect(items.some((i) => i.kind === 'create-node')).toBe(false)
  })

  it('edge 模式：只显示 edge 区命令', () => {
    const commands = [
      cmd({ id: 'context-menu:delete-edge', title: '删除连线', areas: ['edge'], order: 10 }),
      cmd({ id: 'context-menu:delete-node', title: '删除节点', areas: ['node'] }),
    ]
    const items = buildMenuItems('edge', commands, nodeTypes)
    expect(items.map((i) => i.id)).toEqual(['context-menu:delete-edge'])
  })

  it('删除类命令标 danger', () => {
    const commands = [cmd({ id: 'context-menu:delete-edge', title: '删除连线', areas: ['edge'] })]
    const items = buildMenuItems('edge', commands, nodeTypes)
    expect(items[0].danger).toBe(true)
  })

  it('无可见命令 + 非 pane → 返回空（浮层不弹）', () => {
    const commands = [cmd({ id: 'x', title: 'X', areas: ['pane'] })]
    expect(buildMenuItems('edge', commands, nodeTypes)).toEqual([])
  })

  it('命令未声明 order → 排在声明了 order 的后面（同组）', () => {
    const commands = [
      cmd({ id: 'node:delete', title: '删除', areas: ['node'], group: '节点' }),
      cmd({ id: 'node:duplicate', title: '复制一份', areas: ['node'], group: '节点', order: 20 }),
      cmd({ id: 'node:copy', title: '复制', areas: ['node'], group: '节点', order: 10 }),
    ]
    const items = buildMenuItems('node', commands, nodeTypes)
    expect(items.map((i) => i.id)).toEqual(['node:copy', 'node:duplicate', 'node:delete'])
  })
})

describe('sortMenuItems', () => {
  it('按组优先级升序、组内 order 升序排序', () => {
    const items = sortMenuItems([
      { id: 'b', label: 'B', group: '操作', order: 2, kind: 'command', commandId: 'b' },
      { id: 'a', label: 'A', group: '操作', order: 1, kind: 'command', commandId: 'a' },
      { id: 'c', label: 'C', group: 'create', order: 0, kind: 'create-node', nodeType: 'text' },
    ])
    expect(items.map((i) => i.id)).toEqual(['c', 'a', 'b'])
  })
})
