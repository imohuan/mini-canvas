<script setup lang="ts">
/**
 * ToolParamSlider —— 数值类参数的预设控件：滑块 + 当前值 + 单位。
 *
 * 用在 kind:'duration'（连续时长）这类"取值多、要拖"的参数上；
 * dola 视频那种只有 5 / 10 两档的时长**不用**它（走 ToolOptionGrid 按钮网格更好点）。
 * 这条分档由 paramKind.ts 的 resolvePresetKind 纯函数决定，可单测。
 *
 * 视觉**直接沿用设置界面的那一套**（用户 2026-11-08）：
 * shadcn Slider（深色已填充轨道 + 白色圆角滑块）+ NumberField（− 数值 +），
 * 与 SettingsSchemaField 的数字字段完全相同 —— 同一个组件、同一份样式，不再自绘。
 *
 * 配色**不用主题色**（用户口径 2026-10-12「这里其实不需要使用主题颜色，直接使用默认的黑白
 * 两个主题就行，就和你的右键菜单一样」）：轨道灰、填充与圆球走主按钮那档深墨
 * （黑白两套主题各有一格），与右键菜单「只用灰阶 + 黑/白」同一口径。
 */
import { computed } from 'vue'
import type { ToolParamDef } from '@mini-canvas/kernel'
import { Minus, Plus } from 'lucide-vue-next'
import ToolParamHint from './ToolParamHint.vue'
import {
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  Slider,
} from '@mini-canvas/ui-kit-shadcn'

const props = withDefaults(
  defineProps<{
    param: ToolParamDef
    modelValue?: string | number | boolean
    disabled?: boolean
    hideTitle?: boolean
    /** 说明文字（自己画标题时跟在标题下面；空串不渲染） */
    hint?: string
  }>(),
  { modelValue: '', disabled: false, hideTitle: false, hint: '' },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number | boolean]
}>()

const min = computed(() => props.param.min ?? 0)
const max = computed(() => props.param.max ?? 100)
const step = computed(() => props.param.step ?? 1)
const numberValue = computed(() => {
  const n = Number(props.modelValue)
  return Number.isFinite(n) ? n : min.value
})

/** 把任意输入收敛成合法数值并上报（数字输入框用） */
function emitChange(raw: number): void {
  const v = Number.isFinite(raw) ? Math.min(max.value, Math.max(min.value, raw)) : min.value
  emit('update:modelValue', v)
}

/** Slider 给出的是数组（多滑块预留），这里只有一个值 */
function onSlider(value: number | number[] | undefined): void {
  const v = Array.isArray(value) ? value[0] : value
  if (typeof v === 'number' && Number.isFinite(v)) emitChange(v)
}
</script>

<template>
  <section class="tps-block" :data-param-key="param.key">
    <div v-if="!hideTitle" class="tps-head">
      <h4 class="tps-title">
        {{ param.label || param.key }}
        <span v-if="param.unit" class="tps-unit">{{ param.unit }}</span>
      </h4>
      <!--
        参数说明（用户 2026-11-09：参数要有介绍，前端渲染出来）。
        只在**自己画标题**时画它；hideTitle 表示标题归调用方，说明也归调用方，
        否则同一句说明会出现两遍。
      -->
      <ToolParamHint :text="hint || param.description" />
    </div>
    <!--
      与「设置 → 外观」里的数字字段**同一个组件、同一份布局**（用户 2026-11-08）：
      左边滑块、右边「− 数值 +」。
    -->
    <div class="tps-row">
      <Slider
        class="tps-slider"
        :model-value="[numberValue]"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        :aria-label="param.label || param.key"
        @update:model-value="onSlider"
      />
      <NumberField
        class="tps-number-field"
        :model-value="numberValue"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        :format-options="{ useGrouping: false }"
        @update:model-value="(v: number | undefined) => emitChange(Number(v ?? min))"
      >
        <NumberFieldContent>
          <NumberFieldDecrement class="tps-number-btn">
            <Minus :size="12" />
          </NumberFieldDecrement>
          <NumberFieldInput
            class="tps-number-input"
            :aria-label="(param.label || param.key) + '数值'"
          />
          <NumberFieldIncrement class="tps-number-btn">
            <Plus :size="12" />
          </NumberFieldIncrement>
        </NumberFieldContent>
      </NumberField>
      <!--
        隐藏标题时（外层已画过标签），单位仍然要出现 —— 否则「4~15」没有量纲，
        用户不知道是秒还是帧。放在数字框右侧，与标题行的排版一致。
      -->
      <span v-if="hideTitle && param.unit" class="tps-unit tps-unit--inline">{{ param.unit }}</span>
    </div>
  </section>
</template>

<style scoped>
.tps-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tps-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tps-title {
  margin: 0;
  height: 20px;
  display: flex;
  align-items: center;
  gap: 2px;
  /* 标题按参考稿（font-bold text-gray-700）：比正文重、比正文深 */
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  font-weight: 700;
  line-height: 20px;
}
.tps-unit {
  color: var(--ui-ink-mute, #8c95a3);
  font-weight: 500;
}
/* 隐藏标题时的内联单位：跟在数字框右边，不占一行 */
.tps-unit--inline {
  flex: none;
  font-size: 12px;
  white-space: nowrap;
}
/*
 * 版式照抄设置界面（SettingsSchemaField 的 .sf-number / .sf-slider / .sf-number-field）：
 * 左滑块自适应、右数字框固定 104px，中间 12px —— 用户 2026-11-08 指定的效果。
 */
.tps-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.tps-slider {
  flex: 1;
  min-width: 120px;
}
.tps-number-field {
  flex: 0 0 auto;
  width: 104px;
}
.tps-number-input {
  padding: 0 18px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.tps-number-btn {
  padding: 0 4px;
  color: var(--ui-ink-dim, #6b7280);
}
</style>
