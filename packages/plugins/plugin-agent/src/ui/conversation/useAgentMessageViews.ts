/**
 * 消息流视图：用户气泡折叠测量、助手块排序、工具卡折叠与视图缓存。
 *
 * 纯拆分：从 useAgentConversation 原样搬出，语句与顺序不变。
 */
import { nextTick, ref } from 'vue'
import { groupTurnBlocks, type TurnRow } from '../../model/turnBlocks.js'
import { toolView, toolBrief, type ToolView } from '../../model/toolViews.js'
import type { AgentTurnView, ToolCard } from '../../model/sessionModel.js'

export function useAgentMessageViews(bubbleRO: {
  unobserve: (el: HTMLElement) => void
  observe: (el: HTMLElement) => void
}) {
/**
 * 用户气泡「默认只显示前 8 行」（用户口径 2026-10-15）：
 * 长消息会把对话列表的滚动区占掉一大块，默认收着、想看再点「展开」。
 *
 * 超没超出靠 DOM 量（scrollHeight > clientHeight），模板算不出来 ——
 * 用 ResizeObserver 盯正文外壳：初次挂载、内容变化、面板拖宽换行都会触发。
 * 展开状态按消息 id 记，切会话 / 刷新回到收起态。
 */
const USER_BUBBLE_MAX_LINES = 8
const openUserBubbles = ref<Record<string, boolean>>({})
const overflowingUser = ref<Record<string, boolean>>({})
function toggleUserBubble(id: string): void {
  openUserBubbles.value[id] = !openUserBubbles.value[id]
}
/**
 * 测量本体挂哪：挂 <p> 本身会在 ref 回调里写响应式状态 —— 而写状态的当帧正是
 * 渲染刚结束的时机，状态一变又要重渲染，形成「渲染 → ref → 写状态 → 重渲染」
 * 的递归（真机报 Maximum recursive updates exceeded，实测踩到）。
 *
 * 改成渲染后统一量：ref 只把元素登记进普通 Map（零响应式），列表渲染完（nextTick）
 * 再一次性量 scrollHeight / clientHeight。之后的高度变化（面板拖宽换行）由
 * ResizeObserver 兜 —— RO 回调不在渲染帧里写状态，同样安全。
 */
const userBubbleBodies = new Map<string, HTMLElement>()
let measureScheduled = false
function scheduleMeasureUserBubbles(): void {
  if (measureScheduled) return
  measureScheduled = true
  void nextTick(() => {
    measureScheduled = false
    measureUserBubbles()
  })
}
function measureUserBubbles(): void {
  const next: Record<string, boolean> = {}
  for (const [id, el] of userBubbleBodies) {
    // 已展开的**保持原判**：展开态下夹层放开，scrollHeight == clientHeight，
    // 再按"超出"量会把按钮判没（用户就没法收起了）。收起判定交给收起那一次测量。
    if (openUserBubbles.value[id]) next[id] = overflowingUser.value[id] === true
    else next[id] = el.scrollHeight > el.clientHeight + 1
  }
  // 稳定态检测（2026-10-16 卡死修复）：与上次值相同就**不写** ref ——
  // 写相同的值 Vue 也会因引用变化触发重渲染 → ref 回调再触发 measure → 无限循环
  // （「一轮 AI 对话后整机卡死」的根因：滚动吸底动画/RO 每帧驱动 measure）。
  let changed = false
  const prev = overflowingUser.value
  for (const [id, v] of Object.entries(next)) if (prev[id] !== v) changed = true
  if (changed || Object.keys(prev).length !== Object.keys(next).length) overflowingUser.value = next
}
function setUserBubbleBody(id: string): (el: unknown) => void {
  // ref 回调只登记 DOM（普通 Map，不碰响应式）：渲染期间零副作用，不会自触发。
  return (el: unknown) => {
    const node = el as HTMLElement | null
    const old = userBubbleBodies.get(id)
    if (old && old !== node) bubbleRO.unobserve(old)
    if (node) {
      userBubbleBodies.set(id, node)
      bubbleRO.observe(node)
    } else {
      userBubbleBodies.delete(id)
    }
    scheduleMeasureUserBubbles()
  }
}

/**
 * 助手一轮里的块**按到达顺序**排（用户口径 2026-10-05）。
 *
 * 以前模板固定「先工具、后正文」，于是所有工具都被堆到最上面、看不出时序；
 * 现在交给纯函数 groupTurnBlocks：文字是分界线，中间没有文字的多个工具合并成一组。
 * 兜底：老数据 / 极端情况下 steps 为空但 text 有值，就当一整块文字渲染（别把回答藏起来）。
 * 用户那条返回空数组 —— 它的正文由下面的标签行单独渲染，不走这里（避免重复一遍）。
 */
function assistantRows(t: AgentTurnView): TurnRow[] {
  if (t.kind !== 'assistant') return []
  const steps = t.steps ?? []
  if (!steps.length) return t.text ? [{ type: 'text', key: 'fallback', text: t.text }] : []
  return groupTurnBlocks(steps, t.tools ?? [])
}

/** 工具组（一组多个工具）的展开态，key 用块的 key */
const openToolGroups = ref<Record<string, boolean>>({})
function toggleToolGroup(key: string): void {
  openToolGroups.value[key] = !openToolGroups.value[key]
}

/** 组标题：跑着几个 / 跑完了几个（照参考项目的「N 个工具调用」写法） */
function toolGroupTitle(tools: ToolCard[]): string {
  const running = tools.filter((x) => !x.settled).length
  return running ? `${tools.length} 个工具调用 · ${running} 个进行中` : `${tools.length} 个工具调用`
}

/**
 * 画布 MCP 工具（自带卡片）走「直接展示卡片 + 卡内详情折叠」；
 * **其它工具（默认工具）保持原来的折叠行行为**（用户口径 2026-10-07：只删 hover，别动折叠）。
 */
const openTools = ref<Record<string, boolean>>({})
function toggleTool(id: string): void {
  openTools.value[id] = !openTools.value[id]
}
/** 该工具是否有自定义卡片（画布族）——有卡片才直接展示，其余走折叠行 */
function hasCardView(tool: ToolCard): boolean {
  return viewOf(tool).family !== 'fallback'
}
/**
 * 收起行的摘要：优先用卡片给的人话摘要（「25 节点 · 11 连线」这种），
 * 没有才退回输出原文的一行截断（用户口径 2026-10-07：收起行也要能读懂）。
 */
function toolSummary(tool: ToolCard): string {
  const card = viewOf(tool)
  if (card.summary) return card.summary.length > 60 ? card.summary.slice(0, 60) + '…' : card.summary
  const one = (tool.output ?? '').replace(/\s+/g, ' ').trim()
  return one.length > 60 ? one.slice(0, 60) + '…' : one
}

/**
 * **折叠行**后面那截描述：优先给「执行内容」（跑的那条命令 / 读写的那个文件），
 * 没有才退回卡片摘要、再退回输出截断。
 *
 * 用户口径（2026-10-11）：「exec_command 后面应该跟一些执行命令的文本信息」——
 * 只显示一个工具名分不清是哪个（同一种工具能跑无数条命令）。
 * 为什么顺序是这样：收起时最想知道「它干了什么」，输出结果是展开后的事。
 */
function toolRowSummary(tool: ToolCard): string {
  const brief = toolBrief(tool.name, tool.arguments)
  if (brief) return brief
  return toolSummary(tool)
}

/**
 * 展开区的**专用视图**（用户口径 2026-10-06）：内置画布 MCP 工具各自配专用 UI，
 * 不认识的回退通用 JSON。纯函数 toolView 出数据，这里只缓存（同一工具不重复解析）。
 *
 * 缓存条件：output 已到。工具调用先到、结果后到 —— 若先给「无输出」的结果缓存了 fallback
 * 视图，结果到了也不会刷新（实测：专用渲染不生效的根因之一）。
 */
const viewCache = new Map<string, ToolView>()
function viewOf(tool: ToolCard): ToolView {
  if (tool.output !== undefined) {
    const hit = viewCache.get(tool.id)
    if (hit) return hit
  }
  const v = toolView(tool.name, tool.arguments, tool.output)
  if (tool.output !== undefined) viewCache.set(tool.id, v)
  return v
}

/** 换会话 / 清屏时把缓存与展开态一起丢掉（tool id 在不同会话可能重复） */
function resetViewCaches(): void {
  viewCache.clear()
  openTools.value = {}
  openToolGroups.value = {}
}

return {
  USER_BUBBLE_MAX_LINES,
  openUserBubbles,
  overflowingUser,
  toggleUserBubble,
  userBubbleBodies,
  measureScheduled,
  scheduleMeasureUserBubbles,
  measureUserBubbles,
  setUserBubbleBody,
  assistantRows,
  openToolGroups,
  toggleToolGroup,
  toolGroupTitle,
  openTools,
  toggleTool,
  hasCardView,
  toolSummary,
  toolRowSummary,
  viewCache,
  viewOf,
  resetViewCaches,
}
}
