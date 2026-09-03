<script setup lang="ts">
/**
 * AxToast —— AxNotify 的自定义 toast 呈现组件（vue-sonner headless 风格）。
 *
 * 由 notify.ts 通过 `toast.custom(markRaw(AxToast), { componentProps, duration })` 渲染，
 * vue-sonner 只负责容器/堆叠/进出场动画/滑动关闭与 duration 自动关闭，本组件完全掌控卡片外观。
 *
 * vue-sonner 会额外注入两个 prop：
 *   - onCloseToast：关闭本条 toast（点关闭按钮时调用；由 Toast.vue 传入）
 *   - isPaused    ：悬停/交互暂停计时时 true（本组件未用到，可忽略）
 * componentProps（来自 notify.ts）：
 *   - type        ：info/success/warning/error → 决定图标与配色
 *   - message     ：主文案
 *   - description ：次要说明（可选）
 *   - images      ：缩略图（可选）
 */
import type { AxNotifyType } from './notify'

defineProps<{
  type: AxNotifyType
  message: string
  description?: string
  images?: string[]
  onCloseToast?: () => void
}>()

const ICON_BY_TYPE: Record<AxNotifyType, string> = {
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
  <div class="ax-toast" :class="`ax-toast-${type}`">
    <span class="ax-toast-icon" v-html="ICON_BY_TYPE[type]" />
    <div class="ax-toast-body">
      <div class="ax-toast-message">{{ message }}</div>
      <div v-if="description" class="ax-toast-text">{{ description }}</div>
      <div v-if="images?.length" class="ax-toast-images">
        <img v-for="(src, i) in images" :key="i" :src="src" alt="通知配图" />
      </div>
    </div>
    <button v-if="onCloseToast" class="ax-toast-close" title="关闭" @click="onCloseToast()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
</template>

<style scoped>
.ax-toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 320px;
  max-width: 80vw;
  box-sizing: border-box;
  padding: 12px 12px 12px 14px;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.14);
  font-size: 13px;
  backdrop-filter: blur(8px);
}
.ax-toast-info {
  background: rgba(239, 246, 255, 0.98);
  border: 1px solid rgba(37, 99, 235, 0.22);
  color: #1e3a8a;
}
.ax-toast-success {
  background: rgba(240, 253, 244, 0.98);
  border: 1px solid rgba(22, 163, 74, 0.25);
  color: #14532d;
}
.ax-toast-warning {
  background: rgba(255, 251, 235, 0.98);
  border: 1px solid rgba(217, 119, 6, 0.28);
  color: #78350f;
}
.ax-toast-error {
  background: rgba(254, 242, 242, 0.98);
  border: 1px solid rgba(220, 38, 38, 0.25);
  color: #991b1b;
}

.ax-toast-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 1px;
}
.ax-toast-icon :deep(svg) {
  width: 18px;
  height: 18px;
}
.ax-toast-info .ax-toast-icon { color: #2563eb; }
.ax-toast-success .ax-toast-icon { color: #16a34a; }
.ax-toast-warning .ax-toast-icon { color: #d97706; }
.ax-toast-error .ax-toast-icon { color: #dc2626; }

.ax-toast-body { flex: 1; min-width: 0; }
.ax-toast-message { font-weight: 600; line-height: 1.45; word-break: break-word; }
.ax-toast-text { margin-top: 2px; font-size: 12px; opacity: 0.92; line-height: 1.5; word-break: break-word; }

.ax-toast-images { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.ax-toast-images img {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.ax-toast-close {
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
  margin: -2px 0 0 2px;
}
.ax-toast-close:hover { opacity: 1; background: rgba(0, 0, 0, 0.06); }
.ax-toast-close :deep(svg) { width: 14px; height: 14px; }
</style>
