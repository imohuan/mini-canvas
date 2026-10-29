<script setup lang="ts">
import { computed, ref } from 'vue'
import { clampNumber } from '../../shared/types'
import { useUiKit } from '../../provider/context'
import type { SliderProps } from './types'
import './slider.css'

defineOptions({ name: 'MckSlider' })

const props = withDefaults(defineProps<SliderProps>(), {
  modelValue: 0,
  min: 0,
  max: 100,
  step: 1,
  size: undefined,
  disabled: false,
  showValue: true,
  format: undefined,
  ariaLabel: '滑块',
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
  change: [value: number]
}>()

const kit = useUiKit()
const size = computed(() => props.size ?? kit.value.size)
const rootRef = ref<HTMLElement | null>(null)
const dragging = ref(false)

const safeMax = computed(() => props.max > props.min ? props.max : props.min + 1)
const clamped = computed(() => clampNumber(props.modelValue, props.min, safeMax.value, props.min))
const percent = computed(() => ((clamped.value - props.min) / (safeMax.value - props.min)) * 100)
const display = computed(() => props.format ? props.format(clamped.value) : String(Math.round(clamped.value * 100) / 100))

function snap(value: number): number {
  const step = props.step > 0 ? props.step : 1
  const snapped = Math.round((value - props.min) / step) * step + props.min
  return clampNumber(Number(snapped.toFixed(6)), props.min, safeMax.value, props.min)
}

function update(value: number, commit = false): void {
  if (props.disabled) return
  const next = snap(value)
  emit('update:modelValue', next)
  if (commit) emit('change', next)
}

function valueAt(clientX: number): number {
  const el = rootRef.value
  if (!el) return clamped.value
  const rect = el.getBoundingClientRect()
  const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0
  return props.min + clampNumber(ratio, 0, 1) * (safeMax.value - props.min)
}

function onPointerDown(event: PointerEvent): void {
  if (props.disabled || event.button !== 0) return
  dragging.value = true
  rootRef.value?.setPointerCapture?.(event.pointerId)
  update(valueAt(event.clientX))
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  event.preventDefault()
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  update(valueAt(event.clientX))
}

function onPointerUp(): void {
  if (!dragging.value) return
  dragging.value = false
  emit('change', clamped.value)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function onKeydown(event: KeyboardEvent): void {
  if (props.disabled) return
  const step = props.step > 0 ? props.step : 1
  const big = step * 10
  const map: Record<string, number> = {
    ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step,
    PageUp: big, PageDown: -big,
  }
  if (event.key === 'Home') {
    event.preventDefault()
    update(props.min, true)
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    update(safeMax.value, true)
    return
  }
  const delta = map[event.key]
  if (delta === undefined) return
  event.preventDefault()
  update(clamped.value + delta, true)
}
</script>

<template>
  <div class="mck-slider-wrap" :class="'is-size-' + size">
    <div
      ref="rootRef"
      class="mck-slider"
      :class="[{ 'is-disabled': disabled, 'is-dragging': dragging }]"
      role="slider"
      :aria-label="ariaLabel"
      :aria-valuemin="min"
      :aria-valuemax="safeMax"
      :aria-valuenow="clamped"
      :aria-valuetext="display"
      :aria-disabled="disabled ? 'true' : undefined"
      :tabindex="disabled ? -1 : 0"
      @pointerdown="onPointerDown"
      @keydown="onKeydown"
    >
      <span class="mck-slider__track"><span class="mck-slider__fill" :style="{ width: percent + '%' }"></span></span>
      <span class="mck-slider__thumb" :style="{ left: percent + '%' }"></span>
    </div>
    <output v-if="showValue" class="mck-slider__value">{{ display }}</output>
  </div>
</template>
