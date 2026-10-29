<script setup lang="ts">
/**
 * RotatePanel —— 「旋转与镜像」功能模式的顶栏内容（整格替换图片默认顶栏）。
 *
 * 按钮从左到右：退出 / 右转 90° / 水平翻转 / 垂直翻转（用户要求的顺序）。
 * 外观完全沿用图片默认顶栏：容器（.ntp-root 的圆角/边框/阴影）由全局类提供，
 * 按钮一律按名取主题 toolbarButton，不自绘。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { closeRotateMode, isRotateModeActive } from './rotateSession'
import { flipImageNode } from './flipImage'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
const Button = useUiComponent('toolbarButton')

const busy = ref(false)

/** 面板只在本节点处于旋转模式时渲染（退出后旧 UI 立刻消失） */
const active = computed(() => isRotateModeActive(props.id))

function exit(): void {
  closeRotateMode()
  ctx.tryGet<{ exit?(nodeId: string): void }>('nodeToolbar')?.exit?.(props.id)
}

/** 右转 90°：与图片顶栏内置「旋转」走同一条命令（同一实现，不各写一遍） */
function rotate90(): void {
  ctx.get<{ execute(id: string, payload?: unknown): unknown }>('command')
    .execute('image:rotate', { nodeId: props.id })
}

async function flip(axis: 'horizontal' | 'vertical'): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await flipImageNode(ctx, props.id, axis)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="active" class="ntp-root nr-root nodrag nopan">
    <Button title="退出旋转与镜像" variant="danger" :icon="ICON_EXIT" @click="exit" />
    <span class="nr-title">旋转与镜像</span>
    <span class="nr-sep" aria-hidden="true" />
    <Button title="向右旋转 90 度" :icon="ICON_ROTATE" :disabled="busy" @click="rotate90" />
    <Button title="水平翻转" :icon="ICON_FLIP_H" :disabled="busy" @click="flip('horizontal')" />
    <Button title="垂直翻转" :icon="ICON_FLIP_V" :disabled="busy" @click="flip('vertical')" />
  </div>
</template>

<script lang="ts">
/** 图标内联 SVG（与图片顶栏同款写法：常量放第二段 script 里，模板引用更清爽） */
const ICON_EXIT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
const ICON_ROTATE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>'
const ICON_FLIP_H =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M8 7 4 12l4 5"/><path d="m16 7 4 5-4 5"/></svg>'
const ICON_FLIP_V =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><path d="M7 8 12 4l5 4"/><path d="m7 16 5 4 5-4"/></svg>'
</script>

<style scoped>
/* 标题与分隔线：对齐图片编辑态「取消 | 比例 | 确认」的排法（同一根栏里加名称段） */
.nr-title {
  padding: 0 4px;
  font-size: var(--text-base, 13px);
  font-weight: 600;
  color: var(--ui-ink, #18202b);
  white-space: nowrap;
}
.nr-sep {
  width: 1px;
  height: 16px;
  margin: 0 2px;
  background: var(--ui-line, #e2e5ea);
}
</style>
