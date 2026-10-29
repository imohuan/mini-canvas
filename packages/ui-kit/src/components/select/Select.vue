<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Dropdown } from '../dropdown'
import { useUiKit } from '../../provider/context'
import type { SelectOption, SelectProps } from './types'
import './select.css'

defineOptions({ name: 'MckSelect' })

const props = withDefaults(defineProps<SelectProps>(), {
  modelValue: null,
  options: () => [],
  size: undefined,
  placeholder: '请选择',
  searchable: false,
  searchPlaceholder: '搜索…',
  disabled: false,
  invalid: false,
  error: '',
  clearable: false,
  emptyText: '没有匹配的选项',
  ariaLabel: '选择',
  menuMinWidth: '200px',
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number | null]
  change: [value: string | number | null]
}>()

const kit = useUiKit()
const size = computed(() => props.size ?? kit.value.size)
const open = ref(false)
const query = ref('')
const highlight = ref(0)
const searchRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const selected = computed(() => props.options.find((x) => x.value === props.modelValue))
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter((x) => x.label.toLowerCase().includes(q) || (x.description ?? '').toLowerCase().includes(q))
})
const groups = computed(() => {
  const out: Array<{ name: string; items: SelectOption[] }> = []
  for (const item of filtered.value) {
    const name = item.group ?? ''
    const last = out[out.length - 1]
    if (last && last.name === name) last.items.push(item)
    else out.push({ name, items: [item] })
  }
  return out
})

function select(item: SelectOption): void {
  if (item.disabled) return
  emit('update:modelValue', item.value)
  emit('change', item.value)
  open.value = false
}

function clear(): void {
  emit('update:modelValue', null)
  emit('change', null)
}

function onOpenChange(value: boolean): void {
  open.value = value
  if (value) {
    query.value = ''
    nextTick(() => {
      const index = filtered.value.findIndex((x) => x.value === props.modelValue)
      highlight.value = index >= 0 ? index : 0
      if (props.searchable) searchRef.value?.focus()
    })
  }
}

function move(delta: number): void {
  const list = filtered.value
  if (list.length === 0) return
  let next = highlight.value
  for (let i = 0; i < list.length; i += 1) {
    next = (next + delta + list.length) % list.length
    if (!list[next]?.disabled) break
  }
  highlight.value = next
  nextTick(() => {
    listRef.value?.querySelector<HTMLElement>('[data-highlight="true"]')?.scrollIntoView({ block: 'nearest' })
  })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
  else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
  else if (event.key === 'Enter') {
    event.preventDefault()
    const item = filtered.value[highlight.value]
    if (item) select(item)
  } else if (event.key === 'Home') { event.preventDefault(); highlight.value = 0 }
  else if (event.key === 'End') { event.preventDefault(); highlight.value = Math.max(0, filtered.value.length - 1) }
}

watch(filtered, () => { if (highlight.value >= filtered.value.length) highlight.value = 0 })
</script>

<template>
  <div class="mck-select-wrap" :class="'mck-select--' + size">
    <Dropdown
      :model-value="open"
      :disabled="disabled"
      :match-width="true"
      :menu-min-width="menuMinWidth"
      menu-role="listbox"
      menu-max-height="min(320px, 60vh)"
      @update:model-value="onOpenChange"
    >
      <template #trigger="{ open: isOpen }">
        <button
          type="button"
          class="mck-select"
          :class="{ 'is-open': isOpen, 'is-invalid': invalid || !!error, 'is-placeholder': !selected }"
          :aria-label="ariaLabel"
          :aria-expanded="isOpen"
          aria-haspopup="listbox"
          :disabled="disabled"
        >
          <input
            v-if="searchable && isOpen"
            ref="searchRef"
            v-model="query"
            class="mck-select__search"
            :placeholder="searchPlaceholder"
            aria-label="搜索选项"
            @click.stop
            @keydown.stop="onKeydown"
          />
          <span v-else class="mck-select__label">{{ selected?.label || placeholder }}</span>
          <span
            v-if="clearable && selected && !disabled"
            class="mck-select__clear"
            role="button"
            tabindex="-1"
            aria-label="清空选择"
            @click.stop.prevent="clear"
          >×</span>
          <span class="mck-select__arrow" :class="{ 'is-open': isOpen }" aria-hidden="true">▾</span>
        </button>
      </template>
      <template #default>
        <div ref="listRef" class="mck-select__list" @keydown="onKeydown">
          <template v-for="(group, gi) in groups" :key="group.name + gi">
            <div v-if="group.name" class="mck-select__group">{{ group.name }}</div>
            <button
              v-for="item in group.items"
              :key="item.value"
              type="button"
              role="option"
              class="mck-select__option"
              :class="{
                'is-selected': item.value === modelValue,
                'is-highlight': item === filtered[highlight],
                'is-disabled': item.disabled,
              }"
              :data-highlight="item === filtered[highlight] ? 'true' : 'false'"
              :aria-selected="item.value === modelValue"
              :aria-disabled="item.disabled ? 'true' : undefined"
              @click="select(item)"
              @mouseenter="highlight = filtered.indexOf(item)"
            >
              <span v-if="item.icon" class="mck-select__icon" aria-hidden="true">{{ item.icon }}</span>
              <span class="mck-select__copy">
                <span class="mck-select__option-label">{{ item.label }}</span>
                <span v-if="item.description" class="mck-select__option-desc">{{ item.description }}</span>
              </span>
              <span v-if="item.value === modelValue" class="mck-select__check" aria-hidden="true">✓</span>
            </button>
          </template>
          <p v-if="filtered.length === 0" class="mck-select__empty">{{ emptyText }}</p>
        </div>
      </template>
    </Dropdown>
    <p v-if="error" class="mck-select__error" role="alert">{{ error }}</p>
  </div>
</template>
