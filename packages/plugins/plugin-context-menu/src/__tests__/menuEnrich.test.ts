import { describe, it, expect } from 'vitest'
import { enrichMenuItems } from '../menuEnrich'
import type { ContextMenuItem } from '../menuBuilder'

function item(partial: Partial<ContextMenuItem> & { id: string; label: string }): ContextMenuItem {
  return {
    group: 'x',
    order: 0,
    kind: 'command',
    ...partial,
  } as ContextMenuItem
}

describe('enrichMenuItems（图标 + hover 描述补齐）', () => {
  it('create-node 项未注册图标时保底有图标（描述不在这里猜，由节点类型声明）', () => {
    const [it] = enrichMenuItems([
      item({ id: 'create-node:text', label: '文本', kind: 'create-node', nodeType: 'text' }),
    ])
    expect(it.icon).toContain('<svg')
    // 本层不再有 "type 名字 → 文案" 对照表；声明缺失时给空（行保持单行高）
    expect(it.description).toBe('')
  })

  it('create-node 项的描述原样保留（来自节点类型注册声明）', () => {
    const [it] = enrichMenuItems([
      item({
        id: 'create-node:3d-preview',
        label: '3D 预览',
        kind: 'create-node',
        nodeType: '3d-preview',
        description: '在画布中添加一个 3D 全景节点',
      }),
    ])
    expect(it.description).toBe('在画布中添加一个 3D 全景节点')
  })
  it('delete 命令给垃圾桶图标与红危险态', () => {
    const [it] = enrichMenuItems([
      item({ id: 'context-menu:delete-node', label: '删除节点', commandId: 'context-menu:delete-node', danger: true }),
    ])
    expect(it.icon).toContain('M3 6h18')
    expect(it.description).toContain('连线')
  })
  it('copy/duplicate/paste 图标区分', () => {
    const out = enrichMenuItems([
      item({ id: 'clipboard:copy', label: '复制', commandId: 'clipboard:copy' }),
      item({ id: 'clipboard:duplicate', label: '复制一份', commandId: 'clipboard:duplicate' }),
      item({ id: 'clipboard:paste', label: '粘贴', commandId: 'clipboard:paste' }),
    ])
    expect(out[0].icon).not.toEqual(out[1].icon)
    expect(out[1].icon).not.toEqual(out[2].icon)
  })
  it('未知命令给默认图标与空描述（仍保持 icon 恒在）', () => {
    const [it] = enrichMenuItems([item({ id: 'x:y', label: '未知', commandId: 'x:y' })])
    expect(it.icon).toContain('<svg')
    expect(it.description).toBe('')
  })

  it('注册的图标优先于插件内置猜测', () => {
    const SvgIcon = '<svg viewBox="0 0 24 24" data-custom="1"></svg>'
    const [it] = enrichMenuItems([
      item({ id: 'create-node:text', label: '文本', kind: 'create-node', nodeType: 'text', icon: SvgIcon }),
    ])
    expect(it.icon).toBe(SvgIcon)
  })

  it('组件图标原样透传（不被替换成内置 svg）', () => {
    const CompIcon = { name: 'FakeIcon', render: () => null }
    const [it] = enrichMenuItems([
      item({ id: 'create-node:weird', label: '怪节点', kind: 'create-node', nodeType: 'weird', icon: CompIcon }),
    ])
    expect(it.icon).toBe(CompIcon)
  })

  it('未注册图标的节点类型给 default 占位（图标列恒在，不按名字猜）', () => {
    const [it] = enrichMenuItems([
      item({ id: 'create-node:text', label: '文本', kind: 'create-node', nodeType: 'text' }),
    ])
    expect(it.icon).toContain('<svg')
    expect(it.icon).not.toContain('M4 7V5h16v2')
  })
})
