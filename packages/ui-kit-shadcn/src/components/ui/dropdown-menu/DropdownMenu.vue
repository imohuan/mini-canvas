<script setup lang="ts">
import type { DropdownMenuRootEmits, DropdownMenuRootProps } from 'reka-ui'
import { DropdownMenuRoot, useForwardPropsEmits } from 'reka-ui'
import { usePopupExclusive, usePopupOpenState } from '../../../popup/exclusive'

/**
 * 菜单默认非模态。
 *
 * reka-ui 的默认值是 `modal: true`：菜单一开就禁用菜单外所有元素的指针事件，
 * 于是「菜单 A 开着时点按钮 B」的第一次点击只关 A，B 不响应（用户实测：
 * 素材库开着时点「移动」，要点两下才出菜单）。非模态后外部点击照常落到按钮上，
 * 由业务侧的互斥登记表负责关旧菜单，一次点击即可切换。
 * 需要模态行为（如嵌在 Dialog 里）时显式传 `:modal="true"` 即可。
 */
const props = withDefaults(defineProps<DropdownMenuRootProps>(), { modal: false })
const emits = defineEmits<DropdownMenuRootEmits>()

/**
 * 受控开合 + 全局互斥（用户口径 2026-11-03：「两个下拉可以同时打开」）。
 *
 * `open` 交给我们自己的 state，才能让别的浮层打开时把它关掉；
 * 调用点继续写 `v-model:open` / `open` 都照常工作。
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
  <DropdownMenuRoot
    v-slot="slotProps"
    data-slot="dropdown-menu"
    v-bind="forwarded"
    v-model:open="open"
  >
    <slot v-bind="slotProps" />
  </DropdownMenuRoot>
</template>
