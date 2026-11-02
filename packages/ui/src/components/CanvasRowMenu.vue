<script setup lang="ts">
// CanvasRowMenu —— 左侧「画布」树里一行的操作菜单（分组行 / 节点行共用）。
//
// 外壳共用 RowMenuShell（浮层 + 「⋯」触发器 + 行右键 openAt）；条目各写：
// 画布节点有「定位 / 解散分组」，资产那侧另有「移动到 / 图标 / 标签」。
// 本组件只发事件、不做动作，动作由宿主（LeftDrawer）执行。
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import RowMenuShell from './RowMenuShell.vue'

const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuSeparator = useUiComponent('DropdownMenuSeparator')

withDefaults(
  defineProps<{
    /** 这一行是分组还是普通节点（决定菜单里有哪几条） */
    kind: 'group' | 'node'
    name: string
    /** 触发器方位：列表行贴行尾（bottom-end）；宫格卡片空间不同，由宿主给 */
    placement?: string
  }>(),
  { placement: 'bottom-end' },
)

const emit = defineEmits<{
  rename: []
  locate: []
  duplicate: []
  addAgent: []
  ungroup: []
  remove: []
}>()

const shellRef = ref<{ openAt: (x: number, y: number) => void } | null>(null)
/** 行右键：转交外壳，两个入口共享同一份菜单。 */
function openAt(x: number, y: number): void {
  shellRef.value?.openAt(x, y)
}
defineExpose({ openAt })
</script>

<template>
  <RowMenuShell ref="shellRef" :name="name" :placement="placement" menu-width="176px">
    <template #default="{ close }">
      <DropdownMenuItem @select="emit('locate'); close()">定位到节点</DropdownMenuItem>
      <DropdownMenuItem @select="emit('rename'); close()">重命名</DropdownMenuItem>

      <DropdownMenuItem v-if="kind === 'group'" @select="emit('ungroup'); close()">解散分组</DropdownMenuItem>
      <template v-else>
        <DropdownMenuItem @select="emit('duplicate'); close()">复制一份</DropdownMenuItem>
        <DropdownMenuItem @select="emit('addAgent'); close()">添加到 Agent</DropdownMenuItem>
      </template>

      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" @select="emit('remove'); close()">删除</DropdownMenuItem>
    </template>
  </RowMenuShell>
</template>
