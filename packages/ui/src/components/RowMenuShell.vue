<script setup lang="ts">
// RowMenuShell —— 树行的「⋯」操作菜单**外壳**（资产树与画布树共用）。
//
// 本组件管：DropdownMenu 浮层 + 行内「⋯」触发器 + 行右键 openAt；
// 调用方管：菜单里有哪些条目（默认插槽，自己摆 shadcn 的 Item / Sub）。
// 右键与「⋯」两个入口共用同一个菜单实例与同一份条目，避免两套定位逻辑漂移。
import { computed, ref, watch } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'

const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')

const props = withDefaults(
  defineProps<{
    /** 行名（用于「更多操作 <名字>」的无障碍名 —— 读屏要能分清这是哪一行的菜单） */
    name: string
    /** 菜单最小宽度 */
    menuWidth?: string
    /** 触发器的浮层方位文字（只用来决定横向对齐：end = 贴右缘） */
    placement?: string
  }>(),
  { menuWidth: '180px', placement: 'bottom-end' },
)

const open = ref(false)

/**
 * 在鼠标点处打开（行右键用）。
 *
 * 做法：右键时把「⋯」触发器本身临时 fixed 到鼠标点（1×1、透明、不接管指针），
 * 菜单仍以这个真实触发器为锚点。
 *
 * 为什么不用 `reference` 虚拟锚点（2026-11-05 实测）：floating-ui 取参考矩形走的是
 * 模块内函数 `getBoundingClientRect(element)`，伪造的对象属性和 `reference` 传参在这条
 * 链路上都没生效 —— 菜单每次都弹到 (0,0)，离鼠标很远。用真实触发器最稳。
 * 关闭后 `point` 清空，触发器回到行尾原位，不会残留坐标。
 */
const point = ref<{ x: number; y: number } | null>(null)

const align = computed<'start' | 'center' | 'end'>(() => {
  /*
   * 右键时从鼠标点**向右**展开。
   *
   * 行尾的「⋯」贴右边，用 end 对齐才对；但右键点可能落在窄抽屉的任意横向位置，
   * 还按 end 对齐就要把 180px 的菜单往左摆，抽屉只有 320px 时会撞到视口边、被夹回 x=0
   * （实测菜单压在左边缘、离鼠标很远）。向右展开在窄栏里最稳。
   */
  if (point.value) return 'start'
  const suffix = props.placement.split('-')[1]
  return suffix === 'start' || suffix === 'center' ? suffix : 'end'
})

function openAt(x: number, y: number): void {
  point.value = { x, y }
  open.value = true
}

/** 关闭（任何来源：选条目 / Esc / 点外）都要清掉鼠标点，否则下一次「⋯」会沿用旧坐标 */
watch(open, (value) => {
  if (!value) point.value = null
})
defineExpose({ openAt })
</script>

<template>
  <DropdownMenu v-model:open="open" :modal="false">
    <DropdownMenuTrigger as-child>
      <span
        class="rms-trigger"
        :class="{ 'is-at-point': !!point }"
        :style="point ? { left: point.x + 'px', top: point.y + 'px' } : undefined"
      >
        <button
          class="grid size-6 flex-none place-items-center rounded-lg text-ink-dim opacity-0 transition-opacity hover:bg-hover hover:text-ink group-hover/row:opacity-100 focus-visible:opacity-100"
          :aria-label="'更多操作 ' + name"
          :aria-expanded="open"
        ><slot name="trigger"><span class="text-[13px] leading-none">⋯</span></slot></button>
      </span>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      :align="align"
      side="bottom"
      :side-offset="4"
      class="rms-menu"
      :style="{ minWidth: menuWidth }"
    >
      <slot :close="() => (open = false)" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<style scoped>
.rms-trigger { display: inline-flex; }
/*
 * 右键入口：触发器临时收成 1×1、挪到鼠标点（left/top 由内联 style 给），
 * 菜单以它为锚点定位。关闭后恢复成行尾的普通按钮（point 已清空）。
 */
.rms-trigger.is-at-point {
  position: fixed;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
.rms-menu {
  padding: 4px;
  border-radius: var(--mct-radius, 16px);
  background: var(--ui-overlay-solid, #fff);
}
</style>
