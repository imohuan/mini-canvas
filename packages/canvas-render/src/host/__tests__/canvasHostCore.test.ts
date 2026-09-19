import { describe, expect, it } from 'vitest'
import { NodeStore } from '@mini-canvas/canvas-data'
import { ThemeRegistry } from '@mini-canvas/canvas-data'
import { RegistryImpl } from '@mini-canvas/kernel'
import {
  assembleTheme,
  edgeId,
  hitNodeIdAt,
  nodeShellSlot,
  nodesFromStore,
  edgesFromStore,
  pruneDanglingEdges,
  splitNodeWritePatch,
  DEFAULT_EDGE_VISUAL,
  DEFAULT_HANDLE_VISUAL,
  DEFAULT_DEBUG_VISUAL,
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

  it('传入 selectedIds 时给匹配节点打 selected 标记，未传则不带', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'a' },
      { type: 'text', position: { x: 10, y: 10 }, id: 'b' },
    ])
    const without = nodesFromStore(s)
    expect('selected' in without[0]).toBe(false)
    const withSel = nodesFromStore(s, new Set(['a']))
    expect(withSel.find((n) => n.id === 'a')!.selected).toBe(true)
    expect(withSel.find((n) => n.id === 'b')!.selected).toBe(false)
  })

  it('parentId/size 投影：parentId → parentNode（VueFlow 父子字段）、size → style', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 100, y: 50 }, id: 'g', size: { w: 300, h: 200 } },
      { type: 'text', position: { x: 10, y: 10 }, id: 'c', parentId: 'g' },
    ])
    const flow = nodesFromStore(s)
    const g = flow.find((n) => n.id === 'g')!
    const c = flow.find((n) => n.id === 'c')!
    expect(g.parentNode).toBeUndefined()
    expect(g.style).toEqual({ width: '300px', height: '200px' })
    expect(c.parentNode).toBe('g')
    expect(c.style).toBeUndefined()
  })

  it('transparent 类型（容器/分组）z 按嵌套深度分层：外层组-3、内层组-2（VueFlow computed 后 -1，仍在边之下）', () => {
    const s = makeStore()
    s.registerType({ type: 'group', label: '分组', defaultSize: { w: 300, h: 200 }, transparent: true })
    const g = s.addNode('group', { x: 0, y: 0 })
    // 内层组：parentId 指向外层组
    const g2 = s.addNodes([{ type: 'group', position: { x: 10, y: 10 }, size: { w: 100, h: 80 }, id: 'inner', parentId: g }])
    const flow = nodesFromStore(s)
    // 外层组 depth0 → -2（垫底）；内层组 depth1 → -1（盖在外层组上，仍在边之下）
    expect(flow.find((n) => n.id === g)!.zIndex).toBe(-3)
    expect(flow.find((n) => n.id === 'inner')!.zIndex).toBe(-2)
    // 普通类型无 zIndex（走 VueFlow 默认 0）
    const textId = s.addNode('text', { x: 10, y: 10 })
    expect(nodesFromStore(s).find((n) => n.id === textId)!.zIndex).toBeUndefined()
    void g2
  })
  it('data.isTemp 节点：在 VueFlow DTO 上关掉 draggable/selectable/deletable/focusable（防 pane click removeSelectedElements 误删）', () => {
    const s = new NodeStore()
    s.registerType({ type: 'connection-menu', label: 'ConnectionMenu', defaultSize: { w: 264, h: 100 } })
    s.addNode('connection-menu', { x: 0, y: 0 })
    s.updateNodeData(s.getNodes()[0]!.id, { isTemp: true })
    const flow = nodesFromStore(s)
    expect(flow[0]).toMatchObject({
      type: 'connection-menu',
      draggable: false,
      selectable: false,
      deletable: false,
      focusable: false,
      // 临时菜单卡恒在最上层：嵌套组内的子节点 z=1+，不提升会被压住（用户实测截图）
      zIndex: 1001,
    })
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

describe('hitNodeIdAt（松手落点命中判定：区分"落空白"与"落节点上"）', () => {
  const rects = [
    { id: 'a', x: 0, y: 0, w: 100, h: 50 },
    { id: 'b', x: 200, y: 100, w: 100, h: 50 },
  ]

  it('点在卡片内部 → 命中该节点（含边界）', () => {
    expect(hitNodeIdAt({ x: 50, y: 25 }, rects)).toBe('a')
    expect(hitNodeIdAt({ x: 250, y: 125 }, rects)).toBe('b')
    // 边界算命中（左/上/右/下四条边）
    expect(hitNodeIdAt({ x: 0, y: 0 }, rects)).toBe('a')
    expect(hitNodeIdAt({ x: 100, y: 50 }, rects)).toBe('a')
  })

  it('点在所有卡片之外 → null（= 真空白，才该放临时节点）', () => {
    expect(hitNodeIdAt({ x: 150, y: 25 }, rects)).toBeNull()
    expect(hitNodeIdAt({ x: -1, y: 0 }, rects)).toBeNull()
    expect(hitNodeIdAt({ x: 101, y: 51 }, rects)).toBeNull()
  })

  it('无节点 / 空矩形表 → null', () => {
    expect(hitNodeIdAt({ x: 0, y: 0 }, [])).toBeNull()
  })
})

describe('assembleTheme', () => {
  it('读各槽位 + edgeDefaultType；无主题/未注册时回落默认', () => {
    const theme = new ThemeRegistry()
    const shell = {}
    const cl = {}
    theme.register('nodeShell', shell)
    theme.register('connectionLine', cl)
    theme.register('edgeDefaultType', 'custom2')
    const store = makeStore()
    const out = assembleTheme(theme, store.types.keys())
    expect(out.nodeShell).toBe(shell)
    expect(out.connectionLine).toBe(cl)
    expect(out.nodeTypes).toEqual(['text', 'image'])
    expect(out.edgeDefaultType).toBe('custom2')
  })

  it('空 registry / 未注册槽位时回落：shell/edge/background/connectionLine undefined、edgeDefaultType=custom', () => {
    const store = makeStore()
    const out = assembleTheme(undefined, store.types.keys())
    expect(out.nodeShell).toBeUndefined()
    expect(out.edge).toBeUndefined()
    expect(out.background).toBeUndefined()
    expect(out.connectionLine).toBeUndefined()
    expect(out.edgeDefaultType).toBe('custom')
    expect(out.nodeTypes).toEqual(['text', 'image'])
  })

  it('nodeShells：每 type 解析外壳 —— 注册了 nodeShell:<type> 就用它，否则回落全局 nodeShell', () => {
    const theme = new ThemeRegistry()
    const defaultShell = {}
    const ownShell = {}
    theme.register('nodeShell', defaultShell)
    theme.register(nodeShellSlot('connection-menu'), ownShell)
    const store = makeStore()
    store.registerType({ type: 'connection-menu', label: '菜单', defaultSize: { w: 264, h: 100 } })
    const out = assembleTheme(theme, store.types.keys())
    expect(out.nodeShells['connection-menu']).toBe(ownShell)
    expect(out.nodeShells.text).toBe(defaultShell)
    expect(out.nodeShells.image).toBe(defaultShell)
  })

  // 设计文档 §4.5 把 node/shell 定义为"值=壳组件、消费者=节点壳装配"，案例 3/8 教作者用它换壳。
  // 下面三条锁"那些写法真的生效" —— 此前这张场只有写入端、没有读取端，作者的 add/wrap 会静默失效。
  it('node/shell 场：精确键换壳生效（覆盖 theme 槽的默认壳）', () => {
    const theme = new ThemeRegistry()
    const defaultShell = { name: 'BaseNode' }
    const myShell = { name: 'MyShell' }
    theme.register('nodeShell', defaultShell)
    const store = makeStore()
    const field = new RegistryImpl<unknown>()
    field.add('text', myShell)
    const out = assembleTheme(theme, store.types.keys(), field)
    expect(out.nodeShells.text).toBe(myShell)
    // 没被点名的类型仍用默认壳
    expect(out.nodeShells.image).toBe(defaultShell)
  })

  it('node/shell 场：* 通配换壳（一处换掉所有节点）', () => {
    const theme = new ThemeRegistry()
    theme.register('nodeShell', { name: 'BaseNode' })
    const store = makeStore()
    const field = new RegistryImpl<unknown>()
    const chrome = { name: 'MyChrome' }
    field.add('*', chrome)
    const out = assembleTheme(theme, store.types.keys(), field)
    expect(out.nodeShells.text).toBe(chrome)
    expect(out.nodeShells.image).toBe(chrome)
  })

  it('node/shell 场：wrap 能拿到 inner 并包一层（案例 8 的组合语义）', () => {
    const theme = new ThemeRegistry()
    theme.register('nodeShell', { name: 'BaseNode' })
    const store = makeStore()
    const field = new RegistryImpl<unknown>()
    field.add('text', { name: 'BaseNode' })
    // wrap 缺省放在最外（order 更小），resolve 时收到 inner = 原来那个
    field.wrap('text', (inner) => ({ name: 'Badged', inner }))
    const out = assembleTheme(theme, store.types.keys(), field)
    expect(out.nodeShells.text).toEqual({ name: 'Badged', inner: { name: 'BaseNode' } })
    // 别的类型不受影响
    expect(out.nodeShells.image).toEqual({ name: 'BaseNode' })
  })

  it('node/shell 场：只有 wrap、没有 add → inner 是 theme 槽那份默认壳（案例 3/8"原值不丢"）', () => {
    const theme = new ThemeRegistry()
    const defaultShell = { name: 'BaseNode' }
    theme.register('nodeShell', defaultShell)
    const store = makeStore()
    const field = new RegistryImpl<unknown>()
    // 作者只写一行 wrap：包住"主题给的默认壳"
    field.wrap('*', (inner) => ({ name: 'MyChrome', inner }))
    const out = assembleTheme(theme, store.types.keys(), field)
    expect(out.nodeShells.text).toEqual({ name: 'MyChrome', inner: defaultShell })
    expect(out.nodeShells.image).toEqual({ name: 'MyChrome', inner: defaultShell })
  })

  it('node/shell 场：存在 wrap 时精确键优先于通配（各自 base 都拿到默认壳）', () => {
    const theme = new ThemeRegistry()
    const defaultShell = { name: 'BaseNode' }
    theme.register('nodeShell', defaultShell)
    const store = makeStore()
    const field = new RegistryImpl<unknown>()
    field.wrap('*', (inner) => ({ name: 'GlobalChrome', inner }))
    field.wrap('image', (inner) => ({ name: 'ImageShell', inner }))
    const out = assembleTheme(theme, store.types.keys(), field)
    expect(out.nodeShells.image).toEqual({ name: 'ImageShell', inner: defaultShell })
    expect(out.nodeShells.text).toEqual({ name: 'GlobalChrome', inner: defaultShell })
  })

  it('node/shell 场未注册该 type 时回落到 theme 槽（不缺省破坏既有默认皮）', () => {
    const theme = new ThemeRegistry()
    const defaultShell = { name: 'BaseNode' }
    theme.register('nodeShell', defaultShell)
    const store = makeStore()
    const out = assembleTheme(theme, store.types.keys(), new RegistryImpl<unknown>())
    expect(out.nodeShells.text).toBe(defaultShell)
  })

  it('nodeShells：无全局壳时只有自带外壳的 type 有壳，其余不带（裸内容渲染）', () => {
    const theme = new ThemeRegistry()
    const ownShell = {}
    theme.register(nodeShellSlot('special'), ownShell)
    const store = makeStore()
    store.registerType({ type: 'special', label: '特殊', defaultSize: { w: 100, h: 100 } })
    const out = assembleTheme(theme, store.types.keys())
    expect(out.nodeShells.special).toBe(ownShell)
    expect(out.nodeShells.text).toBeUndefined()
    expect(out.nodeShell).toBeUndefined()
  })
})

describe('默认外观常量', () => {
  it('edge 默认对齐 contract（bezier/#3b82f6）', () => {
    expect(DEFAULT_EDGE_VISUAL.edgeType).toBe('bezier')
    expect(DEFAULT_EDGE_VISUAL.edgeColor).toBe('#3b82f6')
  })
  it('handle 默认含全部尺寸字段', () => {
    expect(DEFAULT_HANDLE_VISUAL.handleButtonSize).toBe(32)
    expect(DEFAULT_HANDLE_VISUAL.portZoneWidth).toBe(86)
    expect(DEFAULT_HANDLE_VISUAL.portZoneArcRatio).toBe(1)
    expect(Object.keys(DEFAULT_HANDLE_VISUAL)).toHaveLength(8)
  })
  it('debug 开关默认均开（handleDebug/connectionSnapDebugVisible=true，开关设计默认给可视化）', () => {
    expect(DEFAULT_DEBUG_VISUAL.handleDebug).toBe(true)
    expect(DEFAULT_DEBUG_VISUAL.connectionSnapDebugVisible).toBe(true)
  })
})

describe('edgeId', () => {
  it('生成稳定源→目标 id', () => {
    expect(edgeId('1', '2')).toBe('e-1-2')
  })
})

describe('edgesFromStore（B 项：渲染 DTO 保留端口句柄 + 滤悬挂边）', () => {
  it('保留 sourceHandle/targetHandle；type 缺省补 custom', () => {
    const edges = [
      { id: 'e1', source: 'a', target: 'b', type: 'custom', sourceHandle: 'out1', targetHandle: 'in1' },
      { id: 'e2', source: 'c', target: 'd', sourceHandle: 'out2', targetHandle: 'in2' },
    ]
    const out = edgesFromStore(edges, new Set(['a', 'b', 'c', 'd']))
    expect(out).toEqual([
      { id: 'e1', type: 'custom', source: 'a', target: 'b', sourceHandle: 'out1', targetHandle: 'in1' },
      { id: 'e2', type: 'custom', source: 'c', target: 'd', sourceHandle: 'out2', targetHandle: 'in2' },
    ])
  })
  it('滤掉端点不在存活节点集的悬挂边（不再残留渲染）', () => {
    const edges = [
      { id: 'keep', source: 'a', target: 'b', type: 'custom' },
      { id: 'drop-src', source: 'gone', target: 'b', type: 'custom' },
      { id: 'drop-tgt', source: 'a', target: 'gone', type: 'custom' },
    ]
    const out = edgesFromStore(edges, new Set(['a', 'b']))
    expect(out.map((e) => e.id)).toEqual(['keep'])
  })
  it('无 handle 的存量单端口边原样透传（sourceHandle/targetHandle 为 undefined）', () => {
    const out = edgesFromStore(
      [{ id: 'e1', source: 'a', target: 'b', type: 'custom' }],
      new Set(['a', 'b']),
    )
    expect(out[0]).toEqual({ id: 'e1', type: 'custom', source: 'a', target: 'b', sourceHandle: undefined, targetHandle: undefined })
  })
  it('data.isTemp 边：在渲染 DTO 上关掉 selectable/focusable/deletable 并置顶', () => {
    const out = edgesFromStore(
      [{ id: 'temp', source: 'a', target: 'b', type: 'custom', data: { isTemp: true } }],
      new Set(['a', 'b']),
    )
    expect(out[0]).toEqual({
      id: 'temp',
      type: 'custom',
      source: 'a',
      target: 'b',
      sourceHandle: undefined,
      targetHandle: undefined,
      data: { isTemp: true },
      selectable: false,
      focusable: false,
      deletable: false,
      zIndex: 1000,
    })
  })
})

describe('默认外观常量字段完整（P2-8 防漂移）', () => {
  it('DEFAULT_EDGE_VISUAL 覆盖 EdgeVisual 全部字段（结构完整，CustomEdge 读不到 undefined）', () => {
    const expected = [
      // edgeAnimated 已并入 edgeFlowEnabled（连线动效合并为单一总闸），契约不再有该字段
      'edgeType', 'edgeLineWidth', 'edgeColor', 'edgeDashed',
      'edgeMarkerEnd', 'edgeMarkerSize', 'edgeVisible', 'edgeGlowEnabled',
      'edgeGlowIntensity', 'edgeGlowColor',
    ]
    for (const k of expected) {
      expect(DEFAULT_EDGE_VISUAL, 'missing ' + k).toHaveProperty(k)
    }
  })
  it('DEFAULT_HANDLE_VISUAL / DEFAULT_DEBUG_VISUAL 结构完整', () => {
    const handleKeys = ['handleRestOffset', 'handleCursorGap', 'handleButtonSize', 'portZoneWidth', 'portZoneHeightRatio', 'portZoneOffset', 'portZoneShape', 'portZoneArcRatio']
    for (const k of handleKeys) expect(DEFAULT_HANDLE_VISUAL, 'missing ' + k).toHaveProperty(k)
    const debugKeys = ['handleDebug', 'connectionSnapDebugVisible']
    for (const k of debugKeys) expect(DEFAULT_DEBUG_VISUAL, 'missing ' + k).toHaveProperty(k)
  })
})

describe('edgeId 四元组（B 项，与内核 edgeStoreId 对齐）', () => {
  it('无/默认 handle 保持 e-{s}-{t}；带显式 handle 纳入 id 不互相覆盖', () => {
    expect(edgeId('a', 'b')).toBe('e-a-b')
    expect(edgeId('a', 'b', 'source', 'target')).toBe('e-a-b')
    expect(edgeId('a', 'b', 'out1', 'in1')).toBe('e-a:out1-b:in1')
    expect(edgeId('a', 'b', 'out1', 'in1')).not.toBe(edgeId('a', 'b', 'out2', 'in2'))
  })
})

describe('splitNodeWritePatch（resize 一份 patch 写全 data + node.size）', () => {
  it('带 size：size 单独拆出来，其余字段进 data（不把 size 塞进 data）', () => {
    const r = splitNodeWritePatch({
      cardWidth: 700,
      cardHeight: 300,
      size: { w: 700, h: 300 },
    })
    expect(r.size).toEqual({ w: 700, h: 300 })
    expect(r.data).toEqual({ cardWidth: 700, cardHeight: 300 })
    expect('size' in r.data).toBe(false)
  })

  it('不带 size（标题重命名等）：只返回 data，size 为 undefined', () => {
    const r = splitNodeWritePatch({ label: '新标题' })
    expect(r.size).toBeUndefined()
    expect(r.data).toEqual({ label: '新标题' })
  })

  it('size 拷贝值（不与入参共享引用）', () => {
    const size = { w: 10, h: 20 }
    const r = splitNodeWritePatch({ size })
    expect(r.size).toEqual(size)
    expect(r.size).not.toBe(size)
  })
})
