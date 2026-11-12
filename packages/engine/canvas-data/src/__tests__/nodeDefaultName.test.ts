/**
 * 新节点默认名（nameTemplate）。
 *
 * 用户口径：注册节点类型时声明"名称模板"（如 图片 {{ID}}），建节点时按模板生成默认名；
 * 序号**按类型独立计数**（图片 1、图片 2、文本 1…）；
 * 标题条 / @ 菜单 / 左侧树都读这个名字，三处统一。
 */
import { describe, it, expect } from 'vitest'
import { NodeStore, type CanvasNode } from '../nodeStore'

function makeStore(): NodeStore {
  const s = new NodeStore()
  s.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 }, nameTemplate: '文本 {{ID}}' })
  s.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 }, nameTemplate: '图片 {{ID}}' })
  // 不声明模板 → 用 label 兜底
  s.registerType({ type: 'group', label: '分组', defaultSize: { w: 200, h: 100 } })
  return s
}

describe('新节点默认名（nameTemplate）', () => {
  it('addNode 按模板生成，序号按类型独立递增', () => {
    const s = makeStore()
    const a = s.addNode('image', { x: 0, y: 0 })
    const b = s.addNode('text', { x: 0, y: 0 })
    const c = s.addNode('image', { x: 0, y: 0 })
    // 图片自己数（1、2），文本自己数（1）——互不顶号
    expect(s.getNode(a)!.data.label).toBe('图片 1')
    expect(s.getNode(b)!.data.label).toBe('文本 1')
    expect(s.getNode(c)!.data.label).toBe('图片 2')
  })

  it('不声明模板 → 用 label 兜底（带序号，避免同名分不清）', () => {
    const s = makeStore()
    const a = s.addNode('group', { x: 0, y: 0 })
    const b = s.addNode('group', { x: 0, y: 0 })
    expect(s.getNode(a)!.data.label).toBe('分组 1')
    expect(s.getNode(b)!.data.label).toBe('分组 2')
  })

  it('{{NAME}} 展开为类型 label', () => {
    const s = new NodeStore()
    s.registerType({ type: 'image', label: '图片', defaultSize: { w: 1, h: 1 }, nameTemplate: '{{NAME}}-{{ID}}' })
    const id = s.addNode('image', { x: 0, y: 0 })
    expect(s.getNode(id)!.data.label).toBe('图片-1')
  })

  it('addNodes 也给默认名；显式带 label 的保留原样', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'image', position: { x: 0, y: 0 } },
      { type: 'image', position: { x: 1, y: 1 }, data: { label: '我的图' } },
      { type: 'image', position: { x: 2, y: 2 } },
    ])
    const labels = s.getNodes().map((n) => n.data.label)
    expect(labels).toEqual(['图片 1', '我的图', '图片 2'])
  })

  it('replaceAll 重建序号：不与被恢复的旧名字撞号', () => {
    const s = makeStore()
    const saved: CanvasNode[] = [
      { id: '1', type: 'image', position: { x: 0, y: 0 }, data: { label: '图片 1' } },
      { id: '2', type: 'image', position: { x: 0, y: 0 }, data: { label: '图片 2' } },
      { id: '3', type: 'text', position: { x: 0, y: 0 }, data: { label: '文本 5' } },
    ]
    s.replaceAll(saved)
    // 图片已有 1、2 → 下一个是 3；文本已有 5 → 下一个是 6
    expect(s.getNode(s.addNode('image', { x: 9, y: 9 }))!.data.label).toBe('图片 3')
    expect(s.getNode(s.addNode('text', { x: 9, y: 9 }))!.data.label).toBe('文本 6')
  })

  it('回填不含序号的旧名字不干扰计数', () => {
    const s = makeStore()
    s.replaceAll([{ id: '1', type: 'image', position: { x: 0, y: 0 }, data: { label: '老图' } }])
    expect(s.getNode(s.addNode('image', { x: 0, y: 0 }))!.data.label).toBe('图片 1')
  })
})
