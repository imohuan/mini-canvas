<script setup lang="ts">
import { computed } from 'vue'
import type { DropdownProps } from './types'
import { useDropdown } from './useDropdown'
import './dropdown.css'

defineOptions({ name: 'MckDropdown' })

const props = withDefaults(defineProps<DropdownProps>(), {
  modelValue: false,
  placement: 'bottom-start',
  offset: 6,
  matchWidth: false,
  trigger: 'click',
  hoverCloseDelay: 150,
  menuWidth: '',
  menuMinWidth: '',
  menuMaxWidth: '',
  menuMaxHeight: '',
  menuClass: '',
  bodyClass: '',
  teleport: true,
  arrow: false,
  align: 'auto',
  menuRole: 'menu',
  layout: 'overlay-scroll',
  disabled: false,
  appendTo: 'body',
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean]; open: []; close: [] }>()
const api = useDropdown(props, (value) => {
  emit('update:modelValue', value)
  if (value) emit('open')
  else emit('close')
})
/*
  slot 里拿到的 close 直接调用 hide；hide 内部会派发 update:modelValue=false，
  再由上面这里转成 open/close 事件。测试中通过 wrapper.emitted 校验。
*/

const triggerEvents = computed(() => {
  if (props.trigger === 'hover') {
    return {
      onMouseenter: api.cancelHide,
      onMouseleave: api.scheduleHide,
      onClick: api.toggle,
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
          event.preventDefault()
          api.show()
        }
      },
    }
  }
  if (props.trigger === 'contextmenu') {
    return {
      onContextmenu: (event: MouseEvent) => {
        event.preventDefault()
        api.show()
      },
    }
  }
  return {
    onClick: api.toggle,
    onKeydown: (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        api.show()
      }
    },
  }
})
</script>

<template>
  <div class="mck-dropdown" :class="{ 'is-disabled': disabled }">
    <div
      :ref="api.triggerRef"
      class="mck-dropdown__trigger"
      :aria-expanded="api.open.value"
      aria-haspopup="menu"
      v-bind="triggerEvents"
      @mouseenter="trigger === 'hover' ? api.cancelHide() : undefined"
      @mouseleave="trigger === 'hover' ? api.scheduleHide() : undefined"
    >
      <slot name="trigger" :open="api.open.value" :toggle="api.toggle" :close="api.hide" />
    </div>
    <Teleport :to="appendTo" :disabled="!teleport">
      <Transition name="mck-dropdown-fade">
        <div
          v-if="api.open.value"
          :ref="api.panelRef"
          class="mck-dropdown__panel"
          :class="[menuClass, bodyClass, { 'is-inner-scroll': layout === 'inner-scroll' }]"
          :style="api.panelStyle.value"
          :role="menuRole"
          @mouseenter="trigger === 'hover' ? api.cancelHide() : undefined"
          @mouseleave="trigger === 'hover' ? api.scheduleHide() : undefined"
        >
          <slot :close="api.closeFromSlot" :open="api.open.value" />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
