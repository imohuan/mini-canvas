<script setup lang="ts">
/**
 * ToolParamSlider —— 数值类参数的预设控件：滑块 + 当前值 + 单位。
 *
 * 用在 kind:'duration'（连续时长）这类"取值多、要拖"的参数上；
 * dola 视频那种只有 5 / 10 两档的时长**不用**它（走 ToolOptionGrid 按钮网格更好点）。
 * 这条分档由 paramKind.ts 的 resolvePresetKind 纯函数决定，可单测。
 *
 * 视觉沿用本包设置界面的滑块（PrecisionSlider），只是把 label/值/单位排成一行。
 */
import { computed } from 'vue'
import type { ToolParamDef } from '@mini-canvas/kernel'
import PrecisionSlider from './PrecisionSlider.vue'

const props = withDefaults(
  defineProps<{
    param: ToolParamDef
    modelValue?: string | number | boolean
    disabled?: boolean
    hideTitle?: boolean
  }>(),
  { modelValue: '', disabled: false, hideTitle: false },
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
</script>

<template>
  <section class="tps-block" :data-param-key="param.key">
    <div class="tps-head">
      <h4 v-if="!hideTitle" class="tps-title">{{ param.label || param.key }}</h4>
      <span class="tps-value">{{ numberValue }}<span v-if="param.unit" class="tps-unit">{{ param.unit }}</span></span>
    </div>
    <PrecisionSlider
      :model-value="numberValue"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      @update:model-value="(v: number) => emit('update:modelValue', v)"
    />
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
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 20px;
}
.tps-title {
  margin: 0;
  height: 20px;
  display: flex;
  align-items: center;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
}
.tps-value {
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.tps-unit {
  margin-left: 2px;
  color: var(--ui-ink-mute, #8c95a3);
  font-weight: 500;
}
</style>
