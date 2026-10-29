<script setup lang="ts">
/**
 * GridSplitPanel —— 切分模式的底栏内容（方式 C：nodeToolbar 模式的 bottomBar）。
 *
 * 外观完全沿用默认底栏：容器是 NodeBottomBar 的 .nb-root，本组件只排内容；
 * 按钮一律按名取主题 button，与其它默认件同款。
 * 高清放大暂不做（置灰 + 提示），退出 / 勾选 / 发布 / 分镜组都经这里的按钮触发。
 */
import { computed } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { endSplit, splitState } from './splitSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()
const Button = useUiComponent('toolbarButton')

const state = computed(() => splitState(props.id))
const total = computed(() => (state.value ? state.value.rows * state.value.cols : 0))
const selectedCount = computed(() => state.value?.selected.size ?? 0)

function notify(text: string): void {
  ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.(text)
}

function exit(): void {
  endSplit(props.id)
  ctx.tryGet<{ exit?(nodeId: string): void } | undefined>('nodeToolbar')?.exit?.(props.id)
}

function publish(kind: 'canvas' | 'storyboard'): void {
  if (!state.value) return
  notify(kind === 'canvas'
    ? '发布到画布：开发中（本条只演示接线）'
    : '创建分镜组：开发中（本条只演示接线）')
}
</script>

<template>
  <div v-if="state" class="gsp-root nodrag nopan" data-testid="grid-split-panel">
    <div class="gsp-head">
      <span class="gsp-name">宫格切分</span>
      <span class="gsp-hint">{{ state.rows }} 行 × {{ state.cols }} 列 · 已选 {{ selectedCount }}/{{ total }}</span>
    </div>
    <div class="gsp-actions">
      <component :is="Button || 'button'" type="button" variant="danger" title="退出宫格切分" aria-label="退出宫格切分" @click="exit">退出</component>
      <component :is="Button || 'button'" type="button" title="高清放大（暂未实现）" aria-label="高清放大" disabled>高清放大</component>
      <component :is="Button || 'button'" type="button" variant="primary" title="把选中格子发布到画布" aria-label="发布到画布" @click="publish('canvas')">发布到画布</component>
      <component :is="Button || 'button'" type="button" title="用选中格子创建分镜组" aria-label="创建分镜组" @click="publish('storyboard')">创建分镜组</component>
    </div>
  </div>
</template>

<style scoped>
/* 只排内容：外框（.nb-root 的圆角/阴影/宽度）由默认底栏提供，这里不另画面板。 */
.gsp-root { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.gsp-head { display: flex; align-items: baseline; gap: 8px; }
.gsp-name { font-size: var(--text-base, 13px); font-weight: 600; color: var(--ui-ink, #18202b); }
.gsp-hint { font-size: var(--text-sm, 11px); color: var(--ui-ink-mute, #8c95a3); }
.gsp-actions { display: flex; align-items: center; gap: 6px; }
</style>
