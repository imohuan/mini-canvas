<script setup lang="ts">
/**
 * ScrollPane —— 应用内的滚动容器。
 *
 * 底座是原生溢出的 div，不再是 shadcn ScrollArea（2026-11-03 改，问题 17）：
 * ScrollArea 的滚动条是 reka 自绘的绝对定位滑块，覆盖在内容上面，
 * 行选中高亮 / 卡片边缘会被压住；用户要的是浏览器原生那样单独占一条通道。
 * 原生滚动条 + scrollbar-gutter: stable 正好给出这条通道，样式由全局
 * 滚动条规则统一（6px、低对比）。
 *
 * 这一层仍要保留，因为调用方需要三件事：
 * 1. 滚动事件转发：Vue 会把组件上的 @scroll 当自定义事件，必须先声明再 emit；
 * 2. 真实滚动元素：生成历史要读写 scrollTop（切页签恢复位置）；
 * 3. 稳定的 data 标记，调用方不依赖内部 DOM。
 *
 * 它不含任何业务样式：尺寸 / padding 仍由调用方的 class 与 body-class 决定。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

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

/** 外层普通 div：模板 ref 拿真实 DOM。 */
const rootRef = ref<HTMLElement | null>(null)
/** 真正的滚动层：就是上面这层原生 div，供 scrollTop 读写与触底观察。 */
const viewport = ref<HTMLElement | null>(null)

function syncViewport(): void {
  const el = rootRef.value ?? null
  if (el === viewport.value) return
  viewport.value?.removeEventListener('scroll', onScroll)
  viewport.value = el
  if (!el) return
  el.addEventListener('scroll', onScroll, { passive: true })
}

function onScroll(e: Event): void {
  emit('scroll', e)
}

onBeforeUnmount(() => {
  viewport.value?.removeEventListener('scroll', onScroll)
})

// 热更新 / 重新挂载后要重接一次监听。
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
  <!-- 根节点自己就是滚动层：原生滚动条走全局样式，并靠 scrollbar-gutter 占独立通道。 -->
  <div ref="rootRef" class="scroll-pane" :class="'scroll-pane--' + direction" tabindex="0" data-scroll-pane-view>
    <div :class="bodyClass" data-scroll-pane-body>
      <slot />
    </div>
  </div>
</template>

<style scoped>
/* 调用方一直用 min-h-0 flex-1 让它吃满剩余高度；缺了高度约束就不滚。 */
.scroll-pane {
  min-height: 0;
  overflow: hidden;
}

/*
 * 滚动条独立通道（问题 17）：原生滚动条按浏览器规则占布局宽度，
 * 不再像 ScrollArea 滑块那样压在行高亮上。细度 / 颜色来自 app.css 全局规则。
 */
.scroll-pane--x {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-gutter: stable;
}

.scroll-pane--y {
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
}

.scroll-pane--both {
  overflow: auto;
  scrollbar-gutter: stable;
}
</style>

