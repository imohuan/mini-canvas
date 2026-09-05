/**
 * canvasHostCore —— 渲染宿主纯逻辑单测（store→flow 映射 / 主题装配 / 默认参数 / 边剪枝）。
 * 全部零 Vue 依赖，Node 环境直接跑。
 */
import { describe, expect, it } from 'vitest'
import { NodeStore } from '../../services/nodeStore'
import { ThemeRegistry } from '../../core/registry/themeRegistry'
import {
  assembleTheme,
  edgeId,
  nodesFromStore,
  pruneDanglingEdges,
  DEFAULT_EDGE_VISUAL,
  DEFAULT_HANDLE_VISUAL,
} from '../canvasHostCore'

function makeStore(): NodeStore {
  const s = new NodeStore()
  s.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
  s.registerType({ type: 'image', label: '图片', defaultSize: { w: 200, h: 120 } })
  return s
}

describe('nodesFromStore', () => {
  it('把 store 节点灌成 flow 节点，data 浅拷贝不共享引用', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 10, y: 20 })
    s.updateNodeData(id, { text: 'hi' })
    const flow = nodesFromStore(s)
    expect(flow).toHaveLength(1)
    expect(flow[0]).toEqual({
      id,
      type: 'text',
      position: { x: 10, y: 20 },
      data: { text: 'hi' },
    })
    // data 是浅拷贝：改 flow 的 data 不污染内核 store
    flow[0].data.text = 'MUTATED'
    expect(s.getNode(id)!.data.text).toBe('hi')
  })
})

describe('pruneDanglingEdges', () => {
  it('滤掉 source/target 已不在存活集的边', () => {
    const alive = new Set(['a', 'b'])
    const edges = [
      { id: '1', source: 'a', target: 'b' },
      { id: '2', source: 'a', target: 'gone' },
      { id: '3', source: 'gone', target: 'b' },
    ]
    expect(pruneDanglingEdges(edges, alive)).toEqual([{ id: '1', source: 'a', target: 'b' }])
  })
})

describe('assembleTheme', () => {
  it('读各槽位 + edgeDefaultType；无主题/未注册时回落默认', () => {
    const theme = new ThemeRegistry()
    const shell = {}
    theme.register('nodeShell', shell)
    theme.register('edgeDefaultType', 'custom2')
    const store = makeStore()
    const out = assembleTheme(theme, store.types.keys())
    expect(out.nodeShell).toBe(shell)
    expect(out.nodeTypes).toEqual(['text', 'image'])
    expect(out.edgeDefaultType).toBe('custom2')
  })

  it('空 registry / 未注册槽位时回落：shell/edge/background undefined、edgeDefaultType=custom', () => {
    const store = makeStore()
    const out = assembleTheme(undefined, store.types.keys())
    expect(out.nodeShell).toBeUndefined()
    expect(out.edge).toBeUndefined()
    expect(out.background).toBeUndefined()
    expect(out.edgeDefaultType).toBe('custom')
    expect(out.nodeTypes).toEqual(['text', 'image'])
  })
})

describe('默认外观常量', () => {
  it('edge 默认对齐 contract（bezier/#3b82f6/animated 开）', () => {
    expect(DEFAULT_EDGE_VISUAL.edgeType).toBe('bezier')
    expect(DEFAULT_EDGE_VISUAL.edgeColor).toBe('#3b82f6')
    expect(DEFAULT_EDGE_VISUAL.edgeAnimated).toBe(true)
  })
  it('handle 默认含全部尺寸字段', () => {
    expect(DEFAULT_HANDLE_VISUAL.handleRadius).toBe(86)
    expect(DEFAULT_HANDLE_VISUAL.handleButtonSize).toBe(32)
    expect(Object.keys(DEFAULT_HANDLE_VISUAL)).toHaveLength(5)
  })
})

describe('edgeId', () => {
  it('生成稳定源→目标 id', () => {
    expect(edgeId('1', '2')).toBe('e-1-2')
  })
})
