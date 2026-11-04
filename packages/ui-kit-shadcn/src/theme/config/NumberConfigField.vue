<script setup lang="ts">
/** NumberConfigField —— 数字配置项（间距 / 偏移）。 */
import {
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@/previewKit'
import ConfigField from './ConfigField.vue'

defineProps<{
  label: string
  modelValue: number
  min?: number
  max?: number
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
</script>

<template>
  <ConfigField :label="label">
    <NumberField
      :model-value="modelValue"
      :min="min ?? 0"
      :max="max ?? 40"
      :step="1"
      @update:model-value="emit('update:modelValue', $event ?? 0)"
    >
      <NumberFieldContent>
        <NumberFieldDecrement />
        <NumberFieldInput />
        <NumberFieldIncrement />
      </NumberFieldContent>
    </NumberField>
  </ConfigField>
</template>
