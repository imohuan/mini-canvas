import { shallowRef } from 'vue'
import {
  expandDragProtection,
  needsLiveProtectionCollection,
  pruneProtectionIds,
} from '../canvasHostCore'
import { computeVisibleIds, type VisibleCullConfig } from '../visibleCull'
import { viewportRectInFlow } from '../../geometry/visibleArea'
import type { CanvasInteractionSettings } from '../../contracts/canvasInteractionSettings'
import type { CanvasHostHandle } from '../createMiniCanvasHost'
import type { CanvasSurfaceHandle } from './types'

export function useCanvasCulling(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  surfaceRef: { value: CanvasSurfaceHandle | undefined }
  interactionSettings: CanvasInteractionSettings
  syncNodesFromStore: () => void
  isNodeDragging: () => boolean
}) {
  const { hostRef, surfaceRef, interactionSettings } = opts

  /**
   * cullIds = 视口(+缓冲带)内节点 id 集合（null = 不剔除）。
   * hidden 路线已退役（2026-10-26）：VueFlow EdgeWrapper 对 hidden 端点的边整体不画，
   * 连线跟着节点消失（用户实测断线）。集合现在只用于派生 data._cullState
   * （visible / culled / culled-linked，见 canvasHostCore.nodesFromStore），
   * 节点一律常驻渲染，绘制深度由壳按状态自选。
   * 刷新时机：CanvasSurface 的 visibleRect 每帧变化回调（rAF 节流）+ store/选中重灌前现算，
   * 保证两条重灌路径拿到的都是同一份最新集合。
   */
  const cullIds = shallowRef<ReadonlySet<string> | null>(null)

  /**
   * 写入可见集合，**内容相同就保持旧引用**。
   *
   * 为什么必须做（2026-11-05 真机报 "Maximum recursive updates exceeded in <CanvasSurface>"）：
   * computeVisibleIds 每次都新建 Set，而 cullIds 是 shallowRef —— 无脑赋值会让引用变化，
   * 依赖它的 syncNodesFromStore / watch 全部重新执行；重灌又会再算一次可见集合，
   * 于是形成「重灌 → 重算 → 引用变化 → 再重灌」的自激循环，Vue 判定递归更新超限。
   * 集合内容没变时复用旧引用，Vue 就不会把这次写入当成更新。
   */
  function setCullIds(next: Set<string> | null): void {
    const prev = cullIds.value
    if (prev === next) return
    if (prev === null || next === null) {
      cullIds.value = next
      return
    }
    if (prev.size === next.size) {
      let same = true
      for (const id of next) {
        if (!prev.has(id)) {
          same = false
          break
        }
      }
      if (same) return
    }
    cullIds.value = next
  }
  /**
   * 与被剔除节点相连的节点 id 集（任一端在剔除集合外 ⇒ 两端都算 linked）。
   * 壳据此区分 culled / culled-linked：至少一端在画布内的连线必须继续画，
   * 该连线的两端节点常驻成骨架（锚点/标题/量测保留），连线端点永远锚在真实几何上。
   * 邻接表在 syncFromStore 内随 edgeStore 变化重建，平移/缩放只读不重建。
   */
  let linkedIds = new Set<string>()
  function rebuildLinkedIds(): void {
    const h = hostRef.value
    if (!h) return
    // 注意：cullIds 的语义是「视口内可见集合」（不是视口外集合）——名字来自 computeVisibleIds
    const visible = cullIds.value
    const next = new Set<string>()
    if (!visible) { linkedIds = next; return }
    for (const e of h.edgeStore.getEdges()) {
      const sOut = !visible.has(e.source)
      const tOut = !visible.has(e.target)
      if (sOut !== tOut) { next.add(e.source); next.add(e.target) }
    }
    linkedIds = next
  }
  let cullRaf = 0
  function cullConfigFromSettings(): VisibleCullConfig {
    return {
      enabled: interactionSettings.visibleCullEnabled !== false,
      buffer: typeof interactionSettings.visibleCullBuffer === 'number' ? interactionSettings.visibleCullBuffer : 300,
    }
  }
  /** 压缩档开关（屏外无连线节点连壳不渲染）—— 缺省开（用户场景：1000 节点壳压到 ~50） */
  function compactShellsEnabled(): boolean {
    return interactionSettings.cullCompactShells !== false
  }
  /**
   * 事件驱动缓存：拖拽开始/插件视觉位移变化时才重建，视口每帧只读。
   *
   * 为什么不能每帧重算：refreshCull 在平移/缩放时每帧都跑，全量遍历 1000 节点 + 重建两个 Map
   * 会把裁剪省下的时间吃回去。缓存的生命周期：
   * - NodeDragStart：按 e.nodes（多选整组）建名单，再扩展到分组子节点；
   * - updateNodeVisual：插件视觉位移的 id 增补进名单；
   * - NodeDragStop：清空，松手后立即恢复常规裁剪；
   * - store 变化：只修剪失效成员（节点删除/撤销/已落盘），不清正在拖的成员。
   */
  let dragProtectedIds: Set<string> | undefined
  /** 最近一次原生拖拽的种子（含多选成员），手势期间保持不变，只负责派生子节点 */
  let gestureSeedIds = new Set<string>()
  /** 最近一次读到的插件视觉位移（只保留仍与 store 不一致的 id） */
  let liveVisualIds = new Set<string>()
  /** 已知从"视觉位移"回归到 store 的成员，用于修剪，防止插件不清理自身集合时永久保留 */
  let alignedVisualIds = new Set<string>()

  /** 清空保护缓存（松手、store 变更、撤销/删除后调用，立即恢复常规裁剪） */
  function clearDragProtection(): void {
    dragProtectedIds = undefined
    gestureSeedIds = new Set<string>()
    liveVisualIds = new Set<string>()
    alignedVisualIds = new Set<string>()
  }

  /**
   * store 变化后修剪名单：删掉已不存在的节点；视觉位移已与 store 对齐的成员也移除。
   * 拖拽中 store 的其它更新（远端同步、进度帧）不能清空整张名单 —— 否则正在拖的节点会被裁掉。
   */
  function pruneDragProtection(): void {
    const h = hostRef.value
    if (!h || !dragProtectedIds) return
    const alive = new Set<string>()
    const aligned = new Set<string>()
    for (const node of h.nodeStore.getNodes()) alive.add(node.id)
    const rendered = surfaceRef.value?.getRenderNodePositions?.()
    if (rendered) {
      const byId = new Map(rendered.map((n) => [n.id, n.position]))
      for (const node of h.nodeStore.getNodes()) {
        const p = byId.get(node.id)
        if (p && p.x === node.position.x && p.y === node.position.y) aligned.add(node.id)
      }
    }
    for (const id of aligned) if (liveVisualIds.has(id)) alignedVisualIds.add(id)
    const next = pruneProtectionIds(
      dragProtectedIds,
      alive,
      opts.isNodeDragging(),
      liveVisualIds,
      alignedVisualIds,
    )
    if (next.size === dragProtectedIds.size) return
    if (next.size === 0) {
      clearDragProtection()
      return
    }
    dragProtectedIds = next
    for (const id of gestureSeedIds) if (!next.has(id)) gestureSeedIds.delete(id)
  }

  /** 拖拽开始：一次 O(n) 收集父链 + 扩展到子节点，之后整段手势都复用 */
  function primeDragProtection(seed: Iterable<string>): void {
    const h = hostRef.value
    if (!h) return
    gestureSeedIds = new Set(seed)
    const allIds: string[] = []
    const parentOf = new Map<string, string | undefined>()
    for (const node of h.nodeStore.getNodes()) {
      allIds.push(node.id)
      parentOf.set(node.id, node.parentId)
    }
    dragProtectedIds = expandDragProtection(gestureSeedIds, allIds, parentOf)
    applyCullProtection()
  }

  /** 没有拖拽时的 O(1) 检查：只有插件视觉位移或已有缓存才需要继续处理 */
  function currentVisualMoveSnapshot(): { ids: Set<string>; epoch: number } | undefined {
    try {
      return surfaceRef.value?.getVisualMoveSnapshot?.()
    } catch {
      return undefined
    }
  }

  /** 视觉位移集合变化 → 合并进保护名单（拖拽中增减成员都走这里，不重建父链） */
  function syncVisualMoveProtection(): Set<string> | undefined {
    const h = hostRef.value
    if (!h) return undefined
    const snap = currentVisualMoveSnapshot()
    if (!snap) return dragProtectedIds
    // 视觉位移集合被插件/对账清空：只要没有原生拖拽，整个保护名单也可以清掉
    if (snap.ids.size === 0 && gestureSeedIds.size === 0) {
      clearDragProtection()
      return undefined
    }
    // 成员没变就复用上一份名单：插件逐帧写位置会让 epoch 一直涨，但名单不必重建
    const sameMembers = liveVisualIds.size === snap.ids.size && [...snap.ids].every((id) => liveVisualIds.has(id))
    for (const id of snap.ids) if (!h.nodeStore.getNode(id)) snap.ids.delete(id)
    if (!sameMembers || !dragProtectedIds) {
      const allIds: string[] = []
      const parentOf = new Map<string, string | undefined>()
      for (const node of h.nodeStore.getNodes()) {
        allIds.push(node.id)
        parentOf.set(node.id, node.parentId)
      }
      dragProtectedIds = expandDragProtection(gestureSeedIds, allIds, parentOf, snap.ids)
      liveVisualIds = new Set(snap.ids)
    }
    for (const id of [...alignedVisualIds]) if (dragProtectedIds && !dragProtectedIds.has(id)) alignedVisualIds.delete(id)
    return dragProtectedIds
  }

  /** 用当前保护名单重算裁剪（名单为空时就是常规裁剪） */
  function applyCullProtection(): void {
    const h = hostRef.value
    if (!h) return
    const surface = surfaceRef.value
    const rect = surface?.getVisibleRect?.() ?? null
    if (!interactionSettings.visibleCullEnabled) {
      setCullIds(null)
      return
    }
    const liveIds = dragProtectedIds && dragProtectedIds.size > 0 ? dragProtectedIds : undefined
    if (rect) {
      setCullIds(computeVisibleIds(h.view, rect, cullConfigFromSettings(), liveIds))
      return
    }
    if (typeof window === 'undefined') {
      setCullIds(null)
      return
    }
    const approx = viewportRectInFlow({ x: 0, y: 0, zoom: 1 }, window.innerWidth, window.innerHeight)
    setCullIds(computeVisibleIds(h.view, approx, cullConfigFromSettings(), liveIds))
  }
  function refreshCull(): void {
    const h = hostRef.value
    if (!h) return
    if (!interactionSettings.visibleCullEnabled) {
      setCullIds(null)
      return
    }
    /* 快路径：没拖拽、没视觉位移、没缓存 → 不建 Map、不扫节点，直接常规裁剪 */
    const visual = currentVisualMoveSnapshot()
    const visualCount = visual?.ids.size ?? 0
    const needCollect = needsLiveProtectionCollection(
      opts.isNodeDragging(),
      visualCount,
      !!dragProtectedIds,
    )
    const liveIds = needCollect ? syncVisualMoveProtection() : undefined
    const surface = surfaceRef.value
    const rect = surface?.getVisibleRect?.() ?? null
    if (rect) {
      setCullIds(computeVisibleIds(h.view, rect, cullConfigFromSettings(), liveIds))
      return
    }
    // 视口还量不到（初始挂载窗口）：用**近似视口**先算一版剔除，别全量挂 160 个节点再剔。
    // VueFlow 初始视口是 {0,0,zoom:1}，pane 尺寸回落到窗口尺寸 —— 偏差不大，rAF 到来后精确化。
    // 没有这一步的话：打开大画布 = 全量挂载（含几十个媒体组件创建）→ 下一帧再整批卸载 ——
    // 这一上一下就是打开页面 CPU 打满的原因（2026-10-15 卡死排查）。
    if (typeof window === 'undefined') {
      setCullIds(null)
      return
    }
    const approx = viewportRectInFlow({ x: 0, y: 0, zoom: 1 }, window.innerWidth, window.innerHeight)
    setCullIds(computeVisibleIds(h.view, approx, cullConfigFromSettings(), liveIds))
  }
  /** 视口帧回调（CanvasSurface 每次可视矩形变化都会调；rAF 节流防同一帧多次重灌） */
  function onVisibleRectFrame(): void {
    if (cullRaf) return
    cullRaf = requestAnimationFrame(() => {
      cullRaf = 0
      // 性能关键（LoAF trace 实测 27-134ms/帧）：视口每帧都变，但**可见集合**只在跨越
      // 缓冲边界时才变。先重算集合，与旧集合 diff——相同就跳过重灌（syncNodesFromStore
      // 是 160 节点 DTO 全量重建，每帧都做的话剔除本身反成瓶颈）。
      const prev = cullIds.value
      refreshCull()
      rebuildLinkedIds()
      const next = cullIds.value
      const same = prev === next || (prev && next && prev.size === next.size && [...next].every((id) => prev.has(id)))
      if (!same) opts.syncNodesFromStore()
    })
  }
  return {
    cullIds,
    linkedIds: () => linkedIds,
    rebuildLinkedIds,
    compactShellsEnabled,
    clearDragProtection,
    pruneDragProtection,
    primeDragProtection,
    refreshCull,
    onVisibleRectFrame,
  }
}
