import { describe, expect, it } from 'vitest'
import { NodeStore } from '@mini-canvas/canvas-data'
import { ThemeRegistry } from '@mini-canvas/canvas-data'
import { RegistryImpl } from '@mini-canvas/kernel'
import {
  assembleTheme,
  hitNodeIdAt,
  nodeShellSlot,
  nodesFromStore,
  overlayDraggingPositions,
  expandDragProtection,
  needsLiveProtectionCollection,
  pruneProtectionIds,
  edgesFromStore,
  pruneDanglingEdges,
  splitNodeWritePatch,
  DEFAULT_EDGE_VISUAL,
  DEFAULT_HANDLE_VISUAL,
  DEFAULT_DEBUG_VISUAL,
  FIRST_RUN_FIT_PADDING,
  FIRST_RUN_FIT_RETRY_DELAYS,
} from '../canvasHostCore'
import { LAYERS } from '../../contracts/layers'

function makeStore(): NodeStore {
  const s = new NodeStore()
  s.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
  s.registerType({ type: 'image', label: '图片', defaultSize: { w: 200, h: 120 } })
  return s
}

describe('nodesFromStore', () => {
  it('首屏取景留白固定为 0.15，重试间隔先紧后松', () => {
    // 用户可见行为：第一次打开空白画布/无存档视口时，节点四周留一圈空白，不贴边
    expect(FIRST_RUN_FIT_PADDING).toBe(0.15)
    expect(FIRST_RUN_FIT_RETRY_DELAYS).toEqual([80, 150, 300, 600, 1000])
  })

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
      // label 是建节点时按类型模板生成的默认名（nodeStore.nextDefaultName），随 data 一起过来
      data: { label: '文本 1', text: 'hi', _cullState: 'visible' },
      // 显式分层：普通节点落 LAYERS.node（不再靠 DOM 顺序）
      zIndex: LAYERS.node,
      // 可见状态（2026-10-26）：hidden 路线退役后显式 false 清除旧存档残留；未传 cullIds → 恒 visible
      hidden: false,
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

  it('选中节点抬到普通节点之上（否则重叠时被后建的节点盖住 —— 2026-09-30 用户实测）', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'a' },
      { type: 'image', position: { x: 10, y: 10 }, id: 'b' },
    ])
    const flow = nodesFromStore(s, new Set(['a']))
    const zOf = (id: string): number => flow.find((n) => n.id === id)!.zIndex ?? 0
    // 选中抬层：两层 z 相同就只由 DOM 顺序决定谁在上面，后建的节点会盖住选中的那个
    expect(zOf('a')).toBeGreaterThan(zOf('b'))
    // 但仍必须在「置顶连线」之下 —— 用户要的是「连线显示在最上层」时能压过选中节点
    expect(zOf('a')).toBeLessThan(1001)
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

  /**
   * 图片/视频：加载态包裹尺寸投影**类型默认尺寸**。
   *
   * 用户口径（2026-10-10）：重新生成时卡片先回到设置里配的默认宽高，跑完再跟随新产物比例。
   * 这里锁"包裹尺寸"这一半（另一半是卡片壳 useNodeCardSize，见 theme-default 测试）。
   *
   * 为什么是**投影默认尺寸**而不是抹掉 style：VueFlow 的节点更新是合并语义，去掉 style
   * 不会把上一次写进 DOM 的宽高抹掉（实测包裹停在旧比例）；必须显式给值才改写。
   */
  it('loadingDefaultSize 类型：running 投影类型默认尺寸，非 running 投影 node.size', () => {
    const s = makeStore()
    s.registerType({ type: 'media', label: '媒体', defaultSize: { w: 200, h: 120 }, loadingDefaultSize: true })
    const id = s.addNode('media', { x: 0, y: 0 })
    s.updateNode(id, { size: { w: 169, h: 300 } })
    // 非 running：照常按 node.size 投 style（就是媒体真实比例）
    expect(nodesFromStore(s).find((n) => n.id === id)!.style).toEqual({ width: '169px', height: '300px' })
    // running：投影类型默认尺寸（200×120）—— 重新生成时不沿用上一张图的 169×300 竖版比例
    s.updateNodeData(id, { runState: { status: 'running' } })
    expect(nodesFromStore(s).find((n) => n.id === id)!.style).toEqual({ width: '200px', height: '120px' })
    // 跑完：比例回来
    s.updateNodeData(id, { runState: { status: 'done' } })
    expect(nodesFromStore(s).find((n) => n.id === id)!.style).toEqual({ width: '169px', height: '300px' })
  })

  it('loadingDefaultSize 类型但节点没有 size：running 仍给默认尺寸（空节点加载态也一致）', () => {
    const s = makeStore()
    s.registerType({ type: 'media2', label: '媒体2', defaultSize: { w: 200, h: 120 }, loadingDefaultSize: true })
    const id = s.addNode('media2', { x: 0, y: 0 })
    s.updateNodeData(id, { runState: { status: 'running' } })
    expect(nodesFromStore(s).find((n) => n.id === id)!.style).toEqual({ width: '200px', height: '120px' })
  })

  it('没声明 loadingDefaultSize 的类型：running 期间照常投影 size（行为不变）', () => {
    const s = makeStore()
    s.registerType({ type: 'plain', label: '普通', defaultSize: { w: 200, h: 120 } })
    const id = s.addNode('plain', { x: 0, y: 0 })
    s.updateNode(id, { size: { w: 169, h: 300 } })
    s.updateNodeData(id, { runState: { status: 'running' } })
    expect(nodesFromStore(s).find((n) => n.id === id)!.style).toEqual({ width: '169px', height: '300px' })
  })

  it('transparent 类型（容器/分组）z 按嵌套深度分层：外层组 groupBase、内层组 groupNested（都在连线之下）', () => {
    const s = makeStore()
    s.registerType({ type: 'group', label: '分组', defaultSize: { w: 300, h: 200 }, transparent: true })
    const g = s.addNode('group', { x: 0, y: 0 })
    // 内层组：parentId 指向外层组
    const g2 = s.addNodes([{ type: 'group', position: { x: 10, y: 10 }, size: { w: 100, h: 80 }, id: 'inner', parentId: g }])
    const flow = nodesFromStore(s)
    // 外层组 depth0 → groupBase（垫底）；内层组 depth1 → groupNested（盖在外层组上，仍在连线之下）
    expect(flow.find((n) => n.id === g)!.zIndex).toBe(LAYERS.groupBase)
    expect(flow.find((n) => n.id === 'inner')!.zIndex).toBe(LAYERS.groupNested)
    expect(LAYERS.groupNested).toBeLessThan(LAYERS.edge)
    // 普通类型落 LAYERS.node（显式分层，不再靠 VueFlow 默认 0）
    const textId = s.addNode('text', { x: 10, y: 10 })
    expect(nodesFromStore(s).find((n) => n.id === textId)!.zIndex).toBe(LAYERS.node)
    // 相对次序不变：分组垫底 < 连线 < 普通节点 < 选中节点 < 置顶连线
    expect(LAYERS.groupBase).toBeLessThan(LAYERS.edge)
    expect(LAYERS.node).toBeLessThan(LAYERS.nodeSelected)
    expect(LAYERS.nodeSelected).toBeLessThan(LAYERS.edgeTop)
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
      // 临时菜单卡恒在最上层：不提升会被普通节点压住（用户实测截图）
      zIndex: LAYERS.tempNode,
    })
  })
})

describe('pruneDanglingEdges', () => {
  it('拖动中的实时位置优先于 store 旧位置（滚轮缩放触发可见集合重灌时不回跳）', () => {
    const s = makeStore()
    s.addNodes([
      { id: 'a', type: 'text', position: { x: 10, y: 20 } },
      { id: 'b', type: 'text', position: { x: 30, y: 40 } },
    ])
    const projected = overlayDraggingPositions(nodesFromStore(s), new Map([['a', { x: 300, y: 400 }]]))
    expect(projected.find((n) => n.id === 'a')!.position).toEqual({ x: 300, y: 400 })
    // 没被拖动的节点仍以 store 为准（不能顺手把别人的布局也改了）
    expect(projected.find((n) => n.id === 'b')!.position).toEqual({ x: 30, y: 40 })
    // 只是渲染投影：数据层仍是拖拽前的位置，松手才统一落盘
    expect(s.getNode('a')!.position).toEqual({ x: 10, y: 20 })
    expect(overlayDraggingPositions(nodesFromStore(s), new Map())).toEqual(nodesFromStore(s))
    // 对照：不覆盖时就是用户报的旧位置（证明这条用例真的锁住了修复，而非恒真）
    expect(nodesFromStore(s).find((n) => n.id === 'a')!.position).toEqual({ x: 10, y: 20 })
  })

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

describe('expandDragProtection（事件驱动缓存：一次建好整段手势的保护名单）', () => {
  const all = ['g', 'a', 'b', 'inner', 'deep', 'other']
  const parentOf = new Map<string, string | undefined>([
    ['g', undefined],
    ['a', 'g'],
    ['b', 'g'],
    ['inner', 'g'],
    ['deep', 'inner'],
    ['other', undefined],
  ])

  it('拖分组父节点：整棵嵌套子树都进名单，组外节点不进', () => {
    const ids = expandDragProtection(['g'], all, parentOf)
    expect([...ids].sort()).toEqual(['a', 'b', 'deep', 'g', 'inner'])
  })

  it('多选整组：每个成员都进名单，父级子节点递归展开', () => {
    const ids = expandDragProtection(['a', 'other'], all, parentOf)
    expect([...ids].sort()).toEqual(['a', 'other'])
  })

  it('插件额外视觉位移的成员一并合并（updateNodeVisual 不产生 dragging）', () => {
    const ids = expandDragProtection(['g'], all, parentOf, ['other'])
    expect(ids.has('other')).toBe(true)
    expect(ids.has('g')).toBe(true)
  })

  it('环状父链不死循环（脏数据兜底）', () => {
    const cyclic = new Map<string, string | undefined>([
      ['x', 'y'],
      ['y', 'x'],
    ])
    const ids = expandDragProtection(['x'], ['x', 'y'], cyclic)
    expect(ids.has('x')).toBe(true)
    expect(ids.has('y')).toBe(true)
  })
})

describe('needsLiveProtectionCollection（每帧快路径，O(1)）', () => {
  it('没拖拽、没视觉位移、没缓存 → false（不建 Map、不扫节点）', () => {
    expect(needsLiveProtectionCollection(false, 0, false)).toBe(false)
  })
  it('拖拽中 → true', () => {
    expect(needsLiveProtectionCollection(true, 0, false)).toBe(true)
  })
  it('插件视觉位移存在 → true（即使 VueFlow 的 dragging 是 false）', () => {
    expect(needsLiveProtectionCollection(false, 2, false)).toBe(true)
  })
  it('缓存尚未清空 → true（等松手/落盘后恢复常规裁剪）', () => {
    expect(needsLiveProtectionCollection(false, 0, true)).toBe(true)
  })
})

describe('pruneProtectionIds（松手/删除/撤销后名单不残留）', () => {
  const alive = new Set(['a', 'b'])

  it('拖拽中：存活成员全部保留（store 的其它更新不能打掉正在拖的节点）', () => {
    const next = pruneProtectionIds(new Set(['a', 'b']), alive, true, new Set(), new Set())
    expect([...next].sort()).toEqual(['a', 'b'])
  })

  it('节点被删/撤销：已不存在的 id 立即摘掉', () => {
    const next = pruneProtectionIds(new Set(['a', 'ghost']), alive, true, new Set(), new Set())
    expect([...next]).toEqual(['a'])
  })

  it('松手后：只有仍与 store 不一致的插件视觉位移成员保留', () => {
    const next = pruneProtectionIds(
      new Set(['a', 'b']),
      alive,
      false,
      new Set(['a', 'b']),
      new Set(['b']),
    )
    expect([...next]).toEqual(['a'])
  })

  it('松手且视觉位移已对齐：名单清空，屏外节点恢复常规裁剪', () => {
    const next = pruneProtectionIds(new Set(['a']), alive, false, new Set(['a']), new Set(['a']))
    expect(next.size).toBe(0)
  })

  it('撤销/删除后重新拖拽：旧 id 不会借视觉位移集合复活（视觉集合由上层过滤存活节点）', () => {
    const afterUndo = pruneProtectionIds(
      new Set(['deleted']),
      new Set(['a']),
      false,
      new Set(['deleted']),
      new Set(),
    )
    expect(afterUndo.size).toBe(0)
    // 视觉位移集合里残留的已删 id 不会再进入新名单（调用方先按 store 过滤）
    const rebuilt = expandDragProtection(['a'], ['a'], new Map(), new Set(['a']))
    expect([...rebuilt]).toEqual(['a'])
  })

  it('视觉位移成员变化：a → a+b 能加入 b；a 对齐后只保留 b', () => {
    const all = ['a', 'b']
    const parentOf = new Map<string, string | undefined>()
    // 第一步：插件只移动了 a
    let protectedIds = expandDragProtection([], all, parentOf, ['a'])
    expect([...protectedIds].sort()).toEqual(['a'])
    // 第二步：插件把 b 也加入视觉位移 —— 名单必须扩到 a+b
    protectedIds = expandDragProtection([], all, parentOf, ['a', 'b'])
    expect([...protectedIds].sort()).toEqual(['a', 'b'])
    // 第三步：a 已经和 store 对齐，b 仍在视觉位移 —— 只保留 b
    const next = pruneProtectionIds(
      protectedIds,
      new Set(all),
      false,
      new Set(['a', 'b']),
      new Set(['a']),
    )
    expect([...next]).toEqual(['b'])
  })
})

describe('1000 节点量级：保护名单与快路径的规模行为', () => {
  const N = 1000
  const stored = new Map<string, { x: number; y: number }>()
  const parentOf = new Map<string, string | undefined>()
  const allIds: string[] = []
  for (let i = 0; i < N; i++) {
    const id = 'n' + i
    allIds.push(id)
    stored.set(id, { x: i * 10, y: 0 })
    // 每 50 个一组：组内 49 个子节点，组头是父。避免构造过宽的子树。
    parentOf.set(id, i % 50 !== 0 ? 'n' + (i - (i % 50)) : undefined)
  }
  it('无拖拽：快路径直接返回 false，不产生任何名单', () => {
    expect(needsLiveProtectionCollection(false, 0, false)).toBe(false)
  })

  it('单节点拖拽时名单只含该节点及其子树，不会把 1000 个节点全收进来', () => {
    const t0 = performance.now()
    const ids = expandDragProtection(['n10'], allIds, parentOf)
    const ms = performance.now() - t0
    expect(ids.has('n10')).toBe(true)
    expect(ids.size).toBeLessThan(N)
    // 只为回归留个宽松上限：一次 O(n) 扩展不应接近一帧预算
    expect(ms).toBeLessThan(50)
  })

  it('1000 节点全部视觉位移时名单完整（插件整组拖动的极端场景）', () => {
    const ids = expandDragProtection([], allIds, parentOf, allIds)
    expect(ids.size).toBe(N)
  })

  it('1000 节点：拖拽开始只建一次父链 + 子树扩展，成员集合稳定后不再全量扫描', () => {
    const t0 = performance.now()
    const ids = expandDragProtection(['n0'], allIds, parentOf)
    const ms = performance.now() - t0
    expect(ids.has('n0')).toBe(true)
    expect(ms).toBeLessThan(100)
    // 名单建好后，每帧的判定只是 O(1)：
    expect(needsLiveProtectionCollection(true, 0, true)).toBe(true)
    // 松手后无需任何收集
    expect(needsLiveProtectionCollection(false, 0, false)).toBe(false)
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
    // T10：宿主回落对齐 theme-default（10/0.55/0.8），消除双源（契约 §9-1）
    expect(DEFAULT_HANDLE_VISUAL.portZoneWidth).toBe(10)
    expect(DEFAULT_HANDLE_VISUAL.portZoneHeightRatio).toBe(0.55)
    expect(DEFAULT_HANDLE_VISUAL.portZoneArcRatio).toBe(0.8)
    expect(Object.keys(DEFAULT_HANDLE_VISUAL)).toHaveLength(8)
  })
  it('debug 开关默认均开（handleDebug/connectionSnapDebugVisible=true，开关设计默认给可视化）', () => {
    expect(DEFAULT_DEBUG_VISUAL.handleDebug).toBe(true)
    expect(DEFAULT_DEBUG_VISUAL.connectionSnapDebugVisible).toBe(true)
  })
})

describe('edgesFromStore（B 项：渲染 DTO 保留端口句柄 + 滤悬挂边）', () => {
  it('保留 sourceHandle/targetHandle；type 缺省补 custom', () => {
    const edges = [
      { id: 'e1', source: 'a', target: 'b', type: 'custom', sourceHandle: 'out1', targetHandle: 'in1' },
      { id: 'e2', source: 'c', target: 'd', sourceHandle: 'out2', targetHandle: 'in2' },
    ]
    const out = edgesFromStore(edges, new Set(['a', 'b', 'c', 'd']))
    // zIndex 恒显式（防 VueFlow 合并语义残留旧层值），见下方"取消选中回落"回归测试
    expect(out).toEqual([
      { id: 'e1', type: 'custom', source: 'a', target: 'b', sourceHandle: 'out1', targetHandle: 'in1', zIndex: LAYERS.edge },
      { id: 'e2', type: 'custom', source: 'c', target: 'd', sourceHandle: 'out2', targetHandle: 'in2', zIndex: LAYERS.edge },
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
    expect(out[0]).toEqual({
      id: 'e1', type: 'custom', source: 'a', target: 'b',
      sourceHandle: undefined, targetHandle: undefined, zIndex: LAYERS.edge,
    })
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
      zIndex: LAYERS.tempEdge,
    })
  })
})

describe('edgesFromStore：选中节点连线的层级（选中节点 > 其连线 > 其余）', () => {
  it('任一端选中的边抬到 edgeSelected，普通边显式落在 edge', () => {
    const edges = [
      { id: 'sel-src', source: 'a', target: 'b', type: 'custom' },
      { id: 'sel-tgt', source: 'c', target: 'a', type: 'custom' },
      { id: 'plain', source: 'c', target: 'd', type: 'custom' },
    ]
    const out = edgesFromStore(edges, new Set(['a', 'b', 'c', 'd']), new Set(['a']))
    const byId = (id: string) => out.find((e) => e.id === id)!
    expect(byId('sel-src').zIndex).toBe(LAYERS.edgeSelected)
    expect(byId('sel-tgt').zIndex).toBe(LAYERS.edgeSelected)
    expect(byId('plain').zIndex).toBe(LAYERS.edge)
  })

  it('临时边仍置顶（tempEdge 优先，选中判定只管普通边）', () => {
    const out = edgesFromStore(
      [{ id: 'temp', source: 'a', target: 'b', type: 'custom', data: { isTemp: true } }],
      new Set(['a', 'b']),
      new Set(['a']),
    )
    expect(out[0]!.zIndex).toBe(LAYERS.tempEdge)
  })

  it('不传选中集 = 全部普通边落在 edge（仍显式写 zIndex）', () => {
    const out = edgesFromStore(
      [{ id: 'e1', source: 'a', target: 'b', type: 'custom' }],
      new Set(['a', 'b']),
    )
    expect(out[0]!.zIndex).toBe(LAYERS.edge)
  })

  /**
   * 回归（2026-10-27 用户实测）：取消选中后连线必须**显式回落**到普通层。
   *
   * 为什么这条测试必须断言 100 而不是 undefined：VueFlow 更新边是**合并**语义
   * （parseEdge 里 Object.assign(existingEdge, edge)），没写 zIndex 的字段会沿用上一次的旧值。
   * 旧实现"选中时写 250、取消选中时不写"→ 边永远停在 250，压在未选中节点（200）上面，
   * 用户看到的就是"没选中节点时连线盖住节点""拖拽时层级来回跳"。
   */
  it('取消选中：连线显式回落到 LAYERS.edge（不能省略，否则 VueFlow 合并语义会残留旧值）', () => {
    const edges = [{ id: 'e1', source: 'a', target: 'b', type: 'custom' }]
    const selected = edgesFromStore(edges, new Set(['a', 'b']), new Set(['a']))
    expect(selected[0]!.zIndex).toBe(LAYERS.edgeSelected)
    const cleared = edgesFromStore(edges, new Set(['a', 'b']), new Set())
    expect(cleared[0]!.zIndex).toBe(LAYERS.edge)
  })

  it('普通连线一律显式写 LAYERS.edge（选中切换/连接线置顶开关都能把旧值压回去）', () => {
    const out = edgesFromStore(
      [{ id: 'e1', source: 'a', target: 'b', type: 'custom' }],
      new Set(['a', 'b']),
    )
    expect(out[0]!.zIndex).toBe(LAYERS.edge)
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
