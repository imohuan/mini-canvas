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
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { cors } from 'hono/cors'
import { serve, type ServerType } from '@hono/node-server'
import { KvStore } from './store/kvStore.js'
import { CanvasStore } from './store/canvasStore.js'
import { CanvasResourceStore } from './store/canvasResources.js'
import { ProjectStore } from './store/projectStore.js'
import { AssetStore } from './store/assetStore.js'
import { resolvePluginsDir, resolveUiDist, uiRoutes } from './static.js'
import { fileURLToPath } from 'node:url'
import { mcpRoutes } from './routes/mcp.js'
import { createServerFramework } from './serverFramework/index.js'
import { BUILTIN_PLUGINS } from './plugins/builtin/routes.js'
import { createAgentPlugins } from './plugins/builtin/agentRoutes.js'
import { PluginPresence } from './plugins/pluginPresence.js'
import { loadServerPluginsFromDir, DEFAULT_SERVER_PLUGINS_DIR } from './serverFramework/pluginLoader.js'
import { bindHotLoadedTracking } from './serverFramework/hotLoad.js'
import { listPluginMcpTools } from './serverFramework/mcp.js'
import { CanvasDocument } from './mcp/canvasDoc.js'
import { CanvasDocumentPool } from './mcp/canvasDocPool.js'
import { TOOL_LIST } from './mcp/server.js'
import { ProviderRegistry } from './providers/registry.js'
import type { Provider } from './providers/types.js'
import { loadProvidersFromDir, seedDefaultProviders, DEFAULT_PROVIDERS_DIR } from './providers/load.js'
import { watchProviders, type ProviderWatcher } from './providers/watch.js'
import {
  readProviderConfig,
  writeProviderConfig,
  isSafeFileName,
  platformOfKey as providerIdOfKey,
  type ProviderConfigFile,
} from './providers/configStore.js'
import { HistoryStore } from './tasks/history.js'
import { TaskManager } from './tasks/taskManager.js'
import { createAgentChatProvider } from './tasks/agentChatProvider.js'
import { DEFAULT_CANVAS_ID, canvasDir } from './store/canvasPaths.js'
import { makeResolveResourceUrl } from './tasks/resourceResolver.js'

/**
 * 本包根目录（src/ 的上一级；打包后是 dist/ 的上一级）。
 * 用来找随包的默认 provider（providers/*.js）与 assets。
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
import { makeFetchSelfBytes } from './tasks/selfFetch.js'
import { branchStore } from '@plume-canvas/plugin-agent/server/agent/branchStore.js'
import { testModelRoutes, testModelBaseUrl, TEST_PROVIDER, TEST_MODEL_ID, TEST_API_KEY } from '@plume-canvas/plugin-agent/server/agent/testModel.js'
import { assembleAgentServices, type AgentServices } from '@plume-canvas/plugin-agent/server/agent/assembleAgent.js'
import { buildRuntimeContext, runtimeContextSection } from '@plume-canvas/plugin-agent/server/agent/runtimeContext.js'
import { listAgentPromptSections, runAgentMiddleware } from './serverFramework/agent.js'
import { adminActionFor, createAdminAuth, isAdminPath } from './adminAuth.js'
import { createDebugOrigin } from './debugOrigin.js'
import { createAuditLog } from './audit.js'
import { createRequestTrust, normalizeOriginEntry } from './requestTrust.js'
import { createTaskTokens } from './taskToken.js'
import { REFERENCE_MARKUP_GUIDE } from '@plume-canvas/plugin-agent/server/agent/referenceMarkup.js'
import type { CloudServerOptions, CloudServer } from './serverTypes.js'

/** 默认端口：避开 ui dev 的 5288 与 mcp-server 的 8765 */
export const DEFAULT_PORT = 8865

/** 默认数据目录名（相对启动目录） */
export const DEFAULT_DATA_DIR = '.plume'

export type { CloudServerOptions, CloudServer } from './serverTypes.js'

export async function createCloudServer(opts: CloudServerOptions = {}): Promise<CloudServer> {
  const port = opts.port ?? DEFAULT_PORT
  const dataDir = path.resolve(opts.dir ?? DEFAULT_DATA_DIR)
  const uiDist = await resolveUiDist(opts.uiDist)
  const pluginsDir = await resolvePluginsDir(opts.pluginsDir)

  // ---- 管理面安全：令牌 / 审计 / 来源边界（方案 commit 2/4/5）----
  // 三条都在建 app 之前准备好：中间件要在装配阶段（host.start 之前）挂上。
  // 关鉴权必须显式配合 ALLOW_INSECURE —— 防止一个环境变量就把管理面敞开。
  // 单测里默认关掉：`app.fetch(new Request('http://localhost/...'))` 没有真实 Host，
  // 而且用例本身就是在测业务语义。**生产环境（非 VITEST）默认全开**，
  // 命令行若显式 `--no-admin-auth`，仍要求 PLUME_ALLOW_INSECURE=1（见 cli.ts）。
  const testEnv = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test'
  const adminAuthEnabled = opts.adminAuth ?? !testEnv
  const adminAuth = await createAdminAuth({
    dataDir,
    enabled: adminAuthEnabled,
    ...(opts.adminToken ?? process.env.PLUME_ADMIN_TOKEN
      ? { fixedToken: opts.adminToken ?? process.env.PLUME_ADMIN_TOKEN }
      : {}),
  })
  const audit = createAuditLog(path.join(dataDir, 'audit.log'))
  // 任务脚本（子进程）只能拿这一种令牌：绑定 canvas+node，只允许写自己那一格。
  const taskTokens = createTaskTokens()

  // KV 只剩「设置 / 快捷」这类小数据；画布数据走「一个画布一个文件夹」
  const kvStore = new KvStore(dataDir)
  const canvasStore = new CanvasStore(dataDir)
  const canvasResources = new CanvasResourceStore(dataDir)
  // 项目 / 资产：画布文件夹路径不变，项目归属走索引（见 store/projectStore.ts 文件头）
  const projectStore = new ProjectStore(dataDir)
  const assetStore = new AssetStore(dataDir)
  // MCP 与网页界面共用同一份画布（同一个 CanvasStore）→ 两边看到的是同一张画布
  // 资源也共用同一套画布资源目录：MCP 传的图和网页端上传的图落在同一处、同内容还会去重
  const doc = new CanvasDocument(canvasStore, canvasResources)
  /**
   * **一个画布一个文档实例**（写锁要跨请求有效，见 canvasDocPool 的说明）。
   *
   * 从前几处各自 `new CanvasDocument(...)`：实例不同 = 锁不同，于是「两者都收进同一把写锁」
   * 在非默认画布上不成立 —— 后台写进度与网页端保存会互相覆盖，节点永远停在 60%。
   * 默认画布那份照旧用上面这个 `doc`（预登记进池，避免出现两个实例）。
   */
  const docPool = new CanvasDocumentPool(canvasStore, canvasResources, [
    { canvasId: DEFAULT_CANVAS_ID, doc },
  ])

  // ==================== Agent（画布内的对话助手）====================
  // 全局配置（模型 / 技能 / MCP / 审批规则）住 agent/；会话按画布住在 canvases/<id>/agent/。
  // SDK 只在真要跑一轮时才加载（懒 import），所以没配模型时启动照常成功。
  const agentEnabled = opts.agent !== false
  /**
   * 非空别名：只在 `agentEnabled` 守卫内使用（见下方 host 建好后的装配）。
   * 用访问器把“可能未装配”收成一处明确报错，而不是到处写 `?.` 把缺陷藏起来。
   */
  let agentServicesRef: AgentServices | undefined
  const agentServices = (): AgentServices => {
    if (!agentServicesRef) throw new Error('[cloud-server] Agent 已关闭，不能访问 Agent 服务')
    return agentServicesRef
  }

  // ==================== 平台提供方（后台的「投递箱」）====================
  // 全部走外挂文件：目录里丢一个 .js 就是一个平台，热加载。
  // 随包自带一份默认的（本包 providers/web2api-*.js）：启动时**只补缺失的文件**
  // 到数据根，用户改过/自己写的绝不覆盖。
  // 后台加一个平台 → 前端的模型下拉里自动多一项（前端一行不用改）。
  const providersDir = path.resolve(opts.providersDir ?? path.join(dataDir, DEFAULT_PROVIDERS_DIR))
  const providerConfigFile = path.join(dataDir, 'providers-config.json')
  const providerConfig: ProviderConfigFile = await readProviderConfig(providerConfigFile)
  const seeded = await seedDefaultProviders(path.join(PACKAGE_ROOT, 'providers'), providersDir, {
    skip: providerConfig.deletedFiles,
  })
  if (seeded.length > 0) {
    console.log('[cloud-server] 已铺入默认 provider：' + seeded.join(', '))
  }
  // 外挂后台插件的目录（与 providers 并列；丢 .js 进去即多一个后台插件）
  const serverPluginsDir = path.resolve(
    opts.serverPluginsDir ?? path.join(dataDir, DEFAULT_SERVER_PLUGINS_DIR),
  )
  const registry = new ProviderRegistry()
  /**
   * 内置 agent-chat 平台：首次启动装一次，之后每次 reload 也要补一份。
   * 收成一处，免得两条路径的构造参数写歪（第一次热重载就是这么把它弄丢的）。
   */
  const agentChatProvider = (): Provider =>
    createAgentChatProvider({
      get config() { return agentServices().config },
      loadSdk: () => agentServices().loadSdk(),
      onError: (message, err) => console.warn(message, err),
    })
  const scanned = await loadProvidersFromDir(providersDir, { config: providerConfig })
  registry.load(scanned.providers)
  // Agent 对话（任务化）：**懒取** Agent 服务 —— 这里（第 159 行）比 assembleAgentServices
  // （第 303 行）早，直接 agentServices() 会把 agentBranch 这类「Agent 未装配」场景炸掉。
  // 用闭包延迟到第一次任务提交时才解析；Agent 关闭时不注册 provider，
  // /api/jobs 的 agent:chat 会明确报「未找到动作」。
  if (agentEnabled) {
    registry.add(agentChatProvider())
  }
  /** providerId → 文件名（管理路由据此定位文件；同 id 多文件时后装载者胜） */
  const providerFileOf = new Map<string, string>()
  for (let i = 0; i < scanned.providers.length; i++) {
    providerFileOf.set(scanned.providers[i]!.id, scanned.files[i] ?? '')
  }
  for (const f of scanned.failures) {
    console.warn('[cloud-server] provider 加载失败 ' + f.file + '：' + f.error)
  }

  // ==================== 任务与历史 ====================
  const history = new HistoryStore(dataDir)
  /**
   * 实际监听端口（start() 之后才有真值；port=0 时由系统分配）。
   * 「自己取字节」要靠它判断"是不是本服务的地址"，所以延迟到调用时再读。
   */
  let actualPort: number | undefined
  /**
   * 运行环境上下文（后台地址 + 目录），见 agent/runtimeContext.ts。
   *
   * 为什么是**闭包**而不是一个定值：真实端口要等 listen 回调才知道（port=0 由系统分配、
   * CLI 换端口兜底），而 Agent 配置面在监听之前就会被读（设置页、单测）。
   * 闭包让「读的时刻」决定用哪个端口，于是不需要「等端口定了再补写一次」这种时序技巧。
   */
  const runtimeContext = (): ReturnType<typeof buildRuntimeContext> =>
    buildRuntimeContext({
      baseUrl: 'http://' + (opts.hostname ?? '127.0.0.1') + ':' + String(actualPort ?? port),
      dataRoot: dataDir,
    })
  // 运行环境上下文的首次灌入在 Agent 服务装配完成之后（见下方 host 建好后的位置）——
  // 放在这里会早于 assembleAgentServices，`agentServices()` 还没有可访问的对象。
  /**
   * 「服务器自己把画布里的地址取回来」（见 tasks/selfFetch 的说明）。
   *
   * 在 TaskManager 之前建：参考图解析要用它。app 与真实端口都在后面才就绪，
   * 所以这里是**延迟取值**的闭包（真正调用时早就齐了）。
   */
  const fetchSelfBytes = makeFetchSelfBytes({
    fetch: (req) => host.app.fetch(req),
    origin: () => `http://${hostname}:${actualPort ?? port}`,
    // 用**同一份** Host 白名单：局域网 IP / 反代域名访问时，画布里存的绝对地址
    // 才能被认成「自己」（否则又退回裸地址，web2api 报图片不存在）。
    trustedHosts: () => trustedHosts,
  })
  // 参考图交给 web2api 时要转成 **data URL**（它自己会落盘）——
  // 两个服务可能不在同一台机器，地址（尤其 127.0.0.1）它够不到；内嵌字节则与网络无关。
  const tasks = new TaskManager({
    doc,
    // 多画布：任务的进度/终态写进**它所属的那张画布**（用默认 doc 会写错画布 → 进度卡 0）
    docForCanvas: (canvasId) => docPool.for(canvasId),
    registry,
    history,
    /**
     * 生成成功 → 把产物登记进**资产目录**（用户口径：资产 = 所有生成过的产物）。
     *
     * 关键（与 writeMediaFields 同一条规矩）：不能把 provider 的地址原样登记 —— 那是另一个服务的
     * 地址，换机器/换端口就取不到，资产面板里全是坏图（用户实测：图挂了、预览打不开）。
     * 必须先把字节收进本画布资源目录，再登记**同源地址**。
     */
    onArtifact: (canvasId, urls) => {
      const docFor = docPool.for(canvasId)
      for (const url of urls) {
        void (async () => {
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
            if (!res.ok) throw new Error("取产物失败 " + res.status)
            const bytes = new Uint8Array(await res.arrayBuffer())
            const fileName = url.split("?")[0]?.split("/").pop() || undefined
            const stored = await docFor.saveResource(bytes, fileName ? { fileName } : {})
            const sameOrigin = typeof stored === "string" ? stored : (stored as { url?: string }).url
            if (sameOrigin) await assetStore.addByUrl({ url: sameOrigin, name: fileName, canvasId })
          } catch (err) {
            console.warn("[cloud-server] 产物登记资产失败，回落原始地址：" + url, err)
            await assetStore.addByUrl({ url, name: url.split("/").pop(), canvasId }).catch(() => undefined)
          }
        })()
      }
    },
    /**
     * 参考图要变成 provider 真能取到的内容（data URL）—— 它拿不到我们的相对地址。
     *
     * 解析逻辑收在 tasks/resourceResolver（单独可测）。两条快路读磁盘（画布资源 / 上传资产），
     * 其余**本服务自己的地址**（风格库 `/api/style-library/file?name=…` 这类）走**通用自请求**；
     * 别的域名不碰（SSRF 边界）。认不出 / 取不到就原样返回，让上游自己报错。
     *
     * 为什么是"通用"而不是枚举：枚举就会漏 —— 已经漏过三次（资产 → 画布资源 → 风格库），
     * 每次都要回来加一条。现在新增任何资源路由都自动能用（用户口径）。
     */
    resolveResourceUrl: makeResolveResourceUrl({
      canvasResources,
      readAssetBytes: (name) => assetStore.readFile(name),
      fetchSelfBytes: (url) => fetchSelfBytes(url),
    }),
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
  // hotFallback：让运行期从 NPM 装进来的后台插件**无需重启**即可命中路由
  // （见 serverFramework/routes.ts ④）。真实服务开启；纯测试的 framework 默认不开。
  const host = createServerFramework({ root: dataDir, hotFallback: true })
  /**
   * Agent 关闭时**一个对象都不建**。
   *
   * 此前 Config / SessionStore / SDK 预热 / goal hook 都在开关判断之前执行，
   * `agent: false` 只是少注册两条路由。现在整组服务由 assembleAgentServices 一次建成，
   * 开关为假时它根本不会被调用 —— 没有 Config、没有 SessionStore、没有 SDK 懒加载。
   */
  if (agentEnabled) {
    // Agent 后台的实现已经住在 plugin-agent 里（本文件只做一次装配与端口注入）。
    // 端口一律**显式注入**：插件不 import 宿主的 store / serverFramework，
    // 这样它的后台半才能打成自包含单文件（data: URL 加载器要求）。
    agentServicesRef = await assembleAgentServices({
      ports: {
        dataDir,
        canvasDirOf: (canvasId) => canvasDir(dataDir, canvasId),
        kv: kvStore,
        promptSections: () => listAgentPromptSections(host.ctx),
        runMiddleware: (turn) => runAgentMiddleware(host.ctx, turn),
        skillSources: opts.agentSkillSources,
      },
    })
    // 先灌一次（此刻用的是请求端口）：监听前读配置也能拿到目录与占位符清单。
    agentServicesRef.config.setRuntimeContext(runtimeContext())
  }
  // 设置页要列「后台自动附加了哪些内容」——把注册场的读口子交给 config（它不认识插件系统）。
  // 必须**在 host 建好之后**：`host.ctx` 是 const，放前面会撞暂时性死区。
  if (agentEnabled) agentServices().config.setPromptSectionViews(() => listAgentPromptSections(host.ctx))
  const app = host.app

  // ---- 装配阶段（顺序即匹配优先级；全部必须在 start() 之前完成，Hono 首次 fetch 后冻结）----
  // ① 跨域：**必须最先**（实测：cors 后注册对已注册路由不生效）。
  //    收紧成同源 + 显式白名单：默认 `origin: '*'` 等于任何网页都能读写（2026-10-19 实测）。
  //    注意 `Origin: null`（沙箱 iframe）不在这里放行 —— 视觉节点已改宿主代发（commit 1）。
  /**
   * Host 白名单。**故意用可变数组**：`port: 0` 时真实端口要等 listen 回调才知道，
   * 而白名单在装配阶段（host.start 之前）就被 cors 与 requestTrust 捕获了。
   * 原地替换内容（而不是换一个新数组）让那两处闭包都跟着更新 ——
   * 否则 `createCloudServer({ port: 0 })` 起来后所有请求都会因为 `host: 127.0.0.1:0` 被拒。
   */
  const trustedHosts: string[] = []
  const fillTrustedHosts = (listenPort: number): void => {
    trustedHosts.splice(
      0,
      trustedHosts.length,
      ...new Set([
        `${opts.hostname ?? '127.0.0.1'}:${listenPort}`,
        `localhost:${listenPort}`,
        // 监听 0.0.0.0 / :: 时，本机用 127.0.0.1 访问是**最常见的写法**（启动日志也印它）。
        // 不把这两个补进来，`--host 0.0.0.0` 之后浏览器打开 127.0.0.1 会被来源边界 403 ——
        // 而页面上只写着「请求来源不受信任」，看不出是白名单少了本机回环（实测踩到）。
        ...(opts.hostname === '0.0.0.0' || opts.hostname === '::'
          // IPv6 的 Host 必须带方括号（浏览器就是这么发的），不要加无方括号的写法
          ? [`127.0.0.1:${listenPort}`, `[::1]:${listenPort}`]
          : []),
        ...(opts.trustedHosts ?? []),
        ...(process.env.PLUME_TRUSTED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      ]),
    )
  }
  fillTrustedHosts(port)
  /**
   * Origin 白名单。同样**可变**：独立调试源是另一个端口，起来之后才知道地址，
   * 而调试页要带短令牌把产物写回本节点（跨源 POST），不放行它就 403。
   */
  const trustedOrigins: string[] = Array.from(
    new Set([
      ...(opts.trustedOrigins ?? []).map(normalizeOriginEntry),
      ...(process.env.PLUME_TRUSTED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(normalizeOriginEntry),
    ]),
  )
  /**
   * 「只放行一条窄通道」的来源（见 RequestTrustOptions.scopedOrigins）。
   * 现在只有独立调试源：它上面的页面是用户 HTML，只该能写回产物。
   */
  const scopedOrigins: Array<{ origin: string; paths: string[] }> = []
  const trustEnabled = opts.requestTrust ?? !testEnv
  app.use(
    '*',
    cors({
      // 只有明确认识的来源才回 ACAO；不认识的（含跨源恶意页）连预检都过不了。
      origin: (origin) => {
        if (!trustEnabled) return origin || '*'
        if (!origin) return ''
        try {
          const u = new URL(origin)
          // 归一后再比：配置里写成大写 scheme / 带尾斜杠（`http://localhost:5288/`）时，
          // 实请求能过来源边界，预检却回不了 ACAO —— 表现是「Failed to fetch」，最难查的一类。
          if (trustedOrigins.includes(u.origin)) return u.origin
          if (trustedHosts.includes(u.host.toLowerCase())) return origin
          // 调试源：它要跨源读自己的产物上传回执，所以回 ACAO。
          // 注意 CORS 回调拿不到路径，真正的门在下面的 requestTrust（scopedOrigins
          // 只放行 `/api/canvases/*/resources`）；别的路径即使预检过了，实请求也是 403。
          const scoped = scopedOrigins.find((s) => s.origin === u.origin)
          return scoped ? origin : ''
        } catch {
          return ''
        }
      },
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      // x-task-token：独立调试页（另一个端口）用它把产物写回本节点。
      // 不列在这里，跨源预检就会失败，页面上只剩一句「Failed to fetch」。
      allowHeaders: ['content-type', 'accept', 'x-admin-token', 'x-task-token'],
      maxAge: 600,
    }),
  )

  // ①.2 来源边界（Host/Origin，含 /mcp）—— 挂在 '*' 上：/mcp 是直挂路由，不在 /api/* 下。
  //      必须在 host.start() 之前：插件路由是 start() 时一次性 flush 成代理的。
  if (trustEnabled) {
    const trust = createRequestTrust({
      trustedHosts,
      trustedOrigins,
      scopedOrigins,
      allowOpaqueOrigin: false,
      // 来源边界先于令牌中间件返回，所以这里的拒绝要自己留痕：
      // 恶意 Origin / 伪造 Host / 不透明源 是最该被记下来的一类请求。
      onReject: async (r) => {
        await audit.append({
          action: 'auth-failed',
          method: r.method.toUpperCase(),
          path: r.path,
          token: 'missing',
          result: 'rejected',
          reason: r.reason,
          ...(r.header('origin') ? { origin: r.header('origin')! } : {}),
          ...(r.header('host') ? { host: r.header('host')! } : {}),
        })
      },
    })
    app.use('*', trust as never)
  }

  // ①.3 管理令牌：只拦「能执行代码 / 改画布 / 花钱」的入口（白名单在 adminAuth.ts）。
  //      OPTIONS 放行（预检不带令牌）；GET/HEAD 放行（读接口靠来源边界）。
  //      审计成对：令牌通过 → 记 attempt，路由跑完 → 补 ok（非 2xx/3xx 记 rejected）。
  //      没有成功记录的话，令牌泄露后根本回答不了「它被用来做了什么」。
  app.use('/api/*', async (c, next) => {
    const method = c.req.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next()
    if (!isAdminPath(method, c.req.path)) return next()
    // 任务脚本的产物上传：子进程没有管理令牌，只带一个「绑定 canvas+node 的短时令牌」。
    // 这里只做「看起来像脚本上传」的放行；真正的严格校验在路由里（必须带 slot、签名/过期/归属都要对）。
    // 也就是说：伪造 x-task-token 只能把请求送进路由，不能绕过路由那道关。
    // 脚本另一件要干的事：把产物字段写回本节点（`POST /api/canvases/:id/nodes`）。
    // 路由层那边会再核对「只能改自己这个节点」。
    if (
      method === 'POST' &&
      (c.req.path.startsWith('/api/canvases/') && (c.req.path.endsWith('/resources') || c.req.path.endsWith('/nodes'))) &&
      c.req.header('x-task-token')
    ) {
      // 只放行 POST：将来给这两条路径加 DELETE 时，不能让脚本令牌顺带进去。
      return next()
    }
    const verdict = adminAuth.verify(c.req.header('x-admin-token'))
    if (verdict !== 'ok') {
      await audit.append({
        action: 'auth-failed',
        method,
        path: c.req.path,
        token: verdict,
        result: 'rejected',
        ...(c.req.header('origin') ? { origin: c.req.header('origin')! } : {}),
        ...(c.req.header('host') ? { host: c.req.header('host')! } : {}),
      })
      return c.json(
        { ok: false, error: '需要管理令牌（x-admin-token）；见启动日志或 ' + (adminAuth.tokenFile ?? '<PLUME_ADMIN_TOKEN>') },
        403,
      )
    }
    const base = {
      action: adminActionFor(method, c.req.path),
      method,
      path: c.req.path,
      token: 'ok' as const,
      ...(c.req.header('origin') ? { origin: c.req.header('origin')! } : {}),
      ...(c.req.header('host') ? { host: c.req.header('host')! } : {}),
    }
    await audit.append({ ...base, result: 'attempt' })
    let status = 0
    try {
      await next()
      // 路由已经跑完：状态码决定结局。注意这里拿到的是**响应头已经写好**的状态码。
      status = c.res?.status ?? 0
    } catch (err) {
      // 路由抛异常 = 这次写没有成功；记下结局再把错误抛回去，别吞掉。
      await audit.append({ ...base, result: 'rejected', reason: 'threw' })
      throw err
    }
    await audit.append(
      status >= 200 && status < 400
        ? { ...base, result: 'ok' }
        : { ...base, result: 'rejected', reason: 'http-' + status },
    )
  })

  // ①.4 整画布覆盖（`PUT /api/canvases/:id` 与 `/view`）：**不要令牌**（首版取舍，
  //      靠来源边界），但必须留审计 —— 它是最彻底的一种改法（少一个节点它就没了），
  //      不留痕等于「谁把整张画布换掉了」这个问题永远答不出来。
  //      审查 N2 的实测就是这条：写完整张画布，audit.log 一行没多。
    app.use('/api/canvases/*', async (c, next) => {
    if (c.req.method.toUpperCase() !== 'PUT' || isAdminPath('PUT', c.req.path)) return next()
    const base = {
      action: 'canvas/overwrite' as const,
      method: 'PUT',
      path: c.req.path,
      token: (adminAuth.source === 'disabled' ? 'disabled' : 'missing') as 'disabled' | 'missing',
      ...(c.req.header('origin') ? { origin: c.req.header('origin')! } : {}),
      ...(c.req.header('host') ? { host: c.req.header('host')! } : {}),
    }
    await audit.append({ ...base, result: 'attempt' })
    let status = 0
    try {
      await next()
      status = c.res?.status ?? 0
    } catch (err) {
      await audit.append({ ...base, result: 'rejected', reason: 'threw' })
      throw err
    }
    await audit.append(
      status >= 200 && status < 400
        ? { ...base, result: 'ok' }
        : { ...base, result: 'rejected', reason: 'http-' + status },
    )
  })

   // ①.5 本地 test 模型端点（用户口径 2026-10-09）：一个假的 OpenAI 兼容端点，
   //      命中「test模型」时由它就地伪造回复，完全不请求真实后台。
   //      必须排在 ui 静态兜底（⑤ 的 get('*')）之前，否则会被通配吃掉。
   app.route('/', testModelRoutes())

  // ② 把宿主建好的实例按名上架（内置插件经 inject 取用；见 §三·补 服务名表）
  host.ctx.inject('kvStore', kvStore)
  host.ctx.inject('canvasStore', canvasStore)
  host.ctx.inject('canvasResources', canvasResources)
  host.ctx.inject('projectStore', projectStore)
  host.ctx.inject('assetStore', assetStore)
  host.ctx.inject('doc', doc)
  // 画布文档池：路由按 :id 取文档时用它，**不要各自 new**（那会让写锁失效，见 canvasDocPool）
  host.ctx.inject('docPool', docPool)
  // 外挂后台插件（如 plugin-node-ui）也要按任意画布取同一个文档实例。
  // 服务名用 `canvasDocPool` 与插件侧的窄接口一致；值仍是同一个池，不产生第二把锁。
  host.ctx.inject('canvasDocPool', docPool)
  // 单轮对话（/api/agent/chat/completion）按需加载 SDK 的入口。
  // 为什么给"函数"而不是直接给 SDK 对象：SDK 是懒加载的（没配模型时启动照常成功），
  // 而那条路由每次请求都要用它 —— 传函数就没有"启动时还没加载好"的时序问题。
  // **只在 Agent 开启时注入**：关闭时连这个入口都不该存在（见 agent:false 测试）。
  if (agentEnabled) host.ctx.inject('agentLoadSdk', () => agentServices().loadSdk())
  host.ctx.inject('providerRegistry', registry)
  host.ctx.inject('taskManager', tasks)
  host.ctx.inject('history', history)
  host.ctx.inject('pluginsDir', pluginsDir)
  host.ctx.inject('serverPluginsDir', serverPluginsDir)
  // 调试监听的「在场表」：只存内存（心跳不落盘）。
  // 只有「本机调试」时才装 plugin-presence 插件；否则这个服务根本不存在。
  const pluginPresence = new PluginPresence()
  host.ctx.inject('pluginPresence', pluginPresence)
  /**
   * 在场通道只对「监听本机回环」的服务存在（用户口径：本机调试免配置）。
   *
   * 为什么按监听地址判而不是环境变量：这条通道的数据由**本机文件系统上跑的进程**提供，
   * 只在本机有意义；后台监听 0.0.0.0 / 局域网地址（部署场景）时它是暴露面
   * （外人能伪造「合法插件」引导用户点重装）。接口内另有 Host 回环校验兜底。
   */
  const loopbackListen = ['127.0.0.1', 'localhost', '::1'].includes(opts.hostname ?? '127.0.0.1')
  // 审计日志：插件路由（server-plugins / npm-plugins）经 ctx 取它，装配时注入一次。
  // 没注入就是 no-op —— 那些路由在纯框架单测里照样能跑。
  host.ctx.inject('auditLog', audit)
  // 任务令牌：`task/routes.ts` 调它签一个绑定 canvas+node 的短时令牌给脚本子进程。
  host.ctx.inject('taskTokens', taskTokens)
  // 资源上传的第二层校验：只有「带 slot 且令牌正好绑定这个 canvas+slot」才放行脚本上传。
  host.ctx.inject('allowTaskUpload', (input: { token?: string; canvasId: string; slot?: string }) =>
    input.slot !== undefined && taskTokens.verify(input.token, input.canvasId, input.slot),
  )
  /**
   * 任务脚本能写进节点的字段白名单。
   *
   * 这几项是「产物」：脚本跑完把图/视频/音频/文本交回来。`uiHtml` / `uiScripts` 不在里面 ——
   * 那是界面本身，让脚本改它等于让脚本给自己换一套代码（审查 M1）。
   */
  const TASK_WRITABLE_NODE_FIELDS = new Set(['uiOutputUrl', 'imageUrl', 'videoUrl', 'audioUrl', 'text'])
  host.ctx.inject(
    'verifyTaskWrite',
    (input: { token?: string; canvasId: string; body: Record<string, unknown> }) => {
      /*
       * 只允许**更新自己这个节点的产物字段**。
       *
       * 原来的实现是「把所有 add/delete/update 里的 id 收集起来，全等于绑定节点就放行」。
       * 两个洞：① add 一个 id 等于自己的「新节点」可以覆盖自己节点全部字段（含 uiHtml）；
       * ② 只要有一批 id 对上，请求体里就能夹带别的键。脚本本来就只该交产物，用不上增删。
       */
      const body = input.body
      for (const key of Object.keys(body)) {
        if (key !== 'update') return false
      }
      const list = body.update
      if (!Array.isArray(list) || list.length === 0) return false
      for (const item of list) {
        if (!item || typeof item !== 'object') return false
        const rec = item as { id?: unknown; data?: unknown }
        if (typeof rec.id !== 'string') return false
        if (!taskTokens.verify(input.token, input.canvasId, rec.id)) return false
        if (!rec.data || typeof rec.data !== 'object' || Array.isArray(rec.data)) return false
        for (const field of Object.keys(rec.data as Record<string, unknown>)) {
          if (!TASK_WRITABLE_NODE_FIELDS.has(field)) return false
        }
      }
      return true
    },
  )
  // 服务自己的 origin：用于后台插件安装的跨源检查（不传等于关掉该检查）
  // 先按请求端口灌一次；真实端口在 listen 回调里再覆盖（port=0 / 端口顺延）。
  // 记住撤销句柄：服务名不能重复 inject，覆盖 = 先撤再注。
  let releaseSelfOrigin = host.ctx.inject('selfOrigin', `http://${opts.hostname ?? '127.0.0.1'}:${port}`)
  // 独立调试源：节点 HTML 不再由后台同源托管（同源脚本能读走 localStorage 令牌）。
  // 这里只把「按画布取目录」的能力交出去，听哪个端口由 debugOrigin 自己分配，
  // 装配阶段 start() 一次（端口起来后 url 才有值）。
  const debugOrigin = createDebugOrigin({ dataRoot: dataDir })
  host.ctx.inject('debugOrigin', debugOrigin)
  if (agentEnabled) {
    host.ctx.inject('agentConfig', agentServices().config)
    host.ctx.inject('agentSessions', agentServices().sessions)
    host.ctx.inject('agentRuntime', agentServices().runtime)
    host.ctx.inject('agentBranches', branchStore(dataDir))
    host.ctx.inject('agentHub', agentServices().hub)
    host.ctx.inject('agentQueue', agentServices().queue)
    host.ctx.inject('agentGoal', agentServices().goal)
  }

  // ③ 登记内置插件。**顺序即路由优先级**（Hono 先注册者优先）：
  //    events 必须排在 kv 之前 —— /api/kv/events 是静态、/api/kv/:type 是动态，
  //    顺序反了 SSE 端点会被动态路由吃掉（见 routePriority.test.ts 实测）。
  //    BUILTIN_PLUGINS 的数组顺序就按这条排好，别乱调。
  for (const plugin of BUILTIN_PLUGINS) {
    // agent 相关的两组按开关决定装不装
    // 调试在场通道：只对「监听本机回环」的服务存在（见上面 loopbackListen 的说明）
    if (plugin.name === 'plugin-presence' && !loopbackListen) continue
    host.ctx.plugin(plugin)
  }
  // Agent 三条路由插件单独一组：关闭时它们根本不进登记表，不靠“名字前缀跳过”。
  if (agentEnabled) {
    // 三条路由插件由 plugin-agent 提供；这里只把「跑中间件」的那一个函数指针交给它。
    for (const plugin of createAgentPlugins(host.ctx)) host.ctx.plugin(plugin)
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
  // 注入一个**活的共享数组**：启动登记的那批 + 运行期热装/热卸都要反映在它身上。
  // 为什么不能只注入启动快照：热装的插件不在快照里，插件自省/诊断都看不到它
  // （实测：从 NPM 装完 hello.plugins 为空）。hotLoad 会往这个数组里增删。
  host.ctx.inject('serverPluginsLoaded', registeredServerPlugins)
  bindHotLoadedTracking(registeredServerPlugins)

  // ③.7 **cloud-server 自己也用插件那套能力**往 Agent 提示词里加内容（用户口径 2026-10-14：
  //      「我希望你的插件系统在配置 Agent 的功能时…在系统提示词中新增一些内容」）。
  //
  //      为什么不直接拼字符串：拼在 runtime 里的那两段（引用标记说明 / 运行环境）**插件碰不到**，
  //      用户也就没法知道「我的提示词里到底多了什么」。走注册场之后：
  //        · 每一条都能在设置页列出来（谁加的、内容是什么）；
  //        · 卸载 / 关掉即消失；
  //        · 别的插件（含可视化节点）用同一个口子加，权利一致。
  //
  //      注册成**内核插件**而不是硬调 registerAgentPrompt：这样它与其它插件同寿、同回收，
  //      将来想「关掉引用标记说明」也只是不装这一个插件。
  //
  //      注册成**内核插件**而不是硬调 registerAgentPrompt：这样它与其它插件同寿、同回收，
  //      将来想「关掉引用标记说明」也只是不装这一个插件。
  //
  //      注：这里没有 `inject` —— 两段内容都用**本文件的闭包**（runtimeContext 要读真实端口，
  //      它只在宿主作用域里），不需要任何服务。
  host.ctx.plugin({
    name: 'canvas-agent-prompt',
    apply(ctx) {
      // 引用标记说明：内容不变，只是从「runtime 硬拼」挪到「注册成一节」。
      ctx.agent.systemPrompt(REFERENCE_MARKUP_GUIDE, {
        id: 'canvas:reference-markup',
        title: '引用标记（引用元素）',
        order: 10,
      })
      // 运行环境：**给函数**——地址 / 端口是运行期才定的，写死就会冻住旧值。
      ctx.agent.systemPrompt(() => runtimeContextSection(runtimeContext()).text, {
        id: 'canvas:runtime-env',
        title: '运行环境（本机后台）',
        order: 20,
      })
    },
  })

  // ④ MCP 直挂（**不收敛成插件**：SDK transport，与「代理 handler」模型不兼容）。
  //    ui 静态托管放在最后（见 ⑤ 的 afterRoutes）——它是兜底通配，必须排在插件路由之后。
  const mcpEnabled = opts.mcp !== false
  if (mcpEnabled) {
    /**
     * `/mcp` 没有令牌（首版取舍：SDK transport 只认 Host/Origin）。
     * 那就至少留一条审计：谁在什么时候调了哪个工具。
     *
     * 读工具名要碰 body，但 transport 还要用同一个请求 —— 所以 clone 一份来解析，
     * 原请求原样往下交。克隆失败（不是 JSON-RPC、例如 GET 的 SSE 流）就只记路径。
     */
    app.use('/mcp', async (c, next) => {
      const method = c.req.method.toUpperCase()
      let tool: string | undefined
      if (method === 'POST') {
        try {
          const body = (await c.req.raw.clone().json()) as { method?: unknown; params?: { name?: unknown } }
          if (body?.method === 'tools/call' && typeof body.params?.name === 'string') tool = body.params.name
        } catch {
          /* 不是 JSON-RPC：不记工具名 */
        }
      }
      const base = {
        action: 'mcp/call' as const,
        method,
        path: tool ? '/mcp#' + tool : '/mcp',
        token: 'disabled' as const,
        ...(c.req.header('origin') ? { origin: c.req.header('origin')! } : {}),
        ...(c.req.header('host') ? { host: c.req.header('host')! } : {}),
      }
      await audit.append({ ...base, result: 'attempt' })
      try {
        await next()
      } catch (err) {
        await audit.append({ ...base, result: 'rejected', reason: 'threw' })
        throw err
      }
      const status = c.res?.status ?? 0
      await audit.append(
        status >= 200 && status < 400 ? { ...base, result: 'ok' } : { ...base, result: 'rejected', reason: 'http-' + status },
      )
    })
    app.route(
      '/',
      mcpRoutes(
        doc,
        registry,
        tasks,
        () => listPluginMcpTools(host.ctx),
        // 按画布取文档：默认画布复用上面那个实例；别的画布现建一个（内部只是拼路径）。
        // 关键：AI 传了 canvasId 就必须写到那张画布，否则会全落进 default（就是用户报的「画布上什么都没有」）。
        // **先确认画布存在**：不存在就返回 undefined，让工具报「画布不存在」而不是凭空建一张空画布。
        // 实例由 docPool 统一给（同一张画布永远同一个实例 = 同一把写锁，见 canvasDocPool 说明）。
        async (canvasId) => {
          const ids = await canvasStore.list()
          return ids.includes(canvasId) ? docPool.for(canvasId) : undefined
        },
        // 画布清单：给 AI 发现「该往哪张画布写」的 id（用户看的那张）
        async () => {
          const ids = await canvasStore.list()
          const idx = await projectStore.readIndex()
          const nameOf = new Map(idx.map((e) => [e.id, e.name]))
          return ids.map((id) => ({ id, name: nameOf.get(id) ?? id }))
        },
      ),
    )
  }

  // 内置画布 MCP：把自己 `/mcp` 端点写进 Agent 的 MCP 清单（默认携带、用户零配置）。
  // 这里先用**请求的**端口写一次（测试 / 不开监听也能拿到 builtin 标记与删除锁）；
  // 真正的监听端口要等 listen 回调才知道（port 传 0 时由系统分配），start() 里会再纠正一次。
  // 失败只记日志，不拦启动 —— 用户可能根本没用 Agent，不该因为这一条写不进去就起不来。
  if (agentEnabled && mcpEnabled && opts.builtinCanvasMcp !== false) {
    // 必须 **await**：这是建服务的一部分，不能留一条还在写的异步尾巴 ——
    // 否则调用方（测试清理 / 进程退出）会在写完成前就把数据目录删掉（实测 ENOTEMPTY）。
    await agentServices().config
      .ensureBuiltinCanvasMcp(`http://${opts.hostname ?? '127.0.0.1'}:${port}/mcp`)
      .catch((err) => console.warn('[agent] 内置画布 MCP 写入失败：' + String(err)))
  }

  // ⑤ 装载插件 + 把插件路由翻成代理；**插件路由挂好之后**再挂 ui 兜底。
  //    顺序不可调换：ui 的 get('*') 若先挂，会把 /health、/api/* 全吃掉（实测）。
  await host.start(() => {
    // 本机访问时顺手把管理令牌注进页面（远程不注）：否则用户要先手抄一遍，
    // 忘了抄的表现是「所有写操作 403、节点上只写执行失败」。
    // PLUME_NO_TOKEN_INJECTION=1：反代被配成透传 Host / 删转发头时，令牌注入
    // 的三个判定会被骗过 —— 部署者声明后一刀切不注入，所有用户都手填。
    app.route(
      '/',
      uiRoutes(
        uiDist,
        () => (adminAuthEnabled ? adminAuth.token : undefined),
        process.env.PLUME_NO_TOKEN_INJECTION === '1',
      ),
    )
  })

  let server: ServerType | undefined
  const hostname = opts.hostname ?? '127.0.0.1'

  /**
   * 保证「test模型」在配置里（用户口径 2026-10-09）。
   * 写它的 base_url 时用**请求的**端口先写一次，等真正监听端口确定后再纠正一次
   * （port 传 0 / CLI 换端口时实际端口 ≠ 请求端口，与内置画布 MCP 同一套做法）。
   */
  const ensureTestModel = (origin: string): Promise<void> =>
    agentServices().config
      .ensureTestModel({
        provider: TEST_PROVIDER,
        modelId: TEST_MODEL_ID,
        baseUrl: testModelBaseUrl(origin),
        apiKey: TEST_API_KEY,
      })
      .catch((err) => console.warn('[agent] test 模型登记失败：' + String(err)))
  if (agentEnabled) {
    await ensureTestModel(`http://${opts.hostname ?? '127.0.0.1'}:${port}`)
  }

  /**
   * 重扫目录并整体替换清单。
   *
   * 用 `replaceAll`（清空再装）而不是"追加"：删掉的 provider 必须**一起消失**，
   * 否则它的动作会永远留在前端下拉里、点下去必然失败。
   */
  async function reloadProviders(): Promise<{ count: number; version: number }> {
    const config = await readProviderConfig(providerConfigFile)
    providerConfig.disabledFiles = config.disabledFiles
    providerConfig.deletedFiles = config.deletedFiles
    providerConfig.files = config.files
    providerConfig.config = config.config
    providerConfig.platforms = config.platforms
    providerConfig.defaults = config.defaults
    const scanned = await loadProvidersFromDir(providersDir, { config })
    registry.replaceAll(scanned.providers)
    // replaceAll 会清空整张表（删掉的 provider 的动作为了不残留，必须清）——
    // 但内置的 agent-chat 不在目录里，清完必须补回来，否则「保存一次配置 / 改一次启停」
    // Agent 对话动作就从菜单里消失了（用户实测）。
    if (agentEnabled) registry.add(agentChatProvider())
    providerFileOf.clear()
    for (let i = 0; i < scanned.providers.length; i++) {
      providerFileOf.set(scanned.providers[i]!.id, scanned.files[i] ?? '')
    }
    for (const f of scanned.failures) {
      console.warn('[cloud-server] provider 加载失败 ' + f.file + '：' + f.error)
    }
    return { count: registry.listActions().length, version: registry.contentVersion }
  }

  /**
   * 告诉前端「平台/配置变了，重拉动作与配置」。
   *
   * 用户口径 2026-11-10：操作完就应该实时生效，不该有刷新按钮。
   * 前端 `remoteSync` 监听 `config/providers-version`，收到就 `reloadActions()`。
   * 以前这个 key 从来没人写（实测 GET 是 404），所以实时那条路一直是死的。
   */
  async function broadcastProvidersChanged(): Promise<void> {
    // 顺带把「已装载平台」的展示信息快照进配置：停用/删除后就 import 不到文件了，
    // 没有这份快照，管理页上会退化成文件名（用户 2026-11-10 截图里停用后没有标题）。
    await snapshotPlatformMeta()
    try {
      await kvStore.set('config', 'providers-version', Date.now())
    } catch {
      /* 只是提醒信号，写失败不影响配置本身 */
    }
  }

  /** 把当前装载到的 provider 的名字/介绍/图标记进配置（供停用后显示） */
  async function snapshotPlatformMeta(): Promise<void> {
    try {
      const cfg = await readProviderConfig(providerConfigFile)
      const platforms = { ...(cfg.platforms ?? {}) }
      let changed = false
      for (const p of registry.listProviders()) {
        const cur = platforms[p.id] ?? { accounts: [] }
        const next = {
          ...cur,
          ...(p.title ? { title: p.title } : {}),
          ...(p.description ? { description: p.description } : {}),
          ...(p.icon ? { icon: p.icon } : {}),
        }
        if (
          next.title !== cur.title ||
          next.description !== cur.description ||
          next.icon !== cur.icon
        ) {
          platforms[p.id] = next
          changed = true
        }
      }
      if (!changed) return
      cfg.platforms = platforms
      await writeProviderConfig(providerConfigFile, cfg)
    } catch {
      /* 快照只是展示用，失败了不影响启停本身 */
    }
  }

  // 盯目录：后台丢一个 provider 进去，前端的菜单几秒内自己跟上
  const watcher: ProviderWatcher | undefined = opts.watchProviders === false
    ? undefined
    : watchProviders(providersDir, async () => {
        const r = await reloadProviders()
        console.log('[cloud-server] provider 目录已变更，动作清单更新为 ' + r.count + ' 项')
      })

  host.ctx.inject('providerAdmin', {
    /** providerId → 文件名（路由按 id 找文件；装载器每次重扫后现刷） */
    fileOf: (id: string) => providerFileOf.get(id),
    /** 重扫 + 换清单（启停 / 删文件 / 改配置后调） */
    reload: reloadProviders,
    /** 停用 / 恢复一个文件 */
    async setDisabled(file: string, disabled: boolean): Promise<void> {
      if (!isSafeFileName(file)) throw new Error('非法文件名')
      const cfg = await readProviderConfig(providerConfigFile)
      const set = new Set(cfg.disabledFiles)
      if (disabled) set.add(file)
      else set.delete(file)
      cfg.disabledFiles = [...set]
      await writeProviderConfig(providerConfigFile, cfg)
      await reloadProviders()
      await broadcastProvidersChanged()
    },
    /**
     * 删除一个 provider 文件（记入 deletedFiles，重启不再铺回）。
     * 文件不存在返回 false —— 内置平台（agent-chat 这类没有文件的）不能假装删成功。
     */
    async deleteFile(file: string): Promise<boolean> {
      if (!isSafeFileName(file)) throw new Error('非法文件名')
      try {
        await fs.access(path.join(providersDir, file))
      } catch {
        return false
      }
      await fs.rm(path.join(providersDir, file), { force: true })
      const cfg = await readProviderConfig(providerConfigFile)
      if (!cfg.deletedFiles.includes(file)) cfg.deletedFiles.push(file)
      await writeProviderConfig(providerConfigFile, cfg)
      await reloadProviders()
      await broadcastProvidersChanged()
      return true
    },
    /** 保存一个文件的账号清单（整体替换该文件的账号） */
    async saveAccounts(file: string, accounts: ProviderConfigFile['files'][string]['accounts']): Promise<void> {
      if (!isSafeFileName(file)) throw new Error('非法文件名')
      const cfg = await readProviderConfig(providerConfigFile)
      cfg.files[file] = { accounts }
      // 同时写一份新结构：否则界面（已经按点分隔 key 读）看不到这次保存。
      // 老接口暂时保留给脚本与旧调用方，两条路写同一个事实。
      const pid = file.replace(/\.js$/, '')
      const config: Record<string, string | number | boolean> = { ...(cfg.config ?? {}) }
      for (const key of Object.keys(config)) {
        if (providerIdOfKey(key) === pid) delete config[key]
      }
      for (let i = 0; i < accounts.length; i++) {
        for (const [field, value] of Object.entries(accounts[i]!.values)) {
          config[pid + '.' + field + '.[' + i + ']'] = value
        }
      }
      cfg.config = config
      const platforms = { ...(cfg.platforms ?? {}) }
      platforms[pid] = {
        accounts: accounts.map((a) => ({
          id: a.id,
          ...(a.name ? { name: a.name } : {}),
          ...(a.default ? { default: true } : {}),
        })),
      }
      cfg.platforms = platforms
      await writeProviderConfig(providerConfigFile, cfg)
      await reloadProviders()
      await broadcastProvidersChanged()
    },
    /** 保存点分隔 key 配置（新结构）：通用值 + 每账号值 + 账号清单 */
    async saveKeyConfig(
      pid: string,
      payload: {
        shared: Record<string, string | number | boolean>
        accounts: Array<{ id: string; name?: string; default?: boolean; values: Record<string, string | number | boolean> }>
        accountFields: string[]
      },
    ): Promise<void> {
      const cfg = await readProviderConfig(providerConfigFile)
      const config: Record<string, string | number | boolean> = { ...(cfg.config ?? {}) }
      // 先清掉这个平台原有的 key，再整体写回（避免删掉的字段残留）
      for (const key of Object.keys(config)) {
        if (providerIdOfKey(key) === pid) delete config[key]
      }
      const accountFieldSet = new Set(payload.accountFields)
      for (const [field, value] of Object.entries(payload.shared)) {
        config[pid + '.' + field] = value
      }
      // 账号级字段：下标就是账号顺序；留空的账号不写（读的时候回落通用值）
      payload.accounts.forEach((acc, i) => {
        for (const field of accountFieldSet) {
          const v = acc.values?.[field]
          if (typeof v === 'string' && v === '') continue
          if (v === undefined) continue
          config[pid + '.' + field + '.[' + i + ']'] = v
        }
      })
      cfg.config = config
      const platforms = { ...(cfg.platforms ?? {}) }
      platforms[pid] = {
        accounts: payload.accounts.map((a) => ({
          id: a.id,
          ...(a.name ? { name: a.name } : {}),
          ...(a.default ? { default: true } : {}),
        })),
      }
      cfg.platforms = platforms
      await writeProviderConfig(providerConfigFile, cfg)
      await reloadProviders()
      await broadcastProvidersChanged()
    },
    /** 保存生成类型 → 默认模型 */
    async saveDefaults(defaults: Record<string, string>): Promise<void> {
      const cfg = await readProviderConfig(providerConfigFile)
      cfg.defaults = defaults
      await writeProviderConfig(providerConfigFile, cfg)
      await broadcastProvidersChanged()
    },
    /** 读配置（GET 接口用） */
    readConfig: () => readProviderConfig(providerConfigFile),
    /** 某个平台配置里的账号清单（动作清单要在每行带上“可选账号”，底栏据此出二级菜单） */
    accountsOf(id: string): Array<{ id: string; name?: string; default?: boolean }> {
      const accounts = providerConfig.platforms?.[id]?.accounts ?? []
      return accounts.map((a) => ({
        id: a.id,
        ...(a.name ? { name: a.name } : {}),
        ...(a.default ? { default: true } : {}),
      }))
    },
    /** providers 目录 */
    dir: providersDir,
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
    adminToken: adminAuth.token,
    adminTokenSource: adminAuth.source,
    adminTokenFile: adminAuth.tokenFile,
    trust: { hosts: trustedHosts, origins: trustedOrigins },
    get debugOriginUrl() {
      return debugOrigin.url
    },
    reloadProviders,
    async start() {
      // 独立调试源先起来再听主端口：插件在拿到 url 之前**不会**生成调试页
      // （退回同源那条路已经删掉 —— 它会让页面读到管理令牌）。
      // 起不来不拖垮主服务（调试是开发工具），只是这一轮没有调试页。
      try {
        const debugUrl = await debugOrigin.start()
        // 调试页与后台不同源：它要带短令牌把产物写回本节点。
        // 但**只放行这一条路**（resources 上传），不能把它当可信来源 —— 那上面的页面
        // 是用户 HTML，一旦进 trustedOrigins，它连读 KV、整画布覆盖都能做。
        // 端口是系统分配的，只有 start() 之后才知道，所以在这里追加。
        if (debugUrl && !scopedOrigins.some((s) => s.origin === debugUrl)) {
          scopedOrigins.push({
            origin: debugUrl,
            // 只放行「往本画布写资源」这一条：调试页交产物就只做这件事。
            paths: ['/api/canvases/*/resources'],
          })
        }
      } catch (err) {
        console.warn('[cloud-server] 独立调试源启动失败（这一轮没有调试页；画布本身不受影响）：' + String(err))
      }
      return new Promise((resolve, reject) => {
        let listening = false
        const s = serve({ fetch: app.fetch, port, hostname }, (info) => {
          listening = true
          // 真实端口记下来：「自己取字节」判断"是不是本服务地址"要用它
          actualPort = info.port
          // 真实端口定了 → Host 白名单跟着改（port:0 / 端口顺延都会走到这里）。
          // 必须原地改，见 fillTrustedHosts 的说明。
          fillTrustedHosts(info.port)
          releaseSelfOrigin()
          releaseSelfOrigin = host.ctx.inject('selfOrigin', `http://${hostname}:${info.port}`)
          // 端口定了 → 把运行环境上下文刷新成**真实地址**（提示词里的 {{BACKEND_BASE_URL}}
          // 与常驻小节都读它）。下一次建会话就是对的，不必重启。
          if (agentEnabled) agentServices().config.setRuntimeContext(runtimeContext())
          // 真实端口定了，纠正内置画布 MCP 与 test 模型的地址：
          //   · port 传 0（测试）时真实端口由系统分配 —— 不纠正就会把 `...:0/mcp` 写死；
          //   · CLI 换端口兜底时实际监听端口 ≠ 请求端口 —— 同理。
          //
          // 两条**串行，且等写完再返回**：它们改的是同一批配置文件（读整份 → 改 → 写回），
          // 并发会互相覆盖；以前这里是两条 void，start() 返回时写还在飞 —— 测试清理
          // 紧接着删数据目录，就会撞出 ENOENT / ENOTEMPTY（实测碰到）。
          // 写入本身幂等（地址没变就一个字节都不写），等它只花几毫秒。
          const settleAgentAddresses = async (): Promise<void> => {
            if (!agentEnabled) return
            if (mcpEnabled && opts.builtinCanvasMcp !== false) {
              await agentServices().config
                .ensureBuiltinCanvasMcp(`http://${hostname}:${info.port}/mcp`)
                .catch((err) => console.warn('[agent] 内置画布 MCP 地址纠正失败：' + String(err)))
            }
            await ensureTestModel(`http://${hostname}:${info.port}`)
          }
          // 端口传 0 时真实端口由系统分配，以 info.port 为准。
          // 写配置失败也照样 resolve：地址纠正不成功不该让整个服务「启动不起来」
          // （上面两条各自已吞错，这里再兜一层防意外 reject 把 start() 永远挂住）。
          void settleAgentAddresses()
            .catch((err) => console.warn('[agent] 启动时写地址失败：' + String(err)))
            .then(() => resolve({ port: info.port, url: `http://${hostname}:${info.port}` }))
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
      void debugOrigin.stop().catch(() => undefined)
      agentServicesRef?.dispose()
      void tasks.dispose()
      // 回收插件作用域：jobs 的定时器、store 的命名空间清理都在插件的 ctx.effect 里，
      // 不调它永不 dispose（审查发现的泄漏）。
      host.stop()
      server?.close()
      server = undefined
    },
  }
}
