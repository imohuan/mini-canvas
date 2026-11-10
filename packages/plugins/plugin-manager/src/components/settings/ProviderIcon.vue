<script setup lang="ts">
/**
 * ProviderIcon —— 平台图标的统一渲染件。
 *
 * 支持三种写法（用户口径 2026-11-10）：
 *   1. SVG 字符串（`<svg …>`）
 *   2. Base64 / data URL（`data:image/...;base64,...`）
 *   3. 都没有 → 默认图标：平台名首字母 + 中性底色
 *
 * 为什么单独一个组件：管理列表、模型表格、以后的底栏兜底图标都要用同一套规则，
 * 写三份必然长歪（尺寸、圆角、兜底字母各写一套）。
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{ icon?: string; title?: string; size?: number }>(), {
  size: 32,
})

const src = computed(() => {
  const v = (props.icon ?? '').trim()
  if (!v) return ''
  return /^(data:|https?:|\/)/i.test(v) ? v : ''
})

const svg = computed(() => {
  const v = (props.icon ?? '').trim()
  return v.startsWith('<svg') ? v : ''
})

const letter = computed(() => {
  const t = (props.title ?? '').trim()
  return t ? t.charAt(0).toUpperCase() : '?'
})

const px = computed(() => props.size + 'px')
</script>

<template>
  <img v-if="src" :src="src" :alt="title" class="pi-img" :style="{ width: px, height: px }" />
  <span v-else-if="svg" class="pi-svg" :style="{ width: px, height: px }" aria-hidden="true" v-html="svg" />
  <span v-else class="pi-fallback" :style="{ width: px, height: px }" aria-hidden="true">{{ letter }}</span>
</template>

<style scoped>
.pi-img { flex-shrink: 0; border-radius: 9px; object-fit: cover; }
.pi-svg { flex-shrink: 0; display: block; overflow: hidden; border-radius: 9px; }
.pi-svg :deep(svg) { width: 100%; height: 100%; display: block; }
.pi-fallback {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--ui-fill-subtle, color-mix(in srgb, currentColor 6%, transparent));
  font-size: 13px;
  font-weight: 700;
  color: var(--ui-ink-dim, #6b7280);
}
</style>
