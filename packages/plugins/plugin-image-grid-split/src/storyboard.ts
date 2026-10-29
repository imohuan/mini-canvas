/**
 * storyboard —— 分镜组节点的槽位纯逻辑（零 Vue / 零 DOM，node 可单测）。
 *
 * 槽位模型：节点 data.slots = string|null[]，槽位数 = rows*cols；
 * 图片以持久资源引用存槽位。组件只管画格子与收鼠标，写库前先过这里。
 */

/** 槽位数据形状（节点 data 里的 slots 字段） */
export interface StoryboardData {
  rows: number
  cols: number
  /** 每格的资源引用（null = 空） */
  slots: Array<string | null>
}

/** 读分镜组 data（非法返回 null：类型不匹配/字段缺失都不渲染网格） */
export function readStoryboard(data: Record<string, unknown> | undefined): StoryboardData | null {
  const rows = typeof data?.rows === 'number' ? data.rows : 0
  const cols = typeof data?.cols === 'number' ? data.cols : 0
  const slots = Array.isArray(data?.slots) ? data.slots : null
  if (rows < 1 || cols < 1 || rows > 8 || cols > 8 || !slots || slots.length !== rows * cols) return null
  // 元素收窄：非 string 的槽当空（写库时数据已经过 publish 校验，这里只兜显示）
  const clean: Array<string | null> = slots.map((s) => (typeof s === 'string' && s !== '' ? s : null))
  return { rows, cols, slots: clean }
}

/** 交换两格（返回新数组；同格/越界返回原表）。纯函数：调用方拿新数组走 doc.updateNode。 */
export function swapSlots(data: StoryboardData, a: number, b: number): Array<string | null> {
  const n = data.rows * data.cols
  if (a < 0 || b < 0 || a >= n || b >= n || a === b) return data.slots
  const next = [...data.slots]
  const tmp = next[a]!
  next[a] = next[b]!
  next[b] = tmp
  return next
}
