<script setup lang="ts">
import { computed, type Ref } from 'vue'
import type { PanelSettingDefinition } from '../../registry/types'

const props = defineProps<{
  setting: PanelSettingDefinition
  modelValue: Ref<unknown>
}>()

const emit = defineEmits<{
  'update:modelValue': [unknown]
}>()

const value = computed({
  get: () => props.modelValue.value,
  set: (v) => emit('update:modelValue', v),
})
</script>

<template>
  <div class="dynamic-setting-field">
    <label class="field-label">
      <span class="field-title">{{ setting.title }}</span>
      <span v-if="setting.description" class="field-desc">{{ setting.description }}</span>
    </label>

    <input v-if="setting.type === 'text'" v-model="value" type="text" class="field-input" />

    <input v-else-if="setting.type === 'number'" v-model.number="value" type="number" class="field-input" />

    <button v-else-if="setting.type === 'boolean'" class="field-toggle" :class="{ 'is-on': value === true }" type="button" @click="value = !value">
      <span class="field-toggle-knob" />
    </button>

    <select v-else-if="setting.type === 'select'" v-model="value" class="field-input">
      <option v-for="opt in setting.options" :key="String(opt.value)" :value="opt.value">{{ opt.title }}</option>
    </select>

    <input v-else-if="setting.type === 'color'" v-model="value" type="color" class="field-color" />

    <div v-else-if="setting.type === 'slider'" class="field-slider-wrap">
      <input v-model.number="value" type="range" :min="setting.min ?? 0" :max="setting.max ?? 100" :step="setting.step ?? 1" class="field-slider" />
      <span class="field-slider-value">{{ value }}</span>
    </div>
  </div>
</template>

<style scoped>
.dynamic-setting-field { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; }
.field-label { display: flex; flex-direction: column; gap: 2px; }
.field-title { font-size: 13px; font-weight: 600; color: #374151; }
.field-desc { font-size: 11px; color: #9ca3af; }
.field-input { padding: 6px 8px; border: 1px solid rgba(0,0,0,0.1); border-radius: 6px; font-size: 13px; background: rgba(255,255,255,0.8); color: #374151; }
.field-input:focus { outline: none; border-color: #3b82f6; }
.field-color { width: 40px; height: 28px; border: 1px solid rgba(0,0,0,0.1); border-radius: 6px; cursor: pointer; }
.field-toggle { width: 36px; height: 20px; border: none; border-radius: 10px; background: rgba(0,0,0,0.15); cursor: pointer; position: relative; transition: background 0.2s ease; }
.field-toggle.is-on { background: #3b82f6; }
.field-toggle-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.2s ease; }
.field-toggle.is-on .field-toggle-knob { transform: translateX(16px); }
.field-slider-wrap { display: flex; align-items: center; gap: 8px; }
.field-slider { flex: 1; }
.field-slider-value { font-size: 12px; color: #6b7280; min-width: 30px; text-align: right; }
</style>


