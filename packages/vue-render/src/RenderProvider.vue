<script setup lang="ts">
/**
 * RenderProvider —— 唯一的外壳 Provider（住在 vue-render，不属于具体渲染器）。
 *
 * 它只做三件事：
 * 1. 调一次 `bootstrap()`（由入口注入：建内核 Context、装应用级与画布级插件）；
 * 2. 把外壳上下文 `shell` 与渲染上下文令牌 provide 给整棵树；
 * 3. 卸载时调 `bootstrap` 返回的 dispose，或兜底 `ctx.stop()`。
 *
 * 它**不认识** doc / node / edge / viewport：画布服务由 bootstrap 在进入画布时
 * 装进同一份 Context；项目页没有这些服务也没关系（依赖方停在 PENDING）。
 *
 * 启动顺序：`bootstrap()` 完成前只渲染 loading 与错误态，子组件不会提前拿到 ctx。
 */
import { computed, onMounted, onUnmounted, provide, ref, shallowRef } from 'vue'
import type { ContextWithSlots } from './context'
import { CANVAS_CONTEXT_KEY } from './context'
import { RENDER_SHELL_KEY, type RenderBootstrapResult, type RenderSession, type RenderShell } from './shell'

const props = withDefaults(
  defineProps<{
    /** 启动函数：建 Context、登记插件、start()；返回 ctx / appBase / dispose */
    bootstrap: () => Promise<RenderBootstrapResult>
    /** 加载中文案 */
    loadingText?: string
    /** 错误前缀文案 */
    errorPrefix?: string
  }>(),
  { loadingText: '正在启动应用…', errorPrefix: '应用启动失败' },
)

const ready = ref(false)
const error = ref<Error | null>(null)
const boot = shallowRef<RenderBootstrapResult | null>(null)
/** 当前会话宿主；项目页为 undefined。 */
const sessionHost = shallowRef<unknown>(undefined)
const session = shallowRef<RenderSession | undefined>(undefined)
let disposed = false

const shell: RenderShell = {
  get ctx() {
    return mustBoot().ctx
  },
  get appBase() {
    return mustBoot().appBase
  },
  sessionHost,
  setSession(next) {
    session.value = next
    sessionHost.value = next?.host
  },
}

/**
 * 渲染上下文：ctx 恒在；host/api/manager 只在会话内存在。
 * 项目页访问它们会给出明确错误，而不是静默返回 undefined。
 */
const context = {
  get ctx() {
    return mustBoot().ctx
  },
  get host(): never {
    return mustSession('host') as never
  },
  get api(): never {
    return mustSession('api') as never
  },
  get manager(): never {
    return mustSession('manager') as never
  },
}

provide(RENDER_SHELL_KEY, shell)
provide(CANVAS_CONTEXT_KEY, context)

function mustBoot(): RenderBootstrapResult {
  if (!boot.value) throw new Error('[RenderProvider] 上下文尚未就绪')
  return boot.value
}

function mustSession(key: 'host' | 'api' | 'manager'): unknown {
  const value = session.value?.[key]
  if (!value) {
    throw new Error('[RenderProvider] 当前不在会话内：' + key + ' 只在进入渲染会话后存在。')
  }
  return value
}

onMounted(async () => {
  try {
    const result = await props.bootstrap()
    if (disposed) {
      try {
        await result.dispose?.()
      } finally {
        if (!result.dispose) (result.ctx as ContextWithSlots & { stop?: () => void }).stop?.()
      }
      return
    }
    boot.value = result
    ready.value = true
  } catch (e) {
    if (disposed) return
    error.value = e instanceof Error ? e : new Error(String(e))
  }
})

onUnmounted(() => {
  disposed = true
  const value = boot.value
  if (!value) return
  boot.value = null
  ready.value = false
  void value.dispose?.()
})

const statusText = computed(() => (error.value ? props.errorPrefix + '：' + error.value.message : props.loadingText))

defineExpose({
  get ctx() {
    return boot.value?.ctx
  },
  get appBase() {
    return boot.value?.appBase
  },
})
</script>

<template>
  <div class="render-provider-root">
    <slot v-if="ready" />
    <div v-else class="render-provider-status" :class="{ 'is-error': !!error }">
      {{ statusText }}
    </div>
  </div>
</template>

<style scoped>
.render-provider-root {
  display: contents;
}

.render-provider-status {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 100vh;
  font: 13px system-ui, sans-serif;
  color: var(--ui-ink-dim, #6b7280);
  background: var(--ui-canvas-bg, #f5f6f8);
}

.render-provider-status.is-error {
  color: var(--ui-danger, #dc2626);
}
</style>
