/**
 * capabilityLayer —— 后台能力层：把「后台专属的能力段」挂到每个 ctx 上。
 *
 * 与前端完全对称（见 canvas-data 的 createCanvasCapabilityLayer）：
 * 内核只认识「插件」；后台要的 ctx.routes / ctx.agent / … 由本层产出。
 *
 * 本 Task 只实现 `ctx.routes`（用户点 1）。agent / store / jobs / mcp 在后续 Task 补。
 *
 * 为什么每个 scope 各建一个注册器：注册器要写「谁放的」（条目 id = 插件名），
 * 才能让卸载只摘自己那条；共用一份就分不清归属了。
 */
import { Hono } from 'hono'
import type { CapabilityLayer, ConfigSchema, PluginScope } from '@mini-canvas/kernel'
import { createRouteRegistrar, type RouteRegistrar } from './routes.js'
import { createAgentRegistrar, type AgentRegistrar } from './agent.js'
import { createStoreRegistrar, type StoreRegistrar } from './store.js'
import { createJobsRegistrar, type JobsRegistrar } from './jobs.js'
import { createMcpRegistrar, type McpRegistrar } from './mcp.js'

export interface ServerCapabilityOptions {
  /** 全部请求最终落在的 Hono 实例（能力段只往里注册路由，不负责启动） */
  app: Hono
  /** 数据根目录（ctx.store 的插件私有数据落在这里的 plugin-data/ 下） */
  root?: string
  /**
   * 运行期装载/卸载插件（可选）。由 host 在构造时注入（它持有根 Context）。
   *
   * 为什么要它：插件从 ctx 拿到的是**作用域 ctx**（deriveScope 产物），上面没有
   * installPlugin/uninstallPlugin（那是根 Context 的方法）。host 插件要"运行期热装/热卸"
   * 其它插件（例如从 NPM 现装的），就得经这个能力段拿到根 Context 的能力。
   */
  runtime?: {
    install: (mod: unknown) => void
    uninstall: (name: string) => boolean
  }
}

/**
 * 建一个后台能力层实例（每 Context 一份）。
 *
 * 与前端能力层的差异：前端要 slot/settings 这些「表」；后台提供 routes/agent/store/jobs。
 * `declareConfig` 先做空实现（后台插件的配置面板是后续 Task，不在本计划主体）。
 */
export function createServerCapabilityLayer(opts: ServerCapabilityOptions): CapabilityLayer {
  return {
    buildSegments(ctx: PluginScope, scopeName: string): Record<string, unknown> {
      const routes: RouteRegistrar = createRouteRegistrar(ctx, scopeName)
      const agent: AgentRegistrar = createAgentRegistrar(ctx, scopeName)
      // store 的 root 缺省用进程当前目录（测试直接建能力层时常见；真实服务传真实数据根）
      const store: StoreRegistrar = createStoreRegistrar(ctx, scopeName, {
        root: opts.root ?? process.cwd(),
      })
      const jobs: JobsRegistrar = createJobsRegistrar(ctx, scopeName)
      const mcp: McpRegistrar = createMcpRegistrar(ctx, scopeName)
      return { routes, agent, store, jobs, mcp, runtime: opts.runtime }
    },
    builtins(): Record<string, unknown> {
      // 后台当前没有「恒在的内置服务」；后续 Task 可把 store / providerRegistry 之类放这里。
      return {}
    },
    reset(): void {
      // 无每生命周期的内部实例需要重建（注册场由内核自身在 stop 时清）。
    },
    declareConfig(_schema: ConfigSchema, _config: Record<string, unknown>, _pluginName: string, _dev: boolean): () => void {
      // 后台插件的 Config → 设置面板属后续 Task；现在就返回一个空清理函数（不报错、不静默丢行为）。
      return () => {}
    },
  }
}
