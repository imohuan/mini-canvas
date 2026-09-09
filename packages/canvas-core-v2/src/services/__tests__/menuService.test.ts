import { describe, it, expect } from 'vitest'
import { createMenuService } from '../menuService'

function cmd(id: string, partial: Record<string, unknown> = {}) {
  return { id, ...partial } as { id: string; title?: string; areas?: string[]; group?: string; order?: number; keys?: string[]; icon?: string }
}

describe('MenuService 内核菜单聚合（G 项）', () => {
  it('pane 模式：新建节点区在前 + 命令按 组→order 排', () => {
    const svc = createMenuService(() => [
      cmd('clipboard:paste', { title: '粘贴', areas: ['pane'], group: 'clipboard', order: 20 }),
      cmd('multi-select:select-all', { title: '全选', areas: ['pane'], order: 10 }),
    ])
    const items = svc.menuFor('pane', [{ type: 'text', label: '文本' }, { type: 'image', label: '图片' }])
    expect(items.map((i) => i.id)).toEqual(['create-node:text', 'create-node:image', 'multi-select:select-all', 'clipboard:paste'])
    expect(items[0].kind).toBe('create-node')
  })
  it('区域过滤：node 只显 node 区命令；pane 区命令与无 areas 命令(纯快捷键)都不显示', () => {
    const svc = createMenuService(() => [
      cmd('context-menu:delete-node', { title: '删除节点', areas: ['node'] }),
      cmd('clipboard:paste', { title: '粘贴', areas: ['pane'] }),
      cmd('command:undo', { title: '撤销' }), // 无 areas = 纯快捷键，不进菜单
    ])
    const items = svc.menuFor('node', [])
    expect(items.map((i) => i.id)).toEqual(['context-menu:delete-node'])
    expect(items.some((i) => i.kind === 'create-node')).toBe(false)
  })
  it('无 areas 命令不进 pane 菜单（未声明 = 纯快捷键）', () => {
    const svc = createMenuService(() => [
      cmd('command:undo', { title: '撤销', keys: ['mod+z'] }),
      cmd('clipboard:paste', { title: '粘贴', areas: ['pane'] }),
    ])
    const items = svc.menuFor('pane', [])
    expect(items.map((i) => i.id)).toEqual(['clipboard:paste'])
  })
  it('edge 模式：只显 edge 区命令；删除类标 danger', () => {
    const svc = createMenuService(() => [
      cmd('context-menu:delete-edge', { title: '删除连线', areas: ['edge'] }),
      cmd('context-menu:delete-node', { areas: ['node'] }),
    ])
    const items = svc.menuFor('edge', [])
    expect(items.map((i) => i.id)).toEqual(['context-menu:delete-edge'])
    expect(items[0].danger).toBe(true)
  })
  it('每次现取命令表：注册新命令后立即出现在菜单（实时）', () => {
    let commands = [cmd('a', { areas: ['pane'] })]
    const svc = createMenuService(() => commands)
    expect(svc.menuFor('pane', []).map((i) => i.id)).toEqual(['a'])
    commands = [...commands, cmd('b', { areas: ['pane'] })]
    expect(svc.menuFor('pane', []).map((i) => i.id)).toEqual(['a', 'b'])
  })
  it('无命令 + 非 pane 返回空；未声明 order 排到声明者后（同组）', () => {
    const svc = createMenuService(() => [
      cmd('x', { title: 'X', areas: ['edge'] }),
    ])
    expect(svc.menuFor('node', [])).toEqual([])
    const svc2 = createMenuService(() => [
      cmd('del', { title: '删除', areas: ['node'], group: '节点' }),
      cmd('copy', { title: '复制', areas: ['node'], group: '节点', order: 10 }),
    ])
    expect(svc2.menuFor('node', []).map((i) => i.id)).toEqual(['copy', 'del'])
  })
})


