/**
 * bottomBarOverlay —— 底栏（画布级浮层）的压制条件纯判定（零 Vue / 零 DOM，Node 可测）。
 *
 * 为什么单独抽成模块而不是写在 NodeBottomBarOverlay.vue 的 computed 里：
 * 底栏宿主在 SSR/无 DOM 环境量不到卡片矩形 → 永远不渲染，『拖动时收没收』这条在渲染测试里照不出来
 * （与 multi-select 的 resolveBatchHandleVisible 同一处境，同样抽纯函数锁语义）。
 *
 * 语义：底栏挂在画布 overlay 槽（节点之外），所以 BaseNode 那份 hideToolbars 管不到它 ——
 * 它必须自己把同一套条件补齐，否则『拖动时全画布都收起来了、只有底栏还杵在那』（用户带截图报的）。
 */

/** 压制条件的输入位（各输入由宿主从渲染上下文/选中集读出来后喂进来） */
export interface BottomBarSuppressInput {
  /** 框选/多选手势进行中（interaction.isSelecting） */
  selecting: boolean
  /** 当前选中节点数（底栏语义是恰好选中一个） */
  selectedCount: number
  /** 底栏所属节点 id */
  selectedId: string | null
  /** 正在被 resize 的节点 id（interaction.nodeResizeId；无则 null） */
  resizingId: string | null
  /**
   * 画布上是否有节点正在被拖（interaction.isNodeDragging）。
   *
   * 画布级、不比节点 id：用户要求『拖拽的时候底部状态栏还在，请修改一下』，
   * 与 BaseNode 同一条规则 —— 拖任意节点，全画布的栏一起收，松手立刻恢复。
   */
  nodeDragging: boolean
  /**
   * 画布是否处于「抓手工具」（宿主级设置 nodesDraggable=false）。
   *
   * 用户要求：切到抓手工具后，节点上下两排状态栏都不显示。底栏住在画布 overlay 槽
   * （BaseNode 之外），BaseNode 那条压制管不到它，所以必须在这里把同一条件补上。
   * 判据与 BaseNode 的 isHandTool 同源：**同一个设置键**，不新开开关。
   */
  handTool: boolean
}

/**
 * 底栏该不该被压制（true = 收起）。任一成立即收起：
 * 框选进行中 / 多选（>=2） / 本节点正在被 resize / 画布上有节点正在被拖 / 抓手工具。
 *
 * 注意 resize 那条只认本节点（拖 A 的尺寸不该吃掉 B 的底栏），拖动那条不认节点
 * （规则是画布级的，见 nodeDragging 的说明）——两者不对称是有意的，别统一。
 */
export function resolveBottomBarSuppressed(input: BottomBarSuppressInput): boolean {
  return (
    input.selecting ||
    input.selectedCount > 1 ||
    input.resizingId === input.selectedId ||
    input.nodeDragging ||
    input.handTool
  )
}

/** 底栏本体是否渲染的输入位（与 NodeBottomBar 模板 v-if 同义） */
export interface BottomBarShownInput {
  /** 恰好单选了本节点（useSoleNodeSelected） */
  soleSelected: boolean
  /** 本节点类型有可用的底栏动作（nodeBar.list 非空） */
  hasActions: boolean
  /** 已经提交过任务、栏暂时收起 */
  submitted: boolean
}

/**
 * 底栏本体（`.nb-root`）该不该渲染。
 *
 * **单一事实源**：模板 v-if、Ctrl 快捷键门槛都读这一个判定。
 * 用户口径（2026-10-27）：快捷键只在「底部状态栏打开」时生效；
 * 可视化节点没有底栏动作 → 这里 false，哪怕画布级 `.nb-overlay` 外壳还在。
 */
export function resolveBottomBarShown(input: BottomBarShownInput): boolean {
  return input.soleSelected && input.hasActions && !input.submitted
}
