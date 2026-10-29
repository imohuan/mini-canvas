<script setup lang="ts">
/**
 * ImagePaintPanel —— 图片节点绘制模式的顶部状态栏（nodeToolbar 功能模式的 topBar）。
 *
 * 布局参考图（用户口径 2026-10-30），与默认顶栏同一个胶囊壳（ImageToolbarShell）：
 *   × 退出 | 画笔 / 矩形填充 / 橡皮擦（三个工具互斥）| 颜色 | 笔刷大小（带图标）| 撤销 / 重做 | 保存
 *
 * 三条用户明确指出的错误，已按此修正：
 *   1. 圆形/方形不是「模式」，它们是笔刷形状 —— 已删除；现在是画笔 / 矩形填充 / 橡皮擦三个工具。
 *   2. 历史记录不能只有一个按钮 —— 撤销 + 重做成对。
 *   3. 粗细滑块前要有图标。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { paintState, endPaint, isPainting, undoStroke, redoStroke, clearStrokes } from './paintSession'
import ImageToolbarShell from './ImageToolbarShell.vue'
import PaintColorPicker from './PaintColorPicker.vue'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
const NodeToolbarButton = useUiComponent('toolbarButton')
const Slider = useUiComponent('slider')

/** 会话（响应式；浮层读同一份） */
const session = paintState(props.id)

const painting = computed(() => isPainting(props.id))
const hasStrokes = computed(() => painting.value && session.strokes.length > 0)
const canUndo = computed(() => painting.value && session.strokes.length > 0)
const canRedo = computed(() => painting.value && session.redo.length > 0)

const ICON_EXIT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
/** 画笔（自由绘制） */
const ICON_BRUSH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>'
/** 矩形填充（画一个实心矩形） */
const ICON_RECT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="1.5" fill="currentColor" fill-opacity="0.28"/></svg>'
/** 橡皮擦 */
const ICON_ERASER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L13.2 3a2 2 0 0 1 2.8 0l5 5c.8.8.8 2 0 2.8L13 19"/><path d="M6 11l7 7"/></svg>'
const ICON_UNDO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>'
const ICON_REDO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>'
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
const ICON_SAVE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>'
/** 粗细滑块前面的图标（用户要求：滑块前也要有图标） */
const ICON_BRUSH_SIZE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/></svg>'

function exit(): void {
  endPaint(props.id)
}

function setTool(tool: "brush" | "rect" | "erase"): void {
  session.tool = tool
}

function setBrushSize(v: number): void {
  session.brushSize = Math.round(v)
}

function setColor(v: string): void {
  session.color = v
}

function onUndo(): void {
  undoStroke(props.id)
}

function onRedo(): void {
  redoStroke(props.id)
}

function onClear(): void {
  clearStrokes(props.id)
}

const busy = ref(false)

/** 保存：走命令（image:paint-confirm）；await 保证 busy 覆盖整个保存过程 */
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
  <ImageToolbarShell slot-name="image.paintToolbar" :node-id="props.id" :data="props.data">
    <!-- 1) 退出（最左） -->
    <NodeToolbarButton title="退出绘制" variant="danger" :icon="ICON_EXIT" @click="exit" />

    <!-- 2) 三种工具（互斥，用户口径：画笔 / 矩形填充 / 橡皮擦） -->
    <NodeToolbarButton title="画笔" :icon="ICON_BRUSH" :active="session.tool === 'brush'" @click="setTool('brush')" />
    <NodeToolbarButton title="矩形填充" :icon="ICON_RECT" :active="session.tool === 'rect'" @click="setTool('rect')" />
    <NodeToolbarButton title="橡皮擦" :icon="ICON_ERASER" :active="session.tool === 'erase'" @click="setTool('erase')" />

    <!-- 3) 标记颜色（预置色 + 主题注册的取色器） -->
    <PaintColorPicker :model-value="session.color" @update:model-value="setColor" />

    <!-- 4) 粗细：图标 + 滑块 -->
    <span class="ipp-size-icon" :title="'笔刷粗细 ' + session.brushSize" aria-hidden="true" v-html="ICON_BRUSH_SIZE" />
    <Slider
      v-if="Slider"
      class="ipp-slider"
      :model-value="session.brushSize"
      :min="4"
      :max="100"
      :step="1"
      aria-label="笔刷粗细"
      @update:model-value="setBrushSize"
    />

    <!-- 5) 历史：撤销 + 重做（不是只有一个按钮） -->
    <NodeToolbarButton title="撤销" :icon="ICON_UNDO" :disabled="!canUndo" @click="onUndo" />
    <NodeToolbarButton title="重做" :icon="ICON_REDO" :disabled="!canRedo" @click="onRedo" />
    <NodeToolbarButton title="清空全部笔迹" :icon="ICON_TRASH" :disabled="!hasStrokes" @click="onClear" />

    <!-- 6) 保存 -->
    <NodeToolbarButton title="保存（生成蒙版和结果两个图片节点）" variant="primary" :icon="ICON_SAVE" :disabled="!hasStrokes" @click="save">保存</NodeToolbarButton>
  </ImageToolbarShell>
</template>

<style scoped>
/* 滑块：固定宽度，与按钮同行 */
.ipp-slider {
  width: 96px;
  flex: 0 0 auto;
}

/* 粗细图标：与工具栏按钮图标同尺寸、同色系 */
.ipp-size-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--ui-ink-dim, #6b7280);
  flex: 0 0 auto;
}
.ipp-size-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
