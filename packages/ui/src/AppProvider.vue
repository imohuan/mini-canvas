<script setup lang="ts">
/**
 * AppProvider —— 外壳对根级 Provider 的装配。
 *
 * Provider 本体住在 `@mini-canvas/vue-render` 的 `RenderProvider`：它只负责
 * "建一次 Context、provide 令牌、卸载时回收"，与画布无关。
 * 这里只补外壳自己的启动配方（默认存储适配器、要登记的插件清单、配置桥）。
 */
import { RenderProvider } from '@mini-canvas/vue-render'
import { Context, createCanvasAppBasePlugin } from '@mini-canvas/canvas-data'
import { setReadyHost } from './composables/ui/hostRuntime'
import { createDefaultStorageAdapter, resolveAppPlugins } from './assembly'

async function bootstrap() {
  const ctx = new Context({ dev: import.meta.env.DEV })
  const appBase = createCanvasAppBasePlugin({
    adapter: createDefaultStorageAdapter(),
    persistSettings: true,
  })
  ctx.plugin(appBase.plugin)
  // 所有插件只登记一次：不依赖 doc 的立刻启动，依赖 doc 的停在 PENDING 等画布。
  for (const plugin of resolveAppPlugins()) ctx.plugin(plugin)
  await ctx.start()
  // 配置桥在插件 Config 都声明完之后恢复一次，用户已保存的值才能作为初值。
  await appBase.services.settingsPersist?.restore()
  // 树外按名取件 / 设置 / 历史 / Agent 都读这一份根上下文。
  setReadyHost({ ctx })

  return {
    ctx,
    appBase: appBase.services,
    dispose: async () => {
      await appBase.services.save.flush()
      appBase.services.settingsPersist?.dispose()
      appBase.services.resources.dispose()
      setReadyHost(undefined)
      ctx.stop()
    },
  }
}
</script>

<template>
  <RenderProvider :bootstrap="bootstrap" error-prefix="应用启动失败">
    <slot />
  </RenderProvider>
</template>
