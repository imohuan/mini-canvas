<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useUiKit } from '../../provider/context'
import type { TabsProps } from './types'
import './tabs.css'

defineOptions({ name: 'MckTabs' })

const props = withDefaults(defineProps<TabsProps>(), {
  modelValue: '',
  items: () => [],
  size: undefined,
  block: false,
  ariaLabel: '选项卡',
})

const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [value: string] }>()
const kit = useUiKit()
const size = computed(() => props.size ?? kit.value.size)
const buttons = ref<HTMLElement[]>([])
const enabled = computed(() => props.items.filter((item) => !item.disabled))

function select(value: string, focus = false): void {
  const item = props.items.find((x) => x.value === value)
  if (!item || item.disabled) return
  emit('update:modelValue', value)
  emit('change', value)
  if (focus) nextTick(() => buttons.value[props.items.indexOf(item)]?.focus())
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const list = props.items
  if (list.length === 0) return
  if (event.key === 'Home') {
    event.preventDefault()
    select(enabled.value[0]?.value ?? '', true)
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    select(enabled.value[enabled.value.length - 1]?.value ?? '', true)
    return
  }
  const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  if (!dir) return
  event.preventDefault()
  const order = enabled.value
  if (order.length === 0) return
  const current = list[index]
  const pos = Math.max(0, order.findIndex((x) => x.value === current?.value))
  const next = order[(pos + dir + order.length) % order.length]
  if (next) select(next.value, true)
}

watch(() => props.items, () => {
  if (!props.items.some((x) => x.value === props.modelValue)) {
    const first = enabled.value[0]
    if (first) emit('update:modelValue', first.value)
  }
}, { immediate: true })

const active = computed(() => props.modelValue)
onMounted(() => {
  if (!active.value) {
    const first = enabled.value[0]
    if (first) emit('update:modelValue', first.value)
  }
})
</script>

<template>
  <div
    class="mck-tabs"
    :class="['mck-tabs--' + size, { 'is-block': block }]"
    role="tablist"
    :aria-label="ariaLabel"
  >
    <button
      v-for="(item, index) in items"
      :key="item.value"
      ref="buttons"
      type="button"
      role="tab"
      class="mck-tab"
      :class="{ 'is-active': active === item.value, 'is-disabled': item.disabled }"
      :aria-selected="active === item.value"
      :aria-controls="'panel-' + item.value"
      :disabled="item.disabled"
      :tabindex="active === item.value ? 0 : -1"
      @click="select(item.value)"
      @keydown="onKeydown($event, index)"
    >
      <span>{{ item.label }}</span>
      <span v-if="item.badge !== undefined" class="mck-tab__badge">{{ item.badge }}</span>
    </button>
  </div>
</template>
