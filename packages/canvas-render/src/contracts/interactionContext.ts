/**
 * interactionContext —— "画布此刻在干什么"共享交互状态契约（canvas-render 提供能力、theme/UI 消费）。
 *
 * 背景：render 层此前只有"拖线连接"被建模成 connectionState(很专门，只服务连线 hover/压制/反馈)；
 * 节点拖拽只有 nodeDragStop、画布 pan/缩放/edge 拖拽/框选都没有暴露成状态。
 * 本契约补那一层：**多属性组合的响应式活动状态** —— 不搞单一 enum 切换，
 * 而是 `activity` 里多面旗子各自可亮（手势可叠加：拖节点时掠过另一节点、拖线时还拖到边……），
 * 每面旗子附带指向对象(id)；theme/插件读它决定显隐/样式/行为。
 *
 * 边界：本状态只管"手势/活动"是什么，不管"拖线 hover 到哪个合法目标"那套连线专用反馈
 * （那归 connectionState）。theme 若要压端口/显隐，把本状态的派生位与 connectionState 一起读即可。
 *
 * 坐标系约定：坐标一律 flow(画布)坐标，沿用 connectionContext 的约定。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

/** 每类"正在进行的活动"。多面旗子可叠加同时为真，各自附当前对象句柄。 */
export interface InteractionActivity {
  /** 正在拖动某节点 */
  nodeDragging: boolean
  nodeDragId: string | null
  /** 正在平移画布(pan) */
  paneDragging: boolean
  /** 正在缩放(wheel/pinch) */
  zooming: boolean
  /** 正在重连一条边(edge 拖拽；交互当前未启用，占位未来) */
  edgeDragging: boolean
  edgeDragId: string | null
  /** 正在框选/多选(selectionStart..End；占位未来) */
  selecting: boolean
}

/** 一份"空"活动位（全 false + 对象清空），供重置/初始。 */
export function emptyActivity(): InteractionActivity {
  return {
    nodeDragging: false,
    nodeDragId: null,
    paneDragging: false,
    zooming: false,
    edgeDragging: false,
    edgeDragId: null,
    selecting: false,
  }
}

/** 画布交互状态（多属性组合 + 派生便捷读；全部响应式，供 UI/theme 消费） */
export interface CanvasInteractionState {
  /** 每类活动的布尔 + 对象句柄（可叠加）。host 经 updateActivity 局部分片写入，保留其它位。 */
  activity: Ref<InteractionActivity>
  // —— 派生便捷读（computed；UI/theme 一把读，不必自己拼多面旗子）——
  /** 是否正在拖动节点 */
  isNodeDragging: ComputedRef<boolean>
  /** 是否正在平移画布(pan) */
  isPanning: ComputedRef<boolean>
  /** 是否正在缩放 */
  isZooming: ComputedRef<boolean>
  /** 是否正在重连边 */
  isEdgeDragging: ComputedRef<boolean>
  /** 是否正在框选/多选 */
  isSelecting: ComputedRef<boolean>
  /**
   * 是否有任一"物理拖拽手势"在动（节点拖/pan/连线/框选等按下拖动类）。
   * theme 用它做"交互进行中"的显隐门（例如拖拽期间不冒端口加号）。
   */
  isBusyDragging: ComputedRef<boolean>
  /** 是否有任何活动在发生（含缩放；比 isBusyDragging 更宽，覆盖非拖拽手势） */
  isBusy: ComputedRef<boolean>
}

/** 建一份默认交互状态（ref + 派生 computed） */
export function createInteractionState(): CanvasInteractionState {
  const activity = ref<InteractionActivity>(emptyActivity())
  return {
    activity,
    isNodeDragging: computed(() => activity.value.nodeDragging),
    isPanning: computed(() => activity.value.paneDragging),
    isZooming: computed(() => activity.value.zooming),
    isEdgeDragging: computed(() => activity.value.edgeDragging),
    isSelecting: computed(() => activity.value.selecting),
    isBusyDragging: computed(
      () =>
        activity.value.nodeDragging ||
        activity.value.paneDragging ||
        activity.value.edgeDragging ||
        activity.value.selecting,
    ),
    isBusy: computed(
      () =>
        activity.value.nodeDragging ||
        activity.value.paneDragging ||
        activity.value.zooming ||
        activity.value.edgeDragging ||
        activity.value.selecting,
    ),
  }
}

/** 更新某几面活动旗子（其它位原样保留）。传 `{ nodeDragging:true, nodeDragId:'n1' }` 即只开这两项。 */
export function updateActivity(
  state: CanvasInteractionState,
  patch: Partial<InteractionActivity>,
): void {
  state.activity.value = { ...state.activity.value, ...patch }
}

/** 清空全部活动位（回到全 idle） */
export function clearActivity(state: CanvasInteractionState): void {
  state.activity.value = emptyActivity()
}

// ==================== 手势驱动辅助（CanvasHost 的 VueFlow 事件回调薄封装，语义可单测） ====================

/** 节点拖动开始：亮 nodeDragging + 记被拖节点 id（多选拖动传代表节点 id）。 */
export function beginNodeDrag(state: CanvasInteractionState, nodeId: string): void {
  updateActivity(state, { nodeDragging: true, nodeDragId: nodeId })
}

/** 节点拖动结束：灭 nodeDragging + 清 id。 */
export function endNodeDrag(state: CanvasInteractionState): void {
  updateActivity(state, { nodeDragging: false, nodeDragId: null })
}

/** 视图平移/缩放开始（pan 与 wheel/pinch 同源于 VueFlow move 事件，A 决策统一亮 paneDragging）。 */
export function beginViewportMove(state: CanvasInteractionState): void {
  updateActivity(state, { paneDragging: true })
}

/** 视图平移/缩放结束：灭 paneDragging（与 begin 对称）。 */
export function endViewportMove(state: CanvasInteractionState): void {
  updateActivity(state, { paneDragging: false })
}
