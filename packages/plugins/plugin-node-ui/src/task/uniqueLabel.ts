/**
 * uniqueLabel —— 给**重复的节点名**算一个不撞的后缀（纯函数，可单测）。
 *
 * 与 packages/ui/src/composables/nodeLabel.ts **同一套规则**，为什么要两个文件：
 * 插件后台半是**外挂单文件**（打成 dist/server.js 后 import(data:URL) 加载），
 * 不能 import 工作区包（data: URL 里解析不了裸模块名，见 build-server.mjs 的说明）；
 * 而 ui 侧也不能 import 这个插件（会把 node 逻辑拖进浏览器包）。
 * 所以各写一份 —— **由一条测试盯着两份实现逐字一致**（与 PACK_EXT 同一做法）。
 *
 * 用户口径（2026-10-14）：「你拖出来的这些节点，名称没有自动追加，导致了名称重复。
 * 我的画布里面添加节点的时候，名称是会自动累加的」。
 * 场景：MCP 的 canvas_ui_add_favorite 把同一个收藏节点包建两次 → 两个同名节点。
 */

/** 取一个不与 taken 冲突的显示名（base 为空 → 返回空串，调用方交回数据层补默认名） */
export function uniqueLabel(base: string, taken: Iterable<string>): string {
  const want = String(base ?? '').trim()
  if (!want) return ''
  const used = new Set<string>()
  for (const t of taken) {
    if (typeof t !== 'string') continue
    const s = t.trim()
    if (s) used.add(s)
  }
  if (!used.has(want)) return want
  const m = /^(.*?\D)?\s*(\d+)$/.exec(want)
  // 纯数字名（「3」）没有词干：整体当序号，下一个就是「4」。
  // 带词干的（「可视化 3」）从「可视化 4」起。都没撞到才用的号从 2 起（1 号是原来那个）。
  const stem = m && m[1] !== undefined && m[1].trim() ? m[1].trim() : m ? '' : want
  let n = m ? Number.parseInt(m[2], 10) + 1 : 2
  if (!Number.isFinite(n) || n < 2) n = 2
  for (; n < 100000; n++) {
    const cand = stem ? stem + ' ' + n : String(n)
    if (!used.has(cand)) return cand
  }
  return want + ' ' + Date.now()
}
