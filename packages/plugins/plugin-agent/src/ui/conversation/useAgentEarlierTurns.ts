/**
 * 对话顶部的「加载更早」哨兵。
 *
 * 纯拆分：从 useAgentConversation 原样搬出，watch / onBeforeUnmount 的
 * 注册顺序保持不变（由调用方在原来的位置调用）。
 */
import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { AgentService } from '../../service/types.js'
import type { AgentServiceState } from '../../service/types.js'

export function useAgentEarlierTurns(
  agent: AgentService,
  s: AgentServiceState,
  scroller: Ref<HTMLElement | null>,
) {
/**
 * 顶部哨兵（对话分页，用户口径 2026-10-15）：它进入可视区域才调 loadEarlierTurns()。
 * 两次加载之间的最小间隔 —— 哨兵常驻可视区（对话很短就占满首屏）时不会连发请求；
 * 加载完成后内容从顶部插入，要把滚动位置补回去（否则画面会跳到顶部）。
 */
const earlierSentinel = ref<HTMLElement | null>(null)
let earlierObserver: IntersectionObserver | null = null
let lastEarlierLoadAt = 0
let earlierRetryTimer: ReturnType<typeof setTimeout> | null = null
/** 两次「加载更早」之间的最小间隔（毫秒），与生成历史的 1s 同款 */
const EARLIER_INTERVAL_MS = 1000

function teardownEarlierSentinel(): void {
  earlierObserver?.disconnect()
  earlierObserver = null
  if (earlierRetryTimer) {
    clearTimeout(earlierRetryTimer)
    earlierRetryTimer = null
  }
}

function maybeLoadEarlier(): void {
  if (!s.turnsHaveBefore || s.turnsLoadingEarlier) return
  const elapsed = Date.now() - lastEarlierLoadAt
  if (elapsed < EARLIER_INTERVAL_MS) {
    if (earlierRetryTimer) clearTimeout(earlierRetryTimer)
    earlierRetryTimer = setTimeout(() => {
      earlierRetryTimer = null
      maybeLoadEarlier()
    }, EARLIER_INTERVAL_MS - elapsed)
    return
  }
  lastEarlierLoadAt = Date.now()
  // 顶部插入会让浏览器把滚动锚点顶走：先记当前可视内容到顶部的距离，
  // 装载完（DOM 更新后）把「内容顶到第一条」的增量补回 scrollLeft 无关、只补 scrollTop。
  const el = scroller.value
  const beforeHeight = el?.scrollHeight ?? 0
  const beforeTop = el?.scrollTop ?? 0
  void agent.loadEarlierTurns().then(() => {
    nextTick(() => {
      const after = scroller.value
      if (after && after.scrollHeight > beforeHeight) after.scrollTop = beforeTop + (after.scrollHeight - beforeHeight)
    })
  })
}

function setupEarlierSentinel(): void {
  teardownEarlierSentinel()
  const sentinel = earlierSentinel.value
  if (!sentinel || typeof IntersectionObserver === 'undefined') return
  earlierObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) maybeLoadEarlier()
    },
    { root: scroller.value, rootMargin: '0px 600px 0px 0px' },
  )
  earlierObserver.observe(sentinel)
}

watch(
  () => [s.turnsHaveBefore, s.turnsLoadingEarlier, s.turns.length, s.sessionId],
  () => nextTick(setupEarlierSentinel),
)

onBeforeUnmount(teardownEarlierSentinel)

return {
  earlierSentinel,
  earlierObserver,
  lastEarlierLoadAt,
  earlierRetryTimer,
  EARLIER_INTERVAL_MS,
  teardownEarlierSentinel,
  maybeLoadEarlier,
  setupEarlierSentinel,
}
}
