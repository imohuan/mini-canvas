<script setup lang="ts">
import type { ComboboxRootEmits, ComboboxRootProps } from 'reka-ui'
import { ComboboxRoot, useForwardPropsEmits } from 'reka-ui'
import { usePopupExclusive, usePopupOpenState } from '../../../theme/popup/exclusive'

const props = defineProps<ComboboxRootProps>()
const emits = defineEmits<ComboboxRootEmits>()

/** 受控开合 + 全局互斥：可搜索组合框打开时收起别的下拉。 */
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
  <ComboboxRoot
    v-slot="slotProps"
    data-slot="combobox"
    v-bind="forwarded"
    v-model:open="open"
  >
    <slot v-bind="slotProps" />
  </ComboboxRoot>
</template>
