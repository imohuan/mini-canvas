<script setup lang="ts">
defineProps<{
  labelBelow: boolean
  captionLeftPx: number
  lengthLabel: string
}>()
</script>

<template>
  <!-- 时长文字的下方常驻位（用户口径 2026-10-31）：选区窄到装不下时显示在这里。
       不套 Tooltip 组件、不靠 hover —— 一直看得见，横向锚点跟着选区中心走。
       始终占一行（v-show 而非 v-if）：拖到能被装下/装不下的临界点时，下面的配置区不会跳。 -->
  <div class="vclip-caption" role="status" aria-live="off">
    <span v-show="labelBelow" class="vclip-caption-text" :style="{ left: captionLeftPx + 'px' }">{{ lengthLabel }}</span>
  </div>
</template>

<style scoped>
/**
 * 时长文字的「下方常驻位」（用户口径 2026-10-31）。
 *
 * 选区窄到装不下时（labelBelow），pill 不再挤在选区里被省略，而是挂到胶片条下沿：
 * 常驻可见、不靠 hover、不套 Tooltip 组件。挂在 .vclip-film 里是为了让 left% 直接以
 * 胶片宽度为基准，位置正好对齐选区中心。
 */
.vclip-caption {
  /* 常驻一行（不浮层）：一直占位，拖拽时不会因为显隐把下面的配置区顶来顶去 */
  position: relative;
  width: 100%;
  height: 20px;
  margin-top: -4px;
  z-index: 11;
  pointer-events: none;
}
.vclip-caption-text {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--vclip-ink-strong);
  background: var(--vclip-length-bg);
  box-shadow: 0 4px 14px var(--vclip-divider);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
