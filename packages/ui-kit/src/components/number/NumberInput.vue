<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { clampNumber } from '../../shared/types'
import { useUiKit } from '../../provider/context'
import type { NumberProps } from './types'
import './number.css'

defineOptions({ name: 'MckNumberInput' })

const props = withDefaults(defineProps<NumberProps>(), {
  modelValue: null,
  size: undefined,
  min: -Infinity,
  max: Infinity,
  step: 1,
  precision: 0,
  disabled: false,
  readonly: false,
  placeholder: '',
  controls: true,
  suffix: '',
  invalid: false,
  error: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
  change: [value: number | null]
}>()

const kit = useUiKit()
const size = computed(() => props.size ?? kit.value.size)
const text = ref(props.modelValue === null ? '' : String(props.modelValue))

watch(() => props.modelValue, (value) => {
  text.value = value === null || value === undefined ? '' : String(value)
})

function round(value: number): number {
  const factor = 10 ** Math.max(0, props.precision)
  return Math.round(value * factor) / factor
}

function commit(raw: string): void {
  if (raw.trim() === '') {
    emit('update:modelValue', null)
    emit('change', null)
    return
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return
  const next = round(clampNumber(parsed, props.min, props.max, parsed))
  text.value = String(next)
  emit('update:modelValue', next)
  emit('change', next)
}

function stepBy(direction: 1 | -1): void {
  if (props.disabled || props.readonly) return
  const current = props.modelValue ?? (direction > 0 ? props.min === -Infinity ? 0 : props.min : 0)
  const base = Number.isFinite(current) ? Number(current) : 0
  const next = round(clampNumber(base + direction * props.step, props.min, props.max, base))
  text.value = String(next)
  emit('update:modelValue', next)
  emit('change', next)
}

function onInput(event: Event): void {
  text.value = (event.target as HTMLInputElement).value
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    stepBy(1)
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    stepBy(-1)
  }
}

const shown = computed(() => text.value)
</script>

<template>
  <div class="mck-number-wrap">
    <div
      class="mck-number"
      :class="['mck-number--' + size, { 'is-disabled': disabled, 'is-invalid': invalid || !!error }]"
    >
      <button
        v-if="controls"
        type="button"
        class="mck-number__step"
        :disabled="disabled || readonly || modelValue === null || modelValue <= min"
        aria-label="减少"
        @click="stepBy(-1)"
      >−</button>
      <input
        :value="shown"
        type="text"
        inputmode="decimal"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :aria-invalid="invalid || error ? 'true' : undefined"
        class="mck-number__input"
        @input="onInput"
        @blur="commit(($event.target as HTMLInputElement).value)"
        @keydown="onKeydown"
        @keydown.enter.prevent="commit(($event.target as HTMLInputElement).value)"
      />
      <span v-if="suffix" class="mck-number__suffix">{{ suffix }}</span>
      <button
        v-if="controls"
        type="button"
        class="mck-number__step"
        :disabled="disabled || readonly || modelValue === null || modelValue >= max"
        aria-label="增加"
        @click="stepBy(1)"
      >+</button>
    </div>
    <p v-if="error" class="mck-number__error" role="alert">{{ error }}</p>
  </div>
</template>
