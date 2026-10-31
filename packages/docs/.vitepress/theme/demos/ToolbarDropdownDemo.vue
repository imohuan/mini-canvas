<script setup lang="ts">
/**
 * ToolbarDropdownDemo —— 「工具栏下拉按钮 + 自定义面板」的活演示。
 *
 * 为什么直接 import 主题包的具名导出：文档站不在画布渲染子树里，
 * useUiComponent 取不到 provide（与 ThemeKitDemo 同一理由）。
 * 演示里的小宫格只负责选行列，不碰画布业务。
 */
import { ref } from 'vue'
import { ToolbarDropdownButton } from '@mini-canvas/plugin-theme-default'
import GridPicker from './ToolbarDropdownGridPicker.vue'

const picked = ref('还没选')

const ICON_GRID =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'

function pickPreset(key: string, _path: string[], close: () => void): void {
  picked.value = key
  close()
}

/** 面板里的「确定」：记下选择（关闭由面板组件自己调 panel.close） */
function confirm(rows: number, cols: number): void {
  picked.value = `自定义 ${rows} 行 × ${cols} 列`
}

/** 面板内容用 component + props（render 写法见文档里的代码块） */
const items = [
  { key: 'grid:2:2', label: '4 宫格（2×2）' },
  { key: 'grid:3:3', label: '9 宫格（3×3）' },
  { key: 'grid:4:4', label: '16 宫格（4×4）' },
  { key: 'grid:5:5', label: '25 宫格（5×5）' },
  {
    key: 'grid:custom',
    label: '自定义',
    panel: {
      width: '200px',
      component: GridPicker,
      // onConfirm 拿到的就是「收整张卡」的能力（事件写成 onXxx）
      props: {
        initialRows: 3,
        initialCols: 3,
        onConfirm: (rows: number, cols: number) => confirm(rows, cols),
      },
    },
  },
]
</script>

<template>
  <div class="tdd-demo">
    <ToolbarDropdownButton
      title="宫格切分"
      :icon="ICON_GRID"
      :items="items"
      @pick="pickPreset"
    />

    <span v-if="picked !== '还没选'" class="tdd-val">当前：{{ picked }}</span>

    <p class="tdd-hint">
      「自定义」不在主面板里堆格子，而是在右侧单独展开一块面板。
      鼠标滑到几乘几，点一下格子就确认（没有确定按钮）。
    </p>
  </div>
</template>

<style scoped>
.tdd-demo { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.tdd-val { font-size: var(--text-label, 12px); color: var(--text-muted, #6b7280); }
.tdd-hint { flex-basis: 100%; margin: 0; font-size: var(--text-sm, 11px); color: var(--text-faint, #9ca3af); }

/* 面板内容：与主题 UI 规范同档（12 间距、10 圆角、青色选中） */
.tdd-picker { display: flex; flex-direction: column; gap: 8px; }
.tdd-head { font-size: var(--text-label, 12px); font-weight: 700; color: var(--text-strong, #111827); }
.tdd-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  aspect-ratio: 1;
  cursor: pointer;
}
.tdd-cell {
  border: 1px solid var(--line-hair, rgba(0, 0, 0, 0.08));
  border-radius: 3px;
  background: var(--fill-quiet, rgba(0, 0, 0, 0.03));
}
.tdd-cell.is-on {
  background: rgba(8, 145, 178, 0.2);
  border-color: #0891b2;
}
.tdd-confirm {
  padding: 6px 0;
  border: 0;
  border-radius: var(--radius-control, 8px);
  background: #0891b2;
  color: #fff;
  font-size: var(--text-base, 13px);
  font-weight: 600;
  cursor: pointer;
}
.tdd-confirm:hover { background: #0e7490; }
</style>
