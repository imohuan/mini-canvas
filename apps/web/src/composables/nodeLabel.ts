// nodeLabel —— 给**重复的节点名**算一个不撞的后缀（纯函数，Node 可单测）。
//
// 为什么住在 ui 侧（与 nodePack.ts 同一条理由）：这是成品应用这一侧的事 ——
// 画布上现在有哪些名字只有宿主知道；而 ui 包**不能** import plugin-node-ui
// （跨包 import 会把 node 侧逻辑拖进浏览器包）。后台那半（canvas_ui_add_favorite）
// 在插件侧另有一份同名同规则的实现，由测试盯着两边一致。
//
// 用户口径（2026-10-14）：「你拖出来的这些节点，名称没有自动追加，导致了名称重复。
// 我的画布里面添加节点的时候，名称是会自动累加的」。
//
// 根因：画布上「新建节点」的名字走数据层按类型计数（图片 1 / 图片 2…），不会撞；
// 而**从资产库拖节点包进来**建节点时，名字是**照抄包里那份 data.label** ——
// 拖两次同一个包就得到两个同名节点，左侧树 / 画面里分不清谁是谁。
// （与剪贴板粘贴那个先例同类：用户 2026-10-12 报过「复制一个『文本 1』粘贴又得到一个『文本 1』」。）
//
// 规则（尽量贴近用户看到的那套「自动累加」）：
//   · 没撞名 → 原样用它（不画蛇添足加后缀）；
//   · 撞名了 → 追加序号：「跑一下」→「跑一下 2」→「跑一下 3」…（与自动名同一形态：空格 + 数字）；
//   · 名字本身就带序号（「可视化 3」）→ 从**那个号往上**接着找（「可视化 4」），
//     而不是叠成「可视化 3 2」——后者看着就像坏掉了。

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
