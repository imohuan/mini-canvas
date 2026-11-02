<script setup lang="ts">
/**
 * ThemePreviewBase —— 默认主题在「主题工作台」里自己的预览层。
 *
 * 这里画的是主题插件**自己拥有的东西**：两个节点壳、一条连线、工具条和状态色。
 * 主题页不需要知道这些内容；它只负责把颜色注册进 settings、给一块画板。
 *
 * 为什么不直接挂 BaseNode / CustomEdge：那两个组件要吃 VueFlow 的节点与连线上下文，
 * 工作台里没有第二套真实图。这里复用它们的**同一套 token、几何函数与真实小组件**
 * （NodeEmptyState / Button / buildEdgePath），保证颜色含义一致，又不伪造 VueFlow 状态。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { Hand, Plus } from 'lucide-vue-next'
import { NodeEmptyState } from '../ui'
import { Button } from '@mini-canvas/ui-kit-shadcn'
import {
  useThemePreviewColor,
  useThemePreviewScene,
  type ThemePreviewRect,
} from '@mini-canvas/canvas-render'
import { buildEdgePath, Position } from '../edge/edgeGeometry'

const LAYER_ID = 'theme-default/base'
const scene = useThemePreviewScene()

// 兜底色取主题 token：插件没登记色板时也跟随当前主题，而不是写死一套颜色。
const accent = useThemePreviewColor('accentColor', 'var(--ui-accent)')
const rail = useThemePreviewColor('edgeRailColor', 'var(--ui-ink)')
const flow = useThemePreviewColor('edgeFlowColor', accent.value)

const a = scene.nodes[0]
const b = scene.nodes[1]
const aMid = computed(() => ({ x: a.x + a.w, y: a.y + a.h / 2 }))
const bMid = computed(() => ({ x: b.x, y: b.y + b.h / 2 }))
const edgePath = computed(() =>
  buildEdgePath(
    aMid.value.x, aMid.value.y,
    bMid.value.x, bMid.value.y,
    Position.Right, Position.Left,
    'bezier',
    // 曲率收小：两张卡左右并排时，默认 80 会拐出一个大 S 弯
    { minCurvature: 40 },
  ),
)
const arrowPath = computed(() => {
  const x = bMid.value.x
  const y = bMid.value.y
  return `M ${x - 1} ${y} L ${x - 10} ${y - 4.4} L ${x - 10} ${y + 4.4} Z`
})

/** 基础层可见内容的并集（工作台再按所有图层的并集自动取景） */
const CONTENT_BOUNDS: ThemePreviewRect = { x: 24, y: 40, w: 672, h: 330 }

onMounted(() => scene.registerBounds(LAYER_ID, CONTENT_BOUNDS))
onBeforeUnmount(() => scene.unregisterBounds(LAYER_ID))
</script>

<template>
  <div class="theme-preview-base" aria-hidden="true">
    <div class="tpb-toolbar">
      <Button class="mck-toolbar-btn is-icon-only is-active" variant="ghost" size="sm" type="button" title="移动"><Hand /></Button>
      <span class="tpb-divider"></span>
      <Button class="mck-toolbar-btn is-icon-only" variant="ghost" size="sm" type="button" title="新建"><Plus /></Button>
    </div>

    <svg class="tpb-wires" viewBox="0 0 720 400">
      <path class="tpb-wire-glow" :d="edgePath" :stroke="flow" />
      <path class="tpb-wire-rail" :d="edgePath" :stroke="rail" />
      <path class="tpb-wire-flow" :d="edgePath" :stroke="flow" />
      <path class="tpb-arrow" :d="arrowPath" :fill="rail" />
    </svg>

    <div class="tpb-node" :style="{ left: a.x + 'px', top: a.y + 'px', width: a.w + 'px', height: a.h + 'px' }">
      <div class="tpb-node-title"><i></i><span>灵感速记</span><em>文本</em></div>
      <div class="tpb-node-body">
        <p>把碎片想法收进来，<br />再用连线整理。</p>
        <Button class="mck-toolbar-btn mck-toolbar-btn--primary tpb-cta" variant="default" size="sm" type="button">生成</Button>
      </div>
      <span class="tpb-port is-left"></span>
      <span class="tpb-port is-right"></span>
    </div>

    <div class="tpb-node tpb-node-image" :style="{ left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' }">
      <div class="tpb-node-title"><span>海边房间</span><em>图片</em></div>
      <div class="tpb-image">
        <span class="tpb-image-art"></span>
        <span class="tpb-image-caption">拖入图片开始</span>
      </div>
      <span class="tpb-port is-left"></span>
      <span class="tpb-port is-right"></span>
    </div>

    <div class="tpb-states">
      <div class="tpb-state"><NodeEmptyState layout="row" size="sm" tone="warning" text="待确认" description="检查后继续" /></div>
      <div class="tpb-state"><NodeEmptyState layout="row" size="sm" tone="danger" text="素材失效" description="请重新上传" /></div>
    </div>
  </div>
</template>

<style scoped>
.theme-preview-base {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.tpb-toolbar {
  position: absolute;
  top: 20px;
  left: 28px;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 2px;
  border: 1px solid var(--ui-line);
  border-radius: 9px;
  background: var(--ui-panel);
  box-shadow: var(--ui-shadow-sm);
}

.tpb-divider {
  width: 1px;
  height: 15px;
  margin: 0 2px;
  background: var(--ui-line);
}

.tpb-wires {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  /* 用同一套画板坐标，不拉伸：连线端点才会和节点端口严格对齐 */
}

.tpb-wire-rail,
.tpb-wire-flow,
.tpb-wire-glow {
  fill: none;
  stroke-linecap: round;
}

.tpb-wire-glow {
  stroke-width: 6;
  opacity: 0.12;
  filter: blur(2px);
}

.tpb-wire-rail {
  stroke-width: 1.8;
  opacity: 0.85;
}

.tpb-wire-flow {
  stroke-width: 2.4;
  stroke-dasharray: 3 11;
  animation: tpb-flow 2.6s linear infinite;
  filter: drop-shadow(0 0 3px var(--ui-edge-flow));
}

@keyframes tpb-flow {
  to { stroke-dashoffset: -28; }
}

.tpb-node {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid var(--canvas-node-border);
  border-radius: 8px;
  background: var(--canvas-node-surface);
  box-shadow: 0 2px 10px var(--canvas-node-shadow-soft);
}

.tpb-node-title {
  position: absolute;
  bottom: calc(100% + 7px);
  left: -1px;
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: calc(100% + 2px);
  color: var(--canvas-node-text-strong);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}

.tpb-node-title i {
  width: 5px;
  height: 5px;
  border-radius: 99px;
  background: var(--ui-accent);
}

.tpb-node-title em {
  margin-left: auto;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--ui-accent-soft);
  color: var(--ui-accent);
  font-size: 8px;
  font-style: normal;
  font-weight: 700;
}

.tpb-node-body {
  display: flex;
  height: 100%;
  flex-direction: column;
  justify-content: space-between;
  padding: 12px 15px;
}

.tpb-node-body p {
  margin: 0;
  color: var(--canvas-node-text-body);
  font-size: 12px;
  line-height: 1.6;
}

.tpb-cta {
  align-self: flex-start;
  height: 26px;
  min-width: 0;
  padding: 0 11px;
  font-size: 11px;
}

.tpb-image {
  position: absolute;
  inset: 7px;
  overflow: hidden;
  border-radius: 5px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--ui-accent) 88%, transparent), color-mix(in srgb, var(--ui-edge-flow) 58%, var(--canvas-node-panel-surface)));
}

.tpb-image-art {
  position: absolute;
  top: -25%;
  left: -12%;
  width: 72%;
  height: 120%;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 40%, color-mix(in srgb, var(--ui-on-accent) 70%, transparent), transparent 64%);
  opacity: 0.55;
}

.tpb-image-caption {
  position: absolute;
  bottom: 9px;
  left: 10px;
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--ui-scrim-soft);
  color: var(--ui-on-accent);
  font-size: 10px;
  font-weight: 650;
  backdrop-filter: blur(4px);
}

.tpb-port {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  border: 2px solid var(--ui-accent);
  border-radius: 99px;
  background: var(--canvas-node-surface);
  transform: translateY(-50%);
}

.tpb-port.is-left { left: -4px; }
.tpb-port.is-right { right: -4px; }

.tpb-states {
  position: absolute;
  top: 318px;
  left: 120px;
  display: flex;
  gap: 8px;
}

.tpb-state {
  position: relative;
  width: 190px;
  height: 40px;
  overflow: hidden;
  border: 1px solid var(--ui-line);
  border-radius: 7px;
  background: var(--ui-panel);
  box-shadow: var(--ui-shadow-sm);
}

.tpb-state :deep(.nes-root) {
  gap: 6px;
  padding: 4px 9px;
}

.tpb-state :deep(.nes-icon) {
  width: 18px;
  height: 18px;
}

.tpb-state :deep(.nes-text) {
  font-size: 10px;
  font-weight: 650;
}

.tpb-state :deep(.nes-description) {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .tpb-wire-flow { animation: none; }
}
</style>
