<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import type { DropdownProps } from './types'
import { useDropdown } from './useDropdown'
import './dropdown.css'

defineOptions({ name: 'MckDropdown' })

/** 兼容主题旧实现的 `dd` 外壳类：调用方若已传，不重复补。 */
const attrs = useAttrs()
const rootClass = computed(() => {
  const external = String(attrs.class ?? '').split(/\s+/).filter(Boolean)
  return external.includes('dd') ? external : ['dd', ...external]
})

const props = withDefaults(defineProps<DropdownProps>(), {
  modelValue: false,
  placement: 'bottom-start',
  offset: 6,
  matchWidth: false,
  trigger: 'click',
  hoverCloseDelay: 150,
  hoverOpenDelay: 0,
  menuWidth: '',
  menuHeight: '',
  menuMinWidth: '',
  menuMaxWidth: '',
  menuMaxHeight: '',
  menuClass: '',
  bodyClass: '',
  teleport: true,
  arrow: false,
  arrowClass: '',
  align: 'auto',
  menuRole: 'menu',
  zIndex: undefined,
  layout: 'overlay-scroll',
  disabled: false,
  appendTo: 'body',
  bare: false,
  closeOnOutside: true,
  closeOnEscape: true,
  closeAllEvent: '',
  /** Boolean prop 缺省会被 Vue 转成 false，这里显式给 true；只有调用方写 false 才退出互斥。 */
  exclusive: true,
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

defineExpose({
  controller,
  open: api.open,
  show: api.show,
  /** 在视口坐标打开（右键 / 行尾按钮），与普通打开共用定位与互斥。 */
  showAtPoint: api.showAtPoint,
  hide: api.hide,
  /** 本浮层的链 id：父浮层交给子浮层，用来区分「自己人」与「点外面」。 */
  chainId: api.chainId,
  toggle: api.toggle,
  /** 浮层 DOM：父组件（如 Tooltip）需要把焦点送进去。 */
  panelRef: api.panelRef,
})
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
        api.scheduleShow()
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
  <!-- 兼容主题旧实现的 dd / dd-trigger 类名：调用方与测试按它们取外壳，换底层不该改外观契约。 -->
  <div class="mck-dropdown" :class="[rootClass, { 'is-disabled': disabled }]">
    <!--
      触发器插槽**始终渲染**：外部 anchor 只表示“浮层贴在哪个元素旁边”，
      不等于“这行内容不要显示”。此前 anchor 存在时整块触发器被藏掉，
      子菜单那一行（挂外部 anchor 的菜单行）会凭空消失。
      绑定 anchor 时不接管本地触发事件（见 triggerEvents）。
    -->
    <div
      :ref="api.triggerRef"
      class="mck-dropdown__trigger dd-trigger"
      :aria-expanded="anchor ? undefined : api.open.value"
      :aria-haspopup="anchor ? undefined : 'menu'"
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
          :class="[menuClass, bodyClass, { 'is-inner-scroll': layout === 'inner-scroll', 'is-bare': bare, 'is-tooltip': menuRole === 'tooltip' }]"
          :style="api.panelStyle.value"
          :role="menuRole"
          :data-mck-floating-chain="api.chain.value.join(' ')"
          :data-floating-chain="api.chain.value.join(' ')"
          @mouseenter="trigger === 'hover' ? api.cancelHide() : undefined"
          @mouseleave="trigger === 'hover' ? api.scheduleHide() : undefined"
        >
          <slot :close="api.closeFromSlot" :open="api.open.value" />
        </div>
      </Transition>
      <!--
        箭头必须排在面板之后：旋转 45° 后内侧一半要压在面板边框上，
        和面板连成一体。放前面会被面板盖住，只露出半截尖角。
      -->
      <div
        v-if="api.open.value && arrow"
        class="mck-dropdown__arrow dd-arrow"
        :class="arrowClass"
        :style="api.arrowStyle.value"
        aria-hidden="true"
      />
    </Teleport>
  </div>
</template>
