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
  menuHeight: '',
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
// useDropdown 需要响应式 props：不能展开成快照，否则方向、宽高等后续变化都收不到。
const api = useDropdown(props, (value) => {
  emit('update:modelValue', value)
  if (value) emit('open')
  else emit('close')
})

/** 外部想要的 controller：show/hide/toggle/isOpen，不需要 ref 也能直接调用。 */
const controller = computed(() => ({
  show: api.show,
  hide: api.hide,
  toggle: api.toggle,
  get isOpen() {
    return api.open.value
  },
}))

defineExpose({ controller, open: api.open, show: api.show, hide: api.hide, toggle: api.toggle })
/*
  slot 里拿到的 close 直接调用 hide；hide 内部会派发 update:modelValue=false，
  再由上面这里转成 open/close 事件。测试中通过 wrapper.emitted 校验。
*/

const triggerEvents = computed(() => {
  // 绑定外部 anchor 后，默认不接管本地触发器事件；插槽里仍可用 api.toggle 控制。
  if (props.anchor) return {}
  if (props.trigger === 'always') return {}
  if (props.trigger === 'hover') {
    return {
      onMouseenter: () => {
        api.cancelHide()
        api.show()
      },
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
      v-if="!anchor"
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
      <div
        v-if="api.open.value && arrow"
        class="mck-dropdown__arrow"
        :style="api.arrowStyle.value"
        aria-hidden="true"
      />
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
