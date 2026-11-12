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
import type { PluginModule, PluginScope } from '@plume-canvas/kernel'
import { eventsRoutes } from '../../routes/events.js'
import { canvasesRoutes } from '../../routes/canvases.js'
import { actionsRoutes } from '../../routes/actions.js'
import { jobsRoutes } from '../../routes/jobs.js'
import { historyRoutes } from '../../routes/history.js'
import { kvRoutes } from '../../routes/kv.js'
import { canvasOpsRoutes } from '../../routes/canvasOps.js'
import { pluginRoutes } from '../../static.js'
import { createNpmPluginsRoutes } from '../../routes/npmPlugins.js'
import { projectsRoutes } from '../../routes/projects.js'
import { assetsRoutes } from '../../routes/assets.js'
import { hotInstallServerPlugin, hotUninstallServerPlugin } from '../../serverFramework/hotLoad.js'
import type { PluginRoots } from '../pluginRoots.js'
import { healthPlugin } from './health.js'
import { pluginWatchRoutes } from '../pluginWatch.js'
import { createPluginPresenceRoutes } from '../../routes/pluginPresenceRoute.js'
import { PluginPresence, PRESENCE_SWEEP_MS } from '../pluginPresence.js'
import type { KvStore } from '../../store/kvStore.js'
import type { CanvasStore } from '../../store/canvasStore.js'
import type { CanvasResourceStore } from '../../store/canvasResources.js'
import { CanvasDocument } from '../../mcp/canvasDoc.js'
import type { CanvasDocumentPool } from '../../mcp/canvasDocPool.js'
import type { ProviderRegistry } from '../../providers/registry.js'
import type { TaskManager } from '../../tasks/taskManager.js'
import type { HistoryStore } from '../../tasks/history.js'
import type { ProjectStore } from '../../store/projectStore.js'
import type { AssetStore } from '../../store/assetStore.js'
import { providerAdminRoutes, type ProviderAdminService } from '../../routes/providerAdmin.js'
import { authRoutes } from '../../routes/auth.js'
import type { AuthAccount } from '../../authAccount.js'
import type { AuthSession } from '../../authSession.js'
import { AUTH_WRITE_METHODS } from '../../serverFramework/routes.js'

/** 服务名常量（与 server.ts 的 inject 一一对应，改名要一起改） */
export const S = {
  kvStore: 'kvStore',
  canvasStore: 'canvasStore',
  canvasResources: 'canvasResources',
  projectStore: 'projectStore',
  assetStore: 'assetStore',
  doc: 'doc',
  /** 画布文档池（一个画布一个实例 → 写锁跨请求有效，见 mcp/canvasDocPool.ts） */
  docPool: 'docPool',
  providerRegistry: 'providerRegistry',
  taskManager: 'taskManager',
  history: 'history',
  agentConfig: 'agentConfig',
  agentSessions: 'agentSessions',
  agentRuntime: 'agentRuntime',
  agentBranches: 'agentBranches',
  /** 单轮对话用的「按需加载 SDK」函数（server.ts 里注入 loadSdk） */
  agentLoadSdk: 'agentLoadSdk',
  pluginsDir: 'pluginsDir',
  selfOrigin: 'selfOrigin',
  pluginRoots: 'pluginRoots',
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

/**
 * auth —— 登录接口（cloud-server 一侧）。
 *
 * 这几条**永远不要求登录**（它们就是拿来换会话的），并且注册在注册场里；
 * 中间件查注册场时会拿到 `public`（见下面的声明方式）。
 */
export const authPlugin: PluginModule = {
  name: 'auth',
  inject: ['authAccount', 'authSession'],
  apply(ctx) {
    const account = ctx.tryGet<AuthAccount>('authAccount')
    const session = ctx.tryGet<AuthSession>('authSession')
    // 纯框架单测没注入这两项：不装，不报错（登录接口只在真实服务里有意义）
    if (!account || !session) return
    const app = authRoutes({
      account,
      session,
      enabled: ctx.tryGet<boolean>('authEnabled') !== false,
      autoLoginLocal: ctx.tryGet<boolean>('autoLoginLocal') !== false,
    })
    // 逐条显式标 public：登录接口自己不能被登录挡住
    for (const r of app.routes) {
      const handler = r.handler as never
      if (r.method === 'GET') ctx.routes.get(r.path, handler, 'public')
      else ctx.routes.post(r.path, handler, 'public')
    }
  },
}

/**
 * plugin-presence 内置插件：调试监听的「在场」接口（心跳 / 告别 / 快照）。
 *
 * 只在开发调试时启用（见 server.ts 的开关）；纯测试与生产默认不装 ——
 * 这条通道的存在意义就是本机开发时回答「watch 还在不在跑」。
 */
export const pluginPresencePlugin: PluginModule = {
  name: 'plugin-presence',
  inject: [S.kvStore],
  apply(ctx) {
    // 在场表由宿主注入（server.ts）。纯框架测试没注入时直接跳过，不装死：
    // 没有这张表就没有「在不在线」可答，插件本身也没有别的职责。
    const presence = ctx.tryGet<PluginPresence>('pluginPresence')
    if (!presence) return
    const built = createPluginPresenceRoutes({
      presence,
      kv: need<KvStore>(ctx, S.kvStore),
    })
    ctx.routes.adopt(built.app)
    // 扫超时的定时器跟随插件作用域：卸载即停（不在路由工厂里自己起 setInterval）
    const timer = setInterval(() => void built.sweep(), PRESENCE_SWEEP_MS)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    ctx.effect(() => () => clearInterval(timer))
  },
}

export const canvasesPlugin: PluginModule = {
  name: 'canvases',
  inject: [S.canvasStore, S.canvasResources, S.doc, S.docPool],
  apply(ctx) {
    const pool = need<CanvasDocumentPool>(ctx, S.docPool)
    ctx.routes.adopt(
      canvasesRoutes(
        need<CanvasStore>(ctx, S.canvasStore),
        need<CanvasResourceStore>(ctx, S.canvasResources),
        need<CanvasDocument>(ctx, S.doc),
        // 多画布：整包写 / 写视口也要按 :id 落到那张画布上。
        // 不传的话路由只服务默认画布，对别的 id 一律 404 —— 从前固定写 doc，
        // 于是 `PUT /api/canvases/<别的画布>` 会静默覆盖默认画布（2026-10-14 实测）。
        // 从池里取（**不要 new**：实例不同 = 写锁不同，见 canvasDocPool 的说明）。
        (canvasId) => pool.for(canvasId),
        // 任务脚本的产物上传：子进程只有限节点短时令牌（没有管理令牌）。
        // 没注入就是 undefined → 行为与旧版一致。
        ctx.tryGet<(input: { token?: string; canvasId: string; slot?: string }) => boolean>('allowTaskUpload'),
      ),
    )
  },
}

/** 项目 / 画布两层组织（项目注册表 + 画布索引）。 */
export const projectsPlugin: PluginModule = {
  name: 'projects',
  inject: [S.projectStore, S.canvasStore, S.assetStore],
  apply(ctx) {
    /*
     * `adopt()` 会把这些路由标成 `legacy`（沿用旧前缀白名单）。列表 / 读取没问题，
     * 但历史白名单漏了若干写接口 —— 最严重的是 `DELETE /api/canvases/:id`：
     * 不登录就能删画布（2026-11-12 体检实测 200）。
     * 这里逐条注册：**写方法默认要登录**，读方法继续公开；规则与新插件一致。
     */
    const app = projectsRoutes(
      need<ProjectStore>(ctx, S.projectStore),
      need<CanvasStore>(ctx, S.canvasStore),
      need<AssetStore>(ctx, S.assetStore),
    )
    for (const r of app.routes) {
      const handler = r.handler as never
      const write = AUTH_WRITE_METHODS.has(r.method.toUpperCase())
      const auth = write ? 'admin' : 'public'
      switch (r.method) {
        case 'GET': ctx.routes.get(r.path, handler, auth); break
        case 'POST': ctx.routes.post(r.path, handler, auth); break
        case 'PUT': ctx.routes.put(r.path, handler, auth); break
        case 'PATCH': ctx.routes.patch(r.path, handler, auth); break
        case 'DELETE': ctx.routes.delete(r.path, handler, auth); break
        default: ctx.routes.all(r.path, handler, auth); break
      }
    }
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
    // 账号清单来自 providerAdmin（配置里的 platforms）。
    // 注意：本插件排在 providerAdmin 之前，装配那一刻它还不在 —— 延迟到请求时再取，
    // 否则（实测）动作清单永远拿不到账号列表，二级菜单就出不来。
    ctx.routes.adopt(
      actionsRoutes(need<ProviderRegistry>(ctx, S.providerRegistry), (id) => {
        const admin = ctx.tryGet<{ accountsOf(id: string): Array<{ id: string; name?: string; default?: boolean }> }>(
          'providerAdmin',
        )
        return admin ? admin.accountsOf(id) : []
      }),
    )
  },
}

/**
 * provider-admin 内置插件：平台管理接口（设置面板「平台」页的数据源）。
 * providerAdmin 服务由 server.ts 建好注入（含目录 / 配置存取 / 重扫）。
 */
export const providerAdminPlugin: PluginModule = {
  name: 'provider-admin',
  inject: [S.providerRegistry, 'providerAdmin'],
  apply(ctx) {
    ctx.routes.adopt(
      providerAdminRoutes(
        need<ProviderRegistry>(ctx, S.providerRegistry),
        need<ProviderAdminService>(ctx, 'providerAdmin'),
      ),
    )
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
  inject: [S.doc, S.docPool],
  apply(ctx) {
    const pool = need<CanvasDocumentPool>(ctx, S.docPool)
    // 多画布：增量写接口写哪张由路由的 :id 决定。
    // 文档从池里取（同一张画布永远同一个实例 = 同一把写锁）—— 从前每次请求 new 一个，
    // 于是「与 MCP / 网页同一把写锁」这句话在非默认画布上不成立，并发写会互相覆盖。
    ctx.routes.adopt(
      canvasOpsRoutes(
        need<CanvasDocument>(ctx, S.doc),
        (canvasId) => pool.for(canvasId),
        // 任务脚本的节点写：只允许改它自己那个节点（没注入就是 undefined）。
        ctx.tryGet<(input: { token?: string; canvasId: string; body: Record<string, unknown> }) => boolean>('verifyTaskWrite'),
      ),
    )
  },
}

export const pluginCatalogPlugin: PluginModule = {
  name: 'plugin-routes',
  inject: [S.pluginsDir, S.pluginRoots],
  apply(ctx) {
    // 有 pluginRoots（正常服务）就按「全局优先 + 随包兜底」解析；
    // 只有 pluginsDir（单测的最小装配）时退化成单目录。
    const roots = ctx.tryGet<PluginRoots | undefined>(S.pluginRoots)
    ctx.routes.adopt(pluginRoutes(roots ?? ctx.tryGet<string | undefined>(S.pluginsDir)))
  },
}

/**
 * plugin-watch —— 插件热重载：盯插件产物目录，变了经 SSE（/api/plugin-events）通知前端重装。
 *
 * 前端（window.PlumePlugin）连这条 SSE，收到 { id, name } 就调 reload(id) 拉最新产物重装。
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
  inject: [S.pluginsDir],
  apply(ctx) {
    ctx.routes.adopt(
      createNpmPluginsRoutes({
        pluginsDir: need<string>(ctx, S.pluginsDir),
        // scope 白名单：环境变量 PLUME_NPM_SCOPES 可覆盖（逗号分隔，如 "@imohuan/,@acme/"）
        ...(process.env.PLUME_NPM_SCOPES
          ? {
              scopeAllowlist: process.env.PLUME_NPM_SCOPES.split(',')
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => (s.endsWith('/') ? s : s + '/')),
            }
          : {}),
        // 热装/热卸：装完当场生效（见 serverFramework/hotLoad.ts）
        hotInstall: (id) => hotInstallServerPlugin(ctx, need<string>(ctx, S.pluginsDir), id),
        hotUninstall: async (id) => hotUninstallServerPlugin(ctx, id),
        audit: (e) => ctx.tryGet<{ append(x: unknown): Promise<void> }>('auditLog')?.append(e) ?? Promise.resolve(),
      }),
    )
  },
}

/** 全部内置插件（顺序 = 默认装载序；实际激活顺序由 inject 依赖决定） */
export const BUILTIN_PLUGINS: PluginModule[] = [
  healthPlugin,
  authPlugin,
  eventsPlugin,
  pluginPresencePlugin,
  pluginWatchPlugin,
  projectsPlugin,
  canvasesPlugin,
  assetsPlugin,
  actionsPlugin,
  providerAdminPlugin,
  jobsPlugin,
  historyPlugin,
  kvPlugin,
  canvasOpsPlugin,
  pluginCatalogPlugin,
  npmPluginsPlugin,
]
