<script setup lang="ts">
/**
 * ToolOptionGrid —— 「一个参数区块 = 一行小标题 + 一块选项按钮网格」的通用展示件。
 *
 * 版式照参考站 https://www.liblib.tv/canvas 的参数面板实测：
 *   区块标题：20px 高、弱化色（--ui-ink-mute）、12px/600；
 *   网格：gap 8；列数由 columns 给（画质/清晰度/背景/数量 = 3 列）；
 *   按钮：高 32、圆角 8、1px 发丝边、透明底；选中 = --ui-hover-strong 底。
 *
 * 为什么单独成件：比例网格（每格画按真实宽高比的小矩形）与它共用同一套
 * 区块标题 / 网格间距 / 选中态，差异只在每格里面画什么。把容器抽出来，
 * 比例网格只覆写格内容，避免两份数值各写一遍后漂移。
 *
 * 主题无关：只认内核 ToolParamDef 类型 + 本包自家 token。
 */
import { computed } from 'vue'
import type { ToolParamDef } from '@mini-canvas/kernel'

const props = withDefaults(
  defineProps<{
    param: ToolParamDef
    modelValue?: string | number | boolean
    disabled?: boolean
    /** 每行几格（默认 3，与参考站的画质/清晰度/背景/数量一致） */
    columns?: number
    /** 不显示区块标题（参数标签已在别处出现时用） */
    hideTitle?: boolean
  }>(),
  { modelValue: '', disabled: false, columns: 3, hideTitle: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number | boolean]
}>()

const options = computed(() => props.param.options ?? [])
const gridStyle = computed(() => ({ gridTemplateColumns: 'repeat(' + props.columns + ', 1fr)' }))

function isActive(value: string | number): boolean {
  return String(props.modelValue) === String(value)
}

function pick(value: string | number): void {
  if (props.disabled) return
  emit('update:modelValue', value)
}
</script>

<template>
  <section class="tog-block" :data-param-key="param.key">
    <h4 v-if="!hideTitle" class="tog-title">{{ param.label || param.key }}</h4>
    <div class="tog-grid" :style="gridStyle">
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        class="tog-cell"
        :class="{ 'is-active': isActive(opt.value) }"
        :disabled="disabled"
        :aria-pressed="isActive(opt.value)"
        :title="opt.label"
        @click.stop="pick(opt.value)"
      >
        <span class="tog-label">{{ opt.label }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
/* 区块：标题 + 网格，区块内 gap 8（照参考站实测） */
.tog-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tog-title {
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
/* 网格：默认 3 列（按钮 100×32 的形态由 1fr + 高 32 表现；面板宽 342 时每格约 100） */
.tog-grid {
  display: grid;
  gap: 8px;
}
.tog-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink, #18202b);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease-out, border-color 0.15s ease-out, color 0.15s ease-out;
}
.tog-cell:hover:not(:disabled) {
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
}
/* 选中态：**灰阶**（用户口径 2026-10-12「这里其实不需要使用主题颜色……就和你的右键菜单一样」）。
   同比例网格的写法：深色描边 + 浅灰底 + 粗体。深色走 --ui-ink —— 亮色主题下近黑、
   暗色主题下近白，一档变量吃两套主题。 */
.tog-cell.is-active {
  border-color: var(--ui-ink, #18202b);
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink, #18202b);
  font-weight: 600;
}
.tog-cell:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tog-cell:focus-visible {
  /* 焦点环也走灰阶（与右键菜单同口径：整块面板不用主题色） */
  outline: 2px solid color-mix(in srgb, var(--ui-ink, #18202b) 55%, transparent);
  outline-offset: 1px;
}
/* 超长文案省略（模型名可能很长） */
.tog-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .tog-cell {
    transition: none !important;
  }
}
</style>
