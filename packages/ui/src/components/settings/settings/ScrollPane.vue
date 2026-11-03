<script setup lang="ts">
/**
 * 成品设置皮专用的滚动容器：原生溢出 div（问题 17）。
 * ScrollArea 的自绘滑块会压在正文卡片上，用户要的是浏览器原生那样占独立通道；
 * 原生滚动条 + scrollbar-gutter: stable 正好给出这条通道。
 * 与默认皮的 settings/ScrollPane.vue 同构；两套皮保持同一行为。
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
