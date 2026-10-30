<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUiKit } from '../../provider/context'
import type { SwitchProps } from './types'
import './switch.css'

defineOptions({ name: 'MckSwitch' })

const props = withDefaults(defineProps<SwitchProps>(), {
  modelValue: false,
  size: undefined,
  disabled: false,
  loading: false,
  label: '',
  description: '',
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean]; change: [value: boolean] }>()
const kit = useUiKit()
const size = computed(() => props.size ?? kit.value.size)
const input = ref<HTMLInputElement | null>(null)

function toggle(): void {
  if (props.disabled || props.loading) return
  const next = !props.modelValue
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<template>
  <label
    class="mck-switch"
    :class="['mck-switch--' + size, { 'is-disabled': disabled, 'is-loading': loading, 'is-on': modelValue }]"
  >
    <input
      ref="input"
      type="checkbox"
      class="mck-switch__input"
      :checked="modelValue"
      :disabled="disabled || loading"
      role="switch"
      :aria-label="label || undefined"
      @change="toggle"
    />
    <span v-if="label || description" class="mck-switch__copy">
      <span v-if="label" class="mck-switch__label">{{ label }}</span>
      <span v-if="description" class="mck-switch__desc">{{ description }}</span>
    </span>
    <span class="mck-switch__track" aria-hidden="true"><span class="mck-switch__thumb"></span></span>
  </label>
</template>
