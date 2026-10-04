/**
 * useAgent —— 在画布渲染子树内取 agent 服务（单例）。
 *
 * 为什么不让布局自己 ctx.get('agent')：布局代码里要先拿 ctx（useCanvasRender）再自己转类型，
 * 包成一行函数后，调用的地方只认这一件事。
 *
 * 局限（本仓库的既有约束）：只能在 <CanvasHost> 的渲染子树内用（例如 #ui 插槽里）。
 * 树外（CanvasShell 自己的具名插槽）会抛错 —— 那里改用宿主句柄：
 *   `ui.readyHost?.ctx?.get('agent')`。
 */
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { AgentService } from './agentService.js'

export function useAgent(): AgentService {
  const { ctx } = useCanvasRender()
  const svc = ctx.get<AgentService>('agent')
  if (!svc) throw new Error('[useAgent] 没找到 agent 服务：请确认装配里装了 plugin-agent')
  return svc
}
