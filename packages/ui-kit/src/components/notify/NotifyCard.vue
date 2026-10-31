<script setup lang="ts">
/**
 * NotifyCard —— 通知卡片本体（vue-sonner 的自定义组件）。
 *
 * vue-sonner 只负责容器、堆叠、进出场、悬停暂停和滑走关闭；
 * 卡片里的标题、说明、操作按钮、关闭按钮由这里画。
 *
 * 两个由 sonner 注入的 props：
 *   - `isPaused`：悬停时 sonner 会暂停倒计时；
 *   - `onCloseToast`：点关闭要走 sonner 的退场动画，不能直接删自己的数据。
 */
import { computed } from 'vue'
import type { NotifyItem } from './types'
import './notify.css'

defineOptions({ name: 'MckNotifyCard' })

interface NotifyCardProps {
  item: NotifyItem
  isPaused?: boolean
  onCloseToast?: () => void
}

const props = defineProps<NotifyCardProps>()

const tone = computed(() => props.item.tone ?? 'primary')
const duration = computed(() => props.item.duration ?? 3600)
const hasTimer = computed(() => Number.isFinite(duration.value) && duration.value > 0)

function close(): void {
  props.onCloseToast?.()
}

function runAction(): void {
  props.item.action?.onClick()
  close()
}
</script>

<template>
  <div
    class="mck-notify"
    :class="['is-' + tone, { 'is-paused': isPaused, 'is-sticky': !hasTimer }]"
    role="status"
  >
    <span class="mck-notify__icon" aria-hidden="true">
      <svg v-if="tone === 'success'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <svg v-else-if="tone === 'warning'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
      <svg v-else-if="tone === 'danger'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="m15 9-6 6M9 9l6 6" />
      </svg>
      <svg v-else-if="tone === 'info'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    </span>

    <div class="mck-notify__copy">
      <strong class="mck-notify__title">{{ item.title }}</strong>
      <p v-if="item.description" class="mck-notify__desc">{{ item.description }}</p>
      <button v-if="item.action" type="button" class="mck-notify__action" @click="runAction">
        {{ item.action.label }}
      </button>
    </div>

    <button type="button" class="mck-notify__close" aria-label="关闭通知" title="关闭" @click="close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>

    <span
      v-if="hasTimer"
      class="mck-notify__timer"
      aria-hidden="true"
      :style="{ '--mck-notify-duration': duration + 'ms' }"
    />
  </div>
</template>
