<script setup lang="ts">
/**
 * ThemePreviewSelection —— 多选插件在主题工作台里的预览层。
 *
 * 主题页不知道「多选框」长什么样，也不该知道；这里用本插件自己的配置读取与几何函数，
 * 把两边框画在公共预览场景的两个默认节点上。插件没装 → 这一层不存在。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useThemePreviewScene } from '@mini-canvas/canvas-render'
import { computeSelectionFrameGeometry, type MultiSelectRect } from './multiSelectEngine'
import {
  framePaddingsOf,
  frameStrokeCss,
  resolveMultiSelectFrameConfig,
} from './multiSelectConfig'

const LAYER_ID = 'multi-select/frame'
const scene = useThemePreviewScene()

const cfg = computed(() => resolveMultiSelectFrameConfig((key) => scene.settings?.get(key), scene.mode.value))

const rects = computed<MultiSelectRect[]>(() =>
  scene.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y, w: node.w, h: node.h })),
)

const frame = computed(() => {
  void scene.revision.value
  const pads = framePaddingsOf(cfg.value)
  return computeSelectionFrameGeometry(rects.value, pads.gap, pads.inner)
})

const outerStyle = computed(() => frameStrokeCss(cfg.value.outer, 1, 'var(--ui-select-outer, var(--ui-accent))'))
const innerStyle = computed(() => frameStrokeCss(cfg.value.inner, 1, 'var(--ui-select-inner, var(--ui-accent))'))

function boxStyle(rect: MultiSelectRect): Record<string, string> {
  return {
    left: rect.x + 'px',
    top: rect.y + 'px',
    width: rect.w + 'px',
    height: rect.h + 'px',
  }
}

const outerBox = computed(() => (frame.value ? boxStyle(frame.value.outer) : undefined))
const innerBox = computed(() => (frame.value ? boxStyle(frame.value.inner) : undefined))

onMounted(() => {
  if (frame.value) scene.registerBounds(LAYER_ID, frame.value.outer)
})
onBeforeUnmount(() => scene.unregisterBounds(LAYER_ID))
</script>

<template>
  <div v-if="cfg.enabled && frame" class="theme-preview-selection" aria-hidden="true">
    <span class="tps-outer" :style="{ ...outerBox, ...outerStyle }"></span>
    <span class="tps-inner" :style="{ ...innerBox, ...innerStyle }"></span>
    <span
      class="tps-count"
      :style="{ left: frame.outer.x + frame.outer.w - 52 + 'px', top: frame.outer.y + frame.outer.h + 6 + 'px' }"
    >2 个节点</span>
  </div>
</template>

<style scoped>
.theme-preview-selection {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.tps-outer,
.tps-inner {
  position: absolute;
  box-sizing: border-box;
}

.tps-count {
  position: absolute;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
  color: var(--ui-accent, #0891b2);
  font-size: 9px;
  font-weight: 700;
  white-space: nowrap;
}
</style>
