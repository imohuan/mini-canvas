<script setup lang="ts">
/**
 * Dropdown —— 通用下拉浮层（复刻自 canvas-core/src/components/Ui/AxDropdown.vue）。
 *
 * 用途：任何「触发器 + 浮层菜单」组合：右键菜单 / 选择器 / 弹出面板。
 * 与老版差异：不依赖 Tailwind / @vueuse / @floating-ui，改用本包自己的
 * 浮层定位 + click-outside + 项目统一 UI token（灰阶 + 青色强调 + 内联 SVG）。
 * 动画：入场/关闭 0.12s ease-out（短而直接，不带回弹，避免"跳一下"的观感）。
 *
 * 用法：
 *   <Dropdown v-model="open" placement="bottom-start" :offset="6" :match-width="true">
 *     <template #trigger="{ open, toggle }">…</template>
 *     <template #default="{ close }">…菜单项…</template>
 *   </Dropdown>
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DropdownTrigger } from './types'
// 排他登记表放在独立模块：<script setup> 里的"模块级变量"其实每个实例一份（编译进 setup），
// 那样登记表在实例之间不通、排他失效。详见该文件注释。
import { claimDropdownExclusive, releaseDropdown } from './dropdownRegistry'
import { DROPDOWN_CLOSE_ALL_EVENT } from '@mini-canvas/canvas-render'
// 浮层链判定走**本插件自己那一份**（用户口径 2026-10-15：插件各自独立，不动核心层）。
// 与 @mini-canvas/ui 那份只共享 `data-floating-chain` 这个 DOM 契约。
import { floatingChainOf, isInFloatingGroup } from './floatingChain'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    placement?: string
    offset?: number
    matchWidth?: boolean
    /** 触发方式：click 左键 | hover 悬停 | contextmenu 右键 */
    trigger?: DropdownTrigger
    /** hover 模式下鼠标离开触发器后延迟关闭的时间 (ms) */
    hoverCloseDelay?: number
    menuWidth?: string
    menuMaxWidth?: string
    /**
     * 菜单贴着触发按钮那条边的小箭头（默认关）。
     *
     * 为什么默认关：这件是主题的基础件，被右键菜单 / 选择器 / 参数面板等一堆地方共用，
     * 那些场景本来就不画箭头。要让菜单"指一下按钮"的下拉（如 toolbarDropdown）显式传 true。
     * 与 AxDropdown 的默认值不同（那边默认 true），因为它只服务于"下拉按钮"这一种形态 ——
     * 差异是刻意的：换实现时两边各自的既有观感不变。
     */
    arrow?: boolean
    /** 内容区扩展样式，替换默认内边距 */
    bodyClass?: string
    teleport?: boolean
    /** 浮层最大高度，超出滚动 */
    menuMaxHeight?: string
    /** 浮层 role（默认 menu；选项列表用 listbox） */
    menuRole?: string
    /**
     * 浮层的滚动结构：
     *   'overlay-scroll'（默认）= 整个浮层滚（内容一起滚，适合短菜单 / 单选列表）；
     *   'inner-scroll'          = 浮层只当外框（flex 列、不滚），**内容区自己滚**。
     *
     * 为什么要分两种：需要「顶部标题固定、只有下面列表滚」的结构时，
     * 若仍让整个浮层滚，就只能用 sticky 之类去补 —— 那是绕，不是对的结构
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
    arrow: false,
    bodyClass: '',
    teleport: true,
    menuMaxHeight: '',
    menuRole: 'menu',
    layout: 'overlay-scroll',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const containerRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const closeTimer = ref<ReturnType<typeof setTimeout> | null>(null)

/**
 * 本实例的浮层链 id（父链 + 自己；一级浮层就是 [自己]）。
 *
 * 父链从**触发器所在 DOM** 读：触发器要是长在另一个浮层的面板里（如参数面板里的「格式」下拉），
 * 这里就能认出「我是它的儿子」，claim 时把它放过 —— 否则内层一打开就把外层面板顶掉
 * （用户报的「点内部的下拉时，它触发了外部下拉的关闭」）。
 * 一级浮层读不到链 → 只有自己，行为与改造前一致。
 */
const selfChainId = 'dd-' + Math.random().toString(36).slice(2)
const panelChainIds = computed<string[]>(() => [...floatingChainOf(containerRef.value), selfChainId])
/** 写进面板的组链（与注册件同一契约：子浮层 = 父链 + 自己） */
const panelChain = computed(() => panelChainIds.value.join(' '))

// 内部状态：支持无 v-model 用法（uncontrolled 模式）
const isOpen = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => {
    isOpen.value = v
  },
)

// ---- 浮动定位：fixed + left/top，简单翻转防溢出（不引 floating-ui）----
const pos = ref<{ left: number; top: number; width?: number }>({ left: -9999, top: -9999 })

/**
 * 浮层最大高度：调用方给的 maxHeight 与"视口内可用高度"取小。
 *
 * 为什么不能只写 CSS：调用方给的是内联 maxHeight（如 '280px'），内联样式优先级最高，
 * 纯 CSS 的 calc(100vh - 16px) 会被它盖掉 —— 浮层比视口还高时就顶出屏幕外了。
 * 用 min() 让两者同时生效，无论面板多长都收在视口里滚动。
 */
const menuMaxHeightStyle = computed(() =>
  props.menuMaxHeight
    ? 'min(' + props.menuMaxHeight + ', calc(100vh - 16px))'
    : 'calc(100vh - 16px)',
)

// ---- 小箭头（贴菜单边、指向触发器）----
// 位置跟着 pos 与触发器算，不另存一份状态：面板一重定位，箭头自动跟过去。
const ARROW_HALF = 5
const ARROW_PAD = 14

/** 面板最终落在触发器的哪一侧（含翻转后的结果）——箭头要贴**朝触发器**的那条边 */
const arrowSide = computed<'top' | 'bottom' | 'left' | 'right'>(() => {
  const p = props.placement
  const base = p.split('-')[0]
  if (base === 'left' || base === 'right') return base
  // bottom-* 正常在下方；若 pos.top 已跑到触发器上方（翻转），箭头就贴下缘
  const trig = triggerRef.value
  if (trig && pos.value.top < trig.getBoundingClientRect().top) return 'bottom'
  return 'top'
})

const arrowStyle = computed<Record<string, string>>(() => {
  const menu = menuRef.value
  const trig = triggerRef.value
  // 首帧（含 SSR）：还没有 DOM 尺寸，先给"贴菜单上缘居中"的兜底，
  // 挂载后 computePosition 一跑就会重算成真实位置 —— 不加这个会先闪到屏幕外。
  if (!menu || !trig) {
    return { position: 'fixed', left: 'calc(50% - 5px)', top: '-5px', width: '10px', height: '10px', display: 'none' }
  }
  const tr = trig.getBoundingClientRect()
  const side = arrowSide.value
  // 箭头尖要指着触发器：横向对齐取触发器中心，再夹在菜单两端（避免压到圆角）
  const vertical = side === 'top' || side === 'bottom'
  const center = vertical ? tr.left + tr.width / 2 : tr.top + tr.height / 2
  const menuStart = vertical ? pos.value.left : pos.value.top
  const menuSize = vertical ? menu.offsetWidth : menu.offsetHeight
  const raw = center - menuStart
  const lo = ARROW_PAD
  const hi = Math.max(lo, menuSize - ARROW_PAD)
  const offset = Math.min(Math.max(raw, lo), hi)

  const style: Record<string, string> = {
    position: 'fixed',
    width: '10px',
    height: '10px',
    background: 'var(--dd-bg, #fff)',
    transform: 'rotate(45deg)',
  }
  if (vertical) {
    style.left = pos.value.left + offset - ARROW_HALF + 'px'
    style.top = (side === 'top' ? pos.value.top : pos.value.top + menu.offsetHeight) - ARROW_HALF + 'px'
  } else {
    style.top = pos.value.top + offset - ARROW_HALF + 'px'
    style.left = (side === 'left' ? pos.value.left : pos.value.left + menu.offsetWidth) - ARROW_HALF + 'px'
  }
  // 只画露在外面的两条边（另外两条在菜单内部，画了会有一条线横穿面板）
  const edges: Record<string, [string, string]> = {
    top: ['bottom', 'right'],
    bottom: ['top', 'left'],
    left: ['top', 'right'],
    right: ['bottom', 'left'],
  }
  for (const e of edges[side]) style['border' + e[0].toUpperCase() + e.slice(1)] = '1px solid var(--dd-line, rgba(0,0,0,.08))'
  return style
})
function computePosition(): void {
  const trig = triggerRef.value
  const menu = menuRef.value
  if (!trig || !menu) return
  const tr = trig.getBoundingClientRect()
  const mw = menu.offsetWidth
  const mh = menu.offsetHeight
  const gap = props.offset
  let left = tr.left
  let top = tr.bottom + gap
  const vw = window.innerWidth
  const vh = window.innerHeight

  // 水平：bottom-start（默认）靠左对齐；end 靠右对齐；top-* 系列同理
  const p = props.placement
  if (p === 'bottom-end' || p === 'top-end') left = tr.right - mw
  if (p === 'bottom' || p === 'top') left = tr.left + (tr.width - mw) / 2
  if (p.startsWith('top')) top = tr.top - mh - gap

  // 翻转：下方放不下翻到上方
  if (p.startsWith('bottom') && top + mh > vh - 8 && tr.top - mh - gap > 8) {
    top = tr.top - mh - gap
  }
  // 左右越界收进视口
  if (left + mw > vw - 8) left = Math.max(8, vw - mw - 8)
  if (left < 8) left = 8
  // 上下越界也收进视口（浮层比视口高时，先定位再靠 maxHeight 滚动；
  // 不夹这一下会让浮层顶到屏幕外、底部内容永远看不到）
  if (top + mh > vh - 8) top = Math.max(8, vh - 8 - mh)
  if (top < 8) top = 8

  const out: { left: number; top: number; width?: number } = { left, top }
  if (props.matchWidth) out.width = tr.width
  pos.value = out
}

function open(): void {
  clearCloseTimer()
  isOpen.value = true
  emit('update:modelValue', true)
  nextTick(() => computePosition())
}
function close(): void {
  clearCloseTimer()
  isOpen.value = false
  emit('update:modelValue', false)
}
function toggle(): void {
  if (isOpen.value) close()
  else open()
}

const clearCloseTimer = (): void => {
  if (closeTimer.value) {
    clearTimeout(closeTimer.value)
    closeTimer.value = null
  }
}
const scheduleClose = (): void => {
  clearCloseTimer()
  closeTimer.value = setTimeout(close, props.hoverCloseDelay)
}

// ---- 触发事件 ----
const triggerEvents = computed(() => {
  switch (props.trigger) {
    case 'hover':
      return { onMouseenter: open, onMouseleave: scheduleClose }
    case 'contextmenu':
      return {
        onContextmenu: (e: MouseEvent) => {
          e.preventDefault()
          open()
        },
      }
    case 'click':
    default:
      // click 触发器：单击 = **开/关切换**（与用户直觉一致：再点一下收起）。
      //
      // 为什么是 toggle 而不是只 open：消费方若在内部按钮上写了 @click.stop 自管切换
      // （Select / ColorField 都这样），事件到不了这里、不会重复触发；没写 @click.stop 的
      // 消费方（ToolParamGroup 的触发器）只靠这里，过去只 open 就出现「点得开、点不关」
      // （用户实测：「你这里的下拉还不能点击切换显示隐藏」）。toggle 两边都对。
      return { onClick: toggle }
  }
})

// hover 模式下，鼠标移入面板取消关闭倒计时，移出则关闭
const panelEvents = computed(() => {
  if (props.trigger !== 'hover') return {}
  return { onMouseenter: clearCloseTimer, onMouseleave: close }
})

// ---- 点击外部关闭 ----
function onDocPointerDown(e: PointerEvent): void {
  const target = e.target as Node
  if (containerRef.value?.contains(target)) return
  if (menuRef.value?.contains(target)) return
  // 组内也算「不是外面」：内层浮层（如参数面板里的「格式」下拉）是 teleport 到 body 的
  // 独立元素，DOM 上不在本面板里 —— 只看上面两处，点内层菜单会被判成「点了外面」，
  // 本面板先关、内层随父卸载，click 派发时目标已脱离文档（「嵌套菜单点不动」的老病）。
  // 链里含本实例 id 就说明这一点还在我这一组里。
  if (isInFloatingGroup(target, selfChainId)) return
  if (isOpen.value) close()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isOpen.value) close()
}

/** 「都关了吧」广播：拖拽/缩放这类环境变化时，谁开着的谁收（与全局件同一条广播） */
function onCloseAll(): void {
  if (isOpen.value) close()
}

watch(isOpen, (v) => {
  if (v) {
    // 排他：任何路径（click / hover / contextmenu / 受控 v-model）把它打开时，
    // 先把别的还开着的浮层全关掉 —— 同屏永远只留一个。
    // 把自己那条链交给登记表：它会**放过自己的祖先**（嵌在别人面板里的内层下拉，
    // 不该把外层面板一起关掉）。
    claimDropdownExclusive(close, () => panelChainIds.value)
    nextTick(() => computePosition())
  } else {
    releaseDropdown(close)
  }
})

let ro: ResizeObserver | undefined
onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener(DROPDOWN_CLOSE_ALL_EVENT, onCloseAll)
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (isOpen.value) computePosition()
    })
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener(DROPDOWN_CLOSE_ALL_EVENT, onCloseAll)
  ro?.disconnect()
  clearCloseTimer()
  // 组件没了就别在登记表里留一条指向已销毁实例的 closer（否则下次 open 会去调空实例）
  releaseDropdown(close)
})

watch(isOpen, (v) => {
  if (v && ro && menuRef.value) ro.observe(menuRef.value)
  else if (!v && ro) ro.disconnect()
})
</script>

<template>
  <div ref="containerRef" class="dd">
    <div ref="triggerRef" class="dd-trigger" v-bind="triggerEvents">
      <slot name="trigger" :open="isOpen" :toggle="toggle" :close="close" />
    </div>

    <Teleport to="body" :disabled="!teleport">
      <!-- 直接显示 / 隐藏，无动画；保留 v-if 触发 enter/leave class 以便未来按需接入。 -->
      <div
        v-if="isOpen"
        ref="menuRef"
        class="dd-menu"
        :data-floating-chain="panelChain"
        :class="[bodyClass, props.layout === 'inner-scroll' ? 'dd-menu--inner-scroll' : '']"
        :style="{
          left: pos.left + 'px',
          top: pos.top + 'px',
          minWidth: props.menuWidth || undefined,
          maxWidth: props.menuMaxWidth || undefined,
          maxHeight: menuMaxHeightStyle,
          // 自绘浮层只纵向滚动；横向一律裁掉（内部内容不该把面板撑出横向滚动条）
          overflowX: 'hidden',
        }"
        v-bind="panelEvents"
        :role="menuRole"
      >
        <slot :close="close" />
      </div>
      <!-- 箭头放面板**外面**（兄弟节点）：留在里面会被算进可滚区域，inner-scroll 就破了 -->
      <!-- v-if 只看 arrow + isOpen：位置由 arrowStyle 在挂载后算出（SSR 拿不到 DOM，样式为空但节点在） -->
      <span v-if="isOpen && arrow" :style="arrowStyle" class="dd-arrow" aria-hidden="true" />
    </Teleport>
  </div>
</template>

<style scoped>
.dd {
  position: relative;
  display: inline-flex;
  text-align: left;
}

.dd-trigger {
  display: block;
  /*
   * 它是 .dd（inline-flex）的 flex 项目：默认按内容收缩，宿主把 .dd 拉宽时
   * 触发器却不跟着宽（用户实测：参数下拉给到 148px，触发器只画 99px，看着短一截）。
   * 这里让它撑满 .dd 的可用宽度；.dd 自身没被指定宽度时仍是内容宽，小下拉不受影响。
   */
  flex: 1 1 auto;
  min-width: 0;
}

/* 浮层本体：直接显示 / 隐藏，不做入场/退场动画。 */
.dd-menu {
  position: fixed;
  /* z-index 走画布层叠带变量（--layer-modal，唯一事实源见 canvas-render/contracts/layers.ts） */
  z-index: var(--layer-modal, 100000);
  box-sizing: border-box;
  /* 内边距同样可由消费方用 --dd-padding 覆盖（右键菜单那一档是 6px）。
     理由同下面的圆角：本规则 scoped（[data-v-xxx]，特异性 0,2,0），
     消费方的全局类只写 padding 盖不住它，变量不参与特异性比较。 */
  /* 兜底值 = 右键菜单那一档（6px），与注册件 AxDropdown 用同一组 token
     （真源见 packages/canvas-render/src/styles/ui-theme.css）。 */
  padding: var(--dd-padding, 6px);
  /* 主题变量（--dd-* 由画布主题提供；缺失时回落到改造前的亮色值） */
  border: 1px solid var(--dd-line, rgba(0, 0, 0, 0.08));
  /* 圆角可由消费方的 bodyClass 用 --dd-radius 覆盖（右键菜单那一档是 16）。
     为什么走变量而不是让消费方直接写 border-radius：本规则是 scoped（带 [data-v-xxx]，
     特异性 0,2,0），消费方的全局类只写属性盖不住它 —— 变量不参与特异性比较。 */
  border-radius: var(--dd-radius, 12px);
  background: var(--dd-bg, #fff);
  box-shadow: var(--ui-shadow-md, 0 20px 40px rgba(0, 0, 0, 0.08));
  color: var(--dd-ink, #374151);
  overflow-y: auto;
  /* 横向一律不滚：浮层宽度由调用方定，内容不该把它撑出滚动条（纵向滚动见内联 maxHeight） */
  overflow-x: hidden;
  scrollbar-width: thin;
  font-size: 13px;
  /* 入场：与右键菜单 .ctx-menu 的 ctx-pop 同款（scale .96 + 上移 4px，0.18s 回弹）。
     写成 animation 而不是外层 Transition：浮层是 v-if 直接挂的，加 Transition 要改结构，
     而这里要的只是"出现那一下"的观感。 */
  animation: dd-pop 0.18s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes dd-pop {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dd-menu {
    animation: none !important;
  }
}

/* inner-scroll：浮层只当**外框**，自己不滚；由内容区（如 .ac-menu-scroll）滚。
   这样「顶部标题固定 + 下面列表滚」是天然的 flex 上下分栏，不需要 sticky 去补。
   min-height:0 是让内部 flex 子项能真正收缩（否则内容会把高度顶回去、滚动不触发）。 */
.dd-menu--inner-scroll {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: hidden;
}
.dd-menu--inner-scroll > * {
  min-height: 0;
}

/* 小箭头：与浮层同层，压在浮层之上（DOM 在后）；层级只走 token */
.dd-arrow {
  z-index: var(--layer-modal, 100000);
  pointer-events: none;
}

</style>
