<script setup lang="ts">
import { computed, ref, useAttrs, useSlots } from 'vue'
import { useId } from '../../shared/id'
import { useUiKit } from '../../provider/context'
import type { InputProps } from './types'
import './input.css'

defineOptions({ name: 'MckInput' })

const props = withDefaults(defineProps<InputProps>(), {
  modelValue: '',
  size: undefined,
  type: 'text',
  placeholder: '',
  disabled: false,
  readonly: false,
  clearable: false,
  invalid: false,
  error: '',
  hint: '',
  maxlength: undefined,
  minlength: undefined,
  name: '',
  autocomplete: 'off',
  prefix: '',
  ariaLabel: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  input: [value: string]
  change: [value: string]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
  clear: []
}>()

const slots = useSlots()
const attrs = useAttrs()
const kit = useUiKit()
const inputRef = ref<HTMLInputElement | null>(null)
const inputId = useId('mck-input')
const describedBy = computed(() => {
  if (props.error) return inputId + '-error'
  if (props.hint) return inputId + '-hint'
  return undefined
})
const size = computed(() => props.size ?? kit.value.size)
const value = computed(() => String(props.modelValue ?? ''))
/**
 * 读屏名称有两个入口：`aria-label` 直接写在组件上（HTML 原生写法），或 `ariaLabel`。
 *
 * 组件根节点是 fragment（输入框 + 提示文字），Vue 无法自动把透传属性落到 input 上，
 * 所以这里手动取一次；否则 aria-label 会挂在 div 上，读屏根本读不到输入框。
 */
const ariaLabel = computed(() => {
  const fallthrough = attrs['aria-label']
  return typeof fallthrough === 'string' ? fallthrough : props.ariaLabel
})

function onInput(event: Event): void {
  const next = (event.target as HTMLInputElement).value
  emit('update:modelValue', next)
  emit('input', next)
}

function clear(): void {
  emit('update:modelValue', '')
  emit('input', '')
  emit('clear')
  inputRef.value?.focus()
}
</script>

<template>
  <div
    class="mck-input"
    :class="['mck-input--' + size, { 'is-disabled': disabled, 'is-invalid': invalid || !!error }]"
  >
    <span v-if="prefix || slots.prefix" class="mck-input__prefix" aria-hidden="true">
      <slot name="prefix">{{ prefix }}</slot>
    </span>
    <input
      :id="inputId"
      ref="inputRef"
      :value="value"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :maxlength="maxlength"
      :minlength="minlength"
      :name="name || undefined"
      :autocomplete="autocomplete"
      :aria-label="ariaLabel || undefined"
      :aria-invalid="invalid || error ? 'true' : undefined"
      :aria-describedby="describedBy"
      class="mck-input__control"
      @input="onInput"
      @change="emit('change', String(($event.target as HTMLInputElement).value))"
      @focus="emit('focus', $event)"
      @blur="emit('blur', $event)"
    />
    <button
      v-if="clearable && value && !disabled && !readonly"
      type="button"
      class="mck-input__clear"
      aria-label="清空"
      title="清空"
      @click="clear"
    >
      <slot name="clear-icon">×</slot>
    </button>
    <span v-if="slots.suffix" class="mck-input__suffix"><slot name="suffix" /></span>
  </div>
  <p v-if="error" :id="inputId + '-error'" class="mck-input__error" role="alert">{{ error }}</p>
  <p v-else-if="hint" :id="inputId + '-hint'" class="mck-input__hint">{{ hint }}</p>
</template>
