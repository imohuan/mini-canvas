/**
 * usePluginManager —— 在画布渲染子树内取 plugin-manager 服务（单例）。
 *
 * 与 plugin-agent 的 useAgent 同款：把「先拿 ctx 再自己转类型」包成一行，
 * 调用点只认这一件事。
 *
 * 两处入口：
 * - 画布里的设置面板 → 宿主句柄 host.manager；
 * - 项目页的「插件」整页 → 应用级 appPluginManager（项目页没有画布会话）。
 * 两者都操作同一个根 Context，装完立刻生效。
 */
import { useCanvasContextOrRender } from '@mini-canvas/canvas-render'
import type { HostPluginManager, PluginManagerService } from './pluginManagerService'

export function usePluginManager(): PluginManagerService {
  const context = useCanvasContextOrRender()
  const { ctx } = context
  const svc = ctx.get<PluginManagerService>('plugin-manager')
  if (!svc) throw new Error('[usePluginManager] 没找到 plugin-manager 服务：请确认装配里装了插件管理插件')
  // 插件 apply 拿不到宿主句柄（内核只传 config），这里在渲染子树里完成正式接线。
  // 重复绑定是幂等的；页面晚于插件 apply 挂载，也能把"宿主没有提供 manager"消掉。
  //
  // 注意不能直接解构 host：RenderProvider 的 host 在项目页会抛错（"当前不在会话内"），
  // 解构即触发 getter。这里先拿应用级句柄，没有才去画布会话里取。
  const bound =
    ctx.tryGet<HostPluginManager>('appPluginManager') ??
    context.manager ??
    (context.host as { manager?: HostPluginManager } | undefined)?.manager
  if (bound) void svc.bindManager(bound)
  return svc
}
