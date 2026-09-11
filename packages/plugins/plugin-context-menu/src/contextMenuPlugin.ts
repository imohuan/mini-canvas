/**
 * plugin-context-menu —— 右键上下文菜单插件（v2 独立包，复刻老版 canvas-core/plugins/context-menu）。
 *
 * 复刻范围（对齐老版核心，不越权）：
 * - 右键画布空白(pane)：弹"新建节点"菜单（枚举已注册节点类型 → command:create-node）+ 通用/pane 区命令；
 * - 右键节点(node)：删除该节点（连带边，history 一次）；
 * - 右键连线(edge)：删除该连线（history 一次）。
 *
 * v2 铁律落地：
 * - 不 import canvas-core/src、不反向依赖宿主 demo、不碰 VueFlow/宿主内部。
 * - 事件源：渲染层 RenderEvents.ContextMenuPane/Node/Edge（宿主已 preventDefault + ctx.emit，
 *   flowPosition 已由宿主算好随事件给到），插件 ctx.on 订阅即弹菜单。
 * - 命令与建节点：删除走本插件注册的 context-menu:delete-* 命令（areas 标 node/edge，history 原子）；
 *   新建走既有 command:create-node（不重复造建节点）。
 * - UI 自管：ContextMenu.vue 由 createApp 挂到 body（Teleport 内层），ctx.effect 回收 app + DOM 监听。
 *
 * 浏览器守卫：菜单浮层/DOM 绑定仅在浏览器装配（node 装配/测试安全跳过）；命令注册任何时候都做。
 */
import { createApp, nextTick, reactive, type Component } from 'vue'
import type { ConfigSchema, Context, PluginModule } from '@mini-canvas/canvas-base'
import type {
  NodeStoreService,
  SelectionService,
  CommandService,
  NodeFactoryService,
  GraphDocumentService,
  MenuService,
  EdgeStoreService,
} from '@mini-canvas/canvas-core-v2'
import { typeConnectionDef } from '@mini-canvas/canvas-core-v2'
import { RenderEvents, nodeShellSlot, type ConnectionDropPayload } from '@mini-canvas/canvas-render'
import ContextMenu from './ContextMenu.vue'
import ConnectionMenuContent from './ConnectionMenuContent.vue'
import ConnectionMenuNode from './ConnectionMenuNode.vue'
import type { ContextMenuItem, ContextMenuMode } from './menuBuilder'
import { enrichMenuItems } from './menuEnrich'
import {
  CONNECTION_MENU_CANCEL_EVENT,
  CONNECTION_MENU_PICK_EVENT,
  CONNECTION_MENU_TYPE,
  addEdgeWhenNodeReady,
  buildConnectionMenuItems,
  connectionMenuCardSize,
  DEFAULT_DRAG_THRESHOLD,
  filterConnectableTypes,
  isTempEdge,
  placeByPortAnchor,
  portSideOf,
  resolveEdgeEndpoints,
  type ConnectionDropFact,
} from './connectionMenu'

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    nodeStore: NodeStoreService
    selection: SelectionService
    graph: GraphDocumentService
    nodeFactory: NodeFactoryService
  }
}

export const name = 'context-menu'
export const inject = ['nodeStore', 'selection', 'graph', 'menu', 'nodeFactory', 'edgeStore'] as string[]

/**
 * 本插件可配置项（模块级 Config：内核装配时校验 + 补默认 + 登记进 ⚙ 设置面板）。
 * dragThreshold：从端口按下后至少拖多少像素才算"真在拖线"。
 * 小于该距离就松手（等于在端口上点了一下）不弹菜单 —— 否则误点端口就会冒出菜单节点。
 */
export const Config: ConfigSchema = {
  dragThreshold: {
    type: 'number',
    default: DEFAULT_DRAG_THRESHOLD,
    min: 0,
    max: 60,
    step: 1,
    label: '拖线触发距离',
    group: '节点/连线菜单',
    description: '从端口按下后至少拖动这么多像素才算拖线；小于它松手视为点了一下端口，不弹连线菜单。',
  },
}


/** 渲染层右键事件 payload（与 canvas-render RenderEvents.ContextMenu* 契约一致；本地声明避免依赖导出遗漏） */
interface ContextMenuPanePayload {
  clientX: number
  clientY: number
  flowPosition: { x: number; y: number }
}
interface ContextMenuNodePayload extends ContextMenuPanePayload {
  nodeId: string
  nodeType?: string
}
interface ContextMenuEdgePayload extends ContextMenuPanePayload {
  edgeId: string
}

/** 菜单浮层当前状态（reactive；经 props 喂给 ContextMenu.vue） */
interface MenuUiState {
  visible: boolean
  x: number
  y: number
  mode: ContextMenuMode
  items: ContextMenuItem[]
}

export function apply(ctx: Context): void {
  const { nodeStore, selection, graph } = ctx
  // 菜单聚合走内核 menu 服务（依赖声明在 inject；ctx.menu 直访由 declare module 类型提供）

  // —— 临时菜单节点类型（拖线落空白时放的占位菜单卡）——
  // 它就是一个**真节点**：经 nodeStore → VueFlow 渲染，所以位置/尺寸/缩放全部由画布负责。
  // 尺寸在 addNodes 时按菜单项数写进 node.size（非零，绕开 VueFlow 用 offsetWidth==0 判未初始化写死 hidden 的坑）。
  ctx.nodes.register({
    type: CONNECTION_MENU_TYPE,
    label: '连线菜单',
    size: connectionMenuCardSize(1),
    content: ConnectionMenuContent,
  })
  // 专属外壳：这张卡整体就是一张菜单（无标题条、菜单自绘边框底色、单侧端口、反缩放），
  // 与"标题+内容"的通用卡片形态不同 → 由本插件自己画，主题默认壳不必为它开特判。
  // 渲染层按 `nodeShell:<type>` 解析（见 canvas-render 的 nodeShellSlot）。
  ctx.theme.register(nodeShellSlot(CONNECTION_MENU_TYPE), ConnectionMenuNode)

  // —— 内置命令：右键删除节点 / 删除连线（areas 限定显示区，menuBuilder 据此收进菜单）——
  // 删除右键的节点：连带清掉与它相连的边 + 从选中集移除；history 一次可撤销。
  ctx.commands.register({
    id: 'context-menu:delete-node',
    title: '删除节点',
    areas: ['node'],
    group: '节点',
    order: 10,
    run(_c, payload: { nodeId: string }) {
     const nodeId = payload?.nodeId
     if (!nodeId) return
      graph.removeNodes([nodeId])
   },
 })
  // 删除右键的连线（只删边，保留两端节点）
  ctx.commands.register({
    id: 'context-menu:delete-edge',
    title: '删除连线',
    areas: ['edge'],
    group: '连线',
    order: 10,
    run(_c, payload: { edgeId: string }) {
     const edgeId = payload?.edgeId
     if (!edgeId) return
      graph.removeEdges([edgeId])
   },
 })

  // —— 菜单浮层 UI（仅浏览器）——
  if (typeof window === 'undefined') return
  const state = reactive<MenuUiState>({ visible: false, x: 0, y: 0, mode: 'pane', items: [] })
  // 当前右键上下文（供命令执行时传 payload）
  let current: { nodeId?: string; edgeId?: string; flowPosition: { x: number; y: number } } = {
    flowPosition: { x: 0, y: 0 },
  }

  function openMenu(mode: ContextMenuMode, x: number, y: number, flowPosition: { x: number; y: number }, nodeId?: string, edgeId?: string): void {
    current = { nodeId, edgeId, flowPosition }
    // 新建节点候选 = nodeFactory 可创建类型（只列有 creator 的，避免建出无内容节点）
    const creatable = new Set(ctx.get<NodeFactoryService>('nodeFactory').creatableTypes())
    const nodeTypes = [...nodeStore.types.values()]
      .filter((t) => creatable.has(t.type))
      .map((t) => ({ type: t.type, label: t.label }))
    // G 项：菜单聚合走内核 menu 服务（与未来 toolbar/面板同一数据源），不再插件内自组。
    // areas 语义 = 开放注册：任何插件命令显式声明 areas 含当前 mode 即自动出现在右键，
    // 未声明 areas 的命令（纯快捷键）不进菜单 —— 无需本插件白名单。
    const raw = ctx.get<MenuService>('menu').menuFor(mode, nodeTypes)
    // UI 增强：补图标 + hover 描述（与快捷键面板同款 item 视觉）
    state.items = enrichMenuItems(raw)
    state.mode = mode
    state.x = x
    state.y = y
    state.visible = state.items.length > 0
  }

  function closeMenu(): void {
    state.visible = false
  }

  // ==================== 拖线落空白 → 临时菜单卡片 ====================
  // 临时卡片是**真节点**（进 nodeStore），临时连线是**真边**（进 edgeStore），都标 `transient`：
  //   - 渲染：VueFlow 正常画 → 缩放平移天然对齐（不再自绘坐标）；
  //   - 交互：渲染层对中间态关掉 draggable/selectable/deletable（点空白不会误删、不会连另一端一起没）；
  //   - 历史/落盘：createMiniCanvasHost 的 snapshot/commit 过滤中间态（不入撤销栈、刷新不复活）。
  // 判定由内核通用契约 isTransient 提供，本插件不自造标记。
  /** 当前临时节点 id / 临时边 id（同一时刻只允许一个临时菜单） */
  let tempNodeId: string | null = null
  let tempEdgeId: string | null = null
  /** 松手事实快照（点菜单项时据此建真节点真边） */
  let pendingFact: ConnectionDropFact | null = null

  /** 可建类型候选 = nodeFactory.creatableTypes() ∩ nodeStore.types（只列真能建出内容的） */
  function creatableNodeTypes(): Array<{ type: string; label: string }> {
    const creatable = new Set(ctx.get<NodeFactoryService>('nodeFactory').creatableTypes())
    return [...nodeStore.types.values()]
      .filter((t) => creatable.has(t.type))
      .map((t) => ({ type: t.type, label: t.label }))
  }

  /**
   * 节点是否"已就绪"（渲染层实测到非零尺寸 = 它确已进 VueFlow 内部 store）。
   * 连边前必须确认这件事，否则 VueFlow 的 setEdges 会因为 findNode 查不到端点而丢掉这条边。
   * nodeLayout 由渲染层注入（ResizeObserver 实测）；拿不到服务时退化为"只等一帧"。
   */
  function isNodeMeasured(nodeId: string): boolean {
    const layout = ctx.get<{ nodeSize?(id: string): { w: number; h: number } } | undefined>('nodeLayout')
    if (!layout?.nodeSize) return true
    const s = layout.nodeSize(nodeId)
    return s.w > 0 && s.h > 0
  }

  /** 拖线生效的最小拖拽距离（屏幕 px）：读 ⚙ 设置面板的值，未设置回落默认。 */
  function dragThreshold(): number {
    const v = ctx.get<{ get(key: string): unknown } | undefined>('settings')?.get('dragThreshold')
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_DRAG_THRESHOLD
  }

  /**
   * 等一个渲染帧（nextTick 只等微任务，等不到 ResizeObserver —— 它在帧末才回调）。
   * 无 rAF 环境（SSR/测试）退化为只等 nextTick。
   */
  function waitFrame(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame !== 'function') {
        void nextTick().then(() => resolve())
        return
      }
      requestAnimationFrame(() => {
        void nextTick().then(() => resolve())
      })
    })
  }

  /** 取消临时态：删掉临时节点与临时边（走 graph，但中间态不进历史/不落盘） */
  function clearTempConnection(): void {
    const edgeId = tempEdgeId
    const nodeId = tempNodeId
    tempEdgeId = null
    tempNodeId = null
    pendingFact = null
    // 临时节点被选中过：取消时把它从选中集移除（避免留下指向已删节点的幽灵选中）
    if (nodeId) selection.remove(nodeId)
    if (edgeId) graph.removeEdges([edgeId])
    if (nodeId) graph.removeNodes([nodeId])
  }

  /** 松手落空白：组装"引用该节点生成"菜单（可建类型先过一遍内核校验，滤掉点了必失败的） */
  function openConnectionMenu(payload: ConnectionDropPayload): void {
    // 拖拽距离不够（在端口上点了一下）→ 不弹菜单、不建临时节点。
    // 阈值来自 ⚙ 设置面板（Config.dragThreshold，屏幕 px），默认 DEFAULT_DRAG_THRESHOLD。
    if (payload.dragDistance < dragThreshold()) {
      clearTempConnection()
      return
    }
    const fact: ConnectionDropFact = {
      sourceNodeId: payload.sourceNodeId,
      sourceHandle: payload.sourceHandle,
      flowPosition: { x: payload.flowPosition.x, y: payload.flowPosition.y },
    }
    const sourceNodeType = nodeStore.getNode(fact.sourceNodeId)?.type
    const candidates = filterConnectableTypes({
      fact,
      sourceNodeType,
      types: creatableNodeTypes(),
      // 容量/重复判定只看正式边：中间态边（占位连线）不参与，否则自己的占位边会把候选全滤掉
      edges: ctx.get<EdgeStoreService>('edgeStore').getEdges().filter((e) => !isTempEdge(e)),
      getTypeConn: (type) => typeConnectionDef(nodeStore.types.get(type)),
    })
    const items = enrichMenuItems(buildConnectionMenuItems(candidates))
    // 上一次的临时态先清掉（重复拖线不会堆叠）
    clearTempConnection()
    if (items.length === 0) return

    // 端口位置 = 松手点：卡片按 portSideOf 摆放，让对应边的竖直中点落在松手点上。
    const size = connectionMenuCardSize(items.length)
    const position = placeByPortAnchor(fact.flowPosition, size, portSideOf(fact))
    const nodeId = `temp-menu-${Date.now()}`
    // ① 先放临时节点（进 nodeStore → VueFlow 渲染）。transient → 不进历史/不落盘。
    //    卡片尺寸由本插件的外壳按 items 自行计算（与 node.size 同源），无需再往 data 里塞尺寸。
    graph.addNodes([
      {
        id: nodeId,
        type: CONNECTION_MENU_TYPE,
        position,
        size,
        // portSide：告诉本插件的外壳只显示"落线那一侧"的端口（左=新节点输入口 / 右=新节点输出口）
        data: {
          transient: true,
          items,
          portSide: portSideOf(fact),
        },
      },
    ])
    tempNodeId = nodeId
    pendingFact = fact
    // 临时菜单节点创建后直接选中它（用户要求）
    selection.clearEdges()
    selection.set([nodeId])
    // ② 等临时节点"确已进 VueFlow 内部 store"再连边（时序硬要求，见 addEdgeWhenNodeReady 注释）
    void addEdgeWhenNodeReady({
      waitTick: () => waitFrame(),
      isNodeReady: () => true, // node already in nodeStore; v-if never removes its handle
      // 期间可能已被取消或被下一次拖线替换：此时不该再补边
      isAlive: () => tempNodeId === nodeId,
      addEdge: () => {
        const ep = resolveEdgeEndpoints(fact, nodeId)
        tempEdgeId = graph.addEdge({
          source: ep.source,
          target: ep.target,
          sourceHandle: ep.sourceHandle,
          targetHandle: ep.targetHandle,
          data: { transient: true },
        })
        return tempEdgeId
      },
    })
  }

  /** 卡片里点了某项：建真节点 + 真边，合成**一次撤销**（history.withRecord 只记最外层） */
  function onConnectionPick(item: ContextMenuItem): void {
    const fact = pendingFact
    // 先移除临时脚手架（临时节点+临时边），再建真节点真边：真边不会与占位边重复。
    clearTempConnection()
    if (!fact || item.kind !== 'create-node' || !item.nodeType) return
    const nodeType = item.nodeType
    // 关键：真节点的位置由**同一个** placeByPortAnchor 算出（端口锚点 = 松手点，尺寸取该类型默认尺寸），
    // 于是"临时卡片 → 真节点"切换时端口不跳位 —— 用户要求"与我创建节点输入端口的位置重合且保持不变"。
    const defaultSize = nodeStore.types.get(nodeType)?.defaultSize ?? { w: 256, h: 128 }
    const position = placeByPortAnchor(fact.flowPosition, defaultSize, portSideOf(fact))
    // 建节点走 nodeFactory（而不是 tx.createNode）：各节点插件注册的 creator 才知道自己的默认内容
    // （text 的"双击编辑"等）。
    const nodeId = ctx.get<NodeFactoryService>('nodeFactory').create(nodeType, position)
    // 菜单建出的真节点也直接选中它（用户要求）
    selection.clearEdges()
    selection.set([nodeId])
    // 等节点就绪再连边（时序硬要求，见 addEdgeWhenNodeReady 注释）
    void addEdgeWhenNodeReady({
      waitTick: () => waitFrame(),
      isNodeReady: () => true, // node already in nodeStore; v-if never removes its handle
      isAlive: () => Boolean(nodeStore.getNode(nodeId)), // 期间被撤销/删掉则不补
      addEdge: () => {
        const ep = resolveEdgeEndpoints(fact, nodeId)
        return graph.addEdge({
          source: ep.source,
          target: ep.target,
          sourceHandle: ep.sourceHandle,
          targetHandle: ep.targetHandle,
        })
      },
    })
  }

  /** 菜单项点击：建节点 → command:create-node；命令 → execute(commandId, 上下文 payload) */
  function onSelect(item: ContextMenuItem): void {
    closeMenu()
    const command = ctx.get<CommandService>('command')
    if (item.kind === 'create-node' && item.nodeType) {
      command.execute('command:create-node', {
        type: item.nodeType,
        position: current.flowPosition,
      })
      return
    }
    if (item.commandId) {
      const payload: Record<string, unknown> = {}
      if (current.nodeId) payload.nodeId = current.nodeId
      if (current.edgeId) payload.edgeId = current.edgeId
      command.execute(item.commandId, payload)
    }
  }

  // —— 渲染层右键事件 → 开菜单 ——
  ctx.on(RenderEvents.ContextMenuPane, (p: ContextMenuPanePayload) => {
    openMenu('pane', p.clientX, p.clientY, p.flowPosition)
  })

  // —— 渲染层"拖线落空白"事件 → 临时卡片 ——
  ctx.on(RenderEvents.ConnectionDropBlank, (p: ConnectionDropPayload) => {
    openConnectionMenu(p)
  })
  // 卡片经 ctx 事件回传：选类型 / 请求关闭（卡片跑在渲染子树里，拿不到插件闭包）
  ctx.on(CONNECTION_MENU_PICK_EVENT, (item: ContextMenuItem) => {
    onConnectionPick(item)
  })
  ctx.on(CONNECTION_MENU_CANCEL_EVENT, () => {
    clearTempConnection()
  })
  ctx.on(RenderEvents.ContextMenuNode, (p: ContextMenuNodePayload) => {
    // 右键节点即把它选为唯一选中（老版语义：右键菜单的复制/复制一份作用于被右键节点）
    selection.set([p.nodeId])
    selection.clearEdges()
    openMenu('node', p.clientX, p.clientY, p.flowPosition, p.nodeId, undefined)
  })
  ctx.on(RenderEvents.ContextMenuEdge, (p: ContextMenuEdgePayload) => {
    openMenu('edge', p.clientX, p.clientY, p.flowPosition, undefined, p.edgeId)
  })

  // —— 挂载浮层 + 点外部/Esc/滚轮关闭（ctx.effect 自动回收）——
  // createApp 的 props 传**同一个 reactive state 对象**：组件读 props.state.xxx 会建立响应式追踪，
  // openMenu/closeMenu 改 state 属性即自动触发浮层重渲染，无需任何手动同步。
  ctx.effect(() => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = createApp(ContextMenu as Component, {
      state, // reactive 对象整体传入；内部属性变化被组件读取时自动响应
      onSelect,
      onClose: closeMenu,
    })
    app.mount(container)

    function onPointerDown(e: PointerEvent): void {
      const el = e.target as HTMLElement | null
      if (el && el.closest('.ctx-menu')) return
      closeMenu()
    }
    function onKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeMenu()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('blur', closeMenu)
    document.addEventListener('scroll', closeMenu, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeydown, true)
      window.removeEventListener('blur', closeMenu)
      document.removeEventListener('scroll', closeMenu, true)
      app.unmount()
      container.remove()
    }
  })

  // —— 取消临时态：点画布空白 / Esc（临时节点与临时边都删掉）——
  ctx.effect(() => {
    /**
     * 点"临时卡片之外"的地方 = 取消。
     *
     * 两个坑都要避开：
     * ① 不能用 capture 阶段拦 document 的 pointerdown —— 它会抢在卡片内菜单项的 click 之前把临时节点清掉，菜单项永远点不到；
     * ② 不能用渲染层的 PaneClick —— 拖线松手后浏览器还会补一个 click，那时刚建的临时节点会被自己立刻删掉。
     * 这里用冒泡阶段 + "按下点是否落在卡片内"判断：既不吃掉卡片内的点击，也不受 click 补发影响。
     */
    function onPointerDown(e: PointerEvent): void {
      if (!tempNodeId && !tempEdgeId) return
      const el = e.target as HTMLElement | null
      if (el && el.closest('[data-connection-menu]')) return
      clearTempConnection()
    }
    function onKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && (tempNodeId || tempEdgeId)) clearTempConnection()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeydown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeydown, true)
    }
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const contextMenuPlugin: PluginModule = { name, inject, Config, apply }

