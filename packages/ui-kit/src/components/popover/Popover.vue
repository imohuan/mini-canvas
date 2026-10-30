<script setup lang="ts">
/**
 * Popover 是 Dropdown 的一层「带标题的卡片」预设。
 *
 * 定位、方向、箭头、触发方式、受控开关、外部锚点全部来自 Dropdown，
 * 所以 Dropdown 支持的配置这里都能用，两者行为一致。
 * 传 bare 则去掉库内卡片外观，由默认插槽自己画面板。
 */
import { nextTick, ref, watch } from 'vue'
import { focusFirst } from '../../shared/dom'
import Dropdown from '../dropdown/Dropdown.vue'
import type { DropdownProps } from '../dropdown/types'
import type { PopoverProps } from './types'
import './popover.css'

defineOptions({ name: 'MckPopover' })

const props = withDefaults(defineProps<PopoverProps>(), {
  modelValue: false,
  placement: 'bottom-start',
  offset: 8,
  title: '',
  description: '',
  width: '320px',
  maxWidth: 'calc(100vw - 24px)',
  disabled: false,
  closeOnOutside: true,
  closeOnEscape: true,
  trigger: 'click',
  hoverCloseDelay: 150,
  anchor: null,
  appendTo: 'body',
  arrow: false,
  menuHeight: '',
  layout: 'overlay-scroll',
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const dropdown = ref<InstanceType<typeof Dropdown> | null>(null)
/**
 * 自己记开关。
 * 不能直接把外部 modelValue 透传下去：Dropdown 内部 watch 会在 emit 后
 * 拿旧值把 open 拉回去（打开后立刻关掉），所以这里维护一份真实状态。
 */
const open = ref(props.modelValue)

/** 除外观之外的 Dropdown 配置原样透传，保证两套 API 不漂移。 */
const dropdownProps = (): Partial<DropdownProps> => ({
  anchorPlacement: props.placement,
  anchor: props.anchor,
  offset: props.offset,
  trigger: props.trigger,
  hoverCloseDelay: props.hoverCloseDelay,
  appendTo: props.appendTo,
  arrow: props.arrow,
  menuHeight: props.menuHeight,
  menuMaxWidth: props.maxWidth,
  menuWidth: props.width,
  layout: props.layout,
  disabled: props.disabled,
  // Popover 自己就是完整卡片：外壳只负责定位，不叠加库内面板外观。
  bare: true,
  closeOnOutside: props.closeOnOutside,
  closeOnEscape: props.closeOnEscape,
  menuRole: 'dialog',
})

function onOpenChange(value: boolean): void {
  open.value = value
  emit('update:modelValue', value)
  if (value) nextTick(() => focusFirst(dropdown.value?.panelRef ?? null))
}

function close(): void {
  dropdown.value?.hide()
}

/**
 * 外部 v-model 变化时同步给 Dropdown；Dropdown 自己也会维护内部开关，
 * 所以父级不传 v-model（非受控）时依然能点开。
 */
watch(
  () => props.modelValue,
  (value) => {
    open.value = value
  },
)
</script>

<template>
  <Dropdown
    ref="dropdown"
    :model-value="open"
    v-bind="dropdownProps()"
    @update:model-value="onOpenChange"
  >
    <template #trigger>
      <!--
        只把「打开状态」给插槽用于样式。
        不能再把 toggle 绑到插槽里的按钮上：Dropdown 的外层触发区已经绑了 onClick，
        按钮自己再调一次 toggle 会连开带关（实测：点一下打开又立刻关掉）。
      -->
      <slot name="trigger" :open="open" />
    </template>

    <template #default="{ close: closeSlot }">
      <div class="mck-popover__panel">
        <header v-if="title || $slots.header" class="mck-popover__head">
          <slot name="header">
            <div>
              <strong class="mck-popover__title">{{ title }}</strong>
              <p v-if="description" class="mck-popover__desc">{{ description }}</p>
            </div>
          </slot>
          <button type="button" class="mck-popover__close" aria-label="关闭" title="关闭" @click="closeSlot()">×</button>
        </header>
        <div class="mck-popover__body"><slot :close="closeSlot" /></div>
        <footer v-if="$slots.footer" class="mck-popover__foot"><slot name="footer" :close="closeSlot" /></footer>
      </div>
    </template>
  </Dropdown>
</template>
