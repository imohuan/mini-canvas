<script setup lang="ts">
/**
 * Agent 面板内的滚动层：统一包住组件库的 ScrollArea。
 *
 * 为什么不直接在模板里写 ScrollArea：
 * · 面板需要「标题 / 搜索 / 底栏固定，只有列表滚」，外层必须是确定的 flex 高度；
 * · 打开模型面板时要把选中项滚进可视区，需要拿到 ScrollArea 内部的真实 viewport。
 * 这两件事都收在这一层，业务模板只关心内容。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'

const ScrollArea = useUiComponent('ScrollArea')

const props = withDefaults(
  defineProps<{
    /** 滚动方向；纵向列表用 y，窄面板里的横向分类条用 both */
    direction?: 'x' | 'y' | 'both'
    /** 内容层 class：padding / gap / grid 等布局写在这里 */
    bodyClass?: string
  }>(),
  { direction: 'y', bodyClass: '' },
)

const emit = defineEmits<{ (e: 'scroll', payload: Event): void }>()

const rootRef = ref<HTMLElement | null>(null)
const viewport = ref<HTMLElement | null>(null)

function syncViewport(): void {
  const el = rootRef.value?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null
  if (el === viewport.value) return
  viewport.value?.removeEventListener('scroll', onScroll)
  viewport.value = el
  el?.addEventListener('scroll', onScroll, { passive: true })
}

function onScroll(e: Event): void {
  emit('scroll', e)
}

/** 给「选中项滚进可视区」提供真实滚动元素（不是组件实例） */
function scrollElement(): HTMLElement | null {
  return viewport.value
}

/** 模板 ref 拿到的是组件实例，业务侧查 DOM 前要先取回真实根节点。 */
function rootElement(): HTMLElement | null {
  return rootRef.value
}

onMounted(syncViewport)
watch(rootRef, (el) => {
  if (el) syncViewport()
}, { flush: 'post' })
onBeforeUnmount(() => {
  viewport.value?.removeEventListener('scroll', onScroll)
})

defineExpose({ scrollElement, rootElement })
</script>

<template>
  <div ref="rootRef" class="ac-scrollarea" :data-direction="props.direction">
    <ScrollArea class="ac-scrollarea-area" :class="{ 'is-y-scroll': direction === 'y' }">
      <div class="ac-scrollarea-content" :class="bodyClass" data-agent-scroll-body>
        <div class="ac-scrollarea-fill" :class="{ 'is-fill-height': direction === 'y' }">
          <slot />
        </div>
      </div>
    </ScrollArea>
  </div>
</template>

<style scoped>
.ac-scrollarea {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding-right: 4px!important;
}

.ac-scrollarea :deep([data-slot='scroll-area']) {
  /* shadcn ScrollArea 根节点默认是 relative 的普通块；它必须作为纵向 flex 子项
     才能把「剩余高度」传进内部 viewport，否则内容会按自身高度无限长高。 */
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding-right: 12px;
}

.ac-scrollarea :deep([data-slot='scroll-area-viewport']) {
  display: flex;
  flex-direction: column;
  /* 这是真正滚动的那一层：必须占满 Root 的确定高度（flex:1 + min-height:0），
     内容超出时才在 viewport 内部滚，而不是把整个面板撑高。 */
  flex: 1 1 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  max-height: 100%;
}

/* Reka 在 viewport 里再包了一层内容壳。它默认按内容高度长，导致里面的 flex:1
   永远拿不到 330px 的视口高度；把它固定成视口的 100%，分栏/空态才会按可视区居中与滚动。 */
.ac-scrollarea :deep([data-slot='scroll-area-viewport'] > div:not([data-agent-scroll-body])) {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  max-height: none;
}

.ac-scrollarea[data-direction='y'] :deep([data-slot='scroll-area-viewport']) {
  overflow-x: hidden;
  overflow-y: auto;
}

.ac-scrollarea[data-direction='x'] :deep([data-slot='scroll-area-viewport']) {
  overflow-x: auto;
  overflow-y: hidden;
}

.ac-scrollarea[data-direction='both'] :deep([data-slot='scroll-area-viewport']) {
  overflow: auto;
}

.ac-scrollarea-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* ScrollArea 的 viewport 是 size-full；它不会把「可用高度」传给内容。
   模型 / 技能分栏需要内部 flex 链拿到确定高度，这里补一层 100% 高的稳定壳。 */
.ac-scrollarea-fill {
  display: flex;
  flex: none;
  flex-direction: column;
}

/* 纵向面板：内容层必须占满 viewport 高度，分栏与空态才有正确的居中 / 滚动。
   横向分类条（direction="both"）反过来按内容自然宽高，不强行撑满。 */
.ac-scrollarea-fill.is-fill-height {
  flex: 1 1 0;
  height: 100%;
  min-height: 0;
}
</style>
