<script setup lang="ts">
/**
 * DebugBadge —— 可视化节点标题右侧的「调试」标签（titleExtraSlot 组件）。
 *
 * 用户口径 2026-10-16：调试连接建立后常驻显示，让人一眼看出这个节点正在被调试；
 * 后台/Agent 有动静（收到 eval、执行完成、出错）要在标签上反映出来。
 * 做成插槽组件（titleExtraSlot），以后在标题右侧显示别的数据也能复用同一机制。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { lastUiDebugEvent, subscribeUiDebugEvents, type UiDebugEvent } from './debugEventBus'

const props = defineProps<{ nodeId: string; data: Record<string, unknown> }>()

const last = ref<UiDebugEvent | undefined>(lastUiDebugEvent(props.nodeId))
const off = subscribeUiDebugEvents((e) => {
  if (e.nodeId === props.nodeId) {
    last.value = e
    if (e.kind === 'connected') refreshDebugging()
  }
})

/**
 * 是否仍在调试中。sessionStorage 不是响应式的 —— 真机验证 2026-10-16 抓到：
 * computed 读 sessionStorage 无响应式依赖，挂载时缓存死值（false），
 * 标签永远不出现。改为：挂载读一次 + 总线 connected 置位 + 2 秒轻量轮询。
 */
const stillDebugging = ref(false)
function refreshDebugging(): void {
  try {
    const cred = sessionStorage.getItem('mc-ui-debug-credential')
    if (!cred) { stillDebugging.value = false; return }
    const c = JSON.parse(cred) as { nodeId?: string }
    stillDebugging.value = c.nodeId === props.nodeId
  } catch { stillDebugging.value = false }
}
refreshDebugging()
const pollTimer = setInterval(refreshDebugging, 2000)
onBeforeUnmount(() => clearInterval(pollTimer))

/**
 * 徽标状态机（用户口径 2026-10-17）：
 *   收到指令 → 「收到指令」停留 500ms（不要一下就闪过）
 *   → 「执行中」+ 秒表（执行可能超过 1 秒，让人知道它活着）
 *   → 结束（result/error）→ 结果文案停留 500ms → 回「调试」常驻。
 * 断开（disconnected 事件或凭据消失）→ 整个标签熄灭。
 */
type Phase =
  | { name: 'idle' }
  | { name: 'received'; until: number }
  | { name: 'running'; since: number }
  | { name: 'done'; until: number; text: string; error: boolean }
const phase = ref<Phase>({ name: 'idle' })
const BADGE_HOLD_MS = 500
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
function ensureTicker(): void {
  if (ticker !== null) return
  ticker = setInterval(() => {
    now.value = Date.now()
    const p = phase.value
    if (p.name === 'received' && now.value >= p.until) phase.value = { name: 'running', since: p.until }
    else if (p.name === 'done' && now.value >= p.until) phase.value = { name: 'idle' }
  }, 100)
}
ensureTicker()
onBeforeUnmount(() => { if (ticker !== null) clearInterval(ticker) })

function onDebugEvent(e: UiDebugEvent): void {
  switch (e.kind) {
    case 'eval':
      phase.value = { name: 'received', until: Date.now() + BADGE_HOLD_MS }
      break
    case 'result':
    case 'error':
      phase.value = {
        name: 'done',
        until: Date.now() + BADGE_HOLD_MS,
        text: e.kind === 'error' ? '调试 · 出错' : '调试 · 已执行',
        error: e.kind === 'error',
      }
      break
    case 'disconnected':
      // 断开即熄：用户口径「断开连接的时候，把你的调试关闭掉」
      phase.value = { name: 'idle' }
      break
  }
}
subscribeUiDebugEvents((e) => {
  if (e.nodeId === props.nodeId) onDebugEvent(e)
})

const text = computed(() => {
  if (!stillDebugging.value) return null
  const p = phase.value
  if (p.name === 'received') return '调试 · 收到指令'
  if (p.name === 'running') return '调试 · 执行中 ' + Math.max(1, Math.round((now.value - p.since) / 1000)) + 's'
  if (p.name === 'done') return p.text
  return '调试'
})
const badgeCls = computed(() => ({
  'is-active': phase.value.name === 'running' || phase.value.name === 'received',
  'is-error': phase.value.name === 'done' && phase.value.error,
}))

</script>

<template>
    <span v-if="text" class="ui-debug-badge" :class="badgeCls" role="status">
    <span class="ui-debug-badge-dot" aria-hidden="true"></span>{{ text }}
  </span>
</template>

<style scoped>
.ui-debug-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  white-space: nowrap;
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 18%, transparent);
  color: var(--ui-accent, #0891b2);
}
.ui-debug-badge-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: ui-debug-pulse 1.6s ease-in-out infinite;
}
.ui-debug-badge.is-error {
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 20%, transparent);
  color: var(--ui-warn, #e3a25f);
}
@keyframes ui-debug-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
</style>

