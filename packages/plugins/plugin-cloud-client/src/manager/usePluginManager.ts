/**
 * usePluginManager —— 在画布渲染子树内取 plugin-manager 服务（单例）。
 *
 * 与 plugin-agent 的 useAgent 同款：把「先 useCanvasRender 拿 ctx 再自己转类型」包成一行，
 * 调用点只认这一件事。只能在 <CanvasHost> 的渲染子树内用（设置面板就在里面）。
 */
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { PluginManagerService } from './pluginManagerService'

export function usePluginManager(): PluginManagerService {
  const { ctx } = useCanvasRender()
  const svc = ctx.get<PluginManagerService>('plugin-manager')
  if (!svc) throw new Error('[usePluginManager] 没找到 plugin-manager 服务：请确认装配里装了插件管理插件')
  return svc
}
