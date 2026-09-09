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
  it('create-node:text 给文本图标与描述', () => {
    const [it] = enrichMenuItems([
      item({ id: 'create-node:text', label: '文本', kind: 'create-node', nodeType: 'text' }),
    ])
    expect(it.icon).toContain('<svg')
    expect(it.description).toContain('文本')
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
})
