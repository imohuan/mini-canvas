<script setup lang="ts">
// RowMenuShell —— 树行的「⋯」操作菜单**外壳**（资产树与画布树共用）。
//
// 本组件管：DropdownMenu 浮层 + 行内「⋯」触发器 + 行右键 openAt；
// 调用方管：菜单里有哪些条目（默认插槽，自己摆 shadcn 的 Item / Sub）。
// 右键与「⋯」两个入口共用同一个菜单实例与同一份条目，避免两套定位逻辑漂移。
import { computed, nextTick, ref, watch } from 'vue'
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
 * 锚点是一个 **Teleport 到 body** 的 1×1 空 span（见模板里的 .rms-anchor）。
 *
 * 为什么不在原地挪行尾那个触发器（2026-11-05 用户截图实测）：它的包装 span 带
 * -translate-y-1/2，**任何带 transform 的祖先都会成为 fixed 后代的包含块**，
 * left/top 于是从相对窗口变成相对那一小格，菜单落点整体偏出去一大截
 * （鼠标在 x=291，菜单却出现在 x=570）。
 *
 * 为什么不用 reference 传伪造对象（同一次实测）：floating-ui 取参考矩形走模块内函数，
 * 伪造对象的 getBoundingClientRect 不会被调用，菜单落在 (0,0)。
 * Teleport 到 body 后没有 transform 祖先，用真实元素做 reference 才可靠。
 */
const point = ref<{ x: number; y: number } | null>(null)
const anchorEl = ref<HTMLElement | null>(null)

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
  /* 等锚点 span 落定再开菜单：同一 tick 打开时 Content 首帧读到的 reference 还是空的 */
  void nextTick(() => {
    open.value = true
  })
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
      :reference="point ? anchorEl ?? undefined : undefined"
      class="rms-menu"
      :style="{ minWidth: menuWidth }"
    >
      <slot :close="() => (open = false)" />
    </DropdownMenuContent>
    <!--
      右键锚点：挂到 body，避免被抽屉里的 transform 改掉包含块。
      常驻不 v-if（首帧定位要立刻拿到元素）；没有右键点时挪到视口外，不占位、不遮挡。
    -->
    <Teleport to="body">
      <span
        ref="anchorEl"
        class="rms-anchor"
        :style="point ? { left: point.x + 'px', top: point.y + 'px' } : undefined"
        aria-hidden="true"
      />
    </Teleport>
  </DropdownMenu>
</template>

<style scoped>
.rms-trigger { display: inline-flex; }
/* 右键入口：原触发器临时收成 1×1，避免在鼠标下闪一下（真正定位靠 body 里的锚点） */
.rms-trigger.is-at-point {
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
/* 右键锚点：fixed 相对窗口（挂在 body 下，没有 transform 祖先） */
.rms-anchor {
  position: fixed;
  left: -9999px;
  top: -9999px;
  width: 1px;
  height: 1px;
  pointer-events: none;
  opacity: 0;
}
.rms-menu {
  padding: 4px;
  border-radius: var(--mct-radius, 16px);
  background: var(--ui-overlay-solid, #fff);
}
</style>
