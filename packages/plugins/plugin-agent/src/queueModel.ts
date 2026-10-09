/**
 * queueModel —— 把后台的队列快照（QueueStateView）折算成界面要画的一行行（纯逻辑，零 Vue，可单测）。
 *
 * 为什么要单独一层（照 sessionModel / turnBlocks 的先例）：
 * 1. 队列的真相在后台（会话文件里），组件只管把 rows 画出来 —— 折行 / 阻塞判定 / 按钮文案
 *    这些口径全收在这里，组件不掺逻辑、测试不用拖 Vue；
 * 2. 有几条是用户点名的硬口径（设计 §3.6，G1-G3）：编辑过的消息**保持原位置**（不 sort）、
 *    有消息在编辑中 ⇒ **队列停住等发送**、发送键三态（有内容 ⇒ 发送，空 + 正在跑 ⇒ 终止）。
 *
 * 本模块**只读**：不改条目的任何字段，也不动原数组的顺序（rows 是逐一映射出来的新对象）。
 */
import type { QueueItemView, QueueStateView } from './agentApi.js'

export interface QueueRow {
  id: string
  /** 原始文本（含 <ref …> 标记；编辑回填要用，不能动） */
  text: string
  /**
   * 单行显示文本：空白折成一个空格 + 去首尾；超过 300 字截断加 '…'。
   * 纯图片条目（text 为空）在这里就是 ''；要不要显示「（图片）」由主组件决定。
   */
  display: string
  /** 图片（data URL）原样 */
  images: string[]
  /** 缩略图候选：最多前 3 张，供 UI 取第 1 张画 16×16 */
  thumbs: string[]
  /** state === 'editing' */
  editing: boolean
  /** state === 'sending' */
  sending: boolean
  /**
   * state === 'sent'：已送达、留在列表里的一拍。
   *
   * 界面把它画成"已发送"（灰一点），用户就能看到"这条进了对话"的过渡 ——
   * 否则列表里的行会直接消失，用户以为消息丢了（用户实测）。
   */
  sent: boolean
  /** 服务端/前端的引导标记（QueueItemView.steered） */
  steered: boolean
  /** 这条要以目标模式发时的目标声明（没有则 null） */
  goal: { objective: string; budget: number } | null
}

export interface QueuePanelView {
  rows: QueueRow[]
  count: number
  paused: boolean
  /** 编辑中的那条 id（没有则 null）—— 队列整体阻塞 */
  editingId: string | null
  /** 有条目在编辑中 ⇒ 队列停住等发送 */
  blocked: boolean
  /** 右侧按钮文案：paused ? '启动' : '暂停' */
  pauseLabel: '启动' | '暂停'
  /** 按钮 title（'启动队列自动发送' / '暂停队列自动发送'） */
  pauseTitle: string
  hasItems: boolean
}

/** 单行显示文本最长多少字：超过就截断（队列行只有一行，别把超长文本带进 DOM） */
const DISPLAY_MAX = 300

/** 空白（换行 / 制表 / 连续空格）折成一个空格并去首尾 —— 队列行只有一行可画 */
function toSingleLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > DISPLAY_MAX ? flat.slice(0, DISPLAY_MAX) + '…' : flat
}

/** 一条队列条目 → 一行。字段全部是读出来的派生值，不改条目本身 */
function rowOf(item: QueueItemView): QueueRow {
  // 拷一份数组：调用方（Vue reactive 里的 store）别因为我们拿出去的引用被误改
  const images = [...(item.images ?? [])]
  return {
    id: item.id,
    text: item.text,
    display: toSingleLine(item.text),
    images,
    // 行里只用得上第一张画 16×16；给 3 张是给后面的行内预览留口子
    thumbs: images.slice(0, 3),
    editing: item.state === 'editing',
    sending: item.state === 'sending',
    sent: item.state === 'sent',
    steered: item.steered === true,
    goal: item.goal ?? null,
  }
}

/** 没有队列（还没加载 / 会话为空）时的空视图 —— 组件不必再判 null */
function emptyPanelView(): QueuePanelView {
  return {
    rows: [],
    count: 0,
    paused: false,
    editingId: null,
    blocked: false,
    // 空队列按「没暂停」的一套文案（paused = false）
    pauseLabel: '暂停',
    pauseTitle: '暂停队列自动发送',
    hasItems: false,
  }
}

/** 队列 → 面板视图。queue 为空/undefined 时返回空视图（rows:[]、paused:false、blocked:false） */
export function queuePanelView(queue: QueueStateView | null | undefined): QueuePanelView {
  if (!queue) return emptyPanelView()
  const items = queue.items ?? []
  // 顺序**原样**映射，不 sort —— G3：编辑过的消息保持原位置（编辑不是「置顶」）
  const rows = items.map(rowOf)
  // 编辑是单选（设计 §3.3.4）：正在编辑的那条 = 阻塞队列的那条
  const editing = items.find((i) => i.state === 'editing') ?? null
  const paused = queue.paused === true
  return {
    rows,
    count: rows.length,
    paused,
    editingId: editing ? editing.id : null,
    // 有条目在编辑中 ⇒ 队列停住等发送
    blocked: editing !== null,
    pauseLabel: paused ? '启动' : '暂停',
    pauseTitle: paused ? '启动队列自动发送' : '暂停队列自动发送',
    hasItems: rows.length > 0,
  }
}

/** 发送键的三种状态（设计 §3.6/G1）：有内容 ⇒ 'send'（即使正在跑，点了进队列）；空 + 正在跑 ⇒ 'stop'；空 + 空闲 ⇒ 'disabled' */
export type SendButtonMode = 'send' | 'stop' | 'disabled'

export function sendButtonMode(hasContent: boolean, running: boolean): SendButtonMode {
  // 有内容就永远能发：正在跑时点了 = 进队列（消息不丢），所以这里不看 running
  if (hasContent) return 'send'
  // 空输入框：正在跑 ⇒ 终止（红方块）；空闲 ⇒ 没意义，禁用
  return running ? 'stop' : 'disabled'
}

/**
 * 预算文案：50000 → '50k'；12345 → '12.3k'；999 → '999'；0 / -1 / 空 ⇒ '不限'。
 *
 * 千位以上用一位小数、去掉尾随的 .0（'50k' 不是 '50.0k'，'12.3k' 不是 '12.30k'）——
 * 预算标注的位置很窄，一位小数够看，也不会让数字跳宽。
 * 0 / -1 = 不限（设计 §3.4.3：留空或 0 写进 GOAL.json 时就存 -1）。
 */
export function budgetText(budget: number | null | undefined): string {
  if (budget == null || budget <= 0) return '不限'
  if (budget < 1000) return String(budget)
  return (budget / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
}

/** 目标标记文案（不含图标）：'<目标内容> · 预算 <预算文案>'；目标内容为空时用占位「输入目标内容」 */
export function goalMarkText(objective: string | null | undefined, budget: number | null | undefined): string {
  // 点 + → 目标就先出现标签（此时还没写内容）：占位文案告诉用户点哪儿能填
  const text = (objective ?? '').trim() || '输入目标内容'
  return text + ' · 预算 ' + budgetText(budget)
}

/**
 * 目标状态条里的「已用」文案。
 *
 * 为什么不能直接复用 budgetText：budgetText 的语义是**预算**，0 / -1 = 不限；
 * 已用（tokensUsed）是**确定数字**，0 就是 0。真机实测：刚起目标那一拍
 * tokensUsed=0，状态条显示成「目标第 1 轮 · 不限 / 400k」，看着像预算没生效。
 * 千位以上仍按 k 缩写（与预算同一套观感），负数 / 空按 0（已用不可能是负的）。
 */
export function usedText(used: number | null | undefined): string {
  const n = typeof used === 'number' && Number.isFinite(used) && used > 0 ? used : 0
  if (n < 1000) return String(n)
  return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
}

// ============================================================ token 单位与口径

/**
 * 数字单位制（用户口径 2026-10-09）：
 *   - 'si'：k(1e3) / M(1e6) / B(1e9) / T(1e12)
 *   - 'cn'：万(1e4) / 亿(1e8) / 万亿(1e12)
 * 为什么要有它：token 数字很大，直接显示 `1048576` 或 `1,048,576,000` 又长又难读。
 */
export type TokenUnit = 'si' | 'cn'

const UNIT_TABLE: Record<TokenUnit, Array<[number, string]>> = {
  si: [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']],
  cn: [[1e12, '万亿'], [1e8, '亿'], [1e4, '万']],
}

/**
 * 数字 → 带单位的短文案。小于 1000 原样；一位小数、去掉尾随的 .0。
 * 非有限数按 0（已用不可能是负的 / 预算的「不限」由调用方处理）。
 */
export function formatToken(n: number | null | undefined, unit: TokenUnit = 'si'): string {
  // token 数字不可能是负的 —— 负数一律按 0（与「已用」口径一致，避免出现 -5k 这种鬼东西）
  const v = typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
  for (const [scale, suffix] of UNIT_TABLE[unit]) {
    if (v >= scale) {
      const x = v / scale
      const s = x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10).replace(/\.0$/, '')
      return s + suffix
    }
  }
  return String(Math.round(v))
}

/** 预算文案：<= 0 ⇒ 「不限」；否则按单位换算 */
export function budgetTokenText(budget: number | null | undefined, unit: TokenUnit = 'si'): string {
  const v = typeof budget === 'number' ? budget : NaN
  return !Number.isFinite(v) || v <= 0 ? '不限' : formatToken(v, unit)
}

/**
 * 解析用户手输的 token 数字：支持 `50000` / `50k` / `1M` / `1B` / `5万` / `1亿`；空 ⇒ -1（不限）。
 * 解析不了返回 NaN（调用方据此不要覆盖原值）。
 */
export function parseTokenText(text: string | null | undefined): number {
  const s = String(text ?? '').trim().replace(/,/g, '')
  if (!s) return -1
  const m = /^(\d+(?:\.\d+)?)\s*(k|m|b|t|万|亿|万亿)?$/i.exec(s)
  if (!m) return NaN
  const n = Number(m[1])
  if (!Number.isFinite(n)) return NaN
  const u = (m[2] ?? '').toLowerCase()
  const mul =
    u === 'k' ? 1e3 : u === 'm' ? 1e6 : u === 'b' ? 1e9 : u === 't' ? 1e12
    : u === '万' ? 1e4 : u === '亿' ? 1e8 : u === '万亿' ? 1e12 : 1
  return Math.round(n * mul)
}
