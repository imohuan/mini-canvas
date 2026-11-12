import { ref, type Ref } from 'vue'
import { LAYERS } from '@plume-canvas/vue-render/contracts/layers'
import { edgeOnTopOf } from './helpers'
import {
  edgesFromStore,
  nodesFromStore,
  overlayDraggingPositions,
} from '../canvasHostCore'
import type { CanvasHostHandle } from '../createPlumeHost'
import type { EdgeVisual } from '../../contracts/edgeContext'
import type { CanvasHostRenderEdge, CanvasSurfaceHandle } from './types'

export function useCanvasRenderState(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  surfaceRef: { value: CanvasSurfaceHandle | undefined }
  cullIds: Ref<ReadonlySet<string> | null>
  linkedIds: () => ReadonlySet<string>
  compactShellsEnabled: () => boolean
  edgeVisual: () => Partial<EdgeVisual> | undefined
  pruneDragProtection: () => void
  refreshCull: () => void
  rebuildLinkedIds: () => void
  log: { debug(message: string): void }
}) {
  const { hostRef, surfaceRef, cullIds } = opts

  const nodes = ref<ReturnType<typeof nodesFromStore>>([])
  const edges = ref<CanvasHostRenderEdge[]>([])
  // 选中态：与内核 selection 双向——CustomEdge 高亮读 selectedIds；命令(command:delete)读内核 selection。
  const canUndo = ref(false)
  const canRedo = ref(false)

  /**
   * 分批挂载（2026-10-15 卡死排查兜底）：一次性把上百个节点灌给 VueFlow 时，若含
   * 媒体/iframe 等重组件，挂载窗口的解码/布局会把主线程打满数秒到数十秒（实测打开
   * default 画布即失去响应）。策略：目标列表一次算好；新增挂载超过 40 个时先挂前 40 个，
   * 其余按每帧 30 个渐进追加（rAF 链）。已有节点的更新（props 变化）不受影响。
   */
  let mountRaf = 0
  let publishedExtra = new Set<string>()
  let stagedTarget: ReturnType<typeof nodesFromStore> = []
  function syncNodesFromStore(): void {
    const h = hostRef.value
    if (!h) return
    const target = overlayDraggingPositions(
      nodesFromStore(h.nodeStore, h.selection.ids, cullIds.value, opts.linkedIds(), opts.compactShellsEnabled()),
      surfaceRef.value?.getDraggingNodePositions?.(),
    )
    /*
     * 分批进行中：已有节点必须**立即**吃到新数据（远端改内容、进度帧、拖动位置），
     * 只有尚未挂载的新节点继续排队。以前这里直接 return，分批窗口内所有更新都只写进
     * stagedTarget，画面要等下一批 rAF 才变 —— 用户看到「数据改了但 UI 没动」。
     */
    if (mountRaf) {
      const publishedIds = new Set(nodes.value.map((n) => n.id))
      const stagedById = new Map(target.map((n) => [n.id, n]))
      nodes.value = nodes.value.map((n) => stagedById.get(n.id) ?? n)
      // 新节点仍然只加已经发布过的（publishedExtra / 首批），不会因此把整批一次性挂上。
      for (const n of target) {
        if (!publishedIds.has(n.id) && publishedExtra.has(n.id)) nodes.value.push(n)
      }
      return
    }
    const existingIds = new Set(nodes.value.map((n) => n.id))
    const addedCount = target.filter((n) => !existingIds.has(n.id)).length
    if (addedCount <= 40) {
      publishedExtra = new Set<string>()
      nodes.value = target
      return
    }
    // 首批：可见节点优先，最多 40 个；其余进 rAF 队列渐进挂载
    const visible = (id: string) => !cullIds.value || cullIds.value.has(id)
    const firstIds = new Set(
      target.filter((n) => !existingIds.has(n.id) && visible(n.id)).slice(0, 40).map((n) => n.id),
    )
    stagedTarget = target
    publishedExtra = new Set<string>()
    const pendingIds: string[] = []
    for (const n of target) {
      if (!existingIds.has(n.id) && !firstIds.has(n.id)) pendingIds.push(n.id)
    }
    nodes.value = target.filter((n) => existingIds.has(n.id) || firstIds.has(n.id))
    let idx = 0
    const step = (): void => {
      for (const id of pendingIds.slice(idx, idx + 30)) publishedExtra.add(id)
      idx += 30
      nodes.value = stagedTarget.filter((n) => existingIds.has(n.id) || firstIds.has(n.id) || publishedExtra.has(n.id))
      if (idx < pendingIds.length) {
        mountRaf = requestAnimationFrame(step)
      } else {
        mountRaf = 0
      }
    }
    mountRaf = requestAnimationFrame(step)
  }

  /** 上一次 syncFromStore 时的节点 id 集合（检测「新增」用，视口跟随） */
  let prevNodeIds = new Set<string>()
  function syncFromStore(): void {
    const h = hostRef.value
    if (!h) return
    const alive = new Set(h.nodeStore.getNodes().map((n) => n.id))
    // 边数据源 = 内核 edgeStore（边下沉后唯一数据源）；渲染态取 source/target 仍存活的边(删除路径已在 edgeStore 清边,此处兜底过滤)。
    // B 项：DTO 保留端口句柄（edgesFromStore 也滤悬挂边，纯逻辑单测覆盖）
    const edgeOnTop = edgeOnTopOf(opts.edgeVisual())
    edges.value = edgesFromStore(h.edgeStore.getEdges(), alive, edgeOnTop ? undefined : h.selection.ids).map((e) =>
      // 连线分层：普通边走 LAYERS.edge（在节点之下），置顶边走 LAYERS.edgeTop（压过所有节点，
      // 含选中节点）；选中节点的连线在 edgesFromStore 里按 LAYERS.edgeSelected 抬到普通节点
      // 之上、选中节点之下（edgeOnTop 开启时不抬，全部走置顶档）。临时边自己的 z 在
      // edgesFromStore 里按 LAYERS.tempEdge 给。
      // 层值唯一事实源 = contracts/layers（见门牌注释与 docs/plans/2026-09-29-canvas-z-layers.md）。
      // 普通边现在恒有 zIndex（显式回落，防 VueFlow 合并语义残留），所以这里不能再写
      // !e.zIndex 判断，否则「连线置顶」开关会静默失效。临时边保持自己的 tempEdge 档。
      edgeOnTop && e.zIndex !== LAYERS.tempEdge ? { ...e, zIndex: LAYERS.edgeTop } : e,
    )
    // 灌节点前现算剔除集合与邻接表：保证 syncNodesFromStore 拿到同一份最新状态
    //（store 变化包含节点/边增删改；视口帧回调路径已在 onVisibleRectFrame 内算过，此处幂等重算）。
    /*
     * 拖拽中 store 的因果来源只有两种：
     * 1. 别的插件/云端更新（不是落盘）—— 保护名单不能清；
     * 2. onNodeDragStop 落盘 —— 那时已经 endNodeDrag + clearDragProtection。
     * 所以这里**不能无条件清**，否则拖拽期间的 store 更新会把正在拖的节点重新裁掉。
     * 只清理已不存在 / 已落盘的成员，保证撤销/删除后名单不残留。
     */
    opts.pruneDragProtection()
    opts.refreshCull()
    opts.rebuildLinkedIds()
    syncNodesFromStore()
    // —— 新增节点重扫可视区域（2026-10-16 用户口径：**不要聚焦、不要移动视口**，
    //  只需要新建节点时手动重扫一遍剔除集合，让新节点不被误隐藏）：
    const nowIds = new Set(h.nodeStore.getNodes().map((n) => n.id))
    if (prevNodeIds.size > 0) {
      const added = [...nowIds].filter((id) => !prevNodeIds.has(id))
      if (added.length > 0) {
        opts.refreshCull()
        syncNodesFromStore()
      }
    }
    prevNodeIds = nowIds
    canUndo.value = h.history.canUndo()
    canRedo.value = h.history.canRedo()
    opts.log.debug(`syncFromStore nodes=${nodes.value.length} edges=${edges.value.length} undo=${canUndo.value}`)
  }

  function dispose(): void {
    if (mountRaf) { cancelAnimationFrame(mountRaf); mountRaf = 0 }
  }

  return { nodes, edges, canUndo, canRedo, syncNodesFromStore, syncFromStore, dispose }
}
