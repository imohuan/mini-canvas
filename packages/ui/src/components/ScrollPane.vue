<script setup lang="ts">
/**
 * ScrollPane —— 应用内的滚动容器，底座是组件库的 shadcn ScrollArea。
 *
 * 为什么还要这一层（而不是各处直接写 ScrollArea）：
 * 1. 滚动事件要转发：Vue 会把组件上的 @scroll 当自定义事件消费；ScrollArea 没声明它，
 *    外层的触底加载 / 滚动位置记忆就永远收不到。这里显式转发内部 viewport 的原生 scroll。
 * 2. 滚动入口要能拿到：生成历史要读写 scrollTop（切页签恢复位置），需要真实的滚动元素。
 * 3. 给一个稳定的 data 标记，调用方不必依赖 shadcn 内部的 DOM 结构。
 *
 * 它不含任何业务样式：尺寸 / padding 仍由调用方的 class 与 body-class 决定。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { SCROLL_VIEWPORT_SELECTOR } from './scrollPane'

const ScrollArea = useUiComponent('ScrollArea')

withDefaults(
  defineProps<{
    /** 滚动方向：y 纵向 / x 横向 / both 双向 */
    direction?: 'x' | 'y' | 'both'
    /** 内容层额外 class（padding / gap 等布局样式放这里） */
    bodyClass?: string
  }>(),
  { direction: 'y', bodyClass: '' },
)

const emit = defineEmits<{ (e: 'scroll', payload: Event): void }>()

/** 外层普通 div：ScrollArea 组件挂在里面，DOM 查询从这层向下找，不碰组件实例。 */
const rootRef = ref<HTMLElement | null>(null)
/** 真正的滚动层（shadcn ScrollArea 的 viewport） */
const viewport = ref<HTMLElement | null>(null)

function syncViewport(): void {
  const el = rootRef.value?.querySelector<HTMLElement>(SCROLL_VIEWPORT_SELECTOR) ?? null
  if (el === viewport.value) return
  viewport.value?.removeEventListener('scroll', onScroll)
  viewport.value = el
  if (!el) return
  el.dataset.scrollPaneView = ''
  el.addEventListener('scroll', onScroll, { passive: true })
}

function onScroll(e: Event): void {
  emit('scroll', e)
}

onBeforeUnmount(() => {
  viewport.value?.removeEventListener('scroll', onScroll)
})

// ScrollArea 的内容是插槽里动态挂的：viewport 首帧就有，但热更新 / 重新挂载后要重接一次。
watch(rootRef, (el) => {
  if (el) syncViewport()
}, { flush: 'post' })
onMounted(syncViewport)

/**
 * 给调用方一个稳定的滚动元素入口。
 * 生成历史的「记住 scrollTop / 切回来恢复」用它，不必知道 shadcn 内部类名。
 */
function scrollElement(): HTMLElement | null {
  return viewport.value
}

defineExpose({ scrollElement })
</script>

<template>
  <!--
    外层 div 只用来拿真实 DOM。以前 ref 放在 ScrollArea 组件上，拿到的是组件实例，
    实例没有 querySelector，于是打开 Agent 面板就抛 `querySelector is not a function`。
    横向滚动条由 ScrollArea 自己按 overflow 方向显示，不再单独取 ScrollBar。
  -->
  <div ref="rootRef" class="scroll-pane" :class="'scroll-pane--' + direction">
    <ScrollArea class="size-full">
      <div :class="bodyClass" data-scroll-pane-body>
        <slot />
      </div>
    </ScrollArea>
  </div>
</template>

<style scoped>
/* 调用方一直用 min-h-0 flex-1 让它吃满剩余高度；缺了高度约束就不滚。 */
.scroll-pane {
  min-height: 0;
  overflow: hidden;
}

.scroll-pane :deep([data-slot='scroll-area']) {
  height: 100%;
}

.scroll-pane--x :deep([data-slot='scroll-area-viewport']) {
  overflow-x: auto;
  overflow-y: hidden;
}

.scroll-pane--y :deep([data-slot='scroll-area-viewport']) {
  overflow-y: auto;
  overflow-x: hidden;
}

.scroll-pane--both :deep([data-slot='scroll-area-viewport']) {
  overflow: auto;
}
</style>

