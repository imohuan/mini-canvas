/**
 * bottomBarOverlay —— 底栏「本体是否渲染」的纯判定（零 Vue / 零 DOM，Node 可测）。
 *
 * 历史：这个文件原先还包含「底栏浮层显隐」的压制条件（框选/多选/resize/拖动/抓手）。
 * 2026-10-29 重构后，底栏的**位置与显隐**收归节点壳的 out:bottom 锚点
 * （与 BaseNode 的 hideSlotBars 同一条规则），本文件只保留「栏内内容该不该出现」这一条 ——
 * 它属于 bottom-bar 自己的语义（没有动作的节点不画空壳），不是画布级规则。
 */
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
