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
const capsuleVisible = ref(false)
let observer: ResizeObserver | undefined
let frame = 0

/** 列表根节点（reka 的 TabsList 渲染成 div，模板 ref 拿到的就是元素） */
function listElement(): HTMLElement | null {
  const el = rootEl.value as unknown as HTMLElement | null
  return el ?? null
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
  capsuleLeft.value = rect.left - listRect.left
  capsuleWidth.value = rect.width
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
  for (const el of Array.from(list.children)) observer.observe(el)
}

onMounted(() => {
  if (!props.animated) return
  observeChildren()
  scheduleMeasure()
  // 首次挂载时子项可能还没量完宽（字体加载 / 尺寸档切换），下一帧再补一次
  nextTick(scheduleMeasure)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = undefined
  if (frame) cancelAnimationFrame(frame)
})

watch(() => capsuleVisible.value, () => scheduleMeasure())
</script>

<template>
  <TabsList
    ref="rootEl"
    data-slot="tabs-list"
    :data-variant="variant"
    :data-animated="animated ? '' : undefined"
    v-bind="delegatedProps"
    :class="cn(tabsListVariants({ variant }), 'cn-tabs-list-animated', props.class)"
  >
    <!-- 滑动胶囊：只在 default 变体（有底分段样式）下有意义；line 变体用下划线，胶囊隐掉 -->
    <span
      v-if="animated && variant !== 'line'"
      class="cn-tabs-capsule"
      :style="{
        opacity: capsuleVisible ? '1' : '0',
        width: capsuleWidth + 'px',
        transform: 'translateX(' + capsuleLeft + 'px)',
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
.cn-tabs-capsule {
  position: absolute;
  top: 1px;
  left: 0;
  height: calc(100% - 2px);
  border-radius: 9999px;
  background: var(--ui-tab-capsule, var(--background, #fff));
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
  pointer-events: none;
  will-change: transform, width;
  transition:
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    width 220ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 140ms linear;
}

/*
 * 胶囊在底下当「被选中的底」，所以选中项自己不再画底，否则两层底会叠出深色块。
 * 只清底色和描边，文字颜色仍交给 TabsTrigger 自己的 data-active 规则。
 */
.cn-tabs-list-animated[data-animated] :deep([data-slot='tabs-trigger'][data-state='active']) {
  background: transparent;
  border-color: transparent;
}

/* 用户要求减少动态效果时不滑，直接跳到位 */
@media (prefers-reduced-motion: reduce) {
  .cn-tabs-capsule { transition: none; }
}
</style>
