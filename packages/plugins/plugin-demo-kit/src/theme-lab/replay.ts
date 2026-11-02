/**
 * 主题工作台的“真实手势回放”。
 *
 * 为什么必须回放而不是画样张：对齐线、Shift 绘制框、切割刀光都只在**真实手势**里出现，
 * 而且由插件自己监听事件后绘制。工作台能做的只有“把同一串指针事件送回画布”，
 * 之后出现的 DOM 就是插件本体的产物。
 *
 * 安全：
 * - 全程在同一帧内完成按下 / 移动 / 松开，不经过浏览器默认手势，不会真的拖动节点或删除连线；
 * - 切割回放**不松手**，插件不会执行命中检测；切换场景时统一补 pointerup 收尾；
 * - 对齐回放先禁用多选，避免“多选拖动不对齐”这条规则让参考线永远不出现。
 */

import type { ThemeLabScene } from './catalog'

export interface ReplayContext {
  /** 画布根元素（用于找 pane / 节点 / 边） */
  stage: HTMLElement
  /** 每次事件之后让出一帧，给 Vue / 插件更新 DOM */
  frame: () => Promise<void>
  /** 每次 DOM 更新后让工作台重画指示线（目标可能在下一帧才出现） */
  notify?: () => void
  /** 回放前把节点放回标准位：连续切场景不会把节点越推越远 */
  resetStage?: () => void
}

interface Holdable {
  __hold?: () => void
}

/** 事件送进画布后等一帧，再让工作台重画指示线（目标由插件在下一帧绘出） */
async function settle(ctx: ReplayContext): Promise<void> {
  await ctx.frame()
  ctx.notify?.()
}

function pointerEvent(type: string, x: number, y: number, extra: Record<string, unknown> = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    pointerId: 7,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    ...extra,
  })
}

/**
 * VueFlow 的节点拖动由 d3-drag 接管，它监听的是 mousedown/mousemove/mouseup，
 * 不是 pointer 事件。对齐回放必须用同一套事件，否则参考线永远不会出现。
 */
function mouseEvent(type: string, x: number, y: number, extra: Record<string, unknown> = {}): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    ...extra,
  })
}

function paneOf(stage: HTMLElement): Element | null {
  return stage.querySelector('.vue-flow__pane')
}

/** 找一条真实连线的中点：用于切割刀光回放 */
function edgeMidpoint(stage: HTMLElement): { x: number; y: number } | null {
  const path = stage.querySelector('.custom-edge .edge-hit-area') as SVGPathElement | null
  if (!path) return null
  let length = 0
  try {
    length = path.getTotalLength()
  } catch {
    return null
  }
  if (!length) return null
  const point = path.getPointAtLength(length / 2)
  const ctm = path.getScreenCTM()
  if (!ctm) return null
  return {
    x: ctm.a * point.x + ctm.c * point.y + ctm.e,
    y: ctm.b * point.x + ctm.d * point.y + ctm.f,
  }
}

/** 扫一段带弧度的轨迹（避开节点与边） */
function sweepPoints(start: { x: number; y: number }, dx: number, dy: number): Array<{ x: number; y: number }> {
  return Array.from({ length: 14 }, (_, i) => {
    const t = i / 13
    const bend = Math.sin(t * Math.PI) * 18
    return { x: start.x + dx * t, y: start.y + dy * t + bend }
  })
}

/**
 * 真实拖拽回放：按下节点 → 先拉开一点，再移动到另一个节点的顶边对齐位置
 * （不松手，方便观察参考线）。
 *
 * 只动 y 轴是刻意的：如果沿 x 轴把文本节点拖到图片节点旁边，两张卡会大幅重叠，
 * 看到的就不是“对齐”，而是卡片盖住卡片。顶边对齐既不会遮挡，也一定触发真实参考线。
 */
export async function replayAlign(ctx: ReplayContext): Promise<boolean> {
  ctx.resetStage?.()
  await ctx.frame()
  await ctx.frame()
  const node = ctx.stage.querySelector('.vue-flow__node[data-id="lab-text"]') as HTMLElement | null
  const other = ctx.stage.querySelector('.vue-flow__node[data-id="lab-image"]') as HTMLElement | null
  if (!node) return false
  const rect = node.getBoundingClientRect()
  const otherRect = other?.getBoundingClientRect()
  const grabX = rect.left + Math.min(rect.width / 2, 120)
  const grabOffsetY = Math.min(72, rect.height / 2)
  // 目标：文本节点顶边与图片节点顶边同一水平线；只改 y，避免两张卡叠在一起
  const deltaY = otherRect ? otherRect.top - rect.top : 0
  const start = { x: grabX, y: rect.top + grabOffsetY }
  const pointerAtAlignedTop = start.y + deltaY
  const pullAway = pointerAtAlignedTop + 46
  node.dispatchEvent(mouseEvent('mousedown', start.x, start.y))
  await settle(ctx)
  // 先明确离开对齐位，再回到对齐位：即使上一次回放已经把节点对齐，这一下也会重新触发参考线
  for (let i = 1; i <= 8; i++) {
    const y = start.y + (pullAway - start.y) * (i / 8)
    window.dispatchEvent(mouseEvent('mousemove', start.x, y))
    await settle(ctx)
  }
  let last = { x: start.x, y: pullAway }
  for (let i = 1; i <= 10; i++) {
    const y = pullAway + (pointerAtAlignedTop - pullAway) * (i / 10)
    last = { x: start.x, y }
    window.dispatchEvent(mouseEvent('mousemove', last.x, last.y))
    await settle(ctx)
  }
  // 再让插件跑一帧 rAF：参考线是拖拽帧里算出来的，等它落进 DOM 后再画指示线
  await settle(ctx)
  // 不松手：参考线会保留在屏幕上，用户能看着它改色
  ;(ctx as ReplayContext & Holdable).__hold = () => {
    window.dispatchEvent(mouseEvent('mouseup', last.x, last.y))
    ctx.notify?.()
  }
  return true
}

/** Shift 框选回放：在画布空白处按下 Shift + 拖拽，真实插件会自绘那个框（保持按住便于观察） */
export async function replayBoxSelect(ctx: ReplayContext): Promise<boolean> {
  const pane = paneOf(ctx.stage)
  if (!(pane instanceof HTMLElement)) return false
  const rect = pane.getBoundingClientRect()
  const start = { x: rect.left + rect.width * 0.56, y: rect.top + rect.height * 0.16 }
  const points = sweepPoints(start, rect.width * 0.28, rect.height * 0.3)
  pane.dispatchEvent(pointerEvent('pointerdown', points[0].x, points[0].y, { shiftKey: true }))
  await ctx.frame()
  for (const p of points.slice(1)) {
    document.dispatchEvent(pointerEvent('pointermove', p.x, p.y, { shiftKey: true }))
    await settle(ctx)
  }
  ;(ctx as ReplayContext & Holdable).__hold = () => {
    document.dispatchEvent(pointerEvent('pointerup', points[points.length - 1].x, points[points.length - 1].y, { shiftKey: true }))
    ctx.notify?.()
  }
  return true
}

/**
 * 切割刀光回放：沿真实连线扫一段，但**不松手**。
 *
 * 关键安全点：松手才会执行命中检测并删边；这里一直保持按下状态，用户看到的是
 * 插件自己画出的 cut-path + blade-tip，一条连线都不会少。切换场景时统一 cancel。
 */
export async function replayCut(ctx: ReplayContext): Promise<boolean> {
  const pane = paneOf(ctx.stage)
  const mid = edgeMidpoint(ctx.stage)
  if (!(pane instanceof HTMLElement) || !mid) return false
  const points = sweepPoints({ x: mid.x - 90, y: mid.y - 78 }, 210, 190)
  pane.dispatchEvent(pointerEvent('pointerdown', points[0].x, points[0].y, { altKey: true }))
  await ctx.frame()
  for (const p of points.slice(1)) {
    window.dispatchEvent(pointerEvent('pointermove', p.x, p.y, { altKey: true }))
    await settle(ctx)
  }
  ;(ctx as ReplayContext & Holdable).__hold = () => {
    // 安全取消：先让 blur 走插件的 resetCuttingMode（清 cutting / 轨迹 / body class），
    // 再补 pointerup。此时插件已经不是切割态，pointerup 不会执行命中检测，边一条都不会少。
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(pointerEvent('pointerup', points[points.length - 1].x, points[points.length - 1].y, { altKey: false }))
    ctx.notify?.()
  }
  return true
}

/** 场景离开时统一收尾：如果还有按住的手势，走各场景自己的安全释放路径 */
export function releaseHeld(ctx: ReplayContext): void {
  const hold = (ctx as ReplayContext & Holdable).__hold
  hold?.()
  delete (ctx as ReplayContext & Holdable).__hold
}

/** 场景 → 回放函数。workbench 只管“什么时候调”，具体手势住在这里。 */
export async function replayScene(scene: ThemeLabScene, ctx: ReplayContext): Promise<void> {
  if (scene === 'align') await replayAlign(ctx)
  else if (scene === 'box') await replayBoxSelect(ctx)
  else if (scene === 'cut') await replayCut(ctx)
}
