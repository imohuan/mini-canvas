/**
 * `resource-chip--editable` 必须与注册表对齐（用户 2026-11-07 真机反馈）。
 *
 * 现象：hover 标签时预览框出现了（说明事件绑上了），但左侧图标没换成铅笔 ——
 * 实际是标签 DOM 上缺 `resource-chip--editable` 类，hover 规则整个不命中。
 * 这个类由 toDOM 补，但标签会被频繁重建，个别路径漏掉。
 * 修法：在每次绑定事件的收口处（applyChipEditingState）按注册表再对齐一次。
 */
// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { applyChipEditingState, setChipEditing } from '../editor/chipDom'
import { registerItem, itemRegistry } from '../editor/chipRegistry'

function chip(id: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'resource-node resource-chip'
  el.setAttribute('data-id', id)
  return el
}

describe('标签可编辑态与注册表对齐', () => {
  beforeEach(() => {
    itemRegistry.clear()
    setChipEditing('', false)
  })

  it('注册表里有 onIconClick → 补上 --editable（hover 才会换铅笔）', () => {
    registerItem({ id: 'ref-node:a', name: '视频 1', category: '素材', onIconClick: () => {} })
    const el = chip('ref-node:a')
    applyChipEditingState(el)
    expect(el.classList.contains('resource-chip--editable')).toBe(true)
  })

  it('注册表里没有回调 → 不强行加类', () => {
    registerItem({ id: 'ref-node:b', name: '文本', category: '素材' })
    const el = chip('ref-node:b')
    applyChipEditingState(el)
    expect(el.classList.contains('resource-chip--editable')).toBe(false)
  })

  it('失效标签不加可编辑态', () => {
    registerItem({ id: 'ref-node:c', name: '失效', category: '素材', invalid: true, onIconClick: () => {} })
    const el = chip('ref-node:c')
    applyChipEditingState(el)
    expect(el.classList.contains('resource-chip--editable')).toBe(false)
  })

  it('菜单打开的那颗仍然带 --editing', () => {
    registerItem({ id: 'ref-node:d', name: '视频', category: '素材', onIconClick: () => {} })
    const el = chip('ref-node:d')
    document.body.appendChild(el)
    setChipEditing('ref-node:d', true)
    expect(el.classList.contains('resource-chip--editing')).toBe(true)
    setChipEditing('ref-node:d', false)
    expect(el.classList.contains('resource-chip--editing')).toBe(false)
    el.remove()
  })
})
