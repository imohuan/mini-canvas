<script setup lang="ts">
/**
 * 项目页插件面板的示例内容。
 *
 * 关键点（对插件作者）：这里不依赖 useCanvasRender，也不需要打开画布。
 * 需要画布能力时用 ctx.tryGet('doc') 判断；拿不到就禁用自己的动作。
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useCanvasContext, useUiComponent } from '@plume-canvas/canvas-render'
import { FolderOpenIcon } from 'lucide-vue-next'

const { ctx } = useCanvasContext()
const Button = useUiComponent('Button')

/**
 * 画布会话会装/卸 doc，而服务表本身不是响应式的：
 * 订阅内核的插件装卸事件，让按钮在进入/离开画布后重新判定。
 */
const tick = ref(0)
let disposeInstalled: { dispose(): void } | undefined
let disposeUninstalled: { dispose(): void } | undefined
onMounted(() => {
  disposeInstalled = ctx.on('ctx:plugin-installed', () => { tick.value += 1 })
  disposeUninstalled = ctx.on('ctx:plugin-uninstalled', () => { tick.value += 1 })
})
onBeforeUnmount(() => {
  disposeInstalled?.dispose()
  disposeUninstalled?.dispose()
})

// 每次读取都现取：画布会话是可装卸的，不能在 setup 里缓存一份。
const hasCanvas = computed(() => {
  void tick.value
  return Boolean(ctx.tryGet('doc'))
})
const hint = computed(() =>
  hasCanvas.value ? '当前已在画布内，可以使用画布能力。' : '打开一张画布后可使用画布动作。',
)
</script>

<template>
  <div class="rounded-2xl border border-line bg-panel p-4">
    <div class="flex items-center gap-2 text-sm font-medium text-ink">
      <FolderOpenIcon :size="16" class="text-ink-mute" />
      项目页面板示例
    </div>
    <p class="mt-2 text-xs text-ink-dim">这个面板由插件注册，项目页不启动画布也能显示。</p>
    <component :is="Button" variant="outline" class="mt-3" :disabled="!hasCanvas">
      画布动作
    </component>
    <p class="mt-2 text-xs text-ink-dim">{{ hint }}</p>
  </div>
</template>
