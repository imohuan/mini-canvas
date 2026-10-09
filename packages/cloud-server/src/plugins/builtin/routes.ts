/**
 * builtins —— 每个现有路由组 → 一个内置后台插件。
 *
 * 设计（关键，别写成别样）：
 * **每个插件内部照样调原来的 `xxxRoutes(依赖)` 工厂拿到 Hono，再用 `ctx.routes.adopt()`
 * 把它的路由逐条摊平进注册场**。为什么不重写路由体：
 *   - 那 12 个工厂已经过测试、写成另一种形状只会引入无谓的回归风险；
 *   - 「行为不变」是这一步的硬要求（Task 3），**复用原实现**是最强的保证。
 *
 * 依赖经 `inject` 声明、从 ctx 取（`server.ts` 里 `ctx.inject('名', 实例)` 上架）。
 * 这样「这组接口依赖什么」写在插件上，一眼可见，且装载顺序由依赖决定。
 */
import type { PluginModule, PluginScope } from '@mini-canvas/kernel'
import { eventsRoutes } from '../../routes/events.js'
import { canvasesRoutes } from '../../routes/canvases.js'
import { actionsRoutes } from '../../routes/actions.js'
import { jobsRoutes } from '../../routes/jobs.js'
import { historyRoutes } from '../../routes/history.js'
import { kvRoutes } from '../../routes/kv.js'
import { canvasOpsRoutes } from '../../routes/canvasOps.js'
import { agentRoutes } from '../../routes/agent.js'
import { agentSessionRoutes } from '../../routes/agentSessions.js'
import type { BranchStore } from '../../agent/branchStore.js'
import { pluginRoutes } from '../../static.js'
import { createServerPluginsRoutes } from '../../routes/serverPlugins.js'
import { createNpmPluginsRoutes } from '../../routes/npmPlugins.js'
import { projectsRoutes } from '../../routes/projects.js'
import { assetsRoutes } from '../../routes/assets.js'
import { hotInstallServerPlugin, hotUninstallServerPlugin } from '../../serverFramework/hotLoad.js'
import { hotLoadedNames } from '../../serverFramework/hotLoad.js'
import { buildPluginCatalog } from '../catalog.js'
import { healthPlugin } from './health.js'
import { pluginWatchRoutes } from '../pluginWatch.js'
import { runAgentMiddleware } from '../../serverFramework/agent.js'
import type { KvStore } from '../../store/kvStore.js'
import type { CanvasStore } from '../../store/canvasStore.js'
import type { CanvasResourceStore } from '../../store/canvasResources.js'
import { CanvasDocument } from '../../mcp/canvasDoc.js'
import type { ProviderRegistry } from '../../providers/registry.js'
import type { TaskManager } from '../../tasks/taskManager.js'
import type { HistoryStore } from '../../tasks/history.js'
import type { AgentConfigService } from '../../agent/config.js'
import type { AgentSessionStore } from '../../agent/sessionStore.js'
import type { AgentRuntime } from '../../agent/runtime.js'
import type { SessionHub } from '../../agent/sessionHub.js'
import type { QueueScheduler } from '../../agent/queueScheduler.js'
import type { GoalRuntimePort } from '../../routes/agentSessions.js'
import type { ProjectStore } from '../../store/projectStore.js'
import type { AssetStore } from '../../store/assetStore.js'

/** 服务名常量（与 server.ts 的 inject 一一对应，改名要一起改） */
export const S = {
  kvStore: 'kvStore',
  canvasStore: 'canvasStore',
  canvasResources: 'canvasResources',
  projectStore: 'projectStore',
  assetStore: 'assetStore',
  doc: 'doc',
  providerRegistry: 'providerRegistry',
  taskManager: 'taskManager',
  history: 'history',
  agentConfig: 'agentConfig',
  agentSessions: 'agentSessions',
  agentRuntime: 'agentRuntime',
  agentBranches: 'agentBranches',
  pluginsDir: 'pluginsDir',
  serverPluginsDir: 'serverPluginsDir',
  selfOrigin: 'selfOrigin',
} as const

/** 取服务的小助手：缺了就抛明确错误（不要静默 undefined）。
 *  形参收 PluginScope（`PluginModule.apply` 收到的是它，比 Context 窄）。 */
function need<T>(ctx: PluginScope, name: string): T {
  const v = ctx.tryGet<T>(name)
  if (v === undefined) {
    throw new Error('[builtin] 缺少服务 "' + name + '"：请检查 server.ts 的 inject 登记（见 serverFramework 的服务名表）')
  }
  return v
}

export const eventsPlugin: PluginModule = {
  name: 'events',
  inject: [S.kvStore],
  apply(ctx) {
    ctx.routes.adopt(eventsRoutes(need<KvStore>(ctx, S.kvStore), ctx.tryGet<CanvasStore>(S.canvasStore)))
  },
}

export const canvasesPlugin: PluginModule = {
  name: 'canvases',
  inject: [S.canvasStore, S.canvasResources, S.doc],
  apply(ctx) {
    ctx.routes.adopt(
      canvasesRoutes(
        need<CanvasStore>(ctx, S.canvasStore),
        need<CanvasResourceStore>(ctx, S.canvasResources),
        need<CanvasDocument>(ctx, S.doc),
      ),
    )
  },
}

/** 项目 / 画布两层组织（项目注册表 + 画布索引）。 */
export const projectsPlugin: PluginModule = {
  name: 'projects',
  inject: [S.projectStore, S.canvasStore, S.assetStore],
  apply(ctx) {
    ctx.routes.adopt(
      projectsRoutes(
        need<ProjectStore>(ctx, S.projectStore),
        need<CanvasStore>(ctx, S.canvasStore),
        need<AssetStore>(ctx, S.assetStore),
      ),
    )
  },
}

/** 资产目录（生成产物 + 自己上传）。 */
export const assetsPlugin: PluginModule = {
  name: 'assets',
  inject: [S.assetStore],
  apply(ctx) {
    ctx.routes.adopt(assetsRoutes(need<AssetStore>(ctx, S.assetStore)))
  },
}

export const actionsPlugin: PluginModule = {
  name: 'actions',
  inject: [S.providerRegistry],
  apply(ctx) {
    ctx.routes.adopt(actionsRoutes(need<ProviderRegistry>(ctx, S.providerRegistry)))
  },
}

export const jobsPlugin: PluginModule = {
  name: 'jobs',
  inject: [S.taskManager],
  apply(ctx) {
    ctx.routes.adopt(jobsRoutes(need<TaskManager>(ctx, S.taskManager)))
  },
}

export const historyPlugin: PluginModule = {
  name: 'history',
  inject: [S.history, S.assetStore],
  apply(ctx) {
    ctx.routes.adopt(historyRoutes(need<HistoryStore>(ctx, S.history), need<AssetStore>(ctx, S.assetStore)))
  },
}

export const kvPlugin: PluginModule = {
  name: 'kv',
  inject: [S.kvStore],
  apply(ctx) {
    ctx.routes.adopt(kvRoutes(need<KvStore>(ctx, S.kvStore)))
  },
}

export const canvasOpsPlugin: PluginModule = {
  name: 'canvas-ops',
  inject: [S.doc, S.canvasStore, S.canvasResources],
  apply(ctx) {
    const store = need<CanvasStore>(ctx, S.canvasStore)
    const resources = need<CanvasResourceStore>(ctx, S.canvasResources)
    // 多画布：按画布 id 现建一个 CanvasDocument（增量写接口写哪张由路由的 :id 决定）。
    // 默认画布那份仍用宿主共享的实例（与 MCP / 网页读同一份、同一把写锁）。
    ctx.routes.adopt(
      canvasOpsRoutes(need<CanvasDocument>(ctx, S.doc), (canvasId) => new CanvasDocument(store, resources, canvasId)),
    )
  },
}

export const agentPluginRoutes: PluginModule = {
  name: 'agent-routes',
  inject: [S.agentConfig, S.agentRuntime],
  apply(ctx) {
    ctx.routes.adopt(
      agentRoutes(need<AgentConfigService>(ctx, S.agentConfig), need<AgentRuntime>(ctx, S.agentRuntime)),
    )
  },
}

export const agentSessionPlugin: PluginModule = {
  name: 'agent-sessions',
  inject: [S.agentSessions, S.agentRuntime, S.agentConfig, S.agentBranches, 'agentHub', 'agentQueue', 'agentGoal'],
  apply(ctx) {
    ctx.routes.adopt(
      agentSessionRoutes(
        need<AgentSessionStore>(ctx, S.agentSessions),
        need<AgentRuntime>(ctx, S.agentRuntime),
        need<AgentConfigService>(ctx, S.agentConfig),
        need<BranchStore>(ctx, S.agentBranches),
        // ★ pre-turn 钩子：把 Agent 中间件链挂上去（用户点 2）。
        //   用 ctx 自己即可 —— 中间件注册场（server/agent-mw）是**全插件共享的一张表**，
        //   任何插件的 ctx.registryOf 读到的都是同一份，不必再找"根 ctx"。
        (turn) => runAgentMiddleware(ctx, turn),
        // 托管通道（设计 §3.2）：给了它 = 「后台对话」模式（一轮不绑连接）
        need<SessionHub>(ctx, 'agentHub'),
        // 队列变化后的调度机会（设计 §3.3.2）：路由只管落盘，发不发由调度器决定。
        //
        // **forced**：这条回调的全部触发点都是**用户明确操作**（加 / 删 / 改 / 暂停 /
        // 恢复 / 引导）。调度器对「自动重试」有 30 秒冷却（防配置错误时刷日志），但那道闸
        // 不该挡住用户 —— 不传 forced 的话，上一次派发失败后用户点「恢复队列」也会在 30 秒内
        // 毫无反应（真机表现：点了没动静，只能等）。
        (canvasId, sessionId) => need<QueueScheduler>(ctx, 'agentQueue').tick(canvasId, sessionId, { forced: true }),
        // 目标运行时（设计 §3.4.4）：改预算 / 暂停 / 启动
        need<GoalRuntimePort>(ctx, 'agentGoal'),
      ),
    )
  },
}

/**
 * server-plugins 内置插件：后台插件的安装 / 卸载 / 清单（Task 7）。
 * 目录经服务注入（serverPluginsDir）。安全约束见 routes/serverPlugins.ts 文件头。
 */
export const serverPluginsPlugin: PluginModule = {
  name: 'server-plugins',
  inject: [S.serverPluginsDir, S.selfOrigin, 'serverPluginsLoaded'],
  apply(ctx) {
    ctx.routes.adopt(
      createServerPluginsRoutes({
        dir: need<string>(ctx, S.serverPluginsDir),
        // 现算：启动登记的快照 + 运行期热装 —— 否则热装/热卸后 loaded 不更新，前端据它误判（用户实测）
        loaded: () => [...new Set([...(ctx.tryGet<string[]>('serverPluginsLoaded') ?? []), ...hotLoadedNames()])],
        // 服务自己的 origin：用于跨源安装检查（审查发现：不传 origin 时该检查整段被跳过）。
        origin: need<string>(ctx, S.selfOrigin),
        // 可信哈希来源 = 本服务扫插件目录得到的清单（**不是**调用方声明的）。
        // 审查发现的真问题：比对调用方现算的哈希等于没校验（同一通道同一份字节）。
        trustedShaOf: async (id) => {
          const catalog = await buildPluginCatalog(ctx.tryGet<string | undefined>(S.pluginsDir))
          const entry = catalog.plugins.find((p) => p.id === id)
          return entry?.server?.sha256
        },
        // permissions 的消费点：从清单读出来，供诊断接口展示（计划明确要求）
        permissionsOf: async (id) => {
          const catalog = await buildPluginCatalog(ctx.tryGet<string | undefined>(S.pluginsDir))
          return catalog.plugins.find((p) => p.id === id)?.server?.permissions
        },
        // 热装/热卸：装完/卸完当场生效，用户不必重启服务（见 serverFramework/hotLoad.ts）
        hotInstall: (id) => hotInstallServerPlugin(ctx, need<string>(ctx, S.serverPluginsDir), id),
        hotUninstall: async (id) => hotUninstallServerPlugin(ctx, id),
      }),
    )
  },
}

export const pluginCatalogPlugin: PluginModule = {
  name: 'plugin-routes',
  inject: [S.pluginsDir],
  apply(ctx) {
    ctx.routes.adopt(pluginRoutes(ctx.tryGet<string | undefined>(S.pluginsDir)))
  },
}

/**
 * plugin-watch —— 插件热重载：盯插件产物目录，变了经 SSE（/api/plugin-events）通知前端重装。
 *
 * 前端（window.MiniCanvasPlugin）连这条 SSE，收到 { id, name } 就调 reload(id) 拉最新产物重装。
 * 目录经 S.pluginsDir 取（与 plugin-routes 同一个服务）。监视器按需起停（见 pluginWatch.ts）。
 */
export const pluginWatchPlugin: PluginModule = {
  name: 'plugin-watch',
  inject: [S.pluginsDir],
  apply(ctx) {
    ctx.routes.adopt(pluginWatchRoutes(ctx.tryGet<string | undefined>(S.pluginsDir)))
  },
}

/**
 * npm-plugins 内置插件：从 NPM 搜索 / 安装 / 更新 / 卸载插件（NPM 对接）。
 * 安全模型见 routes/npmPlugins.ts 文件头（confirm 必填 + scope 白名单 + installable 校验）。
 */
export const npmPluginsPlugin: PluginModule = {
  name: 'npm-plugins',
  inject: [S.pluginsDir, S.serverPluginsDir],
  apply(ctx) {
    ctx.routes.adopt(
      createNpmPluginsRoutes({
        pluginsDir: ctx.tryGet<string>(S.pluginsDir),
        serverPluginsDir: need<string>(ctx, S.serverPluginsDir),
        // scope 白名单：环境变量 MINI_CANVAS_NPM_SCOPES 可覆盖（逗号分隔，如 "@imohuan/,@acme/"）
        ...(process.env.MINI_CANVAS_NPM_SCOPES
          ? {
              scopeAllowlist: process.env.MINI_CANVAS_NPM_SCOPES.split(',')
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => (s.endsWith('/') ? s : s + '/')),
            }
          : {}),
        // 热装/热卸：装完当场生效（见 serverFramework/hotLoad.ts）
        hotInstall: (id) => hotInstallServerPlugin(ctx, need<string>(ctx, S.serverPluginsDir), id),
        hotUninstall: async (id) => hotUninstallServerPlugin(ctx, id),
      }),
    )
  },
}

/** 全部内置插件（顺序 = 默认装载序；实际激活顺序由 inject 依赖决定） */
export const BUILTIN_PLUGINS: PluginModule[] = [
  healthPlugin,
  eventsPlugin,
  pluginWatchPlugin,
  projectsPlugin,
  canvasesPlugin,
  assetsPlugin,
  actionsPlugin,
  jobsPlugin,
  historyPlugin,
  kvPlugin,
  canvasOpsPlugin,
  agentPluginRoutes,
  agentSessionPlugin,
  pluginCatalogPlugin,
  serverPluginsPlugin,
  npmPluginsPlugin,
]
