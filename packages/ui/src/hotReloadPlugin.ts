/**
 * hotReloadPlugin —— 往设置面板注册「热重载」分类（本应用侧的一个薄插件）。
 *
 * 为什么由 packages/ui 注册、而不是让 plugin-hot-reload 自己注册：
 *   「热重载」是**开发工具**，链接列表存在本机、只对开发者有意义，不该混进业务插件的
 *   设置分类。放这里 = 它是"这一版应用带的开发工具"，与设置面板换皮（uiSettingsPanelPlugin）同类。
 *
 * 分工：
 *   · 数据与动作在 plugin-hot-reload 的 createHotReload() 单例（挂 window.MiniCanvasHotReload）；
 *   · 本插件只做"往设置面板登记一个分类 + 左导航项"这件事。
 *
 * 三个注册：
 *   ① ctx.inject('hot-reload', 单例)  —— 别的插件/面板可按名取到同一份；
 *   ② settingsNav 导航项             —— 左导航多一个「热重载」；
 *   ③ settingsGroup/热重载 整页       —— 分类正文（HotReloadManager → HotReloadPage）。
 */
import { markRaw } from 'vue'
import type { ConfigSchema, PluginModule } from '@mini-canvas/kernel'
import { createHotReload, HOT_RELOAD_WINDOW_KEY, HotReloadNav, HotReloadManager } from '@mini-canvas/plugin-hot-reload'

const name = 'ui-hot-reload'

/** 设置面板一级分类名（= settingsNav 的 id，也是 settingsGroup/<此名> 的槽键） */
export const HOT_RELOAD_NAV_ID = '热重载'

/**
 * 占位分组（必须有）。
 *
 * 设置面板的**正文只从 settings.groups() 推导** —— 只注册 settingsNav、没有同名分组时，
 * 面板会认为这一级下暂无分组、什么都不渲染（实测踩到）。声明一个只有自己这一格的分组
 * （扁平分组名 = 分类名），面板就把它当这一页渲染；正文仍由 settingsGroup/热重载 整组接管。
 * 做法与 plugin-showcase 的占位分组一致。
 */
export const Config: ConfigSchema = {
  hotReloadHint: {
    type: 'string',
    default: '',
    label: '热重载',
    group: HOT_RELOAD_NAV_ID,
    description: '链接列表见本页正文（这一项只是分类占位，不用改）。',
  },
}

export const uiHotReloadPlugin: PluginModule = {
  name,
  inject: [] as string[],
  Config,
  apply(ctx: {
    inject(name: string, impl: unknown): void
    /** 副作用登记（卸载时回卷）—— 这里用来清掉声明源重扫定时器 */
    effect(fn: () => () => void): unknown
    slots: {
      register(slot: string, req: { id: string; order?: number; component: unknown; meta?: unknown }): string
    }
  }) {
    // 单例：挂 window（幂等 —— 已挂就用那一个），别的面板/控制台共享同一份
    const w = globalThis as unknown as Record<string, unknown>
    const manager =
      (w[HOT_RELOAD_WINDOW_KEY] as ReturnType<typeof createHotReload> | undefined) ??
      createHotReload({
        // 视觉反馈：自动重装成功 → 右下角弹一条 vue-sonner 通知。
        // 用户口径：「如果发生了热重载，希望能提供一个视觉上的提示，比如弹一个 notify」。
        // 缺省实现（数据层里那个）已经在弹 toast；这里不注入，直接用缺省 ——
        // 留这段注释是说明"想换成别的展示（如画布内横幅）就在这里注入 onReloaded"。
      })
    if (w[HOT_RELOAD_WINDOW_KEY] === undefined) w[HOT_RELOAD_WINDOW_KEY] = manager

    // 上架成服务：别的插件可 ctx.get('hot-reload') 拿同一份
    ctx.inject('hot-reload', manager)

    // **插件产物变更监听**（最终形态）：复用宿主共享 KV 通道（零新连接），
    // watch 工具 build 成功后 PUT plugin-watch:<插件名> → 这里收到 → HEAD 对比 → 变了才重装。
    // 无轮询、无声明文件、服务端零改动。失败静默：开发便利不该在控制台刷错误。
    ctx.effect(() => manager.watchPluginChanges())

    // ① 左导航项
    ctx.slots.register('settingsNav', {
      id: HOT_RELOAD_NAV_ID,
      order: 90,
      component: markRaw(HotReloadNav),
      meta: { title: HOT_RELOAD_NAV_ID },
    })
    // ② 分类正文（整页由本插件接管）
    ctx.slots.register('settingsGroup/' + HOT_RELOAD_NAV_ID, {
      id: 'ui-hot-reload-page',
      order: 90,
      component: markRaw(HotReloadManager),
      meta: { mode: 'replace' },
    })
  },
}
