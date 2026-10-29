<script setup lang="ts">
/**
 * DemoBottomPanel —— 功能模式下的**底栏替换面板**。
 *
 * 挂在 image 的 out:bottom 区域（BaseNode 下插槽）：功能激活时渲染这里，
 * 演示「底栏被功能接管」的形态。不做业务，退出按钮回默认底栏。
 *
 * 注意：image 的 out:bottom 现在没有默认段（底栏是画布级浮层），所以这里不会与
 * NodeBottomBar 重叠 —— 下插槽贴在卡片正下方，浮层底栏由 bottom-bar 自己管理。
 * 演示里二选一展示即可：激活功能时这个面板可见，就是「独属于功能的底栏」。
 */
import { computed } from 'vue'
import { useCanvasRender, useSoleNodeSelected, useUiComponent } from '@mini-canvas/canvas-render'
import { closeDemoMode, demoMode } from './demoMode'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()
const ThemedButton = useUiComponent('button')
const selected = useSoleNodeSelected(props.id)

const LABEL = { alpha: '演示功能 A', beta: '演示功能 B' } as const

const kind = computed(() => {
  const m = demoMode.value
  return m && m.nodeId === props.id ? m.kind : null
})

function exit(): void {
  closeDemoMode()
  void ctx
}

void selected
</script>

<template>
  <div v-if="kind" class="dbp-root ntp-root nodrag nopan" data-testid="demo-bottom-panel">
    <span class="dbp-name">{{ LABEL[kind] }} · 底栏</span>
    <span class="dbp-hint">（独属于这个功能的底部状态栏）</span>
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
.dbp-root { gap: 6px; }
.dbp-name { font-size: var(--text-base, 13px); font-weight: 600; color: var(--ui-ink, #18202b); }
.dbp-hint { font-size: var(--text-sm, 11px); color: var(--ui-ink-mute, #8c95a3); }
</style>
