<script setup lang="ts">
/**
 * GridSplitEntry —— 图片顶栏按钮组里的一条（方式 A：image.topToolbar 插槽）。
 *
 * 按钮必须按名取主题件（toolbarButton / toolbarDropdown），不自绘 ——
 * 否则同一排出现两种圆角/高度。显隐自己判：有图才出现，编辑态由壳切换。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { beginSplit, isSplitting } from './splitSession'
import { validRowsCols } from './gridSplit'
import GridSizePicker from './GridSizePicker.vue'

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
const Dropdown = useUiComponent('dropdown')
const Button = useUiComponent('toolbarButton')

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
/** 自定义行列面板的行列（默认 3×3；确认后保留回显） */
const customRows = ref(3)
const customCols = ref(3)

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

function onCustomConfirm(rows: number, cols: number): void {
  customRows.value = rows
  customCols.value = cols
  enter(rows, cols)
}

/** 确定后收起自定义面板（下拉/兜底浮层都传 close 进来） */
function confirmCustom(rows: number, cols: number, close: () => void): void {
  onCustomConfirm(rows, cols)
  close()
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
  <!-- 自定义行列：独立入口（toolbarDropdown 的 children 只收字符串 label，
       悬停式网格选择器需要自己的浮层 —— 与预设下拉并排，互不干扰） -->
  <component
    v-if="hasImage && !splitting && DropdownButton && Dropdown"
    :is="Dropdown"
    placement="bottom-start"
    :offset="6"
  >
    <template #trigger>
      <span class="gse-custom-trigger">
        <component :is="Button || 'button'" type="button" :title="'自定义行列'" aria-label="自定义行列">自定义</component>
      </span>
    </template>
    <template #default="{ close }">
      <GridSizePicker
        :initial-rows="customRows"
        :initial-cols="customCols"
        @confirm="(rows: number, cols: number) => confirmCustom(rows, cols, close)"
      />
    </template>
  </component>
  <component
    v-if="hasImage && !splitting && !DropdownButton && Dropdown"
    :is="Dropdown"
    placement="bottom-start"
    :offset="6"
    menu-width="200px"
  >
    <template #trigger>
      <span class="gse-trigger">
        <span class="gse-icon" v-html="ICON_GRID" />
        <span>宫格切分</span>
      </span>
    </template>
    <template #default="{ close }">
      <div class="gse-menu" data-testid="grid-split-entry-menu">
        <button v-for="item in items" :key="item.key" type="button" class="gse-row" @click.stop="onPick(item.key), close()">
          {{ item.label }}
        </button>
        <div class="gse-sep" />
        <GridSizePicker
          :initial-rows="customRows"
          :initial-cols="customCols"
          @confirm="(rows: number, cols: number) => confirmCustom(rows, cols, close)"
        />
      </div>
    </template>
  </component>
</template>

<style scoped>
/* 主题 dropdown 缺席时的兜底触发器（正常走 toolbarDropdown 时这段不渲染） */
.gse-trigger { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.gse-custom-trigger { display: inline-flex; }
.gse-icon { display: inline-flex; width: 16px; height: 16px; }
.gse-icon :deep(svg) { width: 100%; height: 100%; }
.gse-menu { display: flex; flex-direction: column; gap: 2px; }
.gse-row {
  padding: 0 10px;
  min-height: 32px;
  border: 0;
  border-radius: var(--radius-badge, 6px);
  background: transparent;
  color: var(--ui-ink, #18202b);
  font-size: var(--text-base, 13px);
  text-align: left;
  cursor: pointer;
}
.gse-row:hover { background: var(--ui-hover, rgb(0 0 0 / 0.06)); }
.gse-sep { height: 1px; background: var(--ui-line, #e2e5ea); margin: 2px 0; }
</style>
