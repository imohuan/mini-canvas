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
  /*
   * 这里不再留右边距（用户 2026-11-06：模型面板右侧空出一大块）。
   *
   * 之前 4px 在这里、12px 在根节点、12px 在内容层、6px 在网格上，四层叠起来
   * 实际空出 34px，卡片被一路挤窄。留白只在内容层写一次就够。
   */
  padding-right: 0;
}

.ac-scrollarea :deep([data-slot='scroll-area']) {
  /* shadcn ScrollArea 根节点默认是 relative 的普通块；它必须作为纵向 flex 子项
     才能把「剩余高度」传进内部 viewport，否则内容会按自身高度无限长高。 */
  flex: 1;
  display: flex;
  flex-direction: column;
  /*
   * 不能再写 overflow: hidden（用户 2026-11-06：卡片视图没有滚动条）。
   *
   * 组件库的滚动条是**绝对定位**、贴在根节点右缘的；根节点一裁切，
   * 它就整条被裁掉 —— 表现是有内容、能滚，但右侧什么都看不见。
   * 这里改成 visible，让滚动条正常画出来（内容仍由内部 viewport 自己滚）。
   */
  overflow: visible;
  width: 100%;
  height: 100%;
  min-height: 0;
  /*
   * 也别在这里给滚动条留位：滚动条是 absolute 贴右缘叠在内容上的，
   * 再留 12px 只是白空一块。给滚动条让路的留白统一写在内容层的 padding-right。
   */
  padding-right: 0;
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
