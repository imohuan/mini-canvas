<script setup lang="ts">
import { computed } from "vue"
import { AxInput, AxSwitch, AxSelect, AxSlider } from "../Ui"
import type { SelectOption } from "../Ui/types"
import type { PanelSettingDefinition } from '../../registry/types'

const props = defineProps<{
  setting: PanelSettingDefinition
  modelValue: unknown
}>()

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
}>()

// DynamicSettingField 负责把 v-model 桥接到具体的 Ax 组件
// setting.type 在运行时保证组件与值类型一一对应，ComputedRef<any> 消除编译期类型不匹配
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const value = computed<any>({
  get: () => props.modelValue,
  set: (v) => {
    // AxInput 始终 emit string；number 字段需转换回 number
    if (props.setting.type === 'number') {
      emit("update:modelValue", Number(v))
    } else {
      emit("update:modelValue", v)
    }
  },
})

const selectOptions = computed<SelectOption[]>(() => {
  if (props.setting.type !== 'select' || !props.setting.options) return []
  return props.setting.options.map(opt => ({
    value: opt.value,
    label: opt.title,
  }))
})
</script>

<template>
  <div class="ax-setting-field">
    <div class="ax-field-label-row" v-if="setting.type !== 'boolean'">
      <label class="ax-field-title">{{ setting.title }}</label>
      <span v-if="setting.description" class="ax-field-desc">{{ setting.description }}</span>
    </div>

    <!-- text -->
    <AxInput v-if="setting.type === 'text'" v-model="value" size="lg" type="text" :placeholder="setting.description" />

    <!-- number -->
    <AxInput v-else-if="setting.type === 'number'" v-model="value" size="lg" type="number"
      :placeholder="setting.description" />

    <!-- boolean → AxSwitch -->
    <div v-else-if="setting.type === 'boolean'" class="ax-switch-row">
      <span class="ax-switch-label">{{ setting.title }}</span>
      <AxSwitch v-model="value" size="sm" />
    </div>

    <!-- select → AxSelect -->
    <AxSelect v-else-if="setting.type === 'select'" v-model="value" :options="selectOptions" size="lg" />

    <!-- color (keep native) -->
    <div v-else-if="setting.type === 'color'" class="ax-color-wrap">
      <input v-model="value" type="color" class="ax-color-input" />
      <span class="ax-color-value">{{ value }}</span>
    </div>

    <!-- slider → AxSlider -->
    <AxSlider v-else-if="setting.type === 'slider'" v-model="value" :min="setting.min ?? 0" :max="setting.max ?? 100"
      :step="setting.step ?? (setting.max && setting.max > 10 ? 1 : 0.1)" show-value :value-label="String(value)"
      :label-position="'right'" />
  </div>
</template>

<style scoped>
.ax-setting-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 0;
}

.ax-field-label-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ax-field-title {
  font-family: "JetBrains Mono", "Microsoft YaHei", monospace;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--color-on-surface);
  line-height: 16px;
}

.ax-field-desc {
  font-size: 11px;
  color: var(--color-on-surface-variant);
  line-height: 14px;
}

.ax-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
}

.ax-switch-label {
  font-size: 12px;
  color: var(--color-on-surface);
  flex: 1;
}

.ax-color-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ax-color-input {
  width: 28px;
  height: 24px;
  border: 1px solid var(--color-outline-variant);
  border-radius: 6px;
  cursor: pointer;
  padding: 2px;
  background: transparent;
}

.ax-color-value {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--color-secondary);
}
</style>
