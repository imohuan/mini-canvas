<script setup lang="ts">
import type { PopoverRootEmits, PopoverRootProps } from 'reka-ui'
import { PopoverRoot, useForwardPropsEmits } from 'reka-ui'
import { usePopupExclusive, usePopupOpenState } from '../../../theme/popup/exclusive'

const props = defineProps<PopoverRootProps>()
const emits = defineEmits<PopoverRootEmits>()

/**
 * 受控开合 + 全局互斥：Popover 打开时收起别的下拉。
 * 参数面板（ToolParamGroup）、取色器都走这一个根组件。
 */
/** reka 的 emits 是重载联合类型，这里收窄成单一签名再交给 helper。 */
const emitOpen = (value: boolean): void => {
  ;(emits as unknown as (event: string, value: boolean) => void)('update:open', value)
}
const open = usePopupOpenState(props, emitOpen)
usePopupExclusive(open, () => {
  if (open.value) open.value = false
})

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <PopoverRoot
    v-slot="slotProps"
    data-slot="popover"
    v-bind="forwarded"
    v-model:open="open"
  >
    <slot v-bind="slotProps" />
  </PopoverRoot>
</template>
