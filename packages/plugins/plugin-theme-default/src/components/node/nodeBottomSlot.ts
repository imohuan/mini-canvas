/**
 * nodeBottomSlot —— 底栏槽位宿主的压制条件（纯判定，零 Vue / 零 DOM，可单测）。
 *
 * 为什么需要：底栏宿主住在**画布级浮层**（不在节点里），所以 BaseNode 的 hideSlotBars 管不到它 ——
 * 必须在这里把同一套条件补齐，否则「拖动时全画布都收起来了、只有底栏还杵在那」。
 *
 * 规则与 BaseNode 一致：框选 / 多选 / 本节点 resize / 画布上有节点在拖 / 抓手工具，任一成立就收起。
 * resize 那条只认本节点（拖 A 的尺寸不该吃掉 B 的底栏）；拖动那条是画布级（用户口径：拖任何节点都收）。
 */
export interface BottomSlotSuppressInput {
  /** 框选/多选手势进行中（interaction.isSelecting） */
  selecting: boolean
  /** 当前选中节点数（底栏语义是恰好选中一个） */
  selectedCount: number
  /** 底栏所属节点 id */
  selectedId: string | null
  /** 正在被 resize 的节点 id（interaction.nodeResizeId；无则 null） */
  resizingId: string | null
  /** 画布上是否有节点正在被拖（interaction.isNodeDragging） */
  nodeDragging: boolean
  /** 画布是否处于「抓手工具」（设置 nodesDraggable=false） */
  handTool: boolean
}

/** 底栏该不该被压制（true = 收起） */
export function resolveBottomSlotSuppressed(input: BottomSlotSuppressInput): boolean {
  return (
    input.selecting ||
    input.selectedCount > 1 ||
    input.resizingId === input.selectedId ||
    input.nodeDragging ||
    input.handTool
  )
}
