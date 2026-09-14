/**
 * boxSelectGuard —— 框选结束后"吞掉紧随那次 pane click"的状态机（纯逻辑，零 DOM 可单测）。
 *
 * 要解决的问题（用户报的缺陷）：
 *   Shift+左键拖框选 → 松手后选中**立刻被清空**，看起来"框选完全没生效"，
 *   只有 Ctrl 一个一个点选才有效。
 *
 * 根因：框选期间插件把命中节点写进内核选中，但松手之后浏览器还会补一个 click 事件。
 * 宿主的 onPaneClick 语义是"点空白 = 清空选中"（selectionInteractions.clickPane），
 * 于是刚框选出来的一堆选中，被这一下 click 全清掉。
 *
 * 老版 MultiSelectPlugin 的处理方式与本状态机一致：框选真的发生了 → 给下一次 pane click 打个
 * "要吞掉"的标记；该 click 到来时若落在画布空白（不是节点/边/端口/控件）就吞掉并清标记。
 *
 * 两条兜底（都是踩过的坑）：
 * - 标记没被消费就要作废：松手点恰好落在节点上时 VueFlow 不派发 pane click，
 *   标记会一直留着，把用户**下一次**真实点击也吞掉 → 新的 pointerdown 到来时必须先清标记。
 * - 只有真的拖动了才算框选：原地按下再抬起不该吞 click，否则"Shift 点空白想清空选中"会失效。
 */

export class BoxSelectClickGuard {
  /** 是否处于"刚框选完、下一次 pane click 要吞掉"的待命态 */
  private armed = false

  /** 框选手势结束：拖拽超过阈值（真的框选了）才进入待命态 */
  markGestureDone(dragged: boolean): void {
    this.armed = dragged
  }

  /**
   * 新的指针按下（进入下一次交互）：作废上一次没被消费的待命标记。
   * 不做这一步，落在节点上松手的框选会永久吞掉之后的一次点击。
   */
  reset(): void {
    this.armed = false
  }

  /**
   * pane click 到来：待命态且确实落在画布空白 → 吞掉（返回 true）并解除待命。
   * @param isPaneBlank 该 click 的落点是否算画布空白（非节点/边/端口/控件）
   */
  shouldSwallow(isPaneBlank: boolean): boolean {
    if (!this.armed) return false
    // 无论落点是否空白都解除待命：这次 click 就是那一下补发的 click，消费掉机会只有一次
    this.armed = false
    return isPaneBlank
  }
}

