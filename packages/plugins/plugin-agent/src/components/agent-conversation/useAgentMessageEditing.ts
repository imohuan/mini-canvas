/**
 * 用户消息的复制 / 编辑回填，以及会话内的编辑态与分页锚点。
 *
 * 纯拆分：从 useAgentConversation 原样搬出，语句与顺序不变。
 */
import { computed, nextTick, ref } from 'vue'
import { pagerAnchors, type PagerGroup } from '../../branchNav.js'
import { segmentAnchors } from '../../modelSegments.js'
import type { AgentService } from '../../agent-service/types.js'
import type { AgentServiceState } from '../../agent-service/types.js'
import type { AgentTurnView } from '../../sessionModel.js'
import type { ProseMirrorEditorExposed } from './editorTypes.js'

export function useAgentMessageEditing(
  agent: AgentService,
  s: AgentServiceState,
  session: {
    editorRef: { value: ProseMirrorEditorExposed | null }
    prompt: { value: string }
    attached: { value: string[] }
    getEditingItems: () => { value: string[] }
    getEditingGoal: () => { value: boolean }
    getCancelAllEditsExcept: () => (keep: 'message' | 'queue' | 'goal') => void
    getCancelEditGoal: () => () => void
  },
) {
const { editorRef, prompt, attached } = session
/**
 * 换会话（含新建 / 删当前会话）时把三种编辑态归零。
 *
 * 为什么必须做（代码审查发现的洞）：editingItems / editingGoal 是**组件本地**状态，
 * 而 s.editingId 由 sessionModel 管（model.load / reset 会清）。不清的话，在 A 会话里
 * 点了「编辑排队消息 / 编辑目标」，切到 B 会话后那两条编辑标记还挂着 —— 输入框继续回填着
 * A 的内容，发送反而去改 B 的队列/目标（编辑互斥的前提是「同一会话内最多一个」，跨会话必须归零）。
 */
function resetEditStates(): void {
  const editingItems = session.getEditingItems()
  const editingGoal = session.getEditingGoal()
  if (editingItems.value.length) editingItems.value = []
  editingGoal.value = false
}

/**
 * 用户消息 hover 操作条（用户口径 2026-10-06，照参考图 2）。
 *
 * ① 时间：10月2日 23:20 格式；跨年带年份。拿不到时间（老数据）不显示。
 * ② 复制：把**显示文本**（@ 标记已降级成 @名字 的那份）复制进剪贴板，成功时短暂打勾。
 * ③ 编辑：把那条消息的**提示词 + @ 引用 + 图片**填回底部输入框（图片回附件区），
 *    相当于恢复那次发送 —— 分支（fork）的第一步（分支本身在第三批做）。
 */
const copied = ref<Record<string, boolean>>({})
function msgTimeText(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const md = d.getMonth() + 1 + '月' + d.getDate() + '日 ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  return sameYear ? md : d.getFullYear() + '年' + md
}
function msgTimeTitle(ts?: number): string | undefined {
  if (!ts) return undefined
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleString()
}
async function copyMessage(text: string, turnId: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    copied.value[turnId] = true
    setTimeout(() => { copied.value[turnId] = false }, 1200)
  } catch {
    /* 剪贴板被拒（非安全上下文等）：静默 —— 用户看得到没有变化，不值得为它弹错 */
  }
}

/**
 * 「编辑」= 恢复那次发送：正文回输入框、图片回附件区。
 *
 * 为什么直接 setText 就行：转录里存的是**引用标记原文**（<ref … />，后端口径：不翻译），
 * 而 setText 内部的 parsePlainTextToContent 会把它还原成与右键插入同款的 chip 标签
 *（见 prosemirror-editor-bundle 的 parsePlainTextToContent 与 refRestore 测试）。
 * 用户在此基础上改完直接重发即可（重发走 agentService 的分支 fork）。
 */
function editIntoComposer(text: string, images: string[] | undefined): void {
  editorRef.value?.setText(text)
  if (!editorRef.value) prompt.value = text
  attached.value = [...(images ?? [])]
  // 输入框获得焦点，用户直接改就行
  void nextTick(() => editorRef.value?.$el?.querySelector?.('.ProseMirror')?.focus?.())
}

/** 点「编辑」：回填 + 进入「正在编辑」状态（消息高亮、输入框出联动标记） */
function beginEditMessage(t: AgentTurnView): void {
  session.getCancelAllEditsExcept()('message')
  editIntoComposer(t.text, t.images)
  agent.beginEdit(t.id)
  // 高亮的消息要可见：滚到它（比「点标记滚回来」更早一步到位）
  void nextTick(() => scrollToEditing())
}

/** 输入框联动标记被点：滚回正在编辑的那条消息 */
function scrollToEditing(): void {
  // 三种编辑各自的目标元素不同：谁在编辑就滚到谁（类名挂在外层 .ac-msg 上，选择器对准真身）
  const sel =
    editingKind.value === 'message' ? '.ac-msg.is-editing'
      : editingKind.value === 'queue' ? '.ac-queue-row.is-editing'
        : '.ac-goal-row.is-editing'
  document.querySelector(sel)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
/** 当前在编辑哪一种（消息 / 队列 / 目标）；都没有则 null —— 三者互斥，最多一个 */
const editingKind = computed<'message' | 'queue' | 'goal' | null>(() => {
  if (s.editingId) return 'message'
  if (session.getEditingItems().value.length) return 'queue'
  if (session.getEditingGoal().value) return 'goal'
  return null
})
const editingKindText = computed(() =>
  editingKind.value === 'queue' ? '正在编辑排队消息'
    : editingKind.value === 'goal' ? '正在编辑目标'
      : '正在编辑',
)
/** 那条黄色标记上的 ✕：按当前是哪种编辑去取消 */
function cancelEditing(): void {
  if (editingKind.value === 'message') agent.cancelEdit()
  else if (editingKind.value === 'queue') {
    const editingItems = session.getEditingItems()
    for (const id of [...editingItems.value]) void agent.cancelEditQueueItem(id)
    editingItems.value = []
  } else if (editingKind.value === 'goal') session.getCancelEditGoal()()
}

/**
 * 模型分割线：第 N 个用户消息之前，换成了哪个模型（用户口径 2026-10-11）。
 *
 * 为什么从前端现算而不是后端给 turnId：转录是后端的，而"第几个用户消息"这件事
 * 前端本来就按渲染顺序数得出来（与分页器的 userOrdinal 同一口径）——
 * 后端只给 fromUser 这个稳定坐标，位置由渲染层钉，改渲染不会让后端数据失配。
 *
 * 返回 turnId -> 分段；只给**分叉点那一条**上标（第一段 fromUser=0 也要画，
 * 否则用户不知道这个对话一开始用的是哪个模型）。
 */
// 定位规则住在 ../modelSegments.ts（纯函数，有单测）—— 这里只把状态喂给它。
const segmentByAnchor = computed(() => segmentAnchors(s.turns, s.segments))

/** 分割线上的模型名：有 displayName 就用它（界面上的模型列表是这么叫的） */
function segmentModelLabel(seg: { provider: string; modelId: string }): string {
  const hit = s.models.find((m) => m.provider === seg.provider && m.modelId === seg.modelId)
  return hit?.displayName || seg.modelId
}

/**
 * 这条错误是不是已经显示在消息流里了（挂在某条助手消息上）。
 *
 * 为什么要判：同一条错误两个地方都画就成了两条 —— 用户看到重复的报错会以为出了两次事。
 * 优先信消息里那条（它就在出错的那个位置旁边，读起来最连贯），没有才画底部那条常驻条。
 */
const hasInlineError = computed(() => s.turns.some((t) => !!t.error))

/** 分页器切到上/下一条（越界返回 null，按钮同时是 disabled 状态） */
function pagerTarget(p: PagerGroup, delta: number): string | null {
  const next = p.index + delta
  if (next < 0 || next >= p.items.length) return null
  return p.items[next].id
}

/**
 * 分页器**跟随消息**的锚点（用户口径 2026-10-07）：
 * userOrdinal = 第几条用户消息（0 基）在当前位置被编辑过；
 * 分页器插在那条用户消息**整块回复**结束处（下一条用户消息之前 / 列表末尾）。
 * 返回 turnId -> PagerGroup（模板在对应回合后面渲染）。
 */
const pagerByAnchor = computed(() => pagerAnchors(s.turns, s.pagers))

return {
  resetEditStates,
  copied,
  msgTimeText,
  msgTimeTitle,
  copyMessage,
  editIntoComposer,
  beginEditMessage,
  scrollToEditing,
  editingKind,
  editingKindText,
  cancelEditing,
  segmentByAnchor,
  segmentModelLabel,
  hasInlineError,
  pagerTarget,
  pagerByAnchor,
}
}
