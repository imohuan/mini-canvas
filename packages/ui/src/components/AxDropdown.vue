<script setup lang="ts">
// AxDropdown —— **全局唯一**的通用下拉容器（触发器 + 浮层菜单）。
//
// 为什么它必须是唯一的一份（用户口径，2026-10-03）：
//   「你那个 drop down 组件，我看到好像你有多个实现方式啊……你必须在 package UI 这个库里
//    进行 drop down 组件的注册。因为如果两个地方同时注册，优先级最高的地方会优先使用……
//    那么你其他地方就可以正常地使用原来的这个组件，它会自动变成最新版本的」
//
// 于是：实现只此一份（本文件）；注册由 uiDropdownPlugin 写进 registryOf('ui') 的 dropdown 键，
// order 比主题默认件小 → 顶替它。所有 useUiComponent('dropdown') 的插件与成品应用自己的
// 底栏 / 状态栏 / 左抽屉都用这一份。
//
// 用法（两个插槽 + 一个「要不要箭头」的开关，就这么点东西）：
//   <AxDropdown v-model="open" placement="bottom-start">
//     <template #trigger="{ toggle }"><button @click="toggle">…</button></template>
//     <template #default="{ close }"><button @click="close">…</button></template>
//   </AxDropdown>
//   arrow 默认 true；不想要小尖角就 :arrow="false"。
//
// 其余 props（placement / offset / menuWidth / trigger / layout…）与主题默认件逐条对齐，
// 调用方换实现不用改代码。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import {
  claimDropdownExclusive,
  releaseDropdown,
  DROPDOWN_CLOSE_ALL_EVENT,
} from '@mini-canvas/canvas-render'
import { useFloating } from './hooks/useFloating'
import { useTeleportTarget } from './hooks/useTeleportTarget'

export type DropdownTrigger = 'click' | 'hover' | 'contextmenu'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    /** 方位：bottom / top / bottom-start / bottom-end ……（后缀不再决定对齐，对齐看 align，默认居中） */
    placement?: string
    offset?: number
    matchWidth?: boolean
    /** click 左键 | hover 悬停 | contextmenu 右键 */
    trigger?: DropdownTrigger
    hoverCloseDelay?: number
    menuWidth?: string
    menuMaxWidth?: string
    /** 浮层最大高度（超出滚动）；不写也会夹在视口内（calc(100vh - 16px)） */
    menuMaxHeight?: string
    /** 菜单外层 class（与默认样式合并） */
    menuClass?: string
    /** 内容区 class（与默认样式合并） */
    bodyClass?: string
    teleport?: boolean
    /** 要不要小箭头（贴着菜单的那条边上，居中）。默认开 */
    arrow?: boolean
    /** 内容对触发器的对齐：center=居中（默认，箭头指哪内容就居中在哪）| start=左缘 | end=右缘 */
    align?: 'start' | 'center' | 'end' | 'auto'
    /** 浮层 role（默认 menu；选项列表用 listbox） */
    menuRole?: string
    /**
     * 浮层的滚动结构：
     *   'overlay-scroll'（默认）= 整个浮层滚（内容一起滚，适合短菜单 / 单选列表）；
     *   'inner-scroll'          = 浮层只当外框（flex 列、不滚），**内容区自己滚**。
     *
     * 为什么要分两种：需要「顶部标题固定、只有下面列表滚」的结构时，若仍让整个浮层滚，
     * 就只能用 sticky 之类去补 —— 那是绕，不是对的结构
     * （用户口径：上下是 flex 布局，只有下面内容滚动的地方才显示滚动条）。
     */
    layout?: 'overlay-scroll' | 'inner-scroll'
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
    menuMaxHeight: '',
    menuClass: '',
    bodyClass: '',
    teleport: true,
    arrow: true,
    menuRole: 'menu',
    layout: 'overlay-scroll',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const teleportTarget = useTeleportTarget()
const containerRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const closeTimer = ref<ReturnType<typeof setTimeout> | null>(null)

// 支持无 v-model 的 uncontrolled 用法
const isOpen = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => {
    isOpen.value = v
  },
)

/**
 * 对齐：默认（auto）= 内容**居中于触发器** —— 箭头指着触发器，菜单跟着箭头居中，
 * 这才是"下拉"该有的样子。placement 里的 -start/-end 后缀不参与对齐；
 * 真要贴左/右缘的调用方显式传 align="start" / "end"。
 */
const effectiveAlign = computed<'start' | 'center' | 'end'>(() => {
  if (props.align && props.align !== 'auto') return props.align
  return 'center'
})

const { floatingStyles, isPositioned, placement } = useFloating(triggerRef, menuRef, {
  placement: computed(() => props.placement.split('-')[0] ?? 'bottom'),
  align: effectiveAlign,
  offset: computed(() => props.offset),
  matchWidth: computed(() => props.matchWidth),
})

const menuStyle = computed(() => {
  const base: Record<string, string> = isPositioned.value
    ? { ...(floatingStyles.value as Record<string, string>) }
    : { position: 'fixed', left: '-9999px', top: '-9999px' }
  if (props.menuWidth) base.minWidth = props.menuWidth
  if (props.menuMaxWidth) base.maxWidth = props.menuMaxWidth
  // 限高与"视口内可用高度"取小：调用方给的内联值优先级最高，不用 min() 收一下会顶出屏幕外
  base.maxHeight = 'min(' + (props.menuMaxHeight || '100vh') + ', calc(100vh - 16px))'
  return base
})

/** 箭头坐标：贴着菜单的那条边**居中**。fixed 定位（菜单滚动时箭头不会跟着跑）。 */
const arrowStyle = computed(() => {
  const side = placement.value?.split('-')[0] ?? 'bottom'
  const base = floatingStyles.value as Record<string, string>
  const ml = Number.parseFloat(base.left ?? '') || 0
  const mt = Number.parseFloat(base.top ?? '') || 0
  const menu = menuRef.value
  const mw = menu ? menu.offsetWidth : 0
  const mh = menu ? menu.offsetHeight : 0
  const HALF = 5
  // 居中取菜单自己的中线（mw / 2），不是触发器中心：菜单多为 -start 对齐（从按钮往左铺开），
  // 用触发器中心会把它挤到最左边，看着像"箭头指向左侧"。
  // 也不用 floating-ui 的 arrow 中间件：它按打开那一刻的尺寸算，而 menuWidth 是 min-width，
  // 中文文案会把菜单撑宽，那个偏移随即失准。
  let cx: number
  let cy: number
  if (side === 'right') {
    cx = ml
    cy = mt + mh / 2
  } else if (side === 'left') {
    cx = ml + mw
    cy = mt + mh / 2
  } else {
    // bottom = 箭头贴菜单**上缘**；top = 贴**下缘**。横向一律居中
    cx = ml + mw / 2
    cy = side === 'top' ? mt + mh : mt
  }
  // 旋转 45° 后，哪些原边会露在外面（决定画哪两条边框，才能和菜单边框接上）
  const visibleEdges: Record<string, string[]> = {
    bottom: ['top', 'left'],
    top: ['bottom', 'right'],
    left: ['top', 'right'],
    right: ['left', 'bottom'],
  }
  const style: Record<string, string> = {
    position: 'fixed',
    left: cx - HALF + 'px',
    top: cy - HALF + 'px',
    width: '10px',
    height: '10px',
    background: 'var(--ui-panel)',
    transform: 'rotate(45deg)',
  }
  for (const e of visibleEdges[side] ?? ['top', 'left']) style['border' + e[0].toUpperCase() + e.slice(1)] = '1px solid var(--ui-line)'
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

/** 「都不关了」广播：拖拽/缩放这类环境变化的时刻，谁开着的谁收（见 dropdownExclusive 注释） */
function onCloseAll(): void {
  if (isOpen.value) close()
}

// 同屏只留一个浮层：打开时先把别的关掉。登记表与主题默认件共用同一份
// （@mini-canvas/canvas-render 的 contracts/dropdownExclusive）。
watch(isOpen, (v) => {
  if (v) claimDropdownExclusive(close)
  else releaseDropdown(close)
})

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  window.addEventListener(DROPDOWN_CLOSE_ALL_EVENT, onCloseAll)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener(DROPDOWN_CLOSE_ALL_EVENT, onCloseAll)
  clearCloseTimer()
  releaseDropdown(close)
})
</script>

<template>
  <div ref="containerRef" class="axd-root">
    <div ref="triggerRef" class="axd-trigger" v-bind="triggerEvents">
      <slot name="trigger" :open="isOpen" :toggle="toggle" :close="close" />
    </div>

    <Teleport :to="teleportTarget" :disabled="!teleport">
      <Transition name="axd">
        <div
          v-if="isOpen"
          ref="menuRef"
          :style="menuStyle"
          v-bind="panelEvents"
          :class="['dd-menu', menuClass, bodyClass, props.layout === 'inner-scroll' ? 'dd-menu--inner-scroll' : '']"
          :role="menuRole"
        >
          <slot :close="close" />
        </div>
      </Transition>
      <!-- 箭头放浮层**外面**（兄弟节点）：它要探出菜单边缘才像"小尖角"，
           留在菜单里会把那几 px 算进菜单的可滚溢出，inner-scroll 的「只有列表区滚」就破了。 -->
      <span
        v-if="props.arrow && isOpen && isPositioned"
        :style="arrowStyle"
        class="axd-arrow"
        aria-hidden="true"
      />
    </Teleport>
  </div>
</template>

<style>
/* 非 scoped：菜单被 Teleport 到 body，scoped 选择器命不中。
   浮层类名沿用 dd-menu / dd-menu--inner-scroll：这是「设计系统 dropdown」的公开契约 ——
   本组件就是顶替主题默认件的那一份，调用方与浏览器回归都按这两个名字认它。 */
.axd-root { position: relative; display: inline-flex; text-align: left; }
/* 触发器是 .axd-root（inline-flex）的 flex 项目：宿主把 root 拉宽时它也跟着宽
   （与主题默认件的 .dd-trigger 同一条理由——参数下拉给到 148px 时触发器不该只画 99px）。 */
.axd-trigger { display: block; flex: 1 1 auto; min-width: 0; }
.dd-menu {
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
  overflow-y: auto;
  /* 横向一律不滚：浮层宽度由调用方定，内容不该把它撑出横向滚动条 */
  overflow-x: hidden;
  scrollbar-width: thin;
}
/* inner-scroll：浮层只当**外框**，自己不滚；由内容区自己滚。
   这样「顶部标题固定 + 下面列表滚」是天然的 flex 上下分栏，不需要 sticky 去补。
   min-height:0 是让内部 flex 子项能真正收缩（否则内容会把高度顶回去、滚动不触发）。 */
.dd-menu--inner-scroll {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: hidden;
}
.dd-menu--inner-scroll > * { min-height: 0; }
/* 与浮层同层（100000）：箭头挂在 body 下，层级低了会被画布图层盖住（菜单看得见、箭头看不见）。
   DOM 在浮层之后 → 同层时压在浮层之上。 */
.axd-arrow { z-index: 100000; pointer-events: none; }
.axd-enter-active { transition: opacity .14s ease-out, transform .14s ease-out; }
.axd-leave-active { transition: opacity .1s ease-in, transform .1s ease-in; }
.axd-enter-from, .axd-leave-to { opacity: 0; transform: scale(.96) translateY(-4px); }
@media (prefers-reduced-motion: reduce) {
  .axd-enter-active, .axd-leave-active { transition: none; }
}
</style>
