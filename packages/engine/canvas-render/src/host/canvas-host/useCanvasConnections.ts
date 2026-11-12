import { shallowRef } from 'vue'
import type { Connection } from '@vue-flow/core'
import { validateConnection, typeConnectionDef, type ValidationResult } from '@plume-canvas/canvas-data'
import { beginConnection, endConnection, createConnectionState } from '../connectionState'
import { RenderEvents } from '../renderEvents'
import { reasonText as reasonTextFrom } from '../../connection/reasonText'
import type { HoverDecision } from '../../connection/resolveFeedback'
import type { NodeRect } from '../../connection/geometry'
import { hitNodeIdAt } from '../canvasHostCore'
import type {
  ConnectionFeedbackState,
  FlowPoint,
  HoverFeedback,
  AimedTarget,
} from '../../contracts/connectionContext'
import type { CanvasHostHandle } from '../createPlumeHost'
import type { CanvasSurfaceHandle } from './types'

export function useCanvasConnections(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  surfaceRef: { value: CanvasSurfaceHandle | undefined }
  edges: () => Array<{ id: string; type: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>
  edgeDefaultType: () => string
  log: {
    debug(message: string, ...args: unknown[]): void
    log(message: string, ...args: unknown[]): void
    warn(message: string): void
  }
}) {
  const { hostRef, surfaceRef } = opts
  // 拖线连接过程反馈状态（能力层）。onConnectStart/onConnectEnd 写入；每帧 hover 由 ConnectionLineHost 写。
  // 同一引用经 renderContext provide，BaseNode/ConnectionLine 消费。
  const connectionState: ConnectionFeedbackState = createConnectionState()
  /** 拖线期间 Host 端实时 mouse 跟踪的 flow 坐标（VueFlow 自身 lineProps 不可靠时由这里兜底）。
   *  拖线开始时清零、mousemove 更新、connect-end 清零。供 ConnectionLineHost 渲染端点。 */
  const dragFlowPoint = shallowRef<FlowPoint | null>(null)

  // 连边校验走内核 connection 服务(自连/环/重复/朝向/类型声明)。
  // 返回 ValidationResult 的纯校验（供 isValidConnection / 拖线反馈 validateEdge 复用，reason 不丢弃）。
  // allowCommitted（默认 false）：是否把"端点相同的已提交边"放行为 ok ——
  // 只有 VueFlow 全量重喂已存边的重校验路径(isValidConnection)传 true；
  // 拖线 hover/drop 校验的新候选必须保持 false，让重复连线报 duplicate（"已存在同一条连线"气泡）。
  function checkConnection(
    source: string,
    target: string,
    sourceHandle?: string,
    targetHandle?: string,
    allowCommitted = false,
  ): ValidationResult {
    const h = hostRef.value
    if (!h) return { ok: false, reason: 'missing-node' }
    const map = new Map(h.nodeStore.getNodes().map((n) => [n.id, { id: n.id, type: n.type }]))
    // 幂等重校验：这条连接已真实存在于内核 edgeStore(=已提交的历史边)，不是新拖出的候选——
    // VueFlow 每次 setEdges 全量重喂都会把已存在边再校验一遍，若按"重复"驳回会把已落盘边丢掉(拖线后连线"看不见")。
    // 已存在的边放行(重复/环判定交给真正的新候选)。内核 edgeStore 天然按端点去重，故不影响数据唯一性。
    const alreadyCommitted = h.edgeStore
      .getEdges()
      .some(
        (e) =>
          e.source === source &&
          e.target === target &&
          (sourceHandle === undefined || e.sourceHandle === sourceHandle) &&
          (targetHandle === undefined || e.targetHandle === targetHandle),
      )
    if (alreadyCommitted) {
      if (allowCommitted) {
        // 高频路径：每次 VueFlow 重挂都会对每条已提交边跑一遍（O(边数)）——插件/边一多必刷屏。
        // 降为 debug（默认静音，localStorage.v2debug=1 打开），真正的"新候选非法"仍走 warn。
        opts.log.debug(`checkConnection ${source}→${target} = 已提交边，幂等放行`)
        return { ok: true, reason: 'ok' as const }
      }
      // 新候选语义：端点完全相同的边已存在 → duplicate（"已存在同一条连线"气泡）
      return { ok: false, reason: 'duplicate' }
    }
    const res = validateConnection(
      { source, sourceHandle: sourceHandle ?? undefined, target, targetHandle: targetHandle ?? undefined },
      { nodes: map, edges: opts.edges(), getTypeConn: (t) => typeConnectionDef(h.nodeStore.types.get(t)) },
    )
    if (!res.ok) opts.log.warn(`checkConnection ${source}→${target} 非法:${res.reason}`)
    return res
  }

  function isValidConnection(conn: Connection): boolean {
    if (!conn.source || !conn.target) return false
    return checkConnection(
      conn.source,
      conn.target,
      conn.sourceHandle ?? undefined,
      conn.targetHandle ?? undefined,
      true,
    ).ok
  }

  /**
   * 拖线反馈用的候选校验：给(规范 source,target)返回非法文案(空串=合法)。
   * 供 ConnectionLineHost 每帧 resolveFeedback 判定 hover valid/invalid 用。
   */
  function validateEdgeText(sourceId: string, targetId: string): string {
    const res = checkConnection(sourceId, targetId)
    return res.ok ? '' : reasonTextFrom(res.reason)
  }

  // —— 拖线生命周期：connect-start 记源+挂全局 mousemove 日志；connect-end 用 mouseup 自带的 clientX/Y 解析吸附建边 ——
  /** 本次拖线手势是否已走 @connect(精确 handle) 建边。connect-end 判 drop 建边时据此避免双建。 */
  let connectedThisGesture = false
  /** 上一次 mousemove 日志写入时间（throttle 50ms，避免每帧刷屏） */
  let lastDragHoverLogAt = 0
  /** 本次拖线源端快照（onConnectEnd 用） */
  let dragSourceId = ''
  let dragSourceHandle: 'source' | 'target' = 'source'
  /** 本次拖线的按下点（屏幕坐标）：用于算"拖了多远"，供消费方按阈值区分拖线/点一下 */
  let dragStartClient: { x: number; y: number } | null = null
  /** 最近一次全局按下点（capture 阶段记录；拖线开始时作为起点快照） */
  let lastPointerDownClient: { x: number; y: number } | null = null
  function onGlobalPointerDown(e: MouseEvent): void {
    lastPointerDownClient = { x: e.clientX, y: e.clientY }
  }
  /** mousemove/mouseup 是否在拖线期间挂上（用于 onMounted 早期 + boot 顺序保证） */
  let dragListenersBound = false
  /** rAF 节流：mousemove 高频，只记最新一次 client 坐标；rAF 内做吸附判定+写 state，避免每帧都跑导致卡顿 */
  let dragRafId = 0
  let pendingClient: { x: number; y: number } | null = null

  function onConnectStart(p: { nodeId?: string; handleId: string | null; handleType?: 'source' | 'target' }): void {
    if (!p.nodeId) return
    const handleType = p.handleType ?? (p.handleId as 'source' | 'target') ?? 'source'
    connectedThisGesture = false
    dragSourceId = p.nodeId
    dragSourceHandle = handleType === 'target' ? 'target' : 'source'
    // 按下点快照：VueFlow 的 connectStart 不带鼠标坐标，这里记全局 pointerdown 位置兜底（见 onDragMouseMove 首帧回填）
    dragStartClient = lastPointerDownClient
    dragFlowPoint.value = null
    opts.log.log(`connectStart node=${p.nodeId} handle=${p.handleId} type=${handleType} (挂 drag listeners)`)
    beginConnection(connectionState, {
      sourceNodeId: p.nodeId,
      sourceHandle: dragSourceHandle,
    })
    // 拖线期间挂全局 mousemove/mouseup（捕获阶段优先于 VueFlow 的事件，确保一定能拿到鼠标坐标）
    if (!dragListenersBound) {
      document.addEventListener('mousemove', onDragMouseMove, true)
      document.addEventListener('mouseup', onDragMouseUp, true)
      dragListenersBound = true
    }
  }

  /** 拖线 mousemove：取最新 client 坐标，**rAF 节流**做吸附判定+写 dragFlowPoint/hoverNode（避免每帧都跑导致卡顿） */
  function onDragMouseMove(ev: MouseEvent): void {
    if (!dragSourceId) return
    // 每次 mousemove 只更新最新坐标；具体 resolveFeedback 与写 state 都放到下一帧 rAF 内（合并批次）
    pendingClient = { x: ev.clientX, y: ev.clientY }
    if (dragRafId) return
    dragRafId = requestAnimationFrame(() => {
      dragRafId = 0
      if (!pendingClient || !dragSourceId) return
      const { x, y } = pendingClient
      pendingClient = null
      const flowPoint = clientToFlow(x, y)
      // 命中来源 = 前端 mouse 事件上报的 aimedTarget（不再几何重算）；线端点跟鼠标，命中合法 snap 才吸锚点
      const target = resolveFromAim(connectionState.aimedTarget.value, flowPoint)
      // 写 dragFlowPoint（给 ConnectionLineHost 渲染端点）
      dragFlowPoint.value = { x: target.point.x, y: target.point.y }
      // 写 hoverNode（给 BaseNode 3D/气泡/吸附带 + ConnectionLineHost hasSnap）。rAF 内合并避免每帧多次写 ref
      const h = target.hover
      const nextHover: HoverFeedback | null = h ? enrichHover(h, dragSourceHandle, dragSourceId, target.point) : null
      // 变化比对（与 v1 思路一致：避免无谓写触发下游重渲）
      const cur = connectionState.hoverNode.value
      const changed =
        cur?.nodeId !== nextHover?.nodeId ||
        cur?.status !== nextHover?.status ||
        cur?.zone !== nextHover?.zone ||
        cur?.reason !== nextHover?.reason ||
        cur?.flowPosition?.x !== nextHover?.flowPosition?.x ||
        cur?.flowPosition?.y !== nextHover?.flowPosition?.y
      if (changed) {
        connectionState.hoverNode.value = nextHover
        // 节流日志（50ms 一次），hover 状态变更时打
        const now = Date.now()
        if (now - lastDragHoverLogAt >= 50) {
          lastDragHoverLogAt = now
          opts.log.log(
            `drag hover client=${Math.round(x)},${Math.round(y)} flow=${Math.round(target.point.x)},${Math.round(target.point.y)} ${nextHover ? `→ ${nextHover.nodeId}/${nextHover.status}/${nextHover.zone}${nextHover.reason ? ' ' + nextHover.reason : ''}` : '空'}`,
          )
        }
      }
    })
  }

  /** 拖线 mouseup：用 mouseup 事件自带的 clientX/Y 直接解析吸附（跟 v1 useCanvasConnection.onConnectEnd 同思路） */
  function onDragMouseUp(ev: MouseEvent): void {
    // 仅在拖线源端快照存在时处理（避免与其它业务 mouseup 冲突）
    if (!dragSourceId) return
    // 取消未触发的 rAF（直接走 mouseup 路径）
    if (dragRafId) {
      cancelAnimationFrame(dragRafId)
      dragRafId = 0
      pendingClient = null
    }
    const flowPoint = clientToFlow(ev.clientX, ev.clientY)
    const target = resolveFromAim(connectionState.aimedTarget.value, flowPoint)
    // 同步最后一次 mouseup 坐标到 dragFlowPoint（让 release 那一帧连接线也对齐）
    dragFlowPoint.value = { x: target.point.x, y: target.point.y }
    const drop = decideDropFromHover(dragSourceId, dragSourceHandle, target)
    opts.log.log(
      `drop resolve client=${Math.round(ev.clientX)},${Math.round(ev.clientY)} flow=${Math.round(target.point.x)},${Math.round(target.point.y)} ${drop ? `→ ${drop.source}→${drop.target}/${drop.zone}` : '→ 空白(松空)'}`,
    )
    if (drop) {
      // checkConnection 兜底：drop 来源于 aimedTarget(前端 mouse 上报)的 hover 状态，hover 在合法→非法
      // 之间可能滞后一帧，此处再跑一次内核校验保证 capacity/类型/环/重等规则硬拦截——例如目标节点
      // 输入口 capacity 已满(已有入边)时直接拒，不进入 commitEdge。
      const res = checkConnection(drop.source, drop.target)
      if (!res.ok) opts.log.warn(`drop ${drop.source}→${drop.target} 非法:${res.reason}`)
      else commitEdge(drop.source, drop.target)
    } else {
      // 没建成边有三种情况，只有"真落在空白"才广播 —— 落在节点卡片上（连接不成立/方向不符）
      // 不该冒出"在此处新建节点"的菜单。用几何命中判定：拖线期间画布挂着 .connecting 覆盖层，
      // elementFromPoint 会命中覆盖元素而非卡片（已踩过这个坑）。
      const landedOnNode = hitNodeIdAt(
        target.point,
        connectableNodeRects().map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.width, h: r.height })),
      )
      if (landedOnNode) {
        opts.log.log(`drop 落在节点 ${landedOnNode} 上但连接不成立（非法/方向不符），不广播空白`)
      } else {
        // 空白松手：只广播事实（谁、从哪个口、落在哪），不决定 UI —— 消费方(plugin-context-menu 等)
        // 可据此放临时节点/弹菜单。hostRef 可能尚未就绪（boot 早期），则跳过广播。
        hostRef.value?.ctx.emit(RenderEvents.ConnectionDropBlank, {
        clientX: ev.clientX,
        clientY: ev.clientY,
        flowPosition: { x: target.point.x, y: target.point.y },
        sourceNodeId: dragSourceId,
        sourceHandle: dragSourceHandle,
        // 本次拖线位移（屏幕 px）：消费方据此区分"真拖线"与"在端口上点一下"
        dragDistance: dragStartClient
          ? Math.hypot(ev.clientX - dragStartClient.x, ev.clientY - dragStartClient.y)
          : 0,
        })
      }
    }
    // 清源快照（避免后续普通 mouseup 误触发），监听本身留给 onConnectEnd 拆
    dragSourceId = ''
    dragSourceHandle = 'source'
  }

  /** client 坐标 → flow 坐标（用 VueFlow 自带 screenToFlowCoordinate：缩放/平移/zoom 完全可靠，
   *  比手算 paneRect.left / zoom 准）。boot 前/未挂载时回退 client 当 flow（兜底） */
  function clientToFlow(clientX: number, clientY: number): { x: number; y: number } {
    const surface = surfaceRef.value
    if (surface?.screenToFlow) return surface.screenToFlow(clientX, clientY)
    return { x: clientX, y: clientY }
  }

  /** 取 host 内核中存活节点矩形（flow 坐标）。
   *  尺寸优先用 nodeLayout 的**实测值**（ResizeObserver 量到的真实渲染尺寸），
   *  退而用内核声明的 size，最后才是兜底 —— 否则卡片实际高度与兜底值不同，命中判定会偏。 */
  function liveNodeRects(): NodeRect[] {
    const h = hostRef.value
    if (!h) return []
    const layout = h.view
    return h.nodeStore.getNodes().map((n) => {
      const abs = layout?.absolutePosition ? layout.absolutePosition(n.id) : (n.position ?? { x: 0, y: 0 })
      const size = layout?.nodeSize ? layout.nodeSize(n.id) : { w: n.size?.w ?? 256, h: n.size?.h ?? 128 }
      return {
        id: n.id,
        type: n.type,
        x: abs.x,
        y: abs.y,
        width: size.w || 256,
        height: size.h || 128,
      }
    })
  }

  /** 可参与拖线命中的节点矩形：排除"无端口"类型（inputs/outputs 均声明为空，如分组容器）。
   *  容器不参与连接 —— 拖线悬停不产生 hover 反馈，松手按空白处理（可弹新建菜单）。 */
  function connectableNodeRects(): NodeRect[] {
    const h = hostRef.value
    if (!h) return []
    const portless = (type: string): boolean => {
      const def = h.nodeStore.types.get(type)
      return !def || (def.inputs?.length === 0 && def.outputs?.length === 0)
    }
    return liveNodeRects().filter((r) => r.type != null && !portless(r.type))
  }

  /** 由前端上报的 aimedTarget（mouse 事件驱动）解析当前 hover + 线端点。
   *  命中来源是前端 .moving-handle-zone / 卡片的 mouseenter 上报，后端不再几何重算吸附带。
   *  point = 连接线临时端点：命中**合法 snap 吸附带**时吸到端口锚点；否则(卡片 body/空白/非法)跟鼠标。 */
  function resolveFromAim(
    aim: AimedTarget | null,
    flowPoint: { x: number; y: number },
  ): { point: { x: number; y: number }; hover: HoverDecision | null } {
    if (!aim || !dragSourceId) return { point: flowPoint, hover: null }
    const reverse = dragSourceHandle === 'target'
    const dir = reverse ? 'reverse' : 'forward'
    // 方向匹配：forward(拖 source 口)只认对方 input(输入口) 或 body；reverse(拖 target 口)只认 output(输出口) 或 body。
    // 方向不符的端口侧直接视为空白（与原几何「只生成方向侧吸附带」一致）。
    if (aim.side !== 'body') {
      const expectSide = reverse ? 'output' : 'input'
      if (aim.side !== expectSide) return { point: flowPoint, hover: null }
    }
    // 候选边 + 业务校验（类型/容量/方向，与 checkConnection 同源）
    const candidate = reverse
      ? { source: aim.nodeId, target: dragSourceId }
      : { source: dragSourceId, target: aim.nodeId }
    const msg = validateEdgeText(candidate.source, candidate.target)
    // 端口锚点：优先用前端上报的 anchor（真实渲染高度 cardHeight 算，保证居中）；
    // 无 anchor 时回落到节点矩形左缘/右缘中点（body 命中跟鼠标，不需锚点）。
    const rect = liveNodeRects().find((r) => r.id === aim.nodeId)
    const anchorX =
      aim.anchor?.x ?? (rect ? (dir === 'forward' ? rect.x : rect.x + rect.width) : flowPoint.x)
    const anchorY = aim.anchor?.y ?? (rect ? rect.y + rect.height / 2 : flowPoint.y)
    const zone: 'snap' | 'body' = aim.side === 'body' ? 'body' : 'snap'
    const hover: HoverDecision = {
      nodeId: aim.nodeId,
      status: msg ? 'invalid' : 'valid',
      zone,
      portSide: zone === 'snap' ? (dir === 'forward' ? 'input' : 'output') : undefined,
      reason: msg || undefined,
    }
    // 仅合法 snap(端口吸附带)把线端吸到端口锚点；body/空白/非法保持跟鼠标（body 松手仍可连）
    const snapped = !msg && zone === 'snap'
    return { point: snapped ? { x: anchorX, y: anchorY } : flowPoint, hover }
  }

  /** 给定 hover 决策 + 源信息，补全成富 HoverFeedback（nodeType/nodeData/nodeEl/willEvict） */
  function enrichHover(
    h: HoverDecision,
    sourceHandle: 'source' | 'target',
    sourceId: string,
    flowPoint: FlowPoint,
  ): HoverFeedback {
    const host = hostRef.value
    const node = host?.nodeStore.getNode(h.nodeId)
    // 新边真正的"输入端接收节点"：forward=悬停节点；reverse(从 input 反拖)=发起反向拖的源节点
    const receiverId = sourceHandle === 'target' ? sourceId : h.nodeId
    const tgtNode = host?.nodeStore.getNode(receiverId)
    const tgtType = tgtNode ? host?.nodeStore.types.get(tgtNode.type) : undefined
    const inputDef = tgtType?.inputs?.find((i) => !i.port || i.port === 'target')
    const capacity = inputDef?.capacity
    const incoming = host ? host.edgeStore.getEdges().filter((e) => e.target === receiverId).length : 0
    // 输入口已满额(>=capacity>1) → 本次连接将挤最老一条（evict 为 render 默认行为）
    const willEvict = !!capacity && capacity > 1 && incoming >= capacity
    let nodeEl: HTMLElement | null = null
    try {
      nodeEl = surfaceRef.value?.queryNodeEl?.(h.nodeId) ?? null
    } catch {
      /* SSR/测试环境无 DOM：忽略 */
    }
    return {
      nodeId: h.nodeId,
      status: h.status,
      zone: h.zone,
      flowPosition: flowPoint,
      reason: h.reason,
      portSide: h.portSide,
      nodeType: node?.type,
      willEvict,
      nodeData: node ? { id: node.id, type: node.type, data: node.data } : null,
      nodeEl,
    }
  }

  /** 把 hover 决策转成规范 (source,target) 候选；空白则 null */
  function decideDropFromHover(
    sourceId: string,
    sourceHandle: 'source' | 'target',
    target: { hover: HoverDecision | null },
  ): { source: string; target: string; zone: 'snap' | 'body' } | null {
    const h = target.hover
    if (!h || h.status !== 'valid') return null
    // reverse 方向（从 target口反向连）需把 source/target 对调
    return sourceHandle === 'target'
      ? { source: h.nodeId, target: sourceId, zone: h.zone }
      : { source: sourceId, target: h.nodeId, zone: h.zone }
  }

  function onConnectEnd(): void {
    // @connect 与 drag mouseup 都会尝试建边 — 二者任一成功则跳过另一。
    // 注：VueFlow 顺序：精确命中 handle → @connect(先) → mouseup → @connect-end。@connect 已建则 commitEdge 也会被幂等挡掉。
    // 这里仅负责清空状态 + 拆监听（拖线 mouseup 在 mousemove 同源时已 commit）。
    endConnection(connectionState)
    connectedThisGesture = false
    if (dragListenersBound) {
      document.removeEventListener('mousemove', onDragMouseMove, true)
      document.removeEventListener('mouseup', onDragMouseUp, true)
      dragListenersBound = false
    }
    dragSourceId = ''
    dragSourceHandle = 'source'
    dragFlowPoint.value = null
    // 收尾清 rAF（避免异步 rAF 在手势结束后还写 state）
    if (dragRafId) {
      cancelAnimationFrame(dragRafId)
      dragRafId = 0
    }
    pendingClient = null
    opts.log.log('connectEnd 清空反馈')
  }

  function onConnect(conn: Connection): void {
    opts.log.log(`connect 事件 ${conn.source}→${conn.target}`, conn)
    connectedThisGesture = true
    if (!isValidConnection(conn) || !conn.source || !conn.target) {
      connectedThisGesture = false
      opts.log.warn(`connect 被拒(非法或缺端点) ${conn.source}→${conn.target}`)
      return
    }
    commitEdge(conn.source, conn.target, conn.sourceHandle ?? undefined, conn.targetHandle ?? undefined)
  }

  /**
   * 真正落一条边：内核校验硬兜底 + 幂等去重(已存在同源同目标同 handle 的边则不重复建) + 记历史 + 落盘。
   * @connect(精确命中 handle) 与 connect-end 的 lastDrop(body/snap 松开) 两条路径都走这里，保证不会双建。
   *
   * 内核校验：所有提交路径(@connect、drop)都已经过 isValidConnection / checkConnection，但落一道兜底
   * 防止未来新路径漏校验——比如目标节点输入口 capacity 已满(已有入边)时禁止再建（同源节点多次连向
   * 同一目标会被内核返回 limit-reached 而拒；本函数不再 evict 第一条，由 evictOldestIncoming 单独控）。
   */
  function commitEdge(
    source: string,
    target: string,
    sourceHandle?: string,
    targetHandle?: string,
  ): void {
    const h = hostRef.value
    if (!h) return
    // 全路径统一入口：校验（自连/环/重/类型/朝向）+ 满额挤出（capacity/evictOnFull）+ 落边，
    // 全在 graph.connectEdge 一处。渲染层不再自查一遍 —— 以前"拖线能连、批量连被拒"就是
    // 两套判定漂移造成的。edge type（边外观类型）仍由本层补上（那是渲染层才知道的默认皮）。
    const res = h.graph.connectEdge({
      source,
      target,
      type: opts.edgeDefaultType(),
      sourceHandle: sourceHandle ?? undefined,
      targetHandle: targetHandle ?? undefined,
    })
    if (res.status === 'rejected') opts.log.warn(`commitEdge ${source}→${target} 被拒:${res.reason}`)
    else if (res.status === 'duplicate') opts.log.log(`commitEdge ${source}→${target} 已存在，幂等跳过`)
    else if (res.evictedEdgeId) opts.log.log(`commitEdge ${source}→${target} 成功，满额挤出最老边 ${res.evictedEdgeId}`)
    else opts.log.log(`commitEdge 建边成功 ${source}→${target}`)
  }

  return {
    connectionState,
    dragFlowPoint,
    checkConnection,
    isValidConnection,
    validateEdgeText,
    clientToFlow,
    onGlobalPointerDown,
    onConnectStart,
    onConnectEnd,
    onConnect,
  }
}
