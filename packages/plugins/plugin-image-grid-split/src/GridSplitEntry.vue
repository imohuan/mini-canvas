<script setup lang="ts">
/**
 * GridSplitEntry —— 图片顶栏按钮组里的一条（方式 A：image.topToolbar 插槽）。
 *
 * 按钮必须按名取主题件（toolbarButton / toolbarDropdown），不自绘 ——
 * 否则同一排出现两种圆角/高度。显隐自己判：有图才出现，编辑态由壳切换。
 */
import { computed } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { beginSplit, isSplitting } from './splitSession'
import { validRowsCols } from './gridSplit'

interface ToolbarMenuNode {
  key: string
  label: string
  children?: ToolbarMenuNode[]
}

const props = defineProps<{
  nodeId?: string
  data?: Record<string, unknown>
}>()

const { ctx } = useCanvasRender()
const DropdownButton = useUiComponent('toolbarDropdown')

const ICON_GRID =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'

/** 有图才有切分入口（与裁剪同一口径：没图的按钮点了没意义，直接不渲染） */
const hasImage = computed(() => {
  const d = props.data ?? {}
  const rid = typeof d.resourceId === 'string' ? d.resourceId : ''
  const legacy = typeof d.imageUrl === 'string' ? d.imageUrl : ''
  return rid !== '' || legacy !== ''
})

/** 已经在切分中：按钮让位（功能模式的顶栏会整排替换，这里只兜一层防双开） */
const splitting = computed(() => Boolean(props.nodeId && isSplitting(props.nodeId)))

/** 预设（2/3/4/5 等分）+ 自定义行列的二级菜单 */
const items: ToolbarMenuNode[] = [
  { key: 'grid:2:2', label: '4 宫格（2×2）' },
  { key: 'grid:3:3', label: '9 宫格（3×3）' },
  { key: 'grid:4:4', label: '16 宫格（4×4）' },
  { key: 'grid:5:5', label: '25 宫格（5×5）' },
]

function notify(text: string): void {
  ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.(text)
}

function enter(rows: number, cols: number): void {
  const nodeId = props.nodeId
  if (!nodeId) return
  if (!validRowsCols(rows, cols)) return
  beginSplit(nodeId, rows, cols)
  // 底栏同步换成切分面板（nodeToolbar 会话：主题件，顶栏与底栏共用同一份）
  ctx.tryGet<{ enter?(nodeId: string, modeId: string): void } | undefined>('nodeToolbar')
    ?.enter?.(nodeId, 'image-grid-split/workbench')
  notify('宫格切分：' + rows + ' 行 × ' + cols + ' 列，勾选后点底部按钮')
}

function onPick(key: string): void {
  const m = /^grid:(\d+):(\d+)$/.exec(key)
  if (!m) return
  enter(Number(m[1]), Number(m[2]))
}
</script>

<template>
  <component
    v-if="hasImage && !splitting && DropdownButton"
    :is="DropdownButton"
    title="宫格切分"
    :icon="ICON_GRID"
    :items="items"
    @pick="onPick"
  />
</template>
