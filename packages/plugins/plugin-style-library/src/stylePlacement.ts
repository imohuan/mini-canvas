/**
 * 素材「加入画布」的落点与聚焦（用户口径 2026-10-25）。
 *
 * 现场：画布支持缩放/平移，但素材节点总是落在写死的 flow 坐标 ——
 * 用户把视口移到别处后，新节点出现在视野外，看不到；也不会自动选中。
 *
 * 目标：
 *   1. **落点跟随视口**：取画布容器的屏幕中心，换算成 flow 坐标；
 *      再扣掉节点尺寸的一半 —— 让**节点中心**对齐视口中心，而不是左上角。
 *   2. **落完选中并聚焦**：选中新节点，把视口居中到它（保留当前缩放）。
 *
 * 为什么聚焦用「实测矩形」而不是直接 node.position：
 * 节点宽高由节点类型决定，左上角对准中心会让节点偏右下。
 * 与 `plugin-node-find` 的 focusNode 同一口径（那里是既有做法）。
 *
 * 所有依赖都是可选的：画布级浮层可能在任何阶段打开（甚至极简宿主只有 doc）。
 * 拿不到就退回旧行为，绝不因为"没有视口"把「加入画布」整个弄失败。
 */

/** 节点尺寸（缺省用图片节点的默认尺寸；只是为了让中心对齐，不需要精确） */
export const DEFAULT_NODE_SIZE = { w: 320, h: 240 }

export interface PlacementInput {
  /** 屏幕坐标 → flow 坐标（useCanvasRender().flow.screenToFlow） */
  screenToFlow?(clientX: number, clientY: number): { x: number; y: number }
  /** 画布容器的屏幕矩形（flow.paneRect）；没有 = 视口还没就绪 */
  paneRect?: { left: number; top: number; width: number; height: number } | null
  /** 节点尺寸（用于把节点中心对到视口中心） */
  nodeSize?: { w: number; h: number }
}

/**
 * 算「按当前视口中心落节点」的 flow 坐标。
 *
 * 拿不到视口信息（未挂载 / 没有 screenToFlow）→ undefined，
 * 调用方据此退回旧行为（例如随机偏移），而不是把节点堆到 (0,0)。
 */
export function stylePlacementOf(input: PlacementInput): { x: number; y: number } | undefined {
  const { screenToFlow, paneRect } = input
  if (typeof screenToFlow !== 'function' || !paneRect) return undefined
  if (!(paneRect.width > 0) || !(paneRect.height > 0)) return undefined

  let center: { x: number; y: number }
  try {
    center = screenToFlow(
      paneRect.left + paneRect.width / 2,
      paneRect.top + paneRect.height / 2,
    )
  } catch {
    // 未就绪（CanvasFlowNotReadyError）—— 当没有视口，退回旧行为
    return undefined
  }
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return undefined

  const size = input.nodeSize ?? DEFAULT_NODE_SIZE
  // 节点左上角 = 中心 - 半尺寸（节点以左上角为坐标原点）
  return { x: center.x - size.w / 2, y: center.y - size.h / 2 }
}

/** focusStyleNode 用到的服务（都可选：极简宿主可能只装了其中一部分） */
export interface FocusDeps {
  selection?: { set(ids: string[]): void; clearEdges?(): void } | null
  view?: {
    fitTo(target: string[], opts?: { keepZoom?: boolean; select?: boolean }): boolean
  } | null
}

/**
 * 选中新节点并把它居中到视口（保留当前缩放）。
 *
 * 顺序：先选中（用户立刻看到选中框），再移视口。
 * 任何一个服务缺失都跳过那一步，不抛错 —— 最差情况是"节点建好了但没聚焦"。
 */
export function focusStyleNode(deps: FocusDeps, nodeId: string): void {
  // ① 选中（清掉边选中，避免"节点+边"混选）
  try {
    deps.selection?.clearEdges?.()
    deps.selection?.set([nodeId])
  } catch {
    /* 选中失败不影响节点本身 */
  }

  // ② 聚焦：统一走 view.fitTo（保持当前缩放，只平移）
  const view = deps.view
  if (!view) return
  try {
    view.fitTo([nodeId], { keepZoom: true, select: true })
  } catch {
    /* 聚焦失败不影响节点本身 */
  }
}
