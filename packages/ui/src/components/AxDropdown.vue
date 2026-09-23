<script setup lang="ts">
// AxDropdown —— 通用下拉容器（思路照 web2api 的 AxDropdown：@floating-ui/vue 定位 +
// Teleport 到 body + 点击外部/Esc 关闭 + Transition 入场）。
// 差异只在样式：用本项目的画布暗色 token（#262626 面板 / #363636 边框）。
//
// 用法：
//   <AxDropdown v-model="open" placement="bottom-start">
//     <template #trigger="{ toggle }"><button @click="toggle">…</button></template>
//     <template #default="{ close }"><button @click="close">…</button></template>
//   </AxDropdown>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { useFloating } from './hooks/useFloating'
import { useTeleportTarget } from './hooks/useTeleportTarget'

export type DropdownTrigger = 'click' | 'hover' | 'contextmenu'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    placement?: string
    offset?: number
    matchWidth?: boolean
    /** click 左键 | hover 悬停 | contextmenu 右键 */
    trigger?: DropdownTrigger
    hoverCloseDelay?: number
    menuWidth?: string
    menuMaxWidth?: string
    /** 菜单外层 class（与默认样式合并） */
    menuClass?: string
    /** 内容区 padding class */
    bodyClass?: string
    teleport?: boolean
    /** 是否显示小箭头（指向触发器） */
    arrow?: boolean
    /** 对齐触发器的哪条边：start=左缘对齐 / center=中心对齐（默认）/ end=右缘对齐 */
    align?: 'start' | 'center' | 'end'
  }>(),
  {
    modelValue: false,
    placement: 'bottom-start',
    offset: 6,
    matchWidth: false,
    trigger: 'click',
    hoverCloseDelay: 150,
    menuWidth: '',
    menuMaxWidth: '',
    menuClass: '',
    bodyClass: 'p-1',
    teleport: true,
    arrow: true,
    align: 'center',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const teleportTarget = useTeleportTarget()
const containerRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const arrowRef = ref<HTMLElement | null>(null)
const closeTimer = ref<ReturnType<typeof setTimeout> | null>(null)

// 支持无 v-model 的 uncontrolled 用法
const isOpen = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => {
    isOpen.value = v
  },
)

const { floatingStyles, isPositioned, middlewareData, placement } = useFloating(triggerRef, menuRef, {
  placement: props.placement,
  align: props.align,
  offset: computed(() => props.offset),
  matchWidth: computed(() => props.matchWidth),
  arrowRef: props.arrow ? arrowRef : undefined,
})

/** 箭头位置：动态轴由 middlewareData.arrow 给，静态轴由 placement 决定 */
const staticSideMap: Record<string, string> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

const menuStyle = computed(() => {
  const base: Record<string, string> = isPositioned.value
    ? { ...(floatingStyles.value as Record<string, string>) }
    : { position: 'fixed', left: '-9999px', top: '-9999px' }
  if (props.menuWidth) base.minWidth = props.menuWidth
  if (props.menuMaxWidth) base.maxWidth = props.menuMaxWidth
  return base
})

/** 箭头偏移：与 AxTooltip 同算法 */
const arrowStyle = computed(() => {
  const d = middlewareData.value?.arrow
  const side = placement.value?.split('-')[0] ?? 'bottom'
  // 旋转 45° 后，哪些原边会露在外面（决定画哪两条边框，才能和菜单边框接上）
  const visibleEdges: Record<string, string[]> = {
    bottom: ['top', 'left'],
    top: ['bottom', 'right'],
    left: ['top', 'right'],
    right: ['left', 'bottom'],
  }
  const style: Record<string, string> = {
    position: 'absolute',
    [staticSideMap[side] ?? 'top']: '-5.5px',
    width: '10px',
    height: '10px',
    background: 'var(--ui-panel)',
    transform: 'rotate(45deg)',
  }
  for (const e of visibleEdges[side] ?? ['top', 'left']) style['border' + e[0].toUpperCase() + e.slice(1)] = '1px solid var(--ui-line)'
  if (d) {
    if (d.x != null) style.left = d.x + 'px'
    if (d.y != null) style.top = d.y + 'px'
  }
  return style
})

function clearCloseTimer(): void {
  if (closeTimer.value) {
    clearTimeout(closeTimer.value)
    closeTimer.value = null
  }
}
function open(): void {
  clearCloseTimer()
  isOpen.value = true
  emit('update:modelValue', true)
}
function close(): void {
  clearCloseTimer()
  isOpen.value = false
  emit('update:modelValue', false)
}
function toggle(): void {
  isOpen.value = !isOpen.value
  emit('update:modelValue', isOpen.value)
}
function scheduleClose(): void {
  clearCloseTimer()
  closeTimer.value = setTimeout(close, props.hoverCloseDelay)
}

const triggerEvents = computed(() => {
  switch (props.trigger) {
    case 'hover':
      return { onMouseenter: open, onMouseleave: scheduleClose }
    case 'contextmenu':
      return { onContextmenu: (e: MouseEvent) => { e.preventDefault(); open() } }
    default:
      return { onClick: toggle }
  }
})

const panelEvents = computed(() =>
  props.trigger === 'hover' ? { onMouseenter: clearCloseTimer, onMouseleave: close } : {},
)

onClickOutside(containerRef, (e) => {
  if (menuRef.value?.contains(e.target as Node)) return
  if (isOpen.value) close()
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isOpen.value) close()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  clearCloseTimer()
})
</script>

<template>
  <div ref="containerRef" class="axd-root">
    <div ref="triggerRef" v-bind="triggerEvents">
      <slot name="trigger" :open="isOpen" :toggle="toggle" :close="close" />
    </div>

    <Teleport :to="teleportTarget" :disabled="!teleport">
      <Transition name="axd">
        <div
          v-if="isOpen"
          ref="menuRef"
          :style="menuStyle"
          v-bind="panelEvents"
          :class="['axd-menu', menuClass, bodyClass]"
          role="menu"
        >
          <span v-if="props.arrow" ref="arrowRef" :style="arrowStyle" class="axd-arrow" aria-hidden="true" />
          <slot :close="close" />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style>
/* 非 scoped：菜单被 Teleport 到 body，scoped 选择器命不中。 */
.axd-root { position: relative; display: inline-block; text-align: left; }
.axd-menu {
  position: fixed;
  z-index: 100000;
  min-width: 180px;
  padding: 6px;
  color: var(--ui-ink);
  border: 1px solid var(--ui-line);
  border-radius: 16px;
  background: var(--ui-panel);
  box-shadow: var(--ui-shadow-md);
  backdrop-filter: blur(20px);
}
.axd-arrow { z-index: 1; pointer-events: none; }
.axd-enter-active { transition: opacity .14s ease-out, transform .14s ease-out; }
.axd-leave-active { transition: opacity .1s ease-in, transform .1s ease-in; }
.axd-enter-from, .axd-leave-to { opacity: 0; transform: scale(.96) translateY(-4px); }
@media (prefers-reduced-motion: reduce) {
  .axd-enter-active, .axd-leave-active { transition: none; }
}
</style>
