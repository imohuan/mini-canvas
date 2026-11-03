<script setup lang="ts">
/**
 * 默认主题设置皮专用的滚动容器：原生溢出 div（问题 17）。
 * 不用组件库 ScrollArea：它的滑块是绝对定位覆盖层，会压在正文卡片上；
 * 原生滚动条 + scrollbar-gutter: stable 才是用户要的独立通道。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

withDefaults(
  defineProps<{
    direction?: 'x' | 'y' | 'both'
    bodyClass?: string
  }>(),
  { direction: 'y', bodyClass: '' },
)

/** 真正滚动的元素（就是根节点），切分组回顶时要用 */
const rootRef = ref<HTMLElement | null>(null)
const viewport = ref<HTMLElement | null>(null)

function syncViewport(): void {
  viewport.value = rootRef.value
}

onMounted(syncViewport)
watch(rootRef, (el) => {
  if (el) syncViewport()
}, { flush: 'post' })
onBeforeUnmount(() => {
  viewport.value = null
})

function scrollElement(): HTMLElement | null {
  return viewport.value
}

defineExpose({ scrollElement })
</script>

<template>
  <div ref="rootRef" class="settings-scroll-pane" :class="'settings-scroll-pane--' + direction">
    <div :class="bodyClass" data-settings-scroll-body>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.settings-scroll-pane {
  min-height: 0;
  overflow: hidden;
}

.settings-scroll-pane--x {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-gutter: stable;
}

.settings-scroll-pane--y {
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
}

.settings-scroll-pane--both {
  overflow: auto;
  scrollbar-gutter: stable;
}
</style>
