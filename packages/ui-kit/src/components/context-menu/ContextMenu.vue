<script setup lang="ts">
/**
 * 右键菜单：从 plugin-context-menu 抽出纯 UI 层。
 * 支持分组、图标、快捷键、禁用、危险项和一级子菜单；位置会夹在视口内。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useEscape, useOutsideClick } from '../../shared/overlay'
import type { ContextMenuItem, ContextMenuProps } from './types'
import './context-menu.css'

defineOptions({ name: 'MckContextMenu' })

const props = withDefaults(defineProps<ContextMenuProps>(), {
  items: () => [],
  x: 0,
  y: 0,
  modelValue: undefined,
  minWidth: '200px',
  maxHeight: 'calc(100vh - 24px)',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [item: ContextMenuItem]
  close: []
}>()

const visible = ref(props.modelValue ?? false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const submenu = ref<ContextMenuItem | null>(null)
const submenuAnchor = ref<HTMLElement | null>(null)
const submenuStyle = ref<Record<string, string>>({})

const position = ref({ left: 0, top: 0 })
const groups = computed(() => {
  const out: Array<{ name: string; items: ContextMenuItem[] }> = []
  for (const item of props.items) {
    const name = item.group ?? ''
    const last = out[out.length - 1]
    if (last && last.name === name) last.items.push(item)
    else out.push({ name, items: [item] })
  }
  return out
})

function clampPosition(): void {
  const width = panel.value?.offsetWidth ?? 220
  const height = panel.value?.offsetHeight ?? 180
  const pad = 8
  position.value = {
    left: Math.min(Math.max(props.x, pad), Math.max(pad, window.innerWidth - width - pad)),
    top: Math.min(Math.max(props.y, pad), Math.max(pad, window.innerHeight - height - pad)),
  }
}

function showAt(x: number, y: number): void {
  position.value = { left: x, top: y }
  visible.value = true
  emit('update:modelValue', true)
  nextTick(() => {
    clampPosition()
    panel.value?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
  })
}

function close(): void {
  visible.value = false
  submenu.value = null
  emit('update:modelValue', false)
  emit('close')
}

function activate(item: ContextMenuItem): void {
  if (item.disabled || item.divider) return
  if (item.children?.length) {
    submenu.value = submenu.value?.id === item.id ? null : item
    nextTick(placeSubmenu)
    return
  }
  emit('select', item)
  close()
}

function placeSubmenu(): void {
  const el = submenuAnchor.value
  if (!el || !submenu.value) return
  const rect = el.getBoundingClientRect()
  const width = 200
  const height = 180
  const flipX = rect.right + width > window.innerWidth - 8
  const left = flipX ? Math.max(8, rect.left - width) : rect.right + 2
  const top = Math.min(Math.max(rect.top, 8), Math.max(8, window.innerHeight - height - 8))
  submenuStyle.value = { left: left + 'px', top: top + 'px' }
}

function openSubmenu(item: ContextMenuItem, event: Event): void {
  if (!item.children?.length) return
  submenuAnchor.value = event.currentTarget as HTMLElement
  submenu.value = item
  nextTick(placeSubmenu)
}

function moveFocus(event: KeyboardEvent): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const panelEl = panel.value
  if (!panelEl) return
  const items = Array.from(panelEl.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'))
  if (items.length === 0) return
  event.preventDefault()
  const index = items.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'Home'
    ? items[0]
    : event.key === 'End'
      ? items[items.length - 1]
      : event.key === 'ArrowDown'
        ? items[index < 0 || index === items.length - 1 ? 0 : index + 1]
        : items[index <= 0 ? items.length - 1 : index - 1]
  next?.focus()
}

useOutsideClick(visible, [root, panel], close)
useEscape(visible, close)

watch(() => props.modelValue, (value) => {
  if (typeof value === 'boolean' && value !== visible.value) {
    visible.value = value
    if (value) nextTick(clampPosition)
  }
})

defineExpose({ showAt, close })
</script>

<template>
  <div v-if="visible" ref="root" class="mck-context-menu" @contextmenu.prevent>
    <div
      ref="panel"
      class="mck-context-menu__panel"
      :style="{ left: position.left + 'px', top: position.top + 'px', minWidth, maxHeight }"
      role="menu"
      @keydown="moveFocus"
    >
      <template v-for="(group, gi) in groups" :key="group.name + gi">
        <div v-if="gi > 0" class="mck-context-menu__divider" role="separator" />
        <template v-for="item in group.items" :key="item.id">
          <div v-if="item.divider" class="mck-context-menu__divider" role="separator" />
          <button
            v-else
            type="button"
            class="mck-context-menu__item"
            :class="{ 'is-danger': item.danger, 'is-disabled': item.disabled, 'is-open': submenu?.id === item.id }"
            role="menuitem"
            :aria-disabled="item.disabled ? 'true' : undefined"
            :aria-haspopup="item.children?.length ? 'menu' : undefined"
            :disabled="item.disabled"
            @click="activate(item)"
            @mouseenter="openSubmenu(item, $event)"
          >
            <span v-if="item.icon" class="mck-context-menu__icon" aria-hidden="true">{{ item.icon }}</span>
            <span class="mck-context-menu__copy">
              <span class="mck-context-menu__label">{{ item.label }}</span>
              <span v-if="item.description" class="mck-context-menu__desc">{{ item.description }}</span>
            </span>
            <span v-if="item.shortcut" class="mck-context-menu__shortcut">{{ item.shortcut }}</span>
            <span v-if="item.children?.length" class="mck-context-menu__chevron" aria-hidden="true">›</span>
          </button>
        </template>
      </template>
    </div>
    <div
      v-if="submenu"
      class="mck-context-menu__panel mck-context-menu__submenu"
      :style="submenuStyle"
      role="menu"
    >
      <button
        v-for="child in submenu.children"
        :key="child.id"
        type="button"
        class="mck-context-menu__item"
        :class="{ 'is-danger': child.danger, 'is-disabled': child.disabled }"
        role="menuitem"
        :disabled="child.disabled"
        @click="activate(child)"
      >
        <span v-if="child.icon" class="mck-context-menu__icon" aria-hidden="true">{{ child.icon }}</span>
        <span class="mck-context-menu__copy"><span class="mck-context-menu__label">{{ child.label }}</span></span>
        <span v-if="child.shortcut" class="mck-context-menu__shortcut">{{ child.shortcut }}</span>
      </button>
    </div>
  </div>
  <slot />
</template>
