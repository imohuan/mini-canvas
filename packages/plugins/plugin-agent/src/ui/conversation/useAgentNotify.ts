/**
 * 授权方式、浏览器通知与「一轮跑完」提示。
 *
 * 纯拆分：从 useAgentConversation 原样搬出，语句与顺序不变。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Hand, ShieldAlert } from 'lucide-vue-next'
import { loadNotifyPrefs, playNotifySound, showNotify, type AgentNotifyPrefs } from '../../api/agentNotify.js'
import type { AgentService } from '../../service/types.js'
import type { AgentServiceState } from '../../service/types.js'

export function useAgentNotify(
  agent: AgentService,
  s: AgentServiceState,
  deps: {
    queue: { value: { count: number } }
  },
) {
const { queue } = deps
/**
 * 授权方式（输入框左下角那个下拉）。
 *
 * 它**直接映射**服务端的审批策略开关（policy.enabled），是同一条通道的两个入口 ——
 * 不是又存一份本地状态（两份必然漂移）。
 *   · 完全自动授权 = policy.enabled 关掉 = 所有工具直接放行；
 *   · 接受审核     = policy.enabled 打开 = 命中规则列表的工具先问用户（设置 → Agent → 审批规则）。
 *
 * 与规则列表页共用同一个 agent.savePolicy，所以这里一改、那边立刻就变。
 */
const AUTH_MODES = [
  // 图标与配色（用户口径 2026-10-03）：
  //   接受审核     = 手掌；**无色**（默认样式）—— "先停一下"是常态，不该用彩色喊出来；
  //   完全自动授权 = 盾牌 + 感叹号；**琥珀色**（图标与文字都染）—— 唯一需要用户留意的那个选项。
  // 与 ChatGPT 那份授权菜单的差别：那边"审核"带琥珀、"放行"带红；我们反过来，只给放行上色。
  { value: 'ask', label: '接受审核', hint: '需要确认时先停下来问你。', icon: Hand, tone: 'plain' },
  { value: 'auto', label: '完全自动授权', hint: '所有工具直接执行，不再逐次确认。', icon: ShieldAlert, tone: 'auto' },
] as const
const authMode = computed<'ask' | 'auto'>(() => (s.policy.enabled ? 'ask' : 'auto'))
function setAuthMode(mode: 'ask' | 'auto'): void {
  const enabled = mode === 'ask'
  if (enabled === s.policy.enabled) return
  void agent.savePolicy({ enabled, rules: s.policy.rules })
}

/**
 * 浏览器通知提示条（照参考页实测：383×40、圆角 12、8% 强调色底）。
 * 只在**还没授权**时出现；点「开启」走真的 Notification.requestPermission，
 * 授权失败（浏览器不给 / 用户拒绝）就把这条收起来，不再反复打扰。
 */
const notifyDismissed = ref(false)
const notifyPermission = ref(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
const showNotifyTip = computed(
  () => !notifyDismissed.value && notifyPermission.value === 'default',
)
async function enableNotify(): Promise<void> {
  if (typeof Notification === 'undefined') {
    notifyDismissed.value = true
    return
  }
  try {
    notifyPermission.value = await Notification.requestPermission()
  } catch {
    notifyPermission.value = 'denied'
  }
  notifyDismissed.value = true
}

/**
 * 「一轮跑完 / 队列跑完」的通知（设计 §3.5 / G11）。
 *
 * 为什么在组件里做：浏览器通知与提示音**只能由页面发**（后台脚本发不了）。
 * 两个开关读后台 KV 的 agentNotify（设置弹窗维护那一边，这里只读）；
 * 开关关了就不弹、不响；通知权限没给也不弹（宁缺勿扰，不弹错）。
 */
const notifyPrefs = ref<AgentNotifyPrefs>({ notify: false, sound: false })
async function refreshNotifyPrefs(): Promise<void> {
  notifyPrefs.value = await loadNotifyPrefs({ baseUrl: s.baseUrl })
}

/**
 * 会话标题 + 最后一条的摘要（通知正文用）。
 * 摘要在**动手之前**取：done 事件一到，最后那条助手消息就是这一轮的答案。
 */
function notifySummary(): { title: string; summary: string } {
  const last = [...s.turns].reverse().find((t) => t.kind === 'assistant' && (t.text ?? '').trim())
  // 摘要要把换行 / 连续空白压成一个空格（通知正文只显示一行）——
  // 这里原本写成了 /s+/g（丢了反斜杠）：它匹配的是「一个或多个字母 s」，
  // 于是换行原样留在正文里、而且正文里所有 s 都被换成了空格（真机实测）。
  const raw = (last?.text ?? '').replace(/\s+/g, ' ').trim()
  return { title: s.title || 'Agent', summary: raw.length > 80 ? raw.slice(0, 80) + '…' : raw }
}

/** 一轮跑完：弹通知 + 播音（开关在用户手里） */
function onRoundDone(): void {
  const { title, summary } = notifySummary()
  showNotify('round_done', { title, summary }, notifyPrefs.value)
  playNotifySound(notifyPrefs.value)
}

/** 队列全部发完且会话空闲：再弹一条（用户口径：队列跑完也要说一声） */
function onQueueIdle(): void {
  const { title, summary } = notifySummary()
  showNotify('queue_idle', { title, summary }, notifyPrefs.value)
  playNotifySound(notifyPrefs.value)
}

/**
 * 盯住"跑完"的两个时刻。
 *
 * 为什么用 watch 而不是直接吃 SSE 事件：SSE 的 round_done / queue_idle 事件由
 * 数据层消化（不进 ChatModel），组件这一层看到的是**它消化后的状态变化**：
 *   · 一轮结束 ⇒ s.running 从 true 变 false；
 *   · 队列跑完且空闲 ⇒ 上一条的用户消息在队里发出、队空 + 空闲。
 * 两个时刻在这里都能可靠地观测到，且不依赖数据层把事件转发出来。
 *
 * 摘要必须在**变化之后**取：这时最后一条助手消息已是这一轮的答案。
 *
 * 一条附带纪律：**每轮开跑时重读一次开关**（见下面 refreshNotifyPrefs 的调用）。
 * 开关只在组件挂载时读过一次，用户中途在设置里关了它、当前页面却不知道 ——
 * 表现是「关掉了照样弹」（实测）。读一次是一次轻量请求，且发生在几秒～几分钟的
 * 一轮开始处，等这一轮结束时用的一定是新值。
 */
let roundDoneTimer: ReturnType<typeof setTimeout> | null = null
/** 这一轮开始时队列里还有几条：> 0 且这一轮跑完时队列空了 = **队列全部跑完**（G11 的第二个时机） */
let queueAtRunStart = 0
watch(
  () => s.running,
  (now, before) => {
    if (!before && now) {
      queueAtRunStart = queue.value.count
      // 这一轮开跑时把开关读新：用户在设置里刚改的开关要能马上生效，
      // 不必刷新页面（否则「关掉了照样弹 / 打开了还是不弹」）。
      void refreshNotifyPrefs()
      return
    }
    if (!(before && !now)) return
    const drained = queueAtRunStart > 0 && queue.value.count === 0
    queueAtRunStart = 0
    // 稍等一拍再取摘要：`done` 之后的最后几个 delta 可能还在路上
    if (roundDoneTimer) clearTimeout(roundDoneTimer)
    roundDoneTimer = setTimeout(() => {
      roundDoneTimer = null
      onRoundDone()
      // 这一轮是队列里的最后一条 ⇒ 队列跑完了，再来一条（两个时机各一条，G11）
      if (drained) onQueueIdle()
    }, 250)
  },
)
onBeforeUnmount(() => {
  if (roundDoneTimer) clearTimeout(roundDoneTimer)
  // 断开事件流订阅（只是取消收听；后台那一轮照跑 —— 这是「后台对话」的语义）
  agent.detachStream()
})

return {
  AUTH_MODES,
  authMode,
  setAuthMode,
  notifyDismissed,
  notifyPermission,
  showNotifyTip,
  enableNotify,
  notifyPrefs,
  refreshNotifyPrefs,
  notifySummary,
  onRoundDone,
  onQueueIdle,
  roundDoneTimer,
  queueAtRunStart,
}
}

