<script setup lang="ts">
// RowMenuShell —— 树行的「⋯」操作菜单**外壳**（资产树与画布树共用）。
//
// ## 为什么要有这个组件（用户口径 2026-10-08）
//
// 「当前在左侧边栏的资产面板中，这些文件夹和资源都支持右键菜单。现在，希望画布这边也支持右键菜单 ——
//  因为当前这里只有在 hover 点击后面的按钮时，显示的那个按钮才可以触发。」
//
// 而资产侧那套「⋯ 按钮 + 行右键打开**同一份**菜单」的机制，此前是写死在 AssetTree.vue 里的
// （行 ref 登记表 + contextMenuFor + openAt 转交）。画布树要再抄一遍就会长成第二份实现 ——
// 这正是本项目反复吃过的亏（历史上缩略图 / 预览 / 菜单动作都各漂移过）。
//
// ## 职责边界（只做外壳，不做内容）
// - **本组件管**：菜单浮层（AxDropdown）+ 行内「⋯」触发器 + 「行右键也开同一份菜单」的 openAt；
// - **调用方管**：菜单里有哪些条目（默认插槽，自己摆 AxMenuItem / AxSubMenu）。
//   两棵树的条目本就不同（资产有「移动到 / 更改图标 / 设置标签」，画布节点有「定位 / 解散分组」），
//   硬塞成一份要么靠一堆 if，要么把两边都阉掉 —— 所以内容留给调用方，机制收在这里。
//
// ## 用法
// ```vue
// <RowMenuShell :ref="(el) => bindRowMenu(row.id, el)" :name="row.name">
//   <AxMenuItem @click="...">重命名</AxMenuItem>
// </RowMenuShell>
// ```
// 行上：`@contextmenu="openMenuAt(row.id, $event)"` —— 宿主把每个 shell 的 openAt 收进一张表。
import { ref } from 'vue'
import AxDropdown from './AxDropdown.vue'
import AxMenu from './AxMenu.vue'

const props = withDefaults(
  defineProps<{
    /** 行名（用于「更多操作 <名字>」的无障碍名 —— 读屏要能分清这是哪一行的菜单） */
    name: string
    /** 菜单最小宽度 */
    menuWidth?: string
    /** 触发器的浮层方位（宫格卡片与列表行的可用空间不同，可换） */
    placement?: string
  }>(),
  { menuWidth: '180px', placement: 'bottom-end' },
)

const open = ref(false)
/** 浮层实例：行右键唤出时借它的「鼠标点锚点」能力（翻转 / 防溢出 / 互斥 / 关闭规则全照旧） */
const dropdownRef = ref<{ openAtPoint: (x: number, y: number) => void } | null>(null)

/**
 * 在鼠标点处打开（行右键用）。
 *
 * 为什么转交 AxDropdown 而不是自己定位一个 div：同一份菜单要能从两个入口打开
 * （「⋯」按钮 / 行右键），位置锚、翻转、防溢出、浮层互斥、点外关闭这些规则只有一套实现，
 * 转交才能保证两个入口行为完全一致（复制一份定位逻辑必然漂移）。
 */
function openAt(x: number, y: number): void {
  dropdownRef.value?.openAtPoint(x, y)
}
defineExpose({ openAt })
</script>

<template>
  <AxDropdown ref="dropdownRef" v-model="open" :placement="placement" :offset="4" :menu-width="menuWidth">
    <template #trigger>
      <!-- 触发器与资产树行尾那颗逐字同款（size-6 / 圆角 lg / hover 才可见）。
           显隐靠父行的 group/row —— 两棵树的行都已经是这个 class，不额外加开关。 -->
      <button
        class="grid size-6 flex-none place-items-center rounded-lg text-ink-dim opacity-0 transition-opacity hover:bg-hover hover:text-ink group-hover/row:opacity-100 focus-visible:opacity-100"
        :aria-label="'更多操作 ' + name"
        :aria-expanded="open"
      ><slot name="trigger"><span class="text-[13px] leading-none">⋯</span></slot></button>
    </template>
    <template #default="{ close }">
      <!-- @click.stop：点在菜单里不该冒泡去触发行自身的点击（比如画布行的「定位」） -->
      <AxMenu @click.stop><slot :close="close" /></AxMenu>
    </template>
  </AxDropdown>
</template>
