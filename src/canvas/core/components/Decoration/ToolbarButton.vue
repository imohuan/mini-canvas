<script setup lang="ts">
import { ref, type Component, nextTick } from 'vue'

const props = withDefaults(defineProps<{
  icon?: Component | string
  title?: string
  tooltip?: string
  variant?: 'default' | 'primary'
  danger?: boolean
  disabled?: boolean
  dropdown?: Array<{
    id: string; title?: string; icon?: Component | string
    danger?: boolean; disabled?: boolean | ((ctx: any) => boolean)
  }>
  customRender?: Component
}>(), { variant: 'default', danger: false, disabled: false })

const emit = defineEmits<{
  (e: 'action'): void
  (e: 'dropdown-select', id: string): void
}>()

const showDropdown = ref(false)
const buttonRef = ref<HTMLElement | null>(null)
const dropdownStyle = ref<Record<string, string>>({})

function onButtonClick() {
  if (props.disabled) return
  if (props.dropdown && props.dropdown.length > 0) {
    if (!showDropdown.value) {
      // 计算下拉菜单位置
      nextTick(() => {
        const btn = buttonRef.value
        if (btn) {
          const rect = btn.getBoundingClientRect()
          dropdownStyle.value = {
            position: 'fixed',
            top: rect.bottom + 4 + 'px',
            left: rect.left + 'px',
          }
        }
      })
    }
    showDropdown.value = !showDropdown.value
    return
  }
  emit('action')
}

function onDropdownItemClick(id: string) {
  showDropdown.value = false
  emit('dropdown-select', id)
}
</script>

<template>
  <div class="toolbar-button-wrapper" @mouseleave="showDropdown = false">
    <component v-if="customRender" :is="customRender" @action="emit('action')" />
    <button ref="buttonRef" v-else class="toolbar-button"
      :class="{
        'toolbar-button--primary': variant === 'primary',
        'toolbar-button--danger': danger,
        'is-disabled': disabled,
      }"
      :disabled="disabled" :title="tooltip || title" type="button" @click="onButtonClick">
      <component v-if="typeof icon === 'object' && icon" :is="icon" class="toolbar-button-icon" />
      <span v-else-if="typeof icon === 'string' && icon" class="toolbar-button-icon" v-html="icon" />
      <span v-if="title" class="toolbar-button-label">{{ title }}</span>
      <svg v-if="dropdown && dropdown.length > 0" class="toolbar-button-chevron" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
    <Teleport to="body">
      <Transition name="dropdown-fade">
        <div v-if="showDropdown && dropdown && dropdown.length > 0" class="toolbar-dropdown" :style="dropdownStyle">
          <button v-for="item in dropdown" :key="item.id" class="toolbar-dropdown-item"
            :class="{ 'toolbar-dropdown-item--danger': item.danger, 'is-disabled': item.disabled }"
            :disabled="typeof item.disabled === 'function' ? item.disabled({}) : item.disabled" type="button" @click.stop="onDropdownItemClick(item.id)">
            <component v-if="typeof item.icon === 'object' && item.icon" :is="item.icon" class="toolbar-dropdown-item-icon" />
            <span v-else-if="typeof item.icon === 'string' && item.icon" class="toolbar-dropdown-item-icon" v-html="item.icon" />
            <span v-if="item.title" class="toolbar-dropdown-item-label">{{ item.title }}</span>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.toolbar-button-wrapper { position: relative; display: inline-flex; }
.toolbar-button {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; border: 0; border-radius: 6px;
  background: transparent; color: var(--canvas-node-text, #374151);
  font-size: 12px; line-height: 1; white-space: nowrap; cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.toolbar-button:hover:not(.is-disabled) {
  background: var(--canvas-node-panel-surface-hover, rgba(0,0,0,0.06));
  color: var(--canvas-node-text-strong, #111827);
}
.toolbar-button--primary { color: var(--canvas-node-text-strong, #111827); }
.toolbar-button--primary:hover:not(.is-disabled) { background: var(--canvas-node-panel-surface-active, rgba(59,130,246,0.12)); }
.toolbar-button--danger { color: #ef4444; }
.toolbar-button--danger:hover:not(.is-disabled) { background: rgba(239,68,68,0.08); }
.toolbar-button.is-disabled { opacity: 0.4; cursor: not-allowed; }
.toolbar-button-icon { width: 14px; height: 14px; flex-shrink: 0; display: flex; align-items: center; }
.toolbar-button-label { font-size: 12px; }
.toolbar-button-chevron { opacity: 0.5; margin-left: 2px; }
.toolbar-dropdown {
  z-index: 99999; min-width: 140px;
  padding: 4px; background: rgba(255,255,255,0.95); backdrop-filter: blur(12px);
  border: 1px solid rgba(0,0,0,0.08); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}
.toolbar-dropdown-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 10px; border: 0; border-radius: 6px;
  background: transparent; color: #374151; font-size: 12px;
  cursor: pointer; text-align: left;
}
.toolbar-dropdown-item:hover:not(.is-disabled) { background: rgba(0,0,0,0.05); }
.toolbar-dropdown-item--danger { color: #ef4444; }
.toolbar-dropdown-item--danger:hover:not(.is-disabled) { background: rgba(239,68,68,0.08); }
.toolbar-dropdown-item.is-disabled { opacity: 0.4; cursor: not-allowed; }
.toolbar-dropdown-item-icon { width: 14px; height: 14px; flex-shrink: 0; display: flex; align-items: center; }
.toolbar-dropdown-item-label { font-size: 12px; }
.dropdown-fade-enter-active, .dropdown-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-fade-enter-from, .dropdown-fade-leave-to {
  opacity: 0; transform: translateY(-4px);
}
</style>