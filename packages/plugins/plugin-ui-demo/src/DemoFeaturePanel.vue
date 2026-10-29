<script setup lang="ts">
/**
 * DemoFeaturePanel —— 功能模式下的底栏内容（渲染在**同一根默认底栏内部**）。
 *
 * 外观完全沿用默认底栏：容器/圆角/阴影是 NodeBottomBar 的 .nb-root，本组件只排内容；
 * 按钮一律按名取主题 button，与其它默认件同款。不做业务，只演示形态。
 *
 * 关闭：nodeBar.exitMode（顶栏的「退出」也调同一句，两边永远同步）。
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

function notify(text: string): void {
  ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.(text)
}

function exit(): void {
  closeDemoMode()
  ctx.tryGet<{ exitMode?(nodeId: string): void } | undefined>('nodeBar')?.exitMode?.(props.id)
}
</script>

<template>
  <div v-if="kind" class="dfp-root nodrag nopan" data-testid="demo-feature-panel">
    <div class="dfp-head">
      <span class="dfp-name">{{ LABEL[kind] }}</span>
      <span class="dfp-hint">该功能的专属底栏内容（替换默认生成 UI）</span>
    </div>
    <div class="dfp-actions">
      <component :is="ThemedButton || 'button'" type="button" @click="notify('演示：操作一')">操作一</component>
      <component :is="ThemedButton || 'button'" type="button" @click="notify('演示：操作二')">操作二</component>
      <component :is="ThemedButton || 'button'" type="button" variant="primary" @click="notify('演示：确认')">确认</component>
      <span class="dfp-grow" aria-hidden="true" />
      <component :is="ThemedButton || 'button'" type="button" variant="danger" @click="exit">退出功能</component>
    </div>
  </div>
</template>

<style scoped>
/* 只排内容：外框（.nb-root 的圆角/阴影/宽度）由默认底栏提供，这里不另画面板。 */
.dfp-root { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.dfp-head { display: flex; align-items: baseline; gap: 8px; }
.dfp-name { font-size: var(--text-base, 13px); font-weight: 600; color: var(--ui-ink, #18202b); }
.dfp-hint { font-size: var(--text-sm, 11px); color: var(--ui-ink-mute, #8c95a3); }
.dfp-actions { display: flex; align-items: center; gap: 6px; }
.dfp-grow { flex: 1 1 auto; }
</style>
