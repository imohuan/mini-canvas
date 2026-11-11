<script setup lang="ts">
/**
 * GridSplitEntry —— 图片顶栏按钮组里的一条（方式 A：image.topToolbar 插槽）。
 *
 * 下拉、二级菜单和自定义宫格面板都用 shadcn DropdownMenu 分离件；
 * 按钮本体直接用 shadcn Button —— 同一排只有一套圆角/高度。
 * 显隐自己判：有图才出现，编辑态由壳切换。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useUiComponent, ToolbarIcon } from '@plume-canvas/canvas-render'
import { beginSplit, isSplitting } from './splitSession'
import { validRowsCols } from './gridSplit'
import GridSizePicker from './GridSizePicker.vue'

interface ToolbarMenuNode {
  key: string
  label: string
  children?: ToolbarMenuNode[]
  custom?: boolean
}

const props = defineProps<{
  nodeId?: string
  data?: Record<string, unknown>
}>()

const { ctx } = useCanvasRender()
const Button = useUiComponent('Button')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuSub = useUiComponent('DropdownMenuSub')
const DropdownMenuSubContent = useUiComponent('DropdownMenuSubContent')
const DropdownMenuSubTrigger = useUiComponent('DropdownMenuSubTrigger')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
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

/** 自定义行列面板的行列（默认 3×3；确认后保留回显） */
const customRows = ref(3)
const customCols = ref(3)
const menuOpen = ref(false)
const customOpen = ref(false)

function enter(rows: number, cols: number): void {
  const nodeId = props.nodeId
  if (!nodeId) return
  if (!validRowsCols(rows, cols)) return
  beginSplit(nodeId, rows, cols)
  // 底栏同步换成切分面板（nodeToolbar 会话：主题件，顶栏与底栏共用同一份）
  ctx.tryGet<{ enter?(nodeId: string, modeId: string): void } | undefined>('nodeToolbar')
    ?.enter?.(nodeId, 'image-grid-split/workbench')
}

function onPick(key: string): void {
  const m = /^grid:(\d+):(\d+)$/.exec(key)
  if (!m) return
  enter(Number(m[1]), Number(m[2]))
}

/** 面板里点格子就算确认（选择器自己收起下拉），这里只处理切分 */
function onCustomConfirm(rows: number, cols: number): void {
  customRows.value = rows
  customCols.value = cols
  enter(rows, cols)
}

/** 预设（2/3/4/5 等分）+ 自定义宫格面板：同一个下拉，自定义在右侧展开 */
const items = computed<ToolbarMenuNode[]>(() => [
  { key: 'grid:2:2', label: '4 宫格（2×2）' },
  { key: 'grid:3:3', label: '9 宫格（3×3）' },
  { key: 'grid:4:4', label: '16 宫格（4×4）' },
  { key: 'grid:5:5', label: '25 宫格（5×5）' },
  {
    key: 'grid:custom',
    label: '自定义',
    custom: true,
  },
])

function pickItem(key: string): void {
  if (key === 'grid:custom') return
  onPick(key)
  menuOpen.value = false
}
</script>

<template>
  <DropdownMenu v-if="hasImage && !splitting" v-model:open="menuOpen">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" type="button" title="宫格切分" aria-label="宫格切分" aria-haspopup="menu">
        <ToolbarIcon :icon="ICON_GRID" />
        <span>宫格切分</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" :side-offset="6" class="gse-menu" data-testid="grid-split-entry-menu">
      <DropdownMenuItem v-for="item in items.filter((i) => !i.custom)" :key="item.key" class="gse-row"
        @select="pickItem(item.key)">
        {{ item.label }}
      </DropdownMenuItem>
      <DropdownMenuSub v-model:open="customOpen">
        <DropdownMenuSubTrigger class="gse-row">自定义</DropdownMenuSubTrigger>
        <DropdownMenuSubContent class="gse-custom-panel" :style="{ minWidth: '200px' }">
          <GridSizePicker
            :initial-rows="customRows"
            :initial-cols="customCols"
            @confirm="(rows: number, cols: number) => (onCustomConfirm(rows, cols), (menuOpen = false), (customOpen = false))"
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<style scoped>
/* 菜单与右侧自定义面板的排版（外框/定位由 shadcn 提供） */
.gse-menu { display: flex; flex-direction: column; gap: 2px; width: 200px; padding: 4px; }
.gse-custom-panel { padding: 10px; }
.gse-row {
  padding: 0 10px;
  min-height: 32px;
  border: 0;
  border-radius: var(--radius-badge, 6px);
  background: transparent;
  color: var(--ui-ink, #18202b);
  font-size: var(--ui-text-base, 13px);
  text-align: left;
  cursor: pointer;
}
.gse-row:hover { background: var(--ui-hover, rgb(0 0 0 / 0.06)); }
</style>
