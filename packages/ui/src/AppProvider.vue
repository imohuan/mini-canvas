<script setup lang="ts">
/**
 * AppProvider —— ui-shell 唯一的根级 Provider。
 *
 * 它只建**应用级** Context：save/resources/注册表/命令表 + 配置桥，加上全部插件的登记。
 * 画布服务（doc/selection/view…）不在这里装；画布页进入时才调用 mountCanvas。
 *
 * 这带来两个直接结果：
 * - 项目页不必启动一张画布，也能取到 ctx、ui 目录和插槽；
 * - 项目页与画布页是同一份 Context，插件只登记一次，靠 inject 决定何时启动。
 *
 * 启动顺序：ctx.start() 完成前只渲染 loading —— 否则子组件里的 installPlugin
 * 会撞上 assertState('started')。
 */
import { onMounted, onUnmounted, provide, ref, shallowRef } from 'vue'
import type { MiniCanvasApi } from '@mini-canvas/canvas-render'
import type { PluginManager } from '@mini-canvas/canvas-render'
import { APP_SHELL_KEY, type AppCanvasSession, type AppShell } from './app-shell'
import { Context, createCanvasAppBasePlugin, type CanvasAppBaseServices } from '@mini-canvas/canvas-data'
import { CANVAS_CONTEXT_KEY, type CanvasContext } from '@mini-canvas/canvas-render'
import type { CanvasHostHandle } from '@mini-canvas/canvas-render'
import { createDefaultStorageAdapter, resolveAppPlugins } from './assembly'

const ready = ref(false)
const error = ref<Error | null>(null)
const boot = shallowRef<{ ctx: Context; appBase: CanvasAppBaseServices } | null>(null)
/** 当前画布会话的宿主；项目页为 undefined。 */
const sessionHost = shallowRef<CanvasHostHandle | undefined>(undefined)
const sessionApi = shallowRef<MiniCanvasApi | undefined>(undefined)
const sessionManager = shallowRef<PluginManager | undefined>(undefined)
let disposed = false

const shell: AppShell = {
  get ctx() {
    return mustBoot().ctx
  },
  get appBase() {
    return mustBoot().appBase
  },
  sessionHost,
  setSession(session: AppCanvasSession | undefined) {
    sessionHost.value = session?.host
    sessionApi.value = session?.api
    sessionManager.value = session?.manager
  },
}
provide(APP_SHELL_KEY, shell)

function mustBoot(): NonNullable<typeof boot.value> {
  if (!boot.value) throw new Error('[AppProvider] 上下文尚未就绪')
  return boot.value
}

/**
 * 与 CanvasContext 的字段对齐：
 * ctx 恒在；host/api/manager 只在画布内有值，项目页访问会抛出清晰错误。
 */
const context: CanvasContext = {
  get ctx() {
    return mustBoot().ctx
  },
  get host(): CanvasHostHandle {
    const host = sessionHost.value
    if (!host) throw new Error('[AppProvider] 当前不在画布内：host 只在画布路由里存在。')
    return host
  },
  get api() {
    const api = sessionApi.value
    if (!api) throw new Error('[AppProvider] 当前不在画布内：api 只在画布路由里存在。')
    return api
  },
  get manager() {
    const manager = sessionManager.value
    if (!manager) throw new Error('[AppProvider] 当前不在画布内：manager 只在画布路由里存在。')
    return manager
  },
}
provide(CANVAS_CONTEXT_KEY, context)

onMounted(async () => {
  try {
    const ctx = new Context({ dev: import.meta.env.DEV })
    const appBase = createCanvasAppBasePlugin({
      adapter: createDefaultStorageAdapter(),
      persistSettings: true,
    })
    ctx.plugin(appBase.plugin)
    // 所有插件只登记一次：不依赖 doc 的立刻启动，依赖 doc 的停在 PENDING 等画布
    for (const plugin of resolveAppPlugins()) ctx.plugin(plugin)
    await ctx.start()
    if (disposed) {
      ctx.stop()
      return
    }
    boot.value = { ctx, appBase: appBase.services }
    // 配置桥在插件 Config 都声明完之后恢复一次，用户已保存的值才能作为初值
    await appBase.services.settingsPersist?.restore()
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
  void value.appBase.save.flush()
  value.appBase.settingsPersist?.dispose()
  value.appBase.resources.dispose()
  value.ctx.stop()
  boot.value = null
})

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
  <div class="app-provider-root">
    <slot v-if="ready" />
    <div v-else-if="error" class="app-provider-status is-error">应用启动失败：{{ error.message }}</div>
    <div v-else class="app-provider-status">正在启动应用…</div>
  </div>
</template>

<style scoped>
.app-provider-root {
  display: contents;
}
.app-provider-status {
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
.app-provider-status.is-error {
  color: var(--ui-danger, #dc2626);
}
</style>
