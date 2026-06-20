<script setup lang="ts">
import { computed } from "vue"
import type { PanelSettingDefinition } from '../../registry/types'

const props = defineProps<{
  setting: PanelSettingDefinition
  modelValue: unknown
}>()

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
}>()

const value = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
})
</script>

<template>
  <div class="ax-setting-field">
    <div class="ax-field-label-row" v-if="setting.type !== 'boolean'">
      <label class="ax-field-title">{{ setting.title }}</label>
      <span v-if="setting.description" class="ax-field-desc">{{ setting.description }}</span>
    </div>

    <input v-if="setting.type === 'text'" v-model="value" type="text" class="ax-input" />
    <input v-else-if="setting.type === 'number'" v-model.number="value" type="number" class="ax-input" />

    <!-- boolean (switch) - horizontal -->
    <div v-else-if="setting.type === 'boolean'" class="ax-switch-row">
      <span class="ax-switch-label">{{ setting.title }}</span>
      <button
        class="ax-switch"
        :class="{ on: value === true }"
        type="button"
        role="switch"
        :aria-checked="value === true"
        @click="value = !value"
      >
        <span class="ax-switch-knob" />
      </button>
    </div>

    <select v-else-if="setting.type === 'select'" v-model="value" class="ax-input ax-select">
      <option v-for="opt in setting.options" :key="String(opt.value)" :value="opt.value">{{ opt.title }}</option>
    </select>

    <div v-else-if="setting.type === 'color'" class="ax-color-wrap">
      <input v-model="value" type="color" class="ax-color-input" />
      <span class="ax-color-value">{{ value }}</span>
    </div>

    <div v-else-if="setting.type === 'slider'" class="ax-slider-wrap">
      <input v-model.number="value" type="range" :min="setting.min ?? 0" :max="setting.max ?? 100" :step="setting.step ?? 1" class="ax-slider" />
      <span class="ax-slider-value">{{ value }}</span>
    </div>
  </div>
</template>

<style scoped>
.ax-setting-field { display: flex; flex-direction: column; gap: 6px; padding: 6px 0; }
.ax-field-label-row { display: flex; flex-direction: column; gap: 2px; }
.ax-field-title { font-family: "JetBrains Mono", "Microsoft YaHei", monospace; font-size: 12px; font-weight: 500; letter-spacing: 0.02em; color: #1a1c1d; line-height: 16px; }
.ax-field-desc { font-size: 11px; color: #78767b; line-height: 14px; }
.ax-input { height: 24px; padding: 0 8px; border: 1px solid #c8c5ca; border-radius: 8px; background: #f3f3f4; font-size: 12px; color: #1a1c1d; outline: none; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
.ax-input:focus { border-color: #000000; box-shadow: 0 0 0 1px #000000; }
.ax-select { appearance: none; cursor: pointer; padding-right: 24px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235f5e61' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 6px center; }
.ax-switch { width: 36px; height: 20px; border: none; border-radius: 10px; background: #78767b; cursor: pointer; position: relative; transition: background 0.2s ease; padding: 0; align-self: flex-start; }
.ax-switch.on { background: #000000; }
.ax-switch-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #ffffff; transition: transform 0.2s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
.ax-switch.on .ax-switch-knob { transform: translateX(16px); }
.ax-color-wrap { display: flex; align-items: center; gap: 8px; }
.ax-color-input { width: 28px; height: 24px; border: 1px solid #c8c5ca; border-radius: 6px; cursor: pointer; padding: 2px; background: transparent; }
.ax-color-value { font-family: "JetBrains Mono", monospace; font-size: 11px; color: #5f5e61; }
.ax-slider-wrap { display: flex; align-items: center; gap: 8px; }
.ax-slider { flex: 1; height: 4px; appearance: none; background: #c8c5ca; border-radius: 2px; outline: none; cursor: pointer; }
.ax-slider::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #000000; cursor: pointer; border: 2px solid #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
.ax-slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #000000; cursor: pointer; border: 2px solid #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
.ax-slider-value { font-family: "JetBrains Mono", monospace; font-size: 11px; color: #5f5e61; min-width: 32px; text-align: right; }
</style>