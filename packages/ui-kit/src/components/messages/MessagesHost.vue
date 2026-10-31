<script setup lang="ts">
/**
 * MessagesHost —— 轻提示的挂载点。
 *
 * 和 Notify 的分工：
 *   - Messages：顶部居中、**不带标题和按钮**、最多停留几秒，只报「刚发生了什么」；
 *   - Notify：右上角、可带说明和操作，重要的事才用它。
 *
 * 这里仍是本地队列：轻提示的语义就是「一条短的反馈」，不需要 sonner 的堆叠与滑走。
 */
import { computed } from 'vue'
import { messageList } from './store'
import './messages.css'

defineOptions({ name: 'MckMessagesHost' })

type MessageIcon = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary'

const visible = computed(() => messageList)

function iconOf(tone: string | undefined): MessageIcon {
  return (tone ?? 'neutral') as MessageIcon
}

const paths: Record<MessageIcon, string> = {
  success: 'M20 6 9 17l-5-5',
  warning: 'm21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3ZM12 9v4M12 17h.01',
  danger: 'm15 9-6 6M9 9l6 6',
  info: 'M12 11v5M12 8h.01',
  primary: 'M12 8v8M8 12h8',
  neutral: 'M8 12h8',
}
</script>

<template>
  <Teleport to="body">
    <div class="mck-messages-host" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="mck-message">
        <div
          v-for="item in visible"
          :key="item.id"
          class="mck-message"
          :class="'is-' + (item.tone ?? 'neutral')"
          role="status"
        >
          <span class="mck-message__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle v-if="iconOf(item.tone) === 'danger' || iconOf(item.tone) === 'info' || iconOf(item.tone) === 'neutral'" cx="12" cy="12" r="9" />
              <path :d="paths[iconOf(item.tone)]" />
            </svg>
          </span>
          <span class="mck-message__text">{{ item.text }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
