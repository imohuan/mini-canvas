<script setup lang="ts">
/**
 * ThemePreviewCut —— 切割插件在主题工作台里的预览层。
 *
 * 刀光在真实画布上是「按住 Alt 从空白划到连线」的一段轨迹 + 末端的短尾迹。
 * 这里用本插件真实的轨迹/尾迹几何函数（toSmoothPathData）与同名 CSS 变量，
 * 把轨迹落在两个默认节点之间、刀锋收在连线上；不碰顶部工具条，也不会真的删线。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useThemePreviewPluginColor, useThemePreviewScene } from '@mini-canvas/canvas-render'
import { toSmoothPathData, type ScreenPoint } from './edgeCuttingCore'

const LAYER_ID = 'edge-cutting/preview'
const scene = useThemePreviewScene()

// 兜底色用主题 token（不是写死色值）：插件没登记色板时也跟随当前主题。
const pathColor = useThemePreviewPluginColor('pathColor', 'var(--ui-accent-hover)')
const bladeColor = useThemePreviewPluginColor('bladeColor', 'var(--ui-accent)')

const a = scene.nodes[0]
const b = scene.nodes[1]

/** 切割轨迹：从两张卡之间的空白处斜划下来，末端刀锋正好压过连线 */
/** 切割轨迹：从两张卡之间的上沿空白开始，往右下划；末端的刀锋正好压在连线上。 */
const cutPoints: ScreenPoint[] = [
  { x: 300, y: 76 },
  { x: 318, y: 114 },
  { x: 336, y: 152 },
  { x: 352, y: 186 },
  { x: 366, y: 216 },
]

const cutPath = toSmoothPathData(cutPoints)
const bladePoints = cutPoints.slice(-4)
const bladePath = toSmoothPathData(bladePoints)
const tip = bladePoints[bladePoints.length - 1]

const sparkPoints = bladePoints.slice(-2).map((p) => ({ x: p.x, y: p.y }))

/** 刀光整段在画布内的外接矩形（含轨迹粗细与标签） */
const CUT_BOUNDS = {
  x: Math.min(...cutPoints.map((p) => p.x)) - 24,
  y: Math.min(...cutPoints.map((p) => p.y)) - 26,
  w: Math.max(...cutPoints.map((p) => p.x)) - Math.min(...cutPoints.map((p) => p.x)) + 110,
  h: Math.max(...cutPoints.map((p) => p.y)) - Math.min(...cutPoints.map((p) => p.y)) + 48,
}

onMounted(() =>
  scene.registerBounds(LAYER_ID, CUT_BOUNDS),
)
onBeforeUnmount(() => scene.unregisterBounds(LAYER_ID))
</script>

<template>
  <div class="theme-preview-cut" aria-hidden="true">
    <svg class="tpc-canvas" viewBox="0 0 720 400" preserveAspectRatio="none">
      <path class="tpc-path" :d="cutPath" :style="{ stroke: pathColor }" />
      <path class="tpc-trail tpc-trail--wide" :d="bladePath" :style="{ stroke: bladeColor }" />
      <path class="tpc-trail tpc-trail--mid" :d="bladePath" :style="{ stroke: bladeColor }" />
      <path class="tpc-edge" :d="bladePath" />
      <circle class="tpc-tip" :cx="tip.x" :cy="tip.y" r="3.2" :style="{ stroke: bladeColor }" />
      <g class="tpc-sparks" :style="{ stroke: bladeColor }">
        <line v-for="(p, i) in sparkPoints" :key="i" :x1="p.x" :y1="p.y" :x2="p.x + 7 - i * 3" :y2="p.y - 6 + i * 2" />
      </g>
    </svg>
    <span
      class="tpc-label"
      :style="{ left: cutPoints[cutPoints.length - 1].x - 74 + 'px', top: cutPoints[cutPoints.length - 1].y + 18 + 'px' }"
    >Alt 划过</span>
  </div>
</template>

<style scoped>
.theme-preview-cut {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.tpc-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.tpc-path,
.tpc-trail,
.tpc-edge {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tpc-path {
  stroke-width: 1.5;
  stroke-opacity: 0.5;
  filter: drop-shadow(0 0 2px var(--edge-cutting-path-color));
}

.tpc-trail--wide {
  stroke-width: 5;
  stroke-opacity: 0.24;
  filter: drop-shadow(0 0 3px var(--edge-cutting-blade-color));
}

.tpc-trail--mid {
  stroke-width: 2.4;
  stroke-opacity: 0.62;
}

.tpc-edge {
  stroke: var(--ui-on-accent);
  stroke-width: 1.1;
  filter: drop-shadow(0 0 2px var(--ui-on-accent)) drop-shadow(0 0 4px var(--edge-cutting-blade-color));
}

.tpc-tip {
  fill: var(--ui-on-accent);
  fill-opacity: 0.88;
  stroke-width: 0.9;
  stroke-opacity: 0.55;
}

.tpc-sparks line {
  stroke-width: 0.8;
  stroke-linecap: round;
  opacity: 0.55;
}

.tpc-label {
  position: absolute;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--ui-panel);
  color: var(--ui-ink-dim);
  font-size: 9px;
  font-weight: 650;
  white-space: nowrap;
  box-shadow: 0 1px 3px var(--canvas-node-shadow-soft);
}
</style>
