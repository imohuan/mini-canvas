<script setup lang="ts">
import type { TabsListProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { TabsListVariants } from '.'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import { TabsList } from 'reka-ui'
import { tabsListVariants } from '.'

const props = withDefaults(defineProps<TabsListProps & {
  class?: HTMLAttributes['class']
  variant?: TabsListVariants['variant']
  /**
   * 选中项底下那条「胶囊」是否滑动过去。
   * 默认开：切换页签时用一个 absolute 的圆角底板从旧位置滑到新位置，
   * 而不是瞬间换一块白底。只影响观感，无障碍/键盘仍是 reka 那套。
   */
  animated?: boolean
}>(), {
  variant: 'default',
  animated: true,
})

const delegatedProps = reactiveOmit(props, 'class', 'variant', 'animated')

/* —— 滑动胶囊：位置与宽度都按真实矩形量 ——
   为什么不写 CSS 百分比：各页签名长短不一（「全部画布」/「图片 67」），
   全局字号档、字体设置还会改宽度，百分比和固定值都对不准。
   量的是「选中项相对列表」的左偏移与宽度，交给 transform/width 做过渡。 */
const rootEl = ref<InstanceType<typeof TabsList> | null>(null)
const capsuleLeft = ref(0)
const capsuleWidth = ref(0)
const capsuleHeight = ref(0)
const capsuleTop = ref(0)
const capsuleVisible = ref(false)
let observer: ResizeObserver | undefined
let frame = 0

/**
 * 列表根节点。
 *
 * reka 的 TabsList 是**组件**（不是原生元素），模板 ref 拿到的可能是组件实例，
 * 直接拿去 observe/getBoundingClientRect 会抛「parameter 1 is not of type 'Element'」。
 * 所以这里在实例上取 `$el`，两种形态都兜住；拿不到再退回组件内部查一次。
 */
function listElement(): HTMLElement | null {
  const raw = rootEl.value as unknown
  if (!raw) return null
  if (raw instanceof HTMLElement) return raw
  const el = (raw as { $el?: unknown }).$el
  if (el instanceof HTMLElement) return el
  return document.querySelector<HTMLElement>('[data-slot="tabs-list"]')
}

function measure(): void {
  const list = listElement()
  if (!list || !props.animated) return
  const active = list.querySelector<HTMLElement>('[data-state="active"]')
  if (!active) {
    // 「再点一次取消选中」这类空状态：直接收起，别停在旧位置
    capsuleVisible.value = false
    return
  }
  const listRect = list.getBoundingClientRect()
  const rect = active.getBoundingClientRect()
  // 弹窗还没显示 / 列表被 display:none 时宽度为 0，先别定值，免得胶囊跳到左上角
  if (!rect.width) return
  // 单看选中项矩形还不够：列表若是 static 定位（被别的样式覆盖掉），胶囊的绝对定位会
  // 跑到最近的定位祖先上去，看起来就「没有胶囊」。这种情况先量，再把原因打出来。
  if (typeof getComputedStyle === 'function' && getComputedStyle(list).position === 'static') {
    console.warn('[tabs] TabsList 的 position 被覆盖成 static，滑动胶囊无法定位，请检查外层样式')
  }
  capsuleLeft.value = rect.left - listRect.left
  capsuleWidth.value = rect.width
  // 高度也按选中项量：列表有 4px 内边距，写死 calc(100% - 2px) 会让胶囊顶到外框上
  capsuleHeight.value = rect.height
  capsuleTop.value = rect.top - listRect.top
  capsuleVisible.value = true
}

/** 同一帧内多次触发（缩放 + 选中变化）合并成一次量 */
function scheduleMeasure(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    measure()
  })
}

function observeChildren(): void {
  const list = listElement()
  if (!list || typeof ResizeObserver === 'undefined') return
  observer?.disconnect()
  observer = new ResizeObserver(scheduleMeasure)
  observer.observe(list)
  // 只观察真正的元素：插槽里可能有注释/文本节点，直接 observe 会抛
  // 「parameter 1 is not of type 'Element'」，一抛整个测量就停了（实测就是这样没量出来）。
  for (const el of Array.from(list.children)) {
    if (el instanceof Element) observer.observe(el)
  }
}

onMounted(() => {
  if (!props.animated) return
  try {
    observeChildren()
    scheduleMeasure()
    // 首次挂载时子项可能还没量完宽（字体加载 / 尺寸档切换），下一帧再补一次
    nextTick(scheduleMeasure)
  } catch (err) {
    // 量不出来只影响动画，不能让整个页签列表挂掉（弹窗打不开才是真事故）
    console.warn('[tabs] 滑动胶囊初始化失败，已退回静态选中态：', err)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = undefined
  if (frame) cancelAnimationFrame(frame)
})

watch(() => capsuleVisible.value, () => scheduleMeasure())

/*
 * 点击切换后立刻重量一次。
 *
 * 只靠 ResizeObserver 不够（实测 2026-11-04）：换选中项时两个页签的**尺寸都没变**，
 * observer 不会触发，胶囊就停在上一个位置。这里监听列表的点击，等 DOM 的
 * data-state 落定（nextTick）后再量，动画由 CSS transition 补上。
 */
function onListClick(): void {
  void nextTick(() => {
    measure()
    // 有的容器会在一帧后才完成布局（弹窗动画/字体回填），再补一帧
    scheduleMeasure()
  })
}
</script>

<template>
  <TabsList
    ref="rootEl"
    data-slot="tabs-list"
    :data-variant="variant"
    :data-animated="animated ? '' : undefined"
    v-bind="delegatedProps"
    :class="cn(tabsListVariants({ variant }), 'cn-tabs-list-animated', props.class)"
    @click="onListClick"
  >
    <!-- 滑动胶囊：只在 default 变体（有底分段样式）下有意义；line 变体用下划线，胶囊隐掉 -->
    <span
      v-if="animated && variant !== 'line'"
      class="cn-tabs-capsule"
      :style="{
        opacity: capsuleVisible ? '1' : '0',
        width: capsuleWidth + 'px',
        height: capsuleHeight + 'px',
        transform: 'translate(' + capsuleLeft + 'px, ' + capsuleTop + 'px)',
      }"
      aria-hidden="true"
    />
    <slot />
  </TabsList>
</template>

<style scoped>
/*
 * 胶囊的位置/宽度由脚本写进内联 style，动画放在这里，
 * 这样页面重渲染、开关弹窗都不会把它重置成静态。
 */
.cn-tabs-list-animated {
  /* 胶囊是 absolute 定位，列表必须是它的定位祖先。
     只靠 Tailwind 的 relative 不够稳（别处的样式可能把它覆盖回 static），
     所以这里用组件自己的类兜住，与胶囊同一份样式表。 */
  position: relative;
}

/*
 * 胶囊的位置/宽度由脚本写进内联 style，动画放在这里，
 * 这样页面重渲染、开关弹窗都不会把它重置成静态。
 * z-index 给 0：胶囊当「底」，页签文字在它上面（页签自己是定位元素，会盖住它）。
 *
 * 颜色必须用宿主的「选中底」token（--ui-panel-active / --ui-hover），
 * 不能用 --background：本项目主题里 --background 接近纯白，暗色下会变成一块死白色块
 * （2026-11-04 实测截图就是那样）。没有 token 时才退回半透明 hover 底。
 */
.cn-tabs-capsule {
  position: absolute;
  top: 0;
  left: 0;
  /* 宽、高、位置全部由脚本按选中项的真实矩形写入（含列表内边距），这里不写死任何尺寸 */
  border-radius: 9999px;
  background: var(--ui-tab-capsule, var(--ui-panel-active, var(--ui-hover, rgb(255 255 255 / 0.14))));
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
  pointer-events: none;
  will-change: transform, width;
  z-index: 0;
  transition:
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    width 220ms cubic-bezier(0.22, 1, 0.36, 1),
    height 220ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 140ms linear;
}

/*
 * 胶囊在底下当「被选中的底」，所以选中项自己不再画底，否则两层底会叠出深色块。
 * 只清底色和描边，文字颜色仍交给 TabsTrigger 自己的 data-active 规则。
 */
.cn-tabs-list-animated[data-animated] :deep([data-slot='tabs-trigger'][data-state='active']) {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

/* 用户要求减少动态效果时不滑，直接跳到位 */
@media (prefers-reduced-motion: reduce) {
  .cn-tabs-capsule { transition: none; }
}
</style>
