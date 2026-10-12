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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import {
  claimDropdownExclusive,
  releaseDropdown,
  DROPDOWN_CLOSE_ALL_EVENT,
} from '@mini-canvas/canvas-render'
import { useFloating } from './hooks/useFloating'
import { useTeleportTarget } from './hooks/useTeleportTarget'
import { isInFloatingGroup } from './hooks/floatingGroup'

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
    /**
     * 把它当成**另一个浮层的子浮层**（父浮层传来的组链 + 开关状态）。
     *
     * 用户口径（2026-10-09）：「触发这个菜单的时候，你的画布的这个菜单消失了」——
     * 画布下拉里点行尾「⋯」弹操作菜单，**列表本身要留着**，两个浮层并排。
     *
     * 为什么需要这个开关（默认行为是「同屏只留一个浮层」）：
     * - 打开时不 claim 排他 —— claim 会把父浮层（列表）当场关掉，而它正是要留着的那个；
     * - 面板的组链写成「父链 + 自己」，于是父浮层的「点外关闭」会把子面板算作**组内**，不关父；
     *   反过来，点子浮层自己的判定仍只看自己的 id：点父列表（换画布那一块）只关子菜单，
     *   点真正的浮层之外两个都关。
     * - 父浮层关掉时子浮层跟着关（不然会剩一个没有爹的孤儿菜单挂在屏幕上）。
     *
     * 传 undefined = 普通（独立）下拉，行为完全不变。
     */
    nestedIn?: () => { chain: string; open: boolean } | undefined
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
    nestedIn: undefined,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const teleportTarget = useTeleportTarget()
const containerRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const closeTimer = ref<ReturnType<typeof setTimeout> | null>(null)

/**
 * 右键打开用的**鼠标点锚点**（null = 用默认的触发器锚点）。
 *
 * 为什么需要：同一份菜单既要从「⋯」按钮点开（锚在按钮上），也要能被行的右键唤出（锚在鼠标点）。
 * 不这么做就得在两处各绘一次浮层 —— 那正是用户要求避免的重复。
 * 用一个 0×0 的行内元素当锚：它跟着浮层一起 living，触发的 autoUpdate / 翻转 / 箭头逻辑与
 * 真实触发器完全一致，不需要给 floating-ui 喂虚拟元素（那会破坏 whileElementsMounted 的自动更新）。
 */
const contextAnchor = ref<HTMLElement | null>(null)
/** 右键唤出的鼠标点（null = 没有，走默认触发器锚点） */
const contextPoint = ref<{ x: number; y: number } | null>(null)
/** 浮层锚点：右键唤出时用鼠标点锚，否则用触发器 */
const floatAnchorRef = computed<HTMLElement | null>(() => (contextPoint.value ? contextAnchor.value : triggerRef.value))
/** 右键坐标锚点的定位（0×0，贴在鼠标点上） */
const contextAnchorStyle = computed<Record<string, string | undefined>>(() =>
  contextPoint.value
    ? { position: 'fixed', left: contextPoint.value.x + 'px', top: contextPoint.value.y + 'px', width: '0', height: '0', pointerEvents: 'none' }
    : { display: 'none' },
)

/**
 * 在鼠标点处打开（右键菜单用）：把锚点挪到该坐标，再按常规流程开。
 * 位置锚是真实 DOM（0×0），所以翻转 / 防溢出 / 箭头 / autoUpdate 全部照旧生效。
 */
function openAtPoint(x: number, y: number): void {
  contextPoint.value = { x, y }
  open()
  // 已经开着时（行尾「⋯」从这一行换到另一行）锚点坐标变了，必须重算一次：
  // autoUpdate 只在**参考元素自己**移动/缩放时触发，光改 left/top 不触发重定位
  // （实测：换行后菜单留在原处）。
  void nextTick(() => updatePosition())
}

/**
 * 本浮层的组 id（写进面板的 data-floating-chain，供子浮层续链 + 点外判定用）。
 * 二级/三级菜单的面板链会写成「父链 + 自己的 id」，所以任一级判定「是不是点在我这一组里」
 * 都只需看链里有没有自己的 id（见 hooks/floatingGroup.ts）。
 */
const chainId = 'dd-' + Math.random().toString(36).slice(2)

// ===== 子浮层（挂在另一个浮层旁边）=====
const nestedCtx = computed(() => props.nestedIn?.())
/** 父浮层的组链（空 = 这不是子浮层） */
const parentChain = computed(() => nestedCtx.value?.chain ?? '')
const isNested = computed(() => parentChain.value !== '')
/**
 * 写进面板的组链：子浮层 = 「父链 + 自己」。
 * 父浮层的点外判定读到的就是这条链 —— 含父 id 就说明「这点还在我这一组里」，父菜单不关。
 */
const panelChain = computed(() => (isNested.value ? parentChain.value + ' ' + chainId : chainId))

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
  // 右键唤出：锚点就是光标本身（0×0），菜单左上角贴着光标展开 —— 这是右键菜单的通行手感。
  // （只有这时才强制 start；其它情况仍按 props.align，保持既有下拉的对齐行为不变）
  if (contextPoint.value) return 'start'
  if (props.align && props.align !== 'auto') return props.align
  return 'center'
})

/** 右键唤出的浮层偏移：0（菜单直接贴光标），其余沿用 props.offset */
const effectiveOffset = computed(() => (contextPoint.value ? 0 : props.offset))

const { floatingStyles, isPositioned, placement, updatePosition } = useFloating(floatAnchorRef, menuRef, {
  placement: computed(() => props.placement.split('-')[0] ?? 'bottom'),
  align: effectiveAlign,
  offset: effectiveOffset,
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
    // bottom = 箭头贴菜单**上缘**；top = 贴**下缘**。
    // 横向位置**跟 align 走**（原先写死取菜单中线，左对齐时菜单左移、箭头还留在中间，看着"没对齐"）：
    //   start  → 贴菜单左缘内缩（箭头尖对着触发器的左对齐边）
    //   end    → 贴菜单右缘内缩
    //   center → 菜单中线（老行为）
    const PAD = 14 // 离菜单边角的距离（避免箭头压在圆角上）
    const a = effectiveAlign.value
    cx = a === 'start' ? ml + PAD
      : a === 'end' ? ml + mw - PAD
        : ml + mw / 2
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

/**
 * 点外部关闭。判定用**整组浮层**（触发器 + 自己的面板 + 自己派生出去的子浮层）。
 *
 * 为什么不能只看 containerRef / menuRef：二级菜单是 teleport 到 body 的**独立浮层**，
 * DOM 上不在父面板里。只看这两处的话，点在二级菜单项上会被判成「点了外面」——
 * 于是父菜单先被关掉、二级菜单随父一起卸载，click 派发时目标已脱离文档，
 * Vue 的 click 回调不再触发（用户报的「嵌套菜单无法点击」正是这条链）。
 * 组内谁都不算外面；点真正的外部（含别人家的浮层）才关。
 */
onClickOutside(containerRef, (e) => {
  const node = e.target as Node
  // 子浮层判定用**组链**（含父 id）：点在父面板里时，按点外规则父菜单该关，
  // 但子菜单只该关自己 —— 若拿链判，子菜单会以为「还在我这一组里」而不关（用户实测：点不动）。
  const mine = isNested.value ? chainId : panelChain.value
  if (isInFloatingGroup(node, mine)) return
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
  // 子浮层**不 claim 排他**：claim 会把「别的还开着的」全关掉，而它旁边那个父浮层
  // （画布列表）正是要留着的那个 —— 那正是用户报的「触发这个菜单时画布菜单消失了」。
  if (v && !isNested.value) claimDropdownExclusive(close)
  else releaseDropdown(close)
})

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  window.addEventListener(DROPDOWN_CLOSE_ALL_EVENT, onCloseAll)
  // 子浮层要跟着父浮层一起收：父菜单关了（点外 / Esc / 换画布），孤儿子菜单不能还挂在那儿
  startedWatchParent()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener(DROPDOWN_CLOSE_ALL_EVENT, onCloseAll)
  clearCloseTimer()
  releaseDropdown(close)
})

/** 订阅「父浮层开了没」：父关 → 自己关（只对子浮层生效；普通下拉没有父，watch 是空转） */
let stopParentWatch: (() => void) | undefined
function startedWatchParent(): void {
  stopParentWatch?.()
  stopParentWatch = watch(
    () => isNested.value && nestedCtx.value?.open === false,
    (parentClosed) => {
      if (parentClosed && isOpen.value) close()
    },
  )
}
onBeforeUnmount(() => stopParentWatch?.())

/**
 * 供宿主调用：
 * - `openAtPoint`：在鼠标点打开（行右键菜单那套）；
 * - `isOpen` / `chainId`：给「子浮层」用 —— 父浮层把自己的开关与组链交给子浮层，
 *   子浮层据此加入同一条组链、并在父浮层关掉时跟着收（见 props.nestedIn）。
 */
defineExpose({ openAtPoint, isOpen, chainId })
</script>

<template>
  <div ref="containerRef" class="axd-root">
    <div ref="triggerRef" class="axd-trigger" v-bind="triggerEvents">
      <slot name="trigger" :open="isOpen" :toggle="toggle" :close="close" />
    </div>
    <Teleport :to="teleportTarget" :disabled="!teleport">
      <!--
        右键坐标锚（0×0，贴在鼠标点；只有右键唤出时才参与定位）。

        ⚠️ 它必须待在 Teleport **里面**（跟着菜单一起挂在 body 下），不能留在 .axd-root 里。
        原因（真 bug，2026-10-08 实测）：锚点用 `position: fixed` 表达「鼠标在视口里的绝对坐标」，
        而 CSS 规定 —— **任何非 none 的 transform / translate，或 backdrop-filter 等，
        都会给后代创建一个「包含块」**，后代 fixed 元素于是改以那个祖先为基准。
        画布树的「分组行 / 列表行」操作条容器正是靠 `-translate-y-1/2` 做垂直居中的，
        锚点被关进去后 `left: 28px` 变成「相对那个容器左边 28px」，整块菜单被推到右边
        （实测：鼠标 x=28，菜单落到 x=282；而宫格卡片的操作条没有 translate，落点精确 ——
          用户看到的正是「分组右键菜单位置错了，普通资源的都对」）。
        锚点挂在 body 下就没有这层祖先，left/top 恢复成真正的视口坐标，
        与同样 teleport 到 body 的菜单处在同一坐标系 —— 两者的数学才自洽。
      -->
        <span ref="contextAnchor" :style="contextAnchorStyle" aria-hidden="true" />
      <Transition name="axd">
        <div
          v-if="isOpen"
          ref="menuRef"
          :data-floating-chain="panelChain"
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
        v-if="props.arrow && !contextPoint && isOpen && isPositioned"
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
  /* 内边距 / 圆角 / 底色都走 --dd-* token（值见 canvas-render 的 ui-theme.css，
     与右键菜单 .ctx-menu 对齐：6px / 16px / 不透明白底）。
     为什么必须改成读 token 而不是写死：本组件是**注册件**（顶替主题默认件），
     所有 useUiComponent('dropdown') 的调用方都落到这里 —— 数值写死的话，
     各消费方就只能各自想办法覆盖，又要开始漂移。 */
  padding: var(--dd-padding, 6px);
  color: var(--ui-ink);
  border: 1px solid var(--ui-line);
  border-radius: var(--dd-radius, 16px);
  background: var(--dd-bg, #fff);
  box-shadow: var(--ui-shadow-md);
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
