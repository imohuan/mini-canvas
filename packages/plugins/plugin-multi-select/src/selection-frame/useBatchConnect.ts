import { computed, ref } from 'vue'
import {
  DEFAULT_SNAP_ZONE_CONFIG,
  reasonText as reasonTextFrom,
  resolveFeedback,
  type CanvasRenderContext,
} from '@plume-canvas/canvas-render'
import { typeConnectionDef, validateConnection } from '@plume-canvas/canvas-data'
import {
  buildBatchGuideLines,
  markGuideLines,
  planBatchApply,
  planBatchEdges,
  toNodeRects,
  type BatchGuideLine,
  type BatchSide,
} from '../batchConnect'
import type { MultiSelectRect, SelectionFrameGeometry } from '../multiSelectEngine'

interface BatchDeps {
  sel: () => { ids: ReadonlySet<string> }
  layout: () => CanvasRenderContext['ctx']['view'] | undefined
  nodeStore: () => {
    getNodes(): Array<{ id: string; type: string }>
    types: ReadonlyMap<string, Parameters<typeof typeConnectionDef>[0]>
  }
  edgeStore: () => { getEdges(): Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }> } | undefined
  graph: () => { transaction<T>(reason: string, fn: (tx: { connectEdge(input: { source: string; target: string; sourceHandle?: string; targetHandle?: string }): unknown }) => T): T }
  screenToFlowPoint: (x: number, y: number) => { x: number; y: number }
  pane: { value: HTMLElement | null }
  viewport: { value: { x: number; y: number; zoom: number } }
  handleParams: CanvasRenderContext['handleParams']
  connectionState: CanvasRenderContext['connectionState']
  snapZone: CanvasRenderContext['snapZone']
}

/** 批量连线的拖动状态、预览与落边。 */
export function useBatchConnect(input: BatchDeps) {
  const batchSide = ref<BatchSide | null>(null)
  /** 拖动中的鼠标位置（屏幕坐标，用于画引导线） */
  const batchCursor = ref<{ x: number; y: number } | null>(null)
  const isBatchConnecting = computed(() => batchSide.value !== null)
  const batchSnapAnchor = ref<{ x: number; y: number } | null>(null)
  const batchDropId = ref<string | null>(null)

  const batchPlan = computed(() => {
    const side = batchSide.value
    const dropId = batchDropId.value
    if (!side || !dropId) return null
    const specs = planBatchEdges(side, input.sel().ids, dropId)
    if (specs.length === 0) return null
    const graphEdges = input.edgeStore()?.getEdges() ?? []
    const isDuplicate = (s: { source: string; target: string }): boolean =>
      graphEdges.some(
        (x) =>
          (x.source === s.source && x.target === s.target) ||
          (x.source === s.target && x.target === s.source),
      )
    return planBatchApply(specs, {
      isDuplicate,
      canConnect: (s, alreadyPlanned) =>
        validateBatchEdge(s.source, s.target, alreadyPlanned.length === 0 ? [] : alreadyPlanned),
    })
  })

  function onBatchConnectStart(event: MouseEvent, side: BatchSide): void {
    if (isBatchConnecting.value) return
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    batchSide.value = side
    batchCursor.value = { x: event.clientX, y: event.clientY }
    batchSnapAnchor.value = null
    const cs = input.connectionState
    if (cs) {
      const ids = [...input.sel().ids]
      cs.activeConnection.value = {
        sourceNodeId: ids[0] ?? '',
        sourceNodeIds: ids,
        sourceHandle: side,
      }
      cs.hoverNode.value = null
      cs.suppressHandles.value = true
    }
    window.addEventListener('pointermove', onBatchMove)
    window.addEventListener('pointerup', onBatchUp)
  }

  function onBatchMove(e: PointerEvent): void {
    if (!isBatchConnecting.value) return
    batchCursor.value = { x: e.clientX, y: e.clientY }
    refreshBatchFeedback()
  }

  function refreshBatchFeedback(): void {
    const cs = input.connectionState
    const side = batchSide.value
    const cursor = batchCursor.value
    if (!cs || !side || !cursor) return
    const l = input.layout()
    const ids = [...input.sel().ids]
    if (!l || ids.length === 0) return

    const flowPoint = input.screenToFlowPoint(cursor.x, cursor.y)
    batchDropId.value = nodeIdAtClient(cursor.x, cursor.y)
    const plan = batchPlan.value
    const anyConnectable = !!plan && plan.build.length > 0

    const selected = new Set(ids)
    const nodeRects = toNodeRects(l.getAllRects().filter((r) => !selected.has(r.id)))
    const handleRadius = Number(input.handleParams.portZoneWidth) || 0

    const reasonFor = (source: string, target: string): string => {
      const store = input.nodeStore()
      const nodes = new Map(store.getNodes().map((n) => [n.id, { id: n.id, type: n.type }]))
      const res = validateConnection(
        { source, sourceHandle: 'source', target, targetHandle: 'target' },
        { nodes, edges: input.edgeStore()?.getEdges() ?? [], getTypeConn: (t) => typeConnectionDef(store.types.get(t)) },
      )
      return res.ok ? '' : reasonTextFrom(res.reason)
    }

    const snapCfg = { ...DEFAULT_SNAP_ZONE_CONFIG, ...(input.snapZone ?? {}) }
    let hoverZone: { nodeId: string; zone: 'snap' | 'body'; portSide?: 'input' | 'output' | null } | null = null
    let snapAnchor: { x: number; y: number } | null = null
    for (const id of ids) {
      const r = resolveFeedback({
        sourceId: id,
        sourceHandle: side === 'source' ? 'source' : 'target',
        nodeRects,
        flowPoint,
        handleRadius,
        config: snapCfg,
        validate: () => '',
      })
      if (!r.hover) continue
      hoverZone = { nodeId: r.hover.nodeId, zone: r.hover.zone, portSide: r.hover.portSide }
      snapAnchor = r.snappedToId ? r.end : null
      break
    }

    if (!hoverZone) {
      cs.hoverNode.value = null
      batchSnapAnchor.value = null
      return
    }

    const rejectedReason =
      plan && plan.build.length === 0 && plan.rejected.length > 0
        ? reasonFor(plan.rejected[0].source, plan.rejected[0].target) || '无法连接'
        : undefined
    cs.hoverNode.value = {
      nodeId: hoverZone.nodeId,
      status: anyConnectable ? 'valid' : 'invalid',
      zone: hoverZone.zone,
      flowPosition: flowPoint,
      reason: rejectedReason,
      portSide: hoverZone.portSide ?? undefined,
    }
    batchSnapAnchor.value = snapAnchor
  }

  function onBatchUp(e: PointerEvent): void {
    if (!isBatchConnecting.value) return
    const side = batchSide.value as BatchSide
    window.removeEventListener('pointermove', onBatchMove)
    window.removeEventListener('pointerup', onBatchUp)
    batchDropId.value = nodeIdAtClient(e.clientX, e.clientY)
    const plan = batchPlan.value
    batchSide.value = null
    batchCursor.value = null
    batchDropId.value = null
    const cs = input.connectionState
    if (cs) {
      cs.activeConnection.value = null
      cs.hoverNode.value = null
      cs.suppressHandles.value = false
    }
    batchSnapAnchor.value = null
    if (!plan || plan.build.length === 0) return
    const g = input.graph()
    g.transaction('batch-connect', (tx) => {
      for (const s of plan.build) {
        tx.connectEdge({ source: s.source, target: s.target, sourceHandle: s.sourceHandle, targetHandle: s.targetHandle })
      }
    })
  }

  function nodeIdAtClient(clientX: number, clientY: number): string | null {
    const l = input.layout()
    if (!l) return null
    const p = input.screenToFlowPoint(clientX, clientY)
    const hit = l.getAllRects().find((r) => pointInRect(p, r))
    return hit ? hit.id : null
  }

  function validateBatchEdge(
    source: string,
    target: string,
    alreadyPlanned: ReadonlyArray<{ source: string; target: string; sourceHandle?: string; targetHandle?: string }> = [],
  ): boolean {
    const store = input.nodeStore()
    const nodes = new Map(store.getNodes().map((n) => [n.id, { id: n.id, type: n.type }]))
    const planned = alreadyPlanned.map((s) => ({
      id: `__planned__${s.source}->${s.target}`,
      source: s.source,
      target: s.target,
      sourceHandle: s.sourceHandle,
      targetHandle: s.targetHandle,
    }))
    const res = validateConnection(
      { source, sourceHandle: 'source', target, targetHandle: 'target' },
      {
        nodes,
        edges: [...(input.edgeStore()?.getEdges() ?? []), ...planned],
        getTypeConn: (t) => typeConnectionDef(store.types.get(t)),
      },
    )
    return res.ok
  }

  const guideLines = computed<BatchGuideLine[]>(() => {
    if (!isBatchConnecting.value || !batchCursor.value) return []
    const side = batchSide.value
    const l = input.layout()
    if (!l || !side) return []
    const ids = [...input.sel().ids]
    const rects = ids.map((id) => l.getNodeRect(id)).filter((r): r is MultiSelectRect => r !== null)
    const vp = input.viewport.value
    const paneEl = input.pane?.value
    const rect = paneEl?.getBoundingClientRect()
    if (!rect) return []
    const toScreen = (p: { x: number; y: number }) => ({
      x: p.x * (vp.zoom || 1) + vp.x + rect.left,
      y: p.y * (vp.zoom || 1) + vp.y + rect.top,
    })
    const cursorFlow = input.screenToFlowPoint(batchCursor.value.x, batchCursor.value.y)
    const raw = buildBatchGuideLines(side, ids, rects, cursorFlow, batchSnapAnchor.value)
    const marked = batchPlan.value ? markGuideLines(raw, batchPlan.value, side) : raw
    return marked.map((line) => ({
      ...line,
      from: toScreen(line.from),
      to: toScreen(line.to),
    }))
  })

  return {
    batchSide,
    batchCursor,
    isBatchConnecting,
    batchSnapAnchor,
    batchDropId,
    batchPlan,
    onBatchConnectStart,
    onBatchMove,
    refreshBatchFeedback,
    onBatchUp,
    nodeIdAtClient,
    validateBatchEdge,
    guideLines,
  }
}

function pointInRect(p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

export function useBatchHandleGeometry(input: {
  sel: () => { ids: ReadonlySet<string> }
  layout: () => CanvasRenderContext['ctx']['view'] | undefined
  frame: { value: SelectionFrameGeometry | null }
  handleParams: CanvasRenderContext['handleParams']
}) {
  const BATCH_ZONE_MIN_HEIGHT = 72
  const portZoneWidth = computed(() => Number(input.handleParams.portZoneWidth) || 0)
  const portZoneBaseHeight = computed(() => {
    const l = input.layout()
    if (!l) return 0
    let max = 0
    for (const id of input.sel().ids) {
      const r = l.getNodeRect(id)
      if (r && r.h > max) max = r.h
    }
    return max
  })
  const portZoneHeight = computed(() => {
    const ratio = Math.min(Math.max(Number(input.handleParams.portZoneHeightRatio) || 0.8, 0), 1)
    return Math.max(portZoneBaseHeight.value * ratio, BATCH_ZONE_MIN_HEIGHT)
  })
  const portZoneOffset = computed(() => Number(input.handleParams.portZoneOffset) || 0)
  const portZoneShape = computed(() => input.handleParams.portZoneShape ?? 'arc')
  const portZoneArcRatio = computed(() => input.handleParams.portZoneArcRatio ?? 0.8)

  return { portZoneWidth, portZoneHeight, portZoneOffset, portZoneShape, portZoneArcRatio }
}
