<script setup lang="ts">
// CanvasRowMenu —— 左侧「画布」树里一行的操作菜单（分组行 / 节点行共用）。
//
// 用户口径（2026-10-08）：「当前在左侧边栏的资产面板中，这些文件夹和资源都支持右键菜单。
//  现在希望画布这边也支持右键菜单 —— 因为当前这里只有在 hover 点击后面的按钮时才可以触发。」
//
// 与资产侧的对应关系：
// - **外壳共用**（RowMenuShell：浮层 + 「⋯」触发器 + 行右键 openAt）—— 两边机制同一份；
// - **条目各写**（这里放画布节点能做的事）：资产有「移动到 / 更改图标 / 设置标签」，
//   画布节点没有这些概念，反过来画布有「定位 / 解散分组」。
//
// 一律**只发事件、不做动作**：动作要读画布数据（doc / selection / 命令），
// 那是宿主（LeftDrawer）的活 —— 组件保持"只画菜单"，与 AssetRowMenu 同一分工。
import { ref } from 'vue'
import RowMenuShell from './RowMenuShell.vue'
import AxMenuItem from './AxMenuItem.vue'

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

/** 外壳实例：行右键要借它的 openAt（在鼠标点开同一份菜单） */
const shellRef = ref<{ openAt: (x: number, y: number) => void } | null>(null)
/**
 * 转发给宿主：行右键 → openAt(鼠标坐标)。
 *
 * 为什么要在本组件再包一层：宿主拿到的是 **CanvasRowMenu 的实例引用**
 * （模板里 `:ref` 绑在它身上），外壳藏在它内部。多这一层转发，宿主那一侧就与资产树
 * （AssetTree 里 AssetRowMenu 的 openAt 转交）写法完全一致，两边的接线代码长得一样。
 */
function openAt(x: number, y: number): void {
  shellRef.value?.openAt(x, y)
}
defineExpose({ openAt })
</script>

<template>
  <RowMenuShell
    ref="shellRef"
    :name="name"
    :placement="placement"
    menu-width="176px"
  >
    <template #default="{ close }">
      <!-- 定位：与行内那颗「定位」按钮同一件事（把节点在画布上居中） -->
      <AxMenuItem @click="emit('locate'); close()">定位到节点</AxMenuItem>
      <AxMenuItem @click="emit('rename'); close()">重命名</AxMenuItem>

      <!-- 分组：解散；节点：复制一份 / 引用到 Agent -->
      <AxMenuItem v-if="kind === 'group'" @click="emit('ungroup'); close()">解散分组</AxMenuItem>
      <template v-else>
        <AxMenuItem @click="emit('duplicate'); close()">复制一份</AxMenuItem>
        <AxMenuItem @click="emit('addAgent'); close()">添加到 Agent</AxMenuItem>
      </template>

      <div class="my-1 h-px bg-line"></div>
      <AxMenuItem danger @click="emit('remove'); close()">删除</AxMenuItem>
    </template>
  </RowMenuShell>
</template>
