<script setup lang="ts">
/**
 * CanvasProvider —— 应用最外层的“上下文初始化器”，没有自己的业务 UI。
 *
 * 它只做三件事：
 * 1. 建唯一的内核宿主（createMiniCanvasHost）；
 * 2. 把 ctx / host / api / manager 通过 CANVAS_CONTEXT_KEY 提供给整棵子树；
 * 3. 卸载时先落盘、再在子组件全部卸载后停内核。
 *
 * 它不画画布、不建 NodeRegistry、不提供 flow。需要这些的组件仍放在 <CanvasHost> 内，
 * 用 useCanvasRender() 取渲染上下文。
 *
 * 启动失败时默认插槽不渲染，避免半截外壳拿着空 ctx 去渲染。
 */
import { onBeforeUnmount, onMounted, onUnmounted, provide, ref, shallowRef } from 'vue'
import { createMiniCanvasHost, type CanvasHostHandle, type MiniCanvasApi } from './createMiniCanvasHost'
import type { PluginManager } from './pluginManager'
import type { CanvasHostBootProps, CanvasProviderEmits } from './canvasHostTypes'
import { CANVAS_CONTEXT_KEY, type CanvasContext } from '../contracts/canvasContext'

const props = withDefaults(defineProps<CanvasHostBootProps>(), {
  plugins: () => [],
})

const emit = defineEmits<CanvasProviderEmits>()

interface Boot {
  host: CanvasHostHandle
  api: MiniCanvasApi
  manager: PluginManager
}

const boot = shallowRef<Boot | null>(null)
const error = ref<Error | null>(null)
const ready = ref(false)
let disposed = false

function mustBoot(): Boot {
  if (!boot.value) throw new Error('[CanvasProvider] 上下文尚未就绪')
  return boot.value
}

// provide 必须在 setup 里调用；这里给的是 getter 视图，真正赋值发生在 onMounted 之后。
// 默认插槽只在 ready 后渲染，因此消费方读到的值一定已经就绪。
const context: CanvasContext = {
  get ctx() {
    return mustBoot().host.ctx
  },
  get host() {
    return mustBoot().host
  },
  get api() {
    return mustBoot().api
  },
  get manager() {
    return mustBoot().manager
  },
}
provide(CANVAS_CONTEXT_KEY, context)

onMounted(async () => {
  try {
    const r = await createMiniCanvasHost({
      adapter: props.adapter,
      manifest: props.manifest,
      coldPlugins: props.plugins,
      seedDefault: props.seed,
      dev: props.dev,
    })
    // 启动期间组件可能已被卸载：此时不能把宿主挂进已销毁的上下文，必须就地停掉。
    if (disposed) {
      r.host.stop()
      return
    }
    boot.value = { host: r.host, api: r.api, manager: r.manager }
    if (props.windowKey) r.exposeToWindow(props.windowKey)
    ready.value = true
    emit('ready', r.host)
  } catch (e) {
    if (disposed) return
    error.value = e instanceof Error ? e : new Error(String(e))
    emit('boot-error', error.value)
  }
})

// 先落盘：flush 不依赖仍挂着的子组件。
onBeforeUnmount(() => {
  if (!boot.value) return
  void boot.value.host.save.flush()
})

// 再停内核：必须等子组件（CanvasHost、抽屉、状态条）全部卸载完，
// 否则它们还挂着注册表订阅时会看到内核正在拆除中的事件。
onUnmounted(() => {
  disposed = true
  if (!boot.value) return
  boot.value.host.stop()
  boot.value = null
})

defineExpose({
  get host() {
    return boot.value?.host
  },
  get api() {
    return boot.value?.api
  },
  get manager() {
    return boot.value?.manager
  },
  get ready() {
    return ready.value && !error.value
  },
  get bootErrorText() {
    return error.value?.message ?? ''
  },
})
</script>

<template>
  <!--
    单一根节点：条件插槽如果直接并列，组件就变成 fragment root，
    父级传下来的 id/class 等属性无法继承（Vue 会警告，实测挂在 App 上会刷屏）。
    display:contents 让这个根不产生布局盒子，外壳仍按原样铺满。
  -->
  <div class="canvas-provider-root">
    <slot v-if="ready" />
    <slot v-else-if="error" name="error" :error="error">
      <div class="canvas-provider-status is-error">启动失败：{{ error.message }}</div>
    </slot>
    <slot v-else name="loading">
      <div class="canvas-provider-status">正在启动内核…</div>
    </slot>
  </div>
</template>

<style scoped>
/* 根节点只承担“单一根”职责，不占布局；加载/失败态自己撑满一屏。 */
.canvas-provider-root {
  display: contents;
}
/* 加载/失败是“整页”状态：宽高撑满调用方容器，且至少撑满一屏。 */
.canvas-provider-status {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 100vh;
  color: var(--ui-ink-dim, #6b7280);
  background: var(--ui-canvas-bg, #f5f6f8);
  font: 13px system-ui, 'Microsoft YaHei', sans-serif;
}
.canvas-provider-status.is-error {
  color: var(--ui-danger, #dc2626);
}
</style>
