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

const align = computed<'start' | 'center' | 'end'>(() => {
  const suffix = props.placement.split('-')[1]
  return suffix === 'start' || suffix === 'center' ? suffix : 'end'
})

/**
 * 在鼠标点处打开（行右键用）。
 *
 * 用 reka 的 **虚拟锚点**（`reference`）表达"鼠标点"，而不是把真实触发器挪过去：
 * 挪触发器会带来两个真实 bug —— 关闭后坐标残留（下一次点「⋯」仍出现在旧位置）、
 * 以及 1×1 触发器挡住鼠标下的元素。虚拟锚点只在这次打开期间生效，关闭即失效。
 *
 * 右键与「⋯」共用同一个 DropdownMenu 实例与同一份条目，只是锚点来源不同。
 */
const point = ref<{ x: number; y: number } | null>(null)

/** reka 的 reference 取一个"有尺寸的矩形"：用鼠标点当作左上角，宽高 1px */
const virtualRef = computed(() => {
  const p = point.value
  if (!p) return undefined
  return {
    getBoundingClientRect: () => ({
      x: p.x,
      y: p.y,
      left: p.x,
      top: p.y,
      right: p.x,
      bottom: p.y,
      width: 1,
      height: 1,
      toJSON: () => ({}),
    }),
  } as unknown as HTMLElement
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
      <span class="rms-trigger" :class="{ 'is-at-point': !!point }">
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
      :reference="virtualRef"
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
 * 右键入口：菜单用虚拟锚点定位到鼠标点，这里只把原来的⋯触发器临时收成 1×1 藏在
 * 指针下方，避免它在右键位置闪一下；关闭后恢复成正常按钮（point 已清空）。
 */
.rms-trigger.is-at-point {
  position: fixed;
  left: 0;
  top: 0;
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
