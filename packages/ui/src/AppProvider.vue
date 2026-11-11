<script setup lang="ts">
/**
 * AppProvider —— 外壳对根级 Provider 的装配。
 *
 * Provider 本体住在 `@plume-canvas/vue-render` 的 `RenderProvider`：它只负责
 * "建一次 Context、provide 令牌、卸载时回收"，与画布无关。
 * 这里只补外壳自己的启动配方（默认存储适配器、要登记的插件清单、配置桥）。
 */
import { RenderProvider } from '@plume-canvas/vue-render'
import { Context } from '@plume-canvas/canvas-data'
import { createCanvasBaseAppPlugin } from '@plume-canvas/canvas-base'
import { createPluginManager } from '@plume-canvas/canvas-render'
import { setReadyHost } from './composables/ui/hostRuntime'
import { createDefaultStorageAdapter, resolveAppPlugins } from './assembly'

async function bootstrap() {
  const ctx = new Context({ dev: import.meta.env.DEV })
  // 应用级底座就是这个插件的身份：canvas-base（save / resources / 注册表 / 命令 / 配置桥）。
  const appBase = createCanvasBaseAppPlugin({
    adapter: createDefaultStorageAdapter(),
    persistSettings: true,
  })
  ctx.plugin(appBase.plugin)
  /**
   * 应用级安装句柄：项目页没有画布宿主，但「插件」页仍然要能装东西。
   *
   * 内核的 Context 是唯一的，manager 只是"对同一个 Context 的装卸门面"；
   * 先在 start 之前注入，插件管理的 apply 就能直接绑上，不会先报一轮
   * "宿主没有提供 host.manager"。
   */
  const appManager = createPluginManager(ctx, { hiddenPlugins: [appBase.name] })
  const revokeAppManager = ctx.inject('appPluginManager', appManager)
  // 所有插件只登记一次：不依赖 doc 的立刻启动，依赖 doc 的停在 PENDING 等画布。
  for (const plugin of await resolveAppPlugins()) ctx.plugin(plugin)
  // build 版本：界面包不含任何插件，改为从 cloud-server 的清单装载。
  // 只装**项目内置清单**里的那些（builtinInstallIds）；其余可装卸件由用户在
  // 插件管理页自己装，不能替用户做主，否则卸掉的插件下次开页又回来。
  // dev 版本走上面的静态 import（resolveAppPlugins 非空），这里跳过。
  if (import.meta.env.DEV === false) {
    const { fetchCatalog, installCatalogPlugins, pickBuiltinEntries } = await import('./remote-plugins')
    try {
      const catalog = await fetchCatalog()
      const want = pickBuiltinEntries(catalog)
      const failures = await installCatalogPlugins({ ...catalog, plugins: want }, (mod) => ctx.plugin(mod))
      if (failures.length) {
        // 逐条打印：只打一个数组，用户和排查者都看不出「哪个插件、为什么」。
        for (const f of failures) console.warn('[ui] 插件装载失败 ' + f.id + '：' + f.error)
      }
    } catch (err) {
      // 后台没起来或清单坏了：界面仍要能打开（只是没有插件），把原因说清楚。
      console.error('[ui] 从 cloud-server 装载插件失败', err)
    }
  }
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
      revokeAppManager()
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
