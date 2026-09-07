import { describe, it, expect } from 'vitest'
import type { CanvasNode } from '@mini-canvas/canvas-core-v2'
import { filterNodes, nodeLabelText, typeMeta } from '../nodeFindFilter'

const NL = String.fromCharCode(10)

function node(partial: Partial<CanvasNode> & { id: string; type: string }): CanvasNode {
  return { position: { x: 0, y: 0 }, data: {}, ...partial }
}

describe('nodeLabelText', () => {
  it('优先取 data.label', () => {
    expect(nodeLabelText({ id: '1', data: { label: '你好', text: '第二' } })).toBe('你好')
  })
  it('text 节点取首行文本（去换行）', () => {
    expect(nodeLabelText({ id: '1', data: { text: '第一行' + NL + '第二行' } })).toBe('第一行')
  })
  it('image 节点（无 label/text）给占位', () => {
    expect(nodeLabelText({ id: '1', data: { imageUrl: 'x' } })).toBe('图片节点')
  })
  it('空 data 回退 id', () => {
    expect(nodeLabelText({ id: '7', data: {} })).toBe('7')
  })
})

describe('typeMeta', () => {
  it('已知类型给中文名', () => {
    expect(typeMeta('text').label).toBe('文本')
    expect(typeMeta('image').label).toBe('图片')
  })
  it('未知类型回退自定义', () => {
    expect(typeMeta('whatever').label).toBe('自定义')
  })
})

describe('filterNodes', () => {
  const nodes = [
    node({ id: '1', type: 'text', data: { text: '标题A' } }),
    node({ id: '2', type: 'image', data: { imageUrl: 'u' } }),
    node({ id: '3', type: 'text', data: { label: 'temp-target-x' } }),
    node({ id: '4', type: 'group', data: { label: '整组' } }),
  ]
  it('空 query 返回全部（排除 temp-target 临时节点）', () => {
    const r = filterNodes(nodes, '')
    expect(r.map((n) => n.id)).toEqual(['1', '2', '4'])
  })
  it('按文本首行匹配', () => {
    expect(filterNodes(nodes, '标题').map((n) => n.id)).toEqual(['1'])
  })
  it('按类型匹配', () => {
    expect(filterNodes(nodes, 'image').map((n) => n.id)).toEqual(['2'])
  })
  it('limit 截断', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      node({ id: String(i), type: 'text', data: { text: '同' } }),
    )
    expect(filterNodes(many, '同').length).toBe(20)
  })
})
