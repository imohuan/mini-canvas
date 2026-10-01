<script setup lang="ts">
/**
 * MediaPreviewOverlay —— 素材卡的**全屏预览**浮层（注册在 overlay 槽，Teleport 到 body）。
 *
 * 用户要求（2026-09-30）：「当前预览时是在底部状态栏中进行预览，我要的是全屏，是整个视图」。
 * 所以这里铺满整个视口看大图/全文，而不是缩在底栏里。
 *
 * 关闭方式齐备（照 UI 规范 §3.1 模态三要素）：Esc、点背景、右上角关闭按钮。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { closePreview, previewItem } from './mediaPreview'

const item = computed(() => previewItem())

const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

function onKeydown(e: KeyboardEvent): void {
  if (!item.value) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    closePreview()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="item"
      class="mp-root"
      role="dialog"
      aria-modal="true"
      :aria-label="item.name || '素材预览'"
      data-testid="media-preview-overlay"
      @click.self="closePreview"
      @contextmenu.prevent
    >
      <header class="mp-top" @click.stop>
        <span class="mp-title">{{ item.name || '素材预览' }}</span>
        <button
          class="mp-close"
          type="button"
          title="关闭预览（Esc）"
          aria-label="关闭预览"
          @click.stop="closePreview"
        >
          <span aria-hidden="true" v-html="ICON_CLOSE" />
        </button>
      </header>

      <div class="mp-stage" @click.self="closePreview">
        <img v-if="item.kind === 'image' && item.url" class="mp-img" :src="item.url" :alt="item.name" draggable="false" />
        <video v-else-if="item.kind === 'video' && item.url" class="mp-video" :src="item.url" controls autoplay />
        <audio v-else-if="item.kind === 'audio' && item.url" class="mp-audio" :src="item.url" controls />
        <pre v-else class="mp-text">{{ item.text || '（空）' }}</pre>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 舞台色与前景色都走 token：--ui-scrim 是画布遮罩色（已含"压暗画布"的语义），
   --ui-tip-ink 是深色胶囊上的白字（正是「深底白字」这里要的）。 */
.mp-root {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  flex-direction: column;
  background: var(--ui-scrim, rgb(15 23 42 / 0.35));
}
/* 全屏看图的底板：比遮罩再实一点，避免底下的画布内容透上来干扰看图 */
.mp-root::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(--ui-overlay-solid, #fff);
  opacity: 0.92;
}
.mp-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: none;
  height: 48px;
  padding: 0 12px 0 20px;
  color: var(--ui-tip-ink);
}
.mp-title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: color-mix(in srgb, var(--ui-tip-ink) 10%, transparent);
  color: var(--ui-tip-ink);
  cursor: pointer;
  transition: background-color 0.15s ease-out;
}
.mp-close:hover {
  background: color-mix(in srgb, var(--ui-tip-ink) 20%, transparent);
}
.mp-close:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-tip-ink) 80%, transparent);
  outline-offset: 1px;
}
.mp-close :deep(svg) {
  width: 16px;
  height: 16px;
}
/* 舞台：图片按比例完整放下（contain），不裁切 */
.mp-stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 32px 32px;
}
.mp-img,
.mp-video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
}
.mp-audio {
  width: min(560px, 100%);
}
.mp-text {
  max-width: min(880px, 100%);
  max-height: 100%;
  margin: 0;
  padding: 20px 24px;
  overflow: auto;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-tip-ink) 8%, transparent);
  color: var(--ui-tip-ink);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
