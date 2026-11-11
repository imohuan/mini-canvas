/**
 * pluginAgentServer —— Agent 后台**作为后台插件**的入口（2026-11-12）。
 *
 * 为什么要有它：Agent 的后台代码一直住在 `src/server/`，但宿主是直接 import 源码、
 * 把整棵依赖树编进 cloud-server 自己产物里的。结果是：
 *   · 发布包里 `plugin-agent/` 只有 `dist/web.js`，没有后台半；
 *   · 改 Agent 后端必须重发 cloud-server —— 违背「插件独立更新」。
 *
 * 现在改成真正的后台插件：本文件导出 `{ name, inject, apply }`，被打成
 * `dist/server.js` 放进插件目录，宿主启动时按 `plume.server.entry` 加载它。
 *
 * ## 它为什么能自装配
 *
 * `apply(ctx)` 里的 `ctx` 是宿主的插件作用域，上面已经有装配需要的全部端口
 * （`agentPorts`：数据根 / 画布目录 / KV / 提示词小节 / 中间件 / 技能目录）。
 * 插件自己读这些端口、建服务组、把服务注入回 ctx，再登记三条路由 ——
 * 宿主不再需要知道 Agent 的任何内部结构。
 *
 * 端口缺失时**直接报错**，不静默退化：那种「装上了但少一半能力」最难查。
 */
import type { PluginModule, PluginScope } from '@plume-canvas/kernel'
import { assembleAgentServices, type AgentServices } from './agent/assembleAgent.js'
import { agentPlugins, AGENT_SERVICES } from './routes/plugin.js'
import type { AgentHostPorts } from './ports.js'
import type { AgentTurnEnvelope, AgentTurnOutcome } from './ports.js'
import type { AgentRuntimeContext } from './agent/runtimeContext.js'

/** 宿主上架端口服务的名字（宿主注入一次，插件按名取） */
export const AGENT_PORTS_SERVICE = 'agentPorts'

/** 插件名：与 `package.json` 的 `plume.pluginName` 一致（内核按它索引） */
export const name = 'agent'

/**
 * 宿主通过 `agentPorts` 额外给的两样东西（不放进 AgentHostPorts，因为它们只属于装配期）：
 * - `adopt`：插件装配完把服务组交回宿主（宿主自己还要读 config / runtime 跑任务化对话）；
 * - `runtimeContext`：宿主算出的运行时上下文（模板里的 baseUrl 等）。
 */
interface HostBridgePorts extends AgentHostPorts {
  adopt?: (services: AgentServices) => void
  runtimeContext?: () => AgentRuntimeContext
}

function readPorts(ctx: PluginScope): HostBridgePorts {
  const ports = ctx.tryGet<HostBridgePorts>(AGENT_PORTS_SERVICE)
  if (!ports) {
    throw new Error(
      '[agent] 宿主没有上架 ' + AGENT_PORTS_SERVICE + ' 端口：需要 { dataDir, canvasDirOf, kv, promptSections, runMiddleware }',
    )
  }
  return ports
}

export function apply(ctx: PluginScope): void {
  const ports = readPorts(ctx)
  /**
   * 装配是异步的（要读磁盘、建 goal hook），而内核的 apply 必须同步返回。
   * 所以这里**立刻登记一个异步装配任务**：
   *   · 失败时记一条响亮的错误（不静默：装上了却少一半能力最难查）；
   *   · 装配完成前路由还没登记 —— 宿主是启动期装载，start() 会等它跑完。
   */
  const ready = assemble(ctx, ports)
  // 让宿主能等装配完成（测试与启动流程用得到）；拿不到就算了
  ctx.inject('agentReady', ready)
}

async function assemble(ctx: PluginScope, ports: HostBridgePorts): Promise<AgentServices> {
  const services: AgentServices = await assembleAgentServices({ ports })

  // 1) 服务上架到 ctx：三条路由插件按名取，服务跟着本插件的作用域回收。
  ctx.inject(AGENT_SERVICES.config, services.config)
  ctx.inject(AGENT_SERVICES.sessions, services.sessions)
  ctx.inject(AGENT_SERVICES.runtime, services.runtime)
  ctx.inject(AGENT_SERVICES.hub, services.hub)
  ctx.inject(AGENT_SERVICES.queue, services.queue)
  ctx.inject(AGENT_SERVICES.goal, services.goal)
  ctx.inject(AGENT_SERVICES.loadSdk, services.loadSdk)

  // 2) 设置页要列「后台自动附加了哪些内容」—— 注册场的读口子（走端口，插件不认识注册场）
  services.config.setPromptSectionViews(() => ports.promptSections())
  // 监听前先灌一次：读配置时能拿到目录与占位符清单
  const initialContext = ports.runtimeContext?.()
  if (initialContext) services.config.setRuntimeContext(initialContext)

  // 3) 交回宿主：宿主自己还要用 config / runtime 跑任务化对话与关停回收
  ports.adopt?.(services)

  // 4) 登记三条路由（配置 / 多轮会话 / 单轮对话）。
  //    中间件走宿主注入的那一个函数指针 —— 插件不 import 宿主的注册场实现。
  const middleware = (turn: AgentTurnEnvelope): Promise<AgentTurnOutcome> => ports.runMiddleware(turn)
  for (const plugin of agentPlugins(middleware)) ctx.plugin(plugin)

  // 5) 卸载时回收：运行时与事件通道要停，否则定时器/SSE 会留在后台。
  ctx.effect(() => () => services.dispose())
  return services
}

/** 内核要的插件身份（无硬依赖：端口缺失在 apply 里明确报错） */
export const inject = [] as string[]

export const pluginAgentServer: PluginModule = { name, inject, apply }
