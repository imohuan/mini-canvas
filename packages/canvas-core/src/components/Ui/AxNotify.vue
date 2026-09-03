<script setup lang="ts">
/**
 * AxNotifyHost —— 全局 notify 的展示宿主。
 * 在应用根（如 Canvas 内）渲染一次即可；订阅 ./notify 的队列并渲染成右上角 toast 栈。
 * 通知项由 notifySuccess/notifyError/... 或 notify() 产生。
 */
import { computed } from 'vue'
import { notifyQueue, dismissNotify, type AxNotifyItem } from './notify'

const items = computed(() => [...notifyQueue.values()])

const ICON_BY_TYPE: Record<AxNotifyItem['type'], string> = {
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  success:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  warning:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
}
</script>

<template>
  <Teleport to="body">
    <div class="ax-notify-host" aria-live="polite">
      <TransitionGroup name="ax-notify">
        <div
          v-for="item in items"
          :key="item.id"
          class="ax-notify-item"
          :class="`ax-notify-${item.type}`"
        >
          <span class="ax-notify-icon" v-html="ICON_BY_TYPE[item.type]" />
          <div class="ax-notify-body">
            <div class="ax-notify-title">{{ item.title }}</div>
            <div class="ax-notify-text">{{ item.text }}</div>
            <div v-if="item.images?.length" class="ax-notify-images">
              <img v-for="(src, i) in item.images" :key="i" :src="src" alt="通知配图" />
            </div>
          </div>
          <button class="ax-notify-close" title="关闭" @click="dismissNotify(item.id)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.ax-notify-host {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 100000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  pointer-events: none;
}

.ax-notify-item {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 320px;
  padding: 12px 12px 12px 14px;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.14);
  font-size: 13px;
  box-sizing: border-box;
  backdrop-filter: blur(8px);
}

.ax-notify-info {
  background: rgba(239, 246, 255, 0.98);
  border: 1px solid rgba(37, 99, 235, 0.22);
  color: #1e3a8a;
}
.ax-notify-success {
  background: rgba(240, 253, 244, 0.98);
  border: 1px solid rgba(22, 163, 74, 0.25);
  color: #14532d;
}
.ax-notify-warning {
  background: rgba(255, 251, 235, 0.98);
  border: 1px solid rgba(217, 119, 6, 0.28);
  color: #78350f;
}
.ax-notify-error {
  background: rgba(254, 242, 242, 0.98);
  border: 1px solid rgba(220, 38, 38, 0.25);
  color: #991b1b;
}

.ax-notify-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 1px;
}
.ax-notify-icon :deep(svg) {
  width: 18px;
  height: 18px;
}
.ax-notify-info .ax-notify-icon { color: #2563eb; }
.ax-notify-success .ax-notify-icon { color: #16a34a; }
.ax-notify-warning .ax-notify-icon { color: #d97706; }
.ax-notify-error .ax-notify-icon { color: #dc2626; }

.ax-notify-body { flex: 1; min-width: 0; }
.ax-notify-title { font-weight: 600; margin-bottom: 2px; }
.ax-notify-text { font-size: 12px; opacity: 0.92; line-height: 1.5; word-break: break-word; }

.ax-notify-images { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.ax-notify-images img {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.ax-notify-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: currentColor;
  opacity: 0.6;
  cursor: pointer;
  border-radius: 50%;
  transition: opacity 0.15s, background 0.15s;
  margin-top: -2px;
}
.ax-notify-close:hover { opacity: 1; background: rgba(0, 0, 0, 0.06); }
.ax-notify-close :deep(svg) { width: 14px; height: 14px; }

.ax-notify-enter-active,
.ax-notify-leave-active { transition: opacity 0.22s ease, transform 0.22s ease; }
.ax-notify-enter-from,
.ax-notify-leave-to { opacity: 0; transform: translateX(16px); }
</style>
