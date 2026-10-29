<script setup lang="ts">
/**
 * DemoTopPanel —— 功能模式下的**顶栏替换面板**。
 *
 * 视觉语义：顶部状态栏独属于当前功能（alpha / beta），显示当前功能名与退出按钮。
 * 演示插件不做任何业务，只展示「顶栏被功能接管」的形态。
 *
 * 手势类名 nodrag / nopan 是画布约定：面板上按下不应拖动节点/画布。
 */
import { computed } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { closeDemoMode, demoMode } from './demoMode'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()
const ThemedButton = useUiComponent('button')

const LABEL = { alpha: '演示功能 A', beta: '演示功能 B' } as const

const kind = computed(() => {
  const m = demoMode.value
  return m && m.nodeId === props.id ? m.kind : null
})

function exit(): void {
  closeDemoMode()
  void ctx
}
</script>

<template>
  <div v-if="kind" class="dtp-root ntp-root nodrag nopan" data-testid="demo-top-panel">
    <span class="dtp-name">{{ LABEL[kind] }} · 顶栏</span>
    <component
      :is="ThemedButton || 'button'"
      type="button"
      title="退出功能模式"
      aria-label="退出功能模式"
      @click="exit"
    >退出</component>
  </div>
</template>

<style scoped>
/* 容器由全局 .ntp-root 提供；这里只排内容 */
.dtp-root { gap: 8px; }
.dtp-name { font-size: var(--text-base, 13px); font-weight: 600; color: var(--ui-ink, #18202b); }
</style>
