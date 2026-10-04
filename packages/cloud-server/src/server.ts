/**
 * createCloudServer —— 组装 cloud-server 的 HTTP 应用（可测：不启真端口也能喂 Request 进去）。
 *
 * 四块能力：
 *   1. /api/kv/*                   设置 / 快捷这类小数据（KV）
 *   1b. /api/canvases/:id          画布数据 —— 一个画布一个文件夹（本体 / 视口 / 资源）
 *   2. /api/kv/events              SSE 实时通道
 *   3. /plugin-manifest.json + /plugins/*  外部插件清单与产物
 *   4. /                           托管 packages/ui 的构建产物（真画布）
 *
 * 前 3 项是纯接口，第 4 项是"打开就能看画布"的那一步。
 */
import path from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve, type ServerType } from '@hono/node-server'
import { KvStore } from './store/kvStore.js'
import { CanvasStore } from './store/canvasStore.js'
import { CanvasResourceStore } from './store/canvasResources.js'
import { resolvePluginsDir, resolveUiDist, uiRoutes } from './static.js'
import { mcpRoutes } from './routes/mcp.js'
import { createServerFramework } from './serverFramework/index.js'
import { BUILTIN_PLUGINS } from './plugins/builtin/routes.js'
import type { Context } from '@mini-canvas/kernel'
import { loadServerPluginsFromDir, DEFAULT_SERVER_PLUGINS_DIR } from './serverFramework/pluginLoader.js'
import { listPluginMcpTools } from './serverFramework/mcp.js'
import { CanvasDocument } from './mcp/canvasDoc.js'
import { TOOL_LIST } from './mcp/server.js'
import { ProviderRegistry } from './providers/registry.js'
import { loadProvidersFromDir, DEFAULT_PROVIDERS_DIR } from './providers/load.js'
import { createWeb2ApiProvider } from './providers/web2api/index.js'
import { watchProviders, type ProviderWatcher } from './providers/watch.js'
import { HistoryStore } from './tasks/history.js'
import { TaskManager } from './tasks/taskManager.js'
import { parseResourceRef } from './store/canvasResources.js'
import { AgentConfigService } from './agent/config.js'
import { AgentSessionStore } from './agent/sessionStore.js'
import { AgentRuntime } from './agent/runtime.js'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot } from './agent/agentPaths.js'

/** 默认端口：避开 ui dev 的 5288 与 mcp-server 的 8765 */
export const DEFAULT_PORT = 8865

/** 默认数据目录名（相对启动目录） */
export const DEFAULT_DATA_DIR = '.mini-canvas'

export interface CloudServerOptions {
  /** 监听端口（缺省 8865；0 = 让系统分配，单测/多实例用） */
  port?: number
  /** 数据根目录（缺省 .mini-canvas）：其下 kv/（小数据）与 canvases/（一个画布一个文件夹） */
  dir?: string
  /** 监听地址（缺省 127.0.0.1：本机自用，不对外暴露） */
  hostname?: string
  /** ui 构建产物目录；不传则自动探测 packages/ui/dist（探测不到 → 页面给"先构建"提示） */
  uiDist?: string
  /** 插件目录（含各插件的 dist）；不传则自动探测 packages/plugins */
  pluginsDir?: string
  /** 技能一键导入的来源目录（缺省 ~/.agents/skills；测试注入临时目录，避免读到真实家目录） */
  agentSkillSources?: string[]
  /** 是否装配 Agent（对话助手）。缺省 true；测试里可关掉 */
  agent?: boolean
  /** 平台提供方目录（后台的"投递箱"）；不传则用 <数据根>/providers */
  providersDir?: string
  /** 外挂后台插件的目录（丢 .js 进去即多一个后台插件）；不传则用 <数据根>/server-plugins */
  serverPluginsDir?: string
  /**
   * 是否盯着 provider 目录自动重载（缺省开）。测试里关掉，避免定时器影响用例。
   */
  watchProviders?: boolean
  /**
   * 是否同时提供 MCP 接口（`/mcp`）。缺省 **开**：
   * AI 与网页画布共用同一个服务、同一份数据，是这个服务的主要用法。
   * 只想当静态托管 + KV 接口用时可关掉。
   */
  mcp?: boolean
}

export interface CloudServer {
  /** Hono 应用（测试可直接 app.fetch(new Request(...))，不必启端口） */
  app: Hono
  /**
   * 内核上下文（后台插件系统的宿主 ctx）。
   * 暴露它用途有二：① 测试里验证「路由确实由插件提供」（卸载即失效）；
   * ② 将来宿主想动态装卸后台插件（热装需重建 app，见计划 §九）。
   */
  ctx: Context
  /** 启服务；resolve 后服务已在监听 */
  start(): Promise<{ port: number; url: string }>
  /** 停服务 */
  stop(): void
  /** 解析后的实际路径（启动时用于打印，便于确认数据落在哪） */
  paths: {
    data: string
    kv: string
    canvases: string
    providers: string
    serverPlugins: string
    ui?: string
    plugins?: string
  }
  /** MCP 是否开着 */
  mcpEnabled: boolean
  /** 开放的 MCP 工具清单（关闭时为空数组） */
  tools: readonly { name: string; description: string }[]
  /** 重扫 provider 目录（目录变了由 watcher 调；也可手动触发） */
  reloadProviders(): Promise<{ count: number; version: number }>
}

export async function createCloudServer(opts: CloudServerOptions = {}): Promise<CloudServer> {
  const port = opts.port ?? DEFAULT_PORT
  const dataDir = path.resolve(opts.dir ?? DEFAULT_DATA_DIR)
  const uiDist = await resolveUiDist(opts.uiDist)
  const pluginsDir = await resolvePluginsDir(opts.pluginsDir)

  // KV 只剩「设置 / 快捷」这类小数据；画布数据走「一个画布一个文件夹」
  const kvStore = new KvStore(dataDir)
  const canvasStore = new CanvasStore(dataDir)
  const canvasResources = new CanvasResourceStore(dataDir)
  // MCP 与网页界面共用同一份画布（同一个 CanvasStore）→ 两边看到的是同一张画布
  // 资源也共用同一套画布资源目录：MCP 传的图和网页端上传的图落在同一处、同内容还会去重
  const doc = new CanvasDocument(canvasStore, canvasResources)

  // ==================== Agent（画布内的对话助手）====================
  // 全局配置（模型 / 技能 / MCP / 审批规则）住 agent/；会话按画布住在 canvases/<id>/agent/。
  // SDK 只在真要跑一轮时才加载（懒 import），所以没配模型时启动照常成功。
  const agentEnabled = opts.agent !== false
  const agentConfig = new AgentConfigService(dataDir, opts.agentSkillSources)
  const agentSessions = new AgentSessionStore(dataDir)
  let sdkPromise: Promise<typeof import('@prismshadow/penguin-core')> | undefined
  const loadSdk = (): Promise<typeof import('@prismshadow/penguin-core')> =>
    (sdkPromise ??= import('@prismshadow/penguin-core'))
  const agentRuntime = new AgentRuntime({
    root: dataDir,
    store: agentSessions,
    agent: async () => {
      const sdk = await loadSdk()
      return sdk.createAgent({ root: agentRoot(dataDir), projectId: AGENT_PROJECT_ID, agentId: AGENT_ID })
    },
    makeUserMessage: (text, images) => {
      // 这里必须是同步的（运行时按需 await 不了），所以 SDK 的消息构造在首次 run 前
      // 已经由 loadSdk 预热过；构造器本身是纯函数，不碰网络。
      const sdk = sdkRef
      if (!sdk) throw new Error('SDK 尚未就绪：请先配置模型后重试')
      const messages: unknown[] = [sdk.userText(text)]
      for (const url of images ?? []) messages.push(sdk.imageUrlMessage(url))
      return messages
    },
    filterMcp: (names) => agentConfig.subsetMcp(names),
    readSkill: (name) => agentConfig.readSkillFile(name),
    log: (message, extra) => console.log('[agent] ' + message, extra ?? ''),
  })
  // 同步引用：makeUserMessage 是同步签名，SDK 一旦加载就填进来
  let sdkRef: typeof import('@prismshadow/penguin-core') | undefined
  void loadSdk().then((sdk) => {
    sdkRef = sdk
  }).catch(() => undefined)

  // ==================== 平台提供方（后台的「投递箱」）====================
  // 内置 web2api 用**和外挂完全一样**的接口注册；再扫一遍目录把外挂装进来。
  // 后台加一个平台 → 前端的模型下拉里自动多一项（前端一行不用改）。
  const providersDir = path.resolve(opts.providersDir ?? path.join(dataDir, DEFAULT_PROVIDERS_DIR))
  // 外挂后台插件的目录（与 providers 并列；丢 .js 进去即多一个后台插件）
  const serverPluginsDir = path.resolve(
    opts.serverPluginsDir ?? path.join(dataDir, DEFAULT_SERVER_PLUGINS_DIR),
  )
  const registry = new ProviderRegistry()
  registry.add(createWeb2ApiProvider())
  const scanned = await loadProvidersFromDir(providersDir)
  registry.load(scanned.providers)
  for (const f of scanned.failures) {
    console.warn('[cloud-server] provider 加载失败 ' + f.file + '：' + f.error)
  }

  // ==================== 任务与历史 ====================
  const history = new HistoryStore(dataDir)
  const tasks = new TaskManager({
    doc,
    registry,
    history,
    // 节点里存的是画布内引用 res:<hash>；provider 拿不到"相对引用"，
    // 这里按**当前画布**换成真实可取的地址。
    resolveResourceUrl: (canvasId, ref) => {
      const name = parseResourceRef(ref)
      return name ? '/api/canvases/' + canvasId + '/resources/' + name : ref
    },
    onError: (message, err) => console.warn(message, err),
  })

  /**
   * 历史变化 → 惊动实时通道。
   *
   * 为什么必须这一步：SSE 靠的是**写事件**（kvStore / canvasStore），
   * 而历史写在 `history.json`、不经过它们 —— 不额外喊一声，后台记了账前端也收不到通知，
   * 用户就会看到"我的历史里没有刚生成的那张图"。
   *
   * 落在 `config` 域：它是"后台的元信息"，不是画布内容。
   * 前端一条 SSE 不过滤类型，所以照样收得到。
   */
  history.onChange(() => {
    void kvStore.set('config', 'history-rev', Date.now()).catch(() => {
      /* 只是提醒信号，写失败不影响归档本身 */
    })
  })

  // ==================== 插件宿主（后台插件系统）====================
  // 12 组路由不再是手写的 app.route(...)，而是「内置插件」经 ctx.routes 装载（见 plugins/builtin/）。
  // 这是「后台也能像前端那样丢文件扩展」的落地：新增接口 = 写一个插件。
  // root 传给 framework：ctx.store 的插件私有数据落在数据根下的 plugin-data/（审查发现：
  // 不传会落到 process.cwd()，多实例/换目录会写错位置）。
  const host = createServerFramework({ root: dataDir })
  const app = host.app

  // ---- 装配阶段（顺序即匹配优先级；全部必须在 start() 之前完成，Hono 首次 fetch 后冻结）----
  // ① 跨域：**必须最先**（实测：cors 后注册对已注册路由不生效）
  app.use('*', cors())

  // ② 把宿主建好的实例按名上架（内置插件经 inject 取用；见 §三·补 服务名表）
  host.ctx.inject('kvStore', kvStore)
  host.ctx.inject('canvasStore', canvasStore)
  host.ctx.inject('canvasResources', canvasResources)
  host.ctx.inject('doc', doc)
  host.ctx.inject('providerRegistry', registry)
  host.ctx.inject('taskManager', tasks)
  host.ctx.inject('history', history)
  host.ctx.inject('pluginsDir', pluginsDir)
  host.ctx.inject('serverPluginsDir', serverPluginsDir)
  // 服务自己的 origin：用于后台插件安装的跨源检查（不传等于关掉该检查）
  host.ctx.inject('selfOrigin', `http://${opts.hostname ?? '127.0.0.1'}:${port}`)
  if (agentEnabled) {
    host.ctx.inject('agentConfig', agentConfig)
    host.ctx.inject('agentSessions', agentSessions)
    host.ctx.inject('agentRuntime', agentRuntime)
  }

  // ③ 登记内置插件。**顺序即路由优先级**（Hono 先注册者优先）：
  //    events 必须排在 kv 之前 —— /api/kv/events 是静态、/api/kv/:type 是动态，
  //    顺序反了 SSE 端点会被动态路由吃掉（见 routePriority.test.ts 实测）。
  //    BUILTIN_PLUGINS 的数组顺序就按这条排好，别乱调。
  for (const plugin of BUILTIN_PLUGINS) {
    // agent 相关的两组按开关决定装不装
    if (!agentEnabled && (plugin.name === 'agent-routes' || plugin.name === 'agent-sessions')) continue
    host.ctx.plugin(plugin)
  }

  // ③.5 外挂后台插件：**丢一个 .js 进目录 = 多一个后台插件**（Task 4）。
  //     必须在 host.start() 之前登记（路由代理是 start 时一次性 flush 的）。
  //     安全边界见 serverFramework/pluginLoader.ts 文件头（等于"把 JS 当服务端代码执行"，
  //     信任边界 = 谁能写那个目录）。
  const scannedServerPlugins = await loadServerPluginsFromDir(serverPluginsDir)
  for (const f of scannedServerPlugins.failures) {
    console.warn('[cloud-server] 后台插件加载失败 ' + f.file + '：' + f.error)
  }
  const registeredServerPlugins: string[] = []
  for (const mod of scannedServerPlugins.modules) {
    try {
      host.ctx.plugin(mod)
      registeredServerPlugins.push(mod.name)
    } catch (err) {
      // 重名等登记问题：记一条、继续装别的（别让一个坏插件把整个服务带崩）
      console.warn(
        '[cloud-server] 后台插件 ' + mod.name + ' 登记失败：' + (err instanceof Error ? err.message : String(err)),
      )
    }
  }
  // 运行时观测面（审查 P1）：目录可写 = 服务端代码执行，部署者必须能一眼看清"加载了哪些外挂插件"。
  // 启动日志逐个列出；GET /api/server-plugins 也带 loaded 状态（见 builtin/routes.ts）。
  if (registeredServerPlugins.length > 0 || scannedServerPlugins.failures.length > 0) {
    console.log(
      '[cloud-server] 外挂后台插件 ' +
        registeredServerPlugins.length +
        ' 个: [' +
        registeredServerPlugins.join(', ') +
        ']' +
        (scannedServerPlugins.failures.length > 0 ? '；失败 ' + scannedServerPlugins.failures.length + ' 个' : ''),
    )
  }
  host.ctx.inject('serverPluginsLoaded', registeredServerPlugins)

  // ④ MCP 直挂（**不收敛成插件**：SDK transport，与「代理 handler」模型不兼容）。
  //    ui 静态托管放在最后（见 ⑤ 的 afterRoutes）——它是兜底通配，必须排在插件路由之后。
  const mcpEnabled = opts.mcp !== false
  if (mcpEnabled) {
    app.route(
      '/',
      mcpRoutes(doc, registry, tasks, () => listPluginMcpTools(host.ctx)),
    )
  }

  // ⑤ 装载插件 + 把插件路由翻成代理；**插件路由挂好之后**再挂 ui 兜底。
  //    顺序不可调换：ui 的 get('*') 若先挂，会把 /health、/api/* 全吃掉（实测）。
  await host.start(() => {
    app.route('/', uiRoutes(uiDist))
  })

  let server: ServerType | undefined
  const hostname = opts.hostname ?? '127.0.0.1'

  /**
   * 重扫目录并整体替换清单。
   *
   * 用 `replaceAll`（清空再装）而不是"追加"：删掉的 provider 必须**一起消失**，
   * 否则它的动作会永远留在前端下拉里、点下去必然失败。
   */
  async function reloadProviders(): Promise<{ count: number; version: number }> {
    const scanned = await loadProvidersFromDir(providersDir)
    registry.replaceAll([createWeb2ApiProvider(), ...scanned.providers])
    for (const f of scanned.failures) {
      console.warn('[cloud-server] provider 加载失败 ' + f.file + '：' + f.error)
    }
    return { count: registry.listActions().length, version: registry.contentVersion }
  }

  // 盯目录：后台丢一个 provider 进去，前端的菜单几秒内自己跟上
  const watcher: ProviderWatcher | undefined = opts.watchProviders === false
    ? undefined
    : watchProviders(providersDir, async () => {
        const r = await reloadProviders()
        console.log('[cloud-server] provider 目录已变更，动作清单更新为 ' + r.count + ' 项')
      })

  return {
    app,
    ctx: host.ctx,
    paths: {
      data: dataDir,
      kv: path.join(dataDir, 'kv'),
      canvases: path.join(dataDir, 'canvases'),
      providers: providersDir,
      serverPlugins: serverPluginsDir,
      ...(uiDist ? { ui: uiDist } : {}),
      ...(pluginsDir ? { plugins: pluginsDir } : {}),
    },
    mcpEnabled,
    tools: mcpEnabled ? TOOL_LIST : [],
    reloadProviders,
    start() {
      return new Promise((resolve, reject) => {
        let listening = false
        const s = serve({ fetch: app.fetch, port, hostname }, (info) => {
          listening = true
          // 端口传 0 时真实端口由系统分配，以 info.port 为准
          resolve({ port: info.port, url: `http://${hostname}:${info.port}` })
        })
        // 端口被占用/无权限：把错误交给调用方（CLI 可换端口重试），而不是静默挂着
        s.on('error', (err: NodeJS.ErrnoException) => {
          server = undefined
          if (!listening) reject(err)
        })
        server = s
      })
    },
    stop() {
      watcher?.stop()
      agentRuntime.disposeAll()
      void tasks.dispose()
      // 回收插件作用域：jobs 的定时器、store 的命名空间清理都在插件的 ctx.effect 里，
      // 不调它永不 dispose（审查发现的泄漏）。
      host.stop()
      server?.close()
      server = undefined
    },
  }
}
