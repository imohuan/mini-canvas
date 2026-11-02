<script setup lang="ts">
/**
 * ThemePreviewGuide —— 对齐插件在主题工作台里的预览层。
 *
 * 参考线本来就是「拖动节点时出现的一条线」；这里用真实的参考线样式（同一套 --ui-guide），
 * 画在预览场景两个默认节点的对齐位置上。插件没装 → 没有这一层。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useThemePreviewScene } from '@mini-canvas/canvas-render'

const LAYER_ID = 'align-guide/preview'
const scene = useThemePreviewScene()

const a = scene.nodes[0]
const b = scene.nodes[1]

/** 真实对齐：两张卡的顶边对齐，插件只画这一条横线。 */
const horizontalY = computed(() => b.y)

onMounted(() =>
  scene.registerBounds(LAYER_ID, {
    x: a.x - 16,
    y: horizontalY.value - 12,
    w: b.x + b.w - a.x + 32,
    h: 24,
  }),
)
onBeforeUnmount(() => scene.unregisterBounds(LAYER_ID))
</script>

<template>
  <div class="theme-preview-guide" aria-hidden="true">
    <span
      class="tpg-line is-horizontal"
      :style="{ left: a.x - 12 + 'px', top: horizontalY + 'px', width: b.x + b.w - a.x + 24 + 'px' }"
    ></span>
    <span class="tpg-tag" :style="{ left: a.x + a.w + 8 + 'px', top: horizontalY - 18 + 'px' }">顶边对齐</span>
  </div>
</template>

<style scoped>
.theme-preview-guide {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.tpg-line {
  position: absolute;
  background: var(--ui-guide, color-mix(in srgb, var(--ui-accent) 60%, transparent));
}

.tpg-line.is-horizontal {
  height: 1px;
}

.tpg-tag {
  position: absolute;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--ui-guide-veil, color-mix(in srgb, var(--ui-accent) 12%, transparent));
  color: var(--ui-guide, var(--ui-accent));
  font-size: 9px;
  font-weight: 700;
  white-space: nowrap;
}

</style>
