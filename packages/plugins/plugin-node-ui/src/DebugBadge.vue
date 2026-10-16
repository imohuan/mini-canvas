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

const text = computed(() => {
  if (!stillDebugging.value) return null
  switch (last.value?.kind) {
    case 'eval': return '调试 · 收到指令'
    case 'result': return '调试 · 已执行'
    case 'error': return '调试 · 出错'
    default: return '调试'
  }
})
const cls = computed(() => ({
  'is-active': last.value?.kind === 'eval',
  'is-error': last.value?.kind === 'error',
}))
</script>

<template>
  <span v-if="text" class="ui-debug-badge" :class="cls" role="status">
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

