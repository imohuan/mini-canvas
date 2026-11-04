<script setup lang="ts">
/**
 * ToolRatioGrid —— 比例参数专用网格（5 列）。
 *
 * 版式照参考站实测：每格是「17×17 图标位 + 12px 文案」，
 * 图标位里画一个 12×12 以内、**按真实宽高比缩放**的描边矩形（1.5px 边、圆角 2）。
 * 一眼能看出 16:9 与 9:16 的区别，比只写文字快得多。
 *
 * 为什么按 kind 自动选它：这是用户要求的"识别到固定类型参数就用预设组件"的第一号例子。
 * 工具作者只要声明 kind:'ratio'，不必自己画这套图标。
 *
 * 配色**不用主题色**（用户口径 2026-10-12「这里其实不需要使用主题颜色……就和你的右键菜单一样」）：
   底色只用灰阶 —— 未选透明底 + 发丝边，选中 = 浅灰底 + 粗体 + 无边框。
   宽高比是几何（按真实比例画的描边小矩形），不是配色。
 */
import { computed } from 'vue'
import type { ToolParamDef } from '@mini-canvas/kernel'

const props = withDefaults(
  defineProps<{
    param: ToolParamDef
    modelValue?: string | number | boolean
    disabled?: boolean
    /** 每行几格（参考站是 5） */
    columns?: number
  }>(),
  { modelValue: '', disabled: false, columns: 5 },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number | boolean]
}>()

const options = computed(() => props.param.options ?? [])
const gridStyle = computed(() => ({ gridTemplateColumns: 'repeat(' + props.columns + ', 1fr)' }))

/** 图标盒边长（参考站 17×17 的图标位） */
const BOX = 20
/** 描边矩形最长边（参考站 12×12 左右） */
const MAX = 18

interface Shape {
  w: number
  h: number
  /** 比例无法解析（如 auto）时画虚线方框，与"真比例"区分开 */
  dashed: boolean
}

/** 把 '16:9' / '1.5' 这类值解析成图标几何；解析不出（auto / 空）→ 虚线方块 */
function shapeOf(value: string | number): Shape {
  const raw = String(value ?? '').trim()
  const m = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(raw)
  if (!m) return { w: MAX, h: MAX, dashed: true }
  const a = Number(m[1])
  const b = Number(m[2])
  if (!(a > 0) || !(b > 0)) return { w: MAX, h: MAX, dashed: true }
  const scale = MAX / Math.max(a, b)
  // 短边至少 4px：极端比例（21:9）也要看得见，不塌成一条线
  return { w: Math.max(4, Math.round(a * scale)), h: Math.max(4, Math.round(b * scale)), dashed: false }
}

function isActive(value: string | number): boolean {
  return String(props.modelValue) === String(value)
}

function pick(value: string | number): void {
  if (props.disabled) return
  emit('update:modelValue', value)
}
</script>

<template>
  <section class="trg-block" :data-param-key="param.key">
    <h4 v-if="param.label" class="trg-title">{{ param.label }}</h4>
    <div class="trg-grid" :style="gridStyle">
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        class="trg-cell"
        :class="{ 'is-active': isActive(opt.value) }"
        :disabled="disabled"
        :aria-pressed="isActive(opt.value)"
        :title="opt.label"
        @click.stop="pick(opt.value)"
      >
        <span class="trg-icon" :style="{ width: BOX + 'px', height: BOX + 'px' }" aria-hidden="true">
          <span
            class="trg-shape"
            :class="{ 'is-dashed': shapeOf(opt.value).dashed }"
            :style="{ width: shapeOf(opt.value).w + 'px', height: shapeOf(opt.value).h + 'px' }"
          />
        </span>
        <span class="trg-text">{{ opt.label }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.trg-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.trg-title {
  margin: 0;
  height: 20px;
  display: flex;
  align-items: center;
  /* 标题按参考稿（text-xs font-bold text-gray-800）：比正文重、比正文深 */
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  font-weight: 700;
  line-height: 20px;
}
.trg-grid {
  display: grid;
  gap: 8px;
}
/* 比例格：比普通格高（有图标 + 文字两行）。数值照参数面板参考稿 h-14（56 高）、
   rounded-xl（12 圆角，在 16 圆角的面板里正是嵌套阶梯的下一级）、p-2（8 内边距）。 */
.trg-cell {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-sizing: border-box;
  min-width: 50px;
  min-height: 56px;
  padding: 8px 10px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 12px;
  background: transparent;
  color: var(--ui-ink, #18202b);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease-out, border-color 0.15s ease-out;
}
.trg-cell:hover:not(:disabled) {
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
}
.trg-cell.is-active {
  /* 选中 = 深色描边 + 浅灰底 + 粗体（参考稿的"选中格"结构，只是不用主题色）。
     深色走 --ui-ink：亮色主题下是近黑、暗色主题下是近白 —— 一档变量吃两套主题。 */
  border-color: var(--ui-ink, #18202b);
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink, #18202b);
  font-weight: 600;
}
.trg-cell:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.trg-cell:focus-visible {
  /* 焦点环也走灰阶（与右键菜单同口径：整块面板不用主题色） */
  outline: 2px solid color-mix(in srgb, var(--ui-ink, #18202b) 55%, transparent);
  outline-offset: 1px;
}
/* 图标位：固定 17×17，内部矩形居中 */
.trg-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
/* 描边矩形：1.5px 边 + 圆角 2，尺寸由"按真实宽高比缩放"算出 */
.trg-shape {
  box-sizing: border-box;
  border: 1.5px solid var(--ui-ink-dim, #6b7280);
  border-radius: 2px;
}
.trg-cell.is-active .trg-shape {
  border-color: var(--ui-ink, #18202b);
}
/* auto（比例解析不出）：虚线方框，与真比例区分 */
.trg-shape.is-dashed {
  border-style: dashed;
}
.trg-text {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .trg-cell {
    transition: none !important;
  }
}
</style>
