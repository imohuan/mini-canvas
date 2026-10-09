<script setup lang="ts">
// AxSubMenu —— 菜单里的**二级菜单**（用组件嵌套，而不是手写浮层）。
//
// 为什么必须是一个组件、而不是在调用方拼一个绝对定位的 div：
//   二级菜单要和一级菜单共用同一套「浮层互斥 + 关闭广播」的契约，还要自己算方位、翻转、
//   防出屏、跟着父菜单滚动重定位。这些 AxDropdown 已经做过一遍 —— 这里只把「谁是我的锚点」
//   从触发按钮换成一个 div（我们渲染出来的那一行），其余规则完全一致。
//
// 用法（放在 AxMenu 里的一行）：
//   <AxSubMenu label="移动到" :items="[{ key: '', label: '个人资产库' }, ...]" @pick="onPick" />

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { useFloating } from './hooks/useFloating'
import { useTeleportTarget } from './hooks/useTeleportTarget'
import { floatingChainOf } from './hooks/floatingGroup'
import {
  SUB_MENU_CLOSE_EVENT,
  broadcastSubMenuOpen,
  DROPDOWN_CLOSE_ALL_EVENT,
} from '@mini-canvas/canvas-render'

export interface AxSubMenuItem {
  key: string
  label: string
  /** 左侧缩进（层级/深度），px */
  indent?: number
  /** 选中态（带勾） */
  active?: boolean
}

const props = withDefaults(
  defineProps<{
    label: string
    items: AxSubMenuItem[]
    /** 展开方向：right（默认，往右）| left */
    side?: 'right' | 'left'
    /** 菜单最小宽度 */
    menuWidth?: string
    menuMaxHeight?: string
    /** 行尾的 › 提示（默认显示；菜单要求"全部不带图标"时可关掉） */
    hint?: boolean
  }>(),
  { side: 'right', menuWidth: '180px', menuMaxHeight: '320px', hint: true },
)
const emit = defineEmits<{ pick: [key: string] }>()

const teleportTarget = useTeleportTarget()
const rowRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const closeTimer = ref<ReturnType<typeof setTimeout> | null>(null)
/** 本实例的唯一 id（用于「只关兄弟、不关自己」的广播判定） */
const selfId = 'submenu-' + Math.random().toString(36).slice(2)

const { floatingStyles, isPositioned } = useFloating(rowRef, menuRef, {
  placement: computed(() => props.side),
  align: 'start',
  offset: 4,
})

/**
 * 本二级面板的「浮层链」= 父面板链 + 自己：写进面板的 data-floating-chain。
 * 这样父级下拉的「点外部」判定会把自己派生出去的子面板认作**组内**，
 * 不会先把自己关掉、连带把子面板卸载掉（用户报的「嵌套菜单无法点击」的根因）。
 */
const chain = computed(() => [...floatingChainOf(rowRef.value), selfId].join(' '))

const menuStyle = computed(() => {
  const base: Record<string, string> = isPositioned.value
    ? { ...(floatingStyles.value as Record<string, string>) }
    : { position: 'fixed', left: '-9999px', top: '-9999px' }
  base.minWidth = props.menuWidth
  base.maxHeight = 'min(' + props.menuMaxHeight + ', calc(100vh - 16px))'
  return base
})

function clearTimer(): void {
  if (closeTimer.value) {
    clearTimeout(closeTimer.value)
    closeTimer.value = null
  }
}
function open(): void {
  clearTimer()
  isOpen.value = true
}
/** 选中某一项：交给调用方处理，然后收起面板 */
function pick(key: string): void {
  emit('pick', key)
  isOpen.value = false
}
/**
 * 延迟关闭。到点再确认一次「鼠标是否还悬在行或面板里」才真关。
 *
 * 为什么需要这个守卫（用户报的「移动到点了没反应」的真根因）：
 *   行在左、面板在右，两者之间有一小段**不属于任一元素**的空隙。真实鼠标从行移到面板要花时间，
 *   原来的 160ms 延迟太短 —— 手还在半路，面板就关了，菜单项根本点不到。
 *   （合成事件瞬间派发，从不经过这段空隙，所以旧测试测不出来。）
 */
function scheduleClose(): void {
  clearTimer()
  closeTimer.value = setTimeout(() => {
    if (rowRef.value?.matches(':hover') || menuRef.value?.matches(':hover')) return
    isOpen.value = false
  }, 400)
}
/**
 * 点击只**开**不关（hover 之外的第二条路径：触屏 / 键盘）。
 * 不能做成 toggle：鼠标用户悬停已展开，再点一下会立刻收起 —— 看着像"点了没用"。
 * 收起交给 mouseleave / 选中某项 / 外层关闭。
 */
function openByClick(): void {
  clearTimer()
  isOpen.value = true
}
/** 面板里的自定义内容点完后由调用方决定关不关（图标网格点选后不关，方便连点） */
function close(): void {
  isOpen.value = false
}
defineExpose({ open, close, pick })

watch(isOpen, (v) => {
  if (v) broadcastSubMenuOpen(selfId)
})

/** 兄弟/父级菜单关闭广播：detail 为 null（父级关）或别人的 id（兄弟开）→ 自己收 */
function onSubMenuClose(e: Event): void {
  const keep = (e as CustomEvent<string | null>).detail
  if (keep !== selfId && isOpen.value) isOpen.value = false
}
/** 一级菜单互斥广播（别的下拉打开）：二级跟随父级一起收 */
function onCloseAll(): void {
  if (isOpen.value) isOpen.value = false
}

onMounted(() => {
  window.addEventListener(SUB_MENU_CLOSE_EVENT, onSubMenuClose)
  window.addEventListener(DROPDOWN_CLOSE_ALL_EVENT, onCloseAll)
})
onBeforeUnmount(() => {
  window.removeEventListener(SUB_MENU_CLOSE_EVENT, onSubMenuClose)
  window.removeEventListener(DROPDOWN_CLOSE_ALL_EVENT, onCloseAll)
  clearTimer()
})
</script>

<template>
  <div ref="rowRef" class="ax-sub-row" @mouseenter="open()" @mouseleave="scheduleClose()">
    <div class="ax-menu-item" role="menuitem" aria-haspopup="menu" :aria-expanded="isOpen" @click="openByClick">
      <slot name="label">{{ label }}</slot>
      <ChevronRight v-if="hint" class="ax-menu-hint" :size="12" aria-hidden="true" />
    </div>
  </div>

  <Teleport :to="teleportTarget">
    <div
      v-if="isOpen"
      ref="menuRef"
      :data-floating-chain="chain"
      :style="menuStyle"
      class="dd-menu ax-sub-menu"
      role="menu"
      @mouseenter="clearTimer()"
      @mouseleave="scheduleClose()"
    >
      <slot :pick="pick" :close="close">
        <button
          v-for="it in items"
          :key="it.key"
          class="ax-menu-item"
          role="menuitem"
          :class="{ 'is-active': it.active }"
          :style="it.indent ? { paddingLeft: it.indent + 'px' } : undefined"
          @click="pick(it.key)"
        >{{ it.label }}</button>
      </slot>
    </div>
  </Teleport>
</template>

<style>
/* 非 scoped：浮层 teleport 到 body；类名沿用设计系统的 .dd-menu / .ax-menu-item 公开契约。 */
.ax-sub-row { display: flex; }
.ax-sub-menu { min-width: 160px; }
.ax-sub-menu .ax-menu-item { min-height: 32px; }
</style>
