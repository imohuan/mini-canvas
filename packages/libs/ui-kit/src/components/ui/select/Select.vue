<script setup lang="ts">
import type { SelectRootEmits, SelectRootProps } from 'reka-ui'
import { SelectRoot, useForwardPropsEmits } from 'reka-ui'
import { usePopupExclusive, usePopupOpenState } from '../../../theme/popup/exclusive'

const props = defineProps<SelectRootProps>()
const emits = defineEmits<SelectRootEmits>()

/** 受控开合 + 全局互斥：Select 打开时收起别的下拉（用户口径 2026-11-03）。 */
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
  <SelectRoot
    v-slot="slotProps"
    data-slot="select"
    v-bind="forwarded"
    v-model:open="open"
  >
    <slot v-bind="slotProps" />
  </SelectRoot>
</template>
