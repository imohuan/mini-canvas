/**
 * edgeFlow —— 连线流光"色块"几何纯逻辑（无 Vue / 无 DOM，Node 可单测）。
 *
 * 口径（用户需求）：一条连线固定 N 个色块 —— 线短不会只剩一个、线长也不会铺出一堆。
 *   1. 整条路径先**均分成 N 份**（每份长度 = 总长 / N）；
 *   2. 每份里放一个色块，色块长度 = **该份长度 × 占比(%)**；
 *   3. 色块默认居中于自己那一份；流动时所有色块同步前进相同距离，相位对"每份长度"取模
 *      → 前进一整份后回到原位，循环无缝、永远不会出现"挤一起"或"疏密不均"。
 *
 * 为什么不夹取到 [0, totalLength]：色块要能沿路径**滑入/滑出**（头端从起点外进来、尾端从终点外出去），
 *   越界的块交给渲染器按路径自然裁剪（SVG dash 只画路径上真实存在的段）。故本函数只负责"该画哪几块、画在哪"。
 */

export interface FlowBlockInput {
  /** 路径总长（px，由渲染器 getTotalLength() 提供） */
  totalLength: number
  /** 色块数量（一条连线固定这么多块；小数向下取整，<1 按 1） */
  count: number
  /** 占比(%)：每份里色块占该份长度的百分比（0~100，越界夹取） */
  ratioPercent: number
  /** 已流动距离（px，累积量；相位对"每份长度"取模） */
  animDist: number
}

/** 一个色块在路径上的区间（沿路径长度度量）；start<0 或 end>totalLength 表示正在滑入/滑出 */
export interface FlowBlock {
  start: number
  end: number
}

/** 把数值夹到 [lo, hi]（NaN 视为 lo） */
function clampNum(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.min(hi, Math.max(lo, v))
}

/**
 * 算出当前帧所有色块的路径区间。
 * @returns 与可见范围(0,totalLength)有交叠的色块列表（顺序 = 沿路径方向）；退化输入返回 []
 */
export function computeFlowBlocks(input: FlowBlockInput): FlowBlock[] {
  const { totalLength, count, ratioPercent, animDist } = input
  if (!Number.isFinite(totalLength) || totalLength <= 0) return []

  const n = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1))
  const seg = totalLength / n
  const blockLen = seg * (clampNum(ratioPercent, 0, 100) / 100)
  if (blockLen <= 0) return []

  // 相位：对所有色块统一的公共偏移（对每份长度取模 → 前进一整份即回到原位）
  const phase = ((clampNum(animDist, 0, Number.MAX_SAFE_INTEGER) % seg) + seg) % seg
  // 色块在"自己那一份"里居中
  const leading = (seg - blockLen) / 2

  const out: FlowBlock[] = []
  // i 从 0 到 n（含）：多算一个候选块，覆盖"尾端正滑出"的那一块
  for (let i = 0; i <= n; i++) {
    const start = i * seg + leading + phase - seg
    const end = start + blockLen
    if (end <= 0 || start >= totalLength) continue // 完全在路径之外，不画
    out.push({ start, end })
  }
  return out
}

/** 走完整条路径的基准时长（秒）：所有连线共用，保证长短线「同时出发、同时到达」。 */
export const FLOW_BASE_SECONDS = 2

export interface FlowAdvanceInput {
  /** 路径总长（px） */
  totalLength: number
  /** 速度倍数（1 = 按基准时长走完；2 = 快一倍） */
  speedMultiplier: number
  /** 距上一帧的毫秒数 */
  deltaMs: number
  /** 基准时长（秒），缺省 FLOW_BASE_SECONDS */
  baseSeconds?: number
}

/**
 * 算出这一帧应该沿路径前进多少 px。
 *
 * 口径（用户需求）：一条连线从起点走到终点的时间固定，长度不参与 —— 短线和长线同时出发、同时到达。
 * 速度设置改成倍数：倍数越大，走完整条用的时间越短（2 倍速 = 一半时间）。
 *
 *   前进量 = 线长 × (本帧秒数 / 基准秒数) × 倍数
 *
 * 「走完整条」的时间 = 基准秒数 / 倍数，与线长无关 → 各条线进度天然同步。
 * @returns 本帧前进的 px；退化输入（线长/时间/倍数/基准非正）返回 0（不推进）
 */
export function computeFlowAdvance(input: FlowAdvanceInput): number {
  const { totalLength, speedMultiplier, deltaMs } = input
  const baseSeconds = input.baseSeconds === undefined ? FLOW_BASE_SECONDS : input.baseSeconds
  if (!Number.isFinite(totalLength) || totalLength <= 0) return 0
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) return 0
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0
  if (!Number.isFinite(baseSeconds) || baseSeconds <= 0) return 0
  const deltaSeconds = deltaMs / 1000
  return (totalLength * deltaSeconds * speedMultiplier) / baseSeconds
}
