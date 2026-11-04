/**
 * 队列与目标：编辑态、折算出的队列行、目标预算、发送键三态、Esc 处理。
 *
 * 纯拆分：从 useAgentConversation 原样搬出，语句与顺序不变。
 */
import { computed, ref, watch } from 'vue'
import {
  queuePanelView,
  sendButtonMode,
  goalMarkText,
  goalEndedBadge,
  goalIsFinished,
  parseTokenText,
  type TokenUnit,
  type QueueRow,
} from '../../model/queueModel.js'
import type { QueueStateView } from '../../api/agentApi.js'
import type { AgentService } from '../../service/types.js'
import type { AgentServiceState } from '../../service/types.js'

export function useAgentEditing(
  agent: AgentService,
  s: AgentServiceState,
  deps: {
    prompt: { value: string }
    attached: { value: string[] }
    previewImage: { value: string | null }
    plusOpen: { value: boolean }
    modeOpen: { value: boolean }
    authOpen: { value: boolean }
    modelOpen: { value: boolean }
    skillOpen: { value: boolean }
    mcpOpen: { value: boolean }
    editIntoComposer: (text: string, images: string[] | undefined) => void
  },
) {
const { prompt, attached, previewImage, plusOpen, modeOpen, authOpen, modelOpen, skillOpen, mcpOpen, editIntoComposer } = deps
/**
 * 队列的**镜像**：真相在后台（会话文件里的 queue 字段），state.queue 由
 * 数据层恢复（GET 会话）+ SSE 的 `queue` 事件持续同步；本组件只读它。
 *
 * 上面再叠一层**本地编辑态**：后端的 `update` 语义是"改完待发"（op 一调就把状态刷回
 * queued），没有"置 editing"的接口 —— 所以"这条正在被编辑"由本组件自己记（唯一真相在这里），
 * 折算时把那几条强制成 `editing`（queueModel 据此出琥珀行 + 队列阻塞提示）。
 */
const editingItems = ref<string[]>([])
/**
 * 「发送中显示队列」开关（用户口径 2026-10-15，全局设置里配）：关 = sending 条目
 * 不画出来（真实发送后就从列表消失的效果）。默认显示 —— 关闭是用户显式的选择。
 */
const showSendingQueue = ref(true)
const queueView = computed<QueueStateView>(() => {
  const base = s.queue
  // 开关关闭：先把 sending 条目滤掉（编辑态映射在前 —— 别把用户正在改的那条滤丢）
  const keep = showSendingQueue.value ? base.items : base.items.filter((it) => it.state !== 'sending')
  if (!editingItems.value.length) return { ...base, items: keep }
  const ids = new Set(editingItems.value)
  return { ...base, items: keep.map((it) => (ids.has(it.id) ? { ...it, state: 'editing' as const } : it)) }
})
/** 折算成一排排要画的行（纯函数在 queueModel，可单测） */
const queue = computed(() => queuePanelView(queueView.value))
/**
 * 拖拽排序落地（用户口径 2026-10-16，Vue Draggable Plus）：拖完把全量 id 新顺序
 * 发给 service（乐观更新 + 服务端钉住 sending/sent 的位置）。sending 行没有把手，
 * 拖不动；被别的行拖动经过时由后端放回原位（前端顺序只作参考）。
 */
function onQueueReorder(nextRows: QueueRow[]): void {
  void agent.reorderQueue(nextRows.map((r) => r.id))
}
/**
 * 有队列消息正在编辑 ⇒ **队列整体阻塞**（后端保证不发下一条，G7）。
 * 组件用它决定列表上方那条提示（用户得知道"为什么队列不动了"）。
 */
const queueBlocked = computed(() => queue.value.blocked)

/**
 * 聚合容器是否要画：**有队列消息 或 有已发送的目标**时为真。
 * 未发送的目标不进这个容器（它在输入框内侧），所以不进这个判断。
 */
const pending = computed(() => ({ hasAny: queue.value.hasItems || !!goalRow.value }))

/** 目标标记（G12）：`+ → 目标` 直接加一个默认预算的标记，点标签才弹编辑框 */
const goalMark = computed<{ objective: string; budget: number } | null>(() => s.goalMark)

/**
 * token 口径（用户口径 2026-10-09）：**只有两态** —— 已用预算 ⇄ 剩余预算。
 * 未发送的目标标签、已发送的目标行**共用这一个开关**（两处都能改，口径一致）。
 * 持久化到 localStorage：刷新后口径不跳。
 */
/**
 * token 单位制（用户口径 2026-10-09）：国际 k/M/B/T ⇄ 中文 万/亿/万亿。
 * 跟着「换算口径」走，不放进设置弹框 —— 它就是这里数字的显示方式。
 */
const UNIT_KEY = 'mini-canvas:agent:token-unit'
const tokenUnit = ref<TokenUnit>(
  (typeof localStorage !== 'undefined' && localStorage.getItem(UNIT_KEY) === 'cn') ? 'cn' : 'si',
)
watch(tokenUnit, (u) => {
  try {
    localStorage.setItem(UNIT_KEY, u)
  } catch {
    /* 同上 */
  }
})
function toggleTokenUnit(): void {
  tokenUnit.value = tokenUnit.value === 'si' ? 'cn' : 'si'
}
/**
 * 目标默认预算：读全局设置（KV `config/agentGoalDefaults`，由设置弹窗那一路维护；
 * 与 packages/ui 的 agentSettings 同一个键 —— 别自创路径）。
 *
 * 为什么经**批量口**而不是单项 GET：这个键用户没改过时从未保存过，单项 GET 必然回 404
 * （控制台里多一条“加载资源失败”，而用户什么都没做错）。批量口一次拿回整个 config 域，
 * 缺键只是“桶里没有”，不再产生 404。
 *
 * 三种情况要分清（与 ui 侧 budgetFromKv 同口径）：
 *   · 桶里没这个键（从未保存过）⇒ 用默认 50000（设计 §3.6.3）；
 *   · 存了 `{ budget: 0 }` ⇒ 用户明确选了"不限"，就用 0，**不能**被默认值盖回去；
 *   · 坏数据 ⇒ 回落默认。
 */
const goalDefaultBudget = ref(50000)
async function loadGoalDefaults(): Promise<void> {
  try {
    const base = (s.baseUrl ?? '').replace(/\/+$/, '')
    const res = await fetch(base + '/api/kv/config?values=1', { headers: { accept: 'application/json' } })
    if (!res.ok) return
    const body = (await res.json()) as { values?: Record<string, unknown> } | null
    const raw = body?.values?.['agentGoalDefaults']
    if (!raw || typeof raw !== 'object' || !('budget' in raw)) return
    const b = Number(raw.budget)
    if (Number.isFinite(b) && b >= 0) goalDefaultBudget.value = Math.floor(b)
  } catch {
    /* 后台没连 / 没这个键：用默认值，不打扰用户 */
  }
}

/** 点「+ → 目标」：直接加标签（**不弹框**），内容留空提示「输入目标内容」 */
function addGoalMark(): void {
  agent.setGoalMark('', goalDefaultBudget.value)
}

function clearGoalMark(): void {
  agent.clearGoalMark()
  // 若正在编辑运行中的目标，撤掉标记 = 取消这次编辑（目标本身没动过）
  editingGoal.value = false
}

/**
 * 编辑**正在运行**的目标（用户口径 2026-10-09）：点目标行左侧那颗图标进入。
 * 效果与队列编辑一致 —— 恢复成**待编辑的草稿状态**：目标内容回填输入框 + 挂上目标标记；
 * 发送时（见 submit）**只更新该目标的内容**，不新建目标、也不进队列。
 */
const editingGoal = ref(false)
/**
 * 三种编辑**互斥**（用户口径 2026-10-09）：对话消息 / 队列消息 / 目标，同一时刻只能有一个在编辑。
 * 进入任一编辑前先调它 —— 把另外两种退出，避免三个编辑态叠在一起。
 */
function cancelAllEditsExcept(keep: 'message' | 'queue' | 'goal'): void {
  if (keep !== 'message' && s.editingId) agent.cancelEdit()
  if (keep !== 'queue' && editingItems.value.length) {
    for (const id of [...editingItems.value]) void agent.cancelEditQueueItem(id)
    editingItems.value = []
  }
  if (keep !== 'goal' && editingGoal.value) {
    editingGoal.value = false
    agent.clearGoalMark()
  }
}
function beginEditGoal(): void {
  const g = s.goal
  if (!g) return
  cancelAllEditsExcept('goal')
  editingGoal.value = true
  agent.setGoalMark(g.objective, g.budget)   // 挂上草稿标记（输入框顶部那条）
  // 图片也一并回填（与队列编辑同款）：目标的参考图就在宿主记录里
  editIntoComposer(g.objective, s.goalImages?.length ? s.goalImages : undefined)
}
/** 取消编辑目标：撤掉标记，恢复原样（目标本身没动过） */
function cancelEditGoal(): void {
  editingGoal.value = false
  agent.clearGoalMark()
}
/** 目标行左侧图标点击：进入编辑（再点一次 = 退出编辑、撤掉草稿标记） */
function startEditGoalRow(): void {
  if (editingGoal.value) cancelEditGoal()
  else beginEditGoal()
}

/** 目标标签文案（`目标内容 · 预算 50k`）—— 已发送目标行/无障碍用的文本 */
const goalText = computed(() => goalMarkText(goalMark.value?.objective, goalMark.value?.budget))

/**
 * 已发送目标的列表行：状态徽章 + 第 N 轮 + 进度。
 * 预算**只有一个口径**（用户口径 2026-10-09 修正）：进度 = 已用 / 总预算，没有「已用/剩余」切换。
 */
const goalRow = computed(() => {
  const g = s.goal
  if (!g) return null
  /**
   * 徽章：暂停优先；否则看**是不是真完了**（用户口径 2026-10-11）。
   * `ended` 有两种情形（真完成 / 只是这轮被中止），拿它当"已完成"会谎报，
   * 所以改问 goalIsFinished —— 中止仍显示「已中止」，只有真完成才「已完成」。
   */
  const finished = goalIsFinished(g.status)
  const badge = s.goalPaused
        ? { text: '已暂停', cls: 'is-paused' }
    : (g.ended || finished ? goalEndedBadge(g.status) : { text: '运行中', cls: '' })
  return {
    badge,
    round: g.round,
    resumed: s.goalPaused,
    /** 真完了才收按钮；中止（aborted）仍要给播放键，用户才能接着跑 */
    finished,
  }
})

/**
 * 预算值就地编辑（contenteditable）。用户口径 2026-10-09：
 *   1. **点进去就全选**（省得手动删）——用 focus 时 selectAll；
 *   2. **只有回车才算有效**；Esc 或点别处（失焦）= 放弃、还原原值。
 * 参数：kind = 'budget'（总预算）| 'used'（已用，只读，不触发提交）；scope = 'mark'(草稿) | 'row'(运行中)。
 */
function onGoalEditFocus(e: FocusEvent): void {
  const el = e.target as HTMLElement
  // 记下原值（用于 Esc / 失焦还原），再全选，用户一敲键盘就覆盖
  el.dataset.raw = el.textContent ?? ''
  const sel = window.getSelection?.()
  if (sel) {
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
  }
}
function commitGoalBudget(el: HTMLElement, scope: 'mark' | 'row' | 'used'): void {
  const n = parseTokenText(el.textContent)
  if (Number.isNaN(n)) {
    // 解析不了 = 不改，还原
    el.textContent = el.dataset.raw ?? el.textContent
    return
  }
  if (scope === 'used') void agent.updateGoal({ tokensUsed: n > 0 ? n : 0 })
  else if (scope === 'row') void agent.updateGoal({ budget: n > 0 ? n : -1 })
  else agent.setGoalMark(goalMark.value?.objective ?? '', n > 0 ? n : -1)
  // 提交后清掉 raw，避免下一次失焦又拿旧值还原
  delete el.dataset.raw
}
function onGoalBudgetKeydown(e: KeyboardEvent, el: HTMLElement, scope: 'mark' | 'row' | 'used'): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitGoalBudget(el, scope)   // **只有回车才提交**
    el.blur()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    el.textContent = el.dataset.raw ?? el.textContent
    delete el.dataset.raw
    el.blur()
  }
}
function onGoalBudgetBlur(e: FocusEvent): void {
  // 失焦**不提交**（用户口径：只有回车算有效）—— 有未提交的改动就还原
  const el = e.target as HTMLElement
  if (el.dataset.raw !== undefined) {
    el.textContent = el.dataset.raw
    delete el.dataset.raw
  }
}

/** 发送键三态（G1）：有内容 ⇒ 发送（跑着也是发送，点了进队列）；空 + 跑着 ⇒ 终止；空 + 空闲 ⇒ 禁用 */
const sendMode = computed(() => sendButtonMode(!!prompt.value.trim() || attached.value.length > 0, s.running))

/**
 * 「正在思考」加载指示的显示依据（用户口径 2026-10-16 二次澄清）：
 * **输入框按钮处于「停止」状态（s.running）就显示**，与消息内容/streaming 标记解耦 ——
 * 按钮状态本身就是"这一轮还在跑"的唯一真相，刷新后 openSession 也会把它恢复回来。
 * 只挂在最后一条助手消息上（跟原来一致），避免历史消息里凭空出现加载行。
 */
function showPendingOn(t: { id: string; kind: string }): boolean {
  if (!s.running || t.kind !== 'assistant') return false
  const turns = s.turns
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]!.kind === 'assistant') return turns[i]!.id === t.id
  }
  return false
}


/**
 * 「引导」↳：表面上像直接发送，实际插队（G4/G13）。
 * 跑着时 = 插进当前轮的下一次请求；没跑时后端会把它按普通发送处理（设计 §3.3.3，
 * 三种情况全由后端裁决，前端照调即可）。
 */
async function steerItem(id: string): Promise<void> {
  await agent.steerQueueItem(id)
}

/** 删除这条排队消息（真不要了）；正在编辑的那条删了 = 编辑结束（输入框内容保留） */
async function removeItem(id: string): Promise<void> {
  editingItems.value = editingItems.value.filter((x) => x !== id)
  await agent.removeQueueItem(id)
}

/** 「关闭排队」：不移除内容 —— 文本 + 图片**回填输入框**（用户接着改或直接发） */
async function closeItem(id: string): Promise<void> {
  // 服务把「被关掉那条的内容」回给调用方 —— 关掉的同时回填输入框（它就是"关闭排队"的语义）
  editingItems.value = editingItems.value.filter((x) => x !== id)
  const back = await agent.closeQueueItem(id)
  if (back) editIntoComposer(back.text, back.images)
}

/** 编辑队列消息（G3）：回填输入框 + 标记 editing（位置不变，队列整体阻塞） */
async function beginEditQueue(id: string): Promise<void> {
  // 先要内容（服务那边顺手把这条刷新一遍），再在本地记上"正在编辑"
  cancelAllEditsExcept('queue')
  const back = await agent.beginEditQueueItem(id)
  const item = back ?? s.queue.items.find((x) => x.id === id) ?? null
  if (item && !editingItems.value.includes(id)) editingItems.value = [...editingItems.value, id]
  if (item) editIntoComposer(item.text, item.images)
}

/** 取消编辑（队列行上的 ✕）：状态回 queued，内容不变 */
async function cancelEditQueue(id: string): Promise<void> {
  editingItems.value = editingItems.value.filter((x) => x !== id)
  await agent.cancelEditQueueItem(id)
}

/** 编辑中的那条消息发送：**原位替换**内容（不新起一条、不换位置） */
async function updateEditingQueueItem(id: string, text: string, images: string[]): Promise<void> {
  await agent.saveEditedQueueItem(id, text, images.length ? images : undefined)
  // 发送 = 编辑结束：本地那条"正在编辑"的标记要撤掉，队列才能继续
  editingItems.value = editingItems.value.filter((x) => x !== id)
}

/**
 * 暂停 / 启动队列的自动发送（G8）。
 *
 * 必须写成**函数**、每次点击时现读当前状态：原来的三元（`paused ? resume : pause`）
 * 在 setup 里立刻求值一次，挂载后永远是同一个分支 —— 暂停后点"启动"其实还在调 pause，
 * 看起来完全没反应（真机实测踩到的 bug）。
 */
function toggleQueuePause(): void {
  if (queueView.value.paused) void agent.resumeQueue()
  else void agent.pauseQueue()
}

/** 行内 ⋯ 菜单开合（同一时刻只留一个） */
const rowMenuId = ref<string | null>(null)
/** 当前 hover 的队列行（图标 ⇄ 拖拽把手交换的驱动；用户口径 2026-10-16） */
const hoverRowId = ref<string | null>(null)

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (previewImage.value) {
    previewImage.value = null
    return
  }
  // Esc 先关自己开的那些浮层，最后才轮到别的（手势优先级从最近的一次操作往回退）
  if (rowMenuId.value) {
    rowMenuId.value = null
    return
  }
  if (plusOpen.value) {
    plusOpen.value = false
    return
  }
  // 目标编辑框也吃 Esc（设计 §3.1 的模态三要素之一）
  modeOpen.value = modelOpen.value = skillOpen.value = mcpOpen.value = authOpen.value = false
}

return {
  editingItems,
  showSendingQueue,
  queueView,
  queue,
  onQueueReorder,
  queueBlocked,
  pending,
  goalMark,
  UNIT_KEY,
  tokenUnit,
  toggleTokenUnit,
  goalDefaultBudget,
  loadGoalDefaults,
  addGoalMark,
  clearGoalMark,
  editingGoal,
  cancelAllEditsExcept,
  beginEditGoal,
  cancelEditGoal,
  startEditGoalRow,
  goalText,
  goalRow,
  onGoalEditFocus,
  commitGoalBudget,
  onGoalBudgetKeydown,
  onGoalBudgetBlur,
  sendMode,
  showPendingOn,
  steerItem,
  removeItem,
  closeItem,
  beginEditQueue,
  cancelEditQueue,
  updateEditingQueueItem,
  toggleQueuePause,
  rowMenuId,
  hoverRowId,
  onKeydown,
}
}
