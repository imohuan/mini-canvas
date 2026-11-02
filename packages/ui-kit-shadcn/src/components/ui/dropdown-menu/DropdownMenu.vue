<script setup lang="ts">
import type { DropdownMenuRootEmits, DropdownMenuRootProps } from 'reka-ui'
import { DropdownMenuRoot, useForwardPropsEmits } from 'reka-ui'

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

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <DropdownMenuRoot
    v-slot="slotProps"
    data-slot="dropdown-menu"
    v-bind="forwarded"
  >
    <slot v-bind="slotProps" />
  </DropdownMenuRoot>
</template>
