<script setup lang="ts">
/**
 * ImagePaintPanel —— 图片节点绘制模式的顶部状态栏（nodeToolbar 功能模式的 topBar）。
 *
 * 进入绘制模式后，顶栏整条换成：退出 / 笔刷形状 / 画擦切换 / 笔刷大小 / 撤销 / 清空 / 保存。
 * 组件按名取主题按钮（toolbarButton）与滑块（slider），不自绘。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { paintState, endPaint } from './paintSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
const NodeToolbarButton = useUiComponent('toolbarButton')
const Slider = useUiComponent('slider')

/** 会话（响应式；浮层读同一份） */
const session = paintState(props.id)

/** 有没有笔迹：决定保存按钮是否可用 */
const hasStrokes = computed(() => session.strokes.length > 0)

const ICON_EXIT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
const ICON_ROUND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>'
const ICON_SQUARE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>'
const ICON_BRUSH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>'
const ICON_ERASER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L13.2 3a2 2 0 0 1 2.8 0l5 5c.8.8.8 2 0 2.8L13 19"/><path d="M6 11l7 7"/></svg>'
const ICON_UNDO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>'
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
const ICON_SAVE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>'

function exit(): void {
  endPaint(props.id)
}

function setShape(shape: "round" | "square"): void {
  session.brushShape = shape
}

function setMode(mode: "paint" | "erase"): void {
  session.brushMode = mode
}

function setBrushSize(v: number): void {
  session.brushSize = Math.round(v)
}

/** 撤销/清空：浮层挂在自己的 over:inset 段，顶栏摸不到它的 ref —— 走命令让浮层自己处理 */
function undoStroke(): void {
  ctx.get<{ execute(id: string, payload?: unknown): unknown }>('command').execute('image:paint-undo', { nodeId: props.id })
}

function clearStrokes(): void {
  ctx.get<{ execute(id: string, payload?: unknown): unknown }>('command').execute('image:paint-clear', { nodeId: props.id })
}

const busy = ref(false)

/** 保存：走命令（image:paint-confirm），命令读会话草稿并生成两张图。
 * execute 同步返回 run 的 Promise（kernel command.ts），await 它保证 busy 覆盖整个保存过程。 */
async function save(): Promise<void> {
  if (busy.value || !hasStrokes.value) return
  busy.value = true
  try {
    await ctx.get<{ execute(id: string, payload?: unknown): unknown }>('command').execute('image:paint-confirm', { nodeId: props.id })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ipp-root nodrag nopan">
    <NodeToolbarButton title="退出绘制" variant="danger" :icon="ICON_EXIT" @click="exit" />
    <NodeToolbarButton title="圆形笔刷" :icon="ICON_ROUND" :active="session.brushShape === 'round'" @click="setShape('round')" />
    <NodeToolbarButton title="方形笔刷" :icon="ICON_SQUARE" :active="session.brushShape === 'square'" @click="setShape('square')" />
    <NodeToolbarButton title="涂（标记要重绘的区域）" :icon="ICON_BRUSH" :active="session.brushMode === 'paint'" @click="setMode('paint')" />
    <NodeToolbarButton title="擦（把涂过的区域擦回来）" :icon="ICON_ERASER" :active="session.brushMode === 'erase'" @click="setMode('erase')" />
    <Slider
      v-if="Slider"
      class="ipp-slider"
      :model-value="session.brushSize"
      :min="4"
      :max="100"
      :step="1"
      aria-label="笔刷大小"
      @update:model-value="setBrushSize"
    />
    <NodeToolbarButton title="撤销上一笔" :icon="ICON_UNDO" @click="undoStroke" />
    <NodeToolbarButton title="清空全部笔迹" :icon="ICON_TRASH" @click="clearStrokes" />
    <NodeToolbarButton title="保存（生成蒙版和结果两个图片节点）" variant="primary" :icon="ICON_SAVE" :disabled="!hasStrokes" @click="save">保存</NodeToolbarButton>
  </div>
</template>

<style scoped>
/* 布局对齐裁剪/扩展：容器（排一行）由全局 .ntp-root 提供，这里只补滑块与按钮的间距 */
.ipp-slider {
  width: 120px;
  margin: 0 4px;
}
</style>
