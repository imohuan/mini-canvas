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
import { ProjectStore } from './store/projectStore.js'
import { AssetStore } from './store/assetStore.js'
import { resolvePluginsDir, resolveUiDist, uiRoutes } from './static.js'
import { mcpRoutes } from './routes/mcp.js'
import { createServerFramework } from './serverFramework/index.js'
import { BUILTIN_PLUGINS } from './plugins/builtin/routes.js'
import type { Context } from '@mini-canvas/kernel'
import { loadServerPluginsFromDir, DEFAULT_SERVER_PLUGINS_DIR } from './serverFramework/pluginLoader.js'
import { bindHotLoadedTracking } from './serverFramework/hotLoad.js'
import { listPluginMcpTools } from './serverFramework/mcp.js'
import { CanvasDocument } from './mcp/canvasDoc.js'
import { TOOL_LIST } from './mcp/server.js'
import { ProviderRegistry } from './providers/registry.js'
import { loadProvidersFromDir, DEFAULT_PROVIDERS_DIR } from './providers/load.js'
import { createWeb2ApiProvider } from './providers/web2api/index.js'
import { watchProviders, type ProviderWatcher } from './providers/watch.js'
import { HistoryStore } from './tasks/history.js'
import { TaskManager } from './tasks/taskManager.js'
import { DEFAULT_CANVAS_ID } from './store/canvasPaths.js'
import { makeResolveResourceUrl } from './tasks/resourceResolver.js'
import { makeFetchSelfBytes } from './tasks/selfFetch.js'
import { AgentConfigService } from './agent/config.js'
import { AgentSessionStore } from './agent/sessionStore.js'
import { branchStore } from './agent/branchStore.js'
 import { testModelRoutes, testModelBaseUrl, TEST_PROVIDER, TEST_MODEL_ID, TEST_API_KEY } from './agent/testModel.js'
import { AgentRuntime } from './agent/runtime.js'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot } from './agent/agentPaths.js'
import { ensureGoalInstalled } from './agent/goal.js'
import { SessionHub } from './agent/sessionHub.js'
import { QueueScheduler } from './agent/queueScheduler.js'
import { GoalRuntime, goalHooksDir, findSessionTrace } from './agent/goalRuntime.js'
import { sessionScratchpadPath } from './agent/agentPaths.js'
import { tracesDirOf } from './agent/traceFork.js'

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
  /**
   * 是否把**自身的画布 MCP**自动写进 Agent 的 MCP 清单（缺省开）。
   *
   * 产品口径：这个画布 MCP 是随 Agent 内置的，用户零配置。
   * 测试里可关掉 —— 那些用例要验「用户没配 MCP 时是什么样」的行为。
   */
  builtinCanvasMcp?: boolean
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
  // 项目 / 资产：画布文件夹路径不变，项目归属走索引（见 store/projectStore.ts 文件头）
  const projectStore = new ProjectStore(dataDir)
  const assetStore = new AssetStore(dataDir)
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
  // 「后台对话」的事件通道（设计 §3.2）：每会话一条常驻流，队列在空闲时自动起轮也靠它广播。
  const agentHub = new SessionHub({ log: (m, extra) => console.log('[agent-hub] ' + m, extra ?? '') })
  // 队列调度器（设计 §3.3）：唯一裁判，见 queueScheduler.ts 文件头。
  // 先声明后赋值（agentRuntime 的 onRunFinished 要引用它，而它的 deps 又要 agentRuntime 的派生面）。
  let queueScheduler: QueueScheduler
  const agentRuntime = new AgentRuntime({
    root: dataDir,
    store: agentSessions,
    hub: agentHub,
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
    // 宿主注入的用户消息（目标协议文本）：必须走 sender:'harness' —— SDK 的 goal
    // stop hook 靠这个戳划轮次边界，缺了它记账会退化成「整份 trace = 一轮」（真机实测）。
    makeHarnessMessage: (text) => {
      const sdk = sdkRef
      if (!sdk) throw new Error('SDK 尚未就绪：请先配置模型后重试')
      return sdk.userText(text, 'harness')
    },
    filterMcp: (names) => agentConfig.subsetMcp(names),
    readSkill: (name) => agentConfig.readSkillFile(name),
    withSystemPrompt: (text) => agentConfig.withSystemPrompt(text),
    // 会话自动命名：走「会话标题模型」配置的模型（没配则回落会话默认模型）。
    // 失败返回 null，runtime 回落「首句截断」—— 起名失败不该报错打扰对话。
    generateTitle: (plainFirstText) => agentConfig.generateSessionTitle(plainFirstText),
    // 一轮结束 → 队列调度（先结算 sending 的账，再看能不能发下一条）
    //    目标还有**轮次边界**（一次 run 里 stop hook 连跑多轮）：见下面的 onGoalRound。
    onGoalRound: (canvasId, sessionId) => {
      /**
       * 目标的一轮结束（stop hook 刚跑完）：立刻读一次 GOAL.json 推 goal_state。
       * 为什么需要它（真机实测的滞后）：目标是在**一次 SDK run() 里连跑多轮**的，
       * 只在 run 结束时读一次会让中间几轮全被跳过（用户看到「第 3 轮直接跳到第 7 轮」）。
       */
      void goalRuntime
        .read(canvasId, sessionId)
        .then((g) => {
          if (g) agentHub.append(canvasId, sessionId, { type: 'goal_state', goal: g })
        })
        .catch(() => undefined)
    },
    onRunFinished: (canvasId, sessionId) => {
      // 一轮结束的收尾顺序（设计 §3.4.4 的"守住缺席" + §3.3.2 的调度）：
      // 1. 目标被暂停时守住 GOAL.json 的缺席（那一轮里模型可能把它写回来）；
      // 2. 通知时机之一：这一轮结束（round_done）；
      // 3. 交给队列调度器：结算 sending 的账、再看能不能发下一条。
      void goalRuntime
        .enforcePauseIfNeeded(canvasId, sessionId)
        .catch((err) =>
          console.warn('[agent-goal] 守住暂停失败', err instanceof Error ? err.message : String(err)),
        )
        .finally(() => {
          agentHub.append(canvasId, sessionId, { type: 'round_done' })
          /**
           * 每轮结束都推一次 goal_state（用户口径 2026-10-09：目标行上的「第 N 轮 ·
           * 已用/剩余预算」必须跟着跑）。GOAL.json 由 goal 插件的 stop.mjs 在轮末更新，
           * 这时读它就是最新值；没有目标（读不到文件）就不推，界面保持原样。
           * 不推的后果（真机实测）：数字永远停在发起那一刻（第 1 轮 · 剩余预算 100k）。
           */
          void goalRuntime
            .read(canvasId, sessionId)
            .then((g) => {
              if (g) agentHub.append(canvasId, sessionId, { type: 'goal_state', goal: g })
            })
            .catch(() => undefined)
          queueScheduler.onRunFinished(canvasId, sessionId)
        })
    },
    log: (message, extra) => console.log('[agent] ' + message, extra ?? ''),
  })
  queueScheduler = new QueueScheduler({
    store: agentSessions,
    runtime: agentRuntime,
    hub: agentHub,
    // 起一轮的实现：与 HTTP 的"发消息"走同一条路（pre-turn 中间件由 HTTP 层跑；
    // 队列发的是**已经在队列里核准过的**文本，不再过一遍中间件 —— 避免同一条消息被改写两次）
    // 调度器给的是一个带 canvasId 的 StartRunInput；runtime.startRun 是 (canvasId, input) 两参
    startRun: (input) => agentRuntime.startRun(input.canvasId, input),
    // 带目标的条目：先把目标文件与第 1 轮的协议文本备好，再起一轮
    startGoal: (canvasId, sessionId, objective, budget) =>
      goalRuntime.beginGoal(canvasId, sessionId, objective, budget),
    log: (message, extra) => console.log('[agent-queue] ' + message, extra ?? ''),
  })
  // 目标运行时（设计 §3.4.4）：改预算 / 暂停 / 启动。
  const goalRuntime = new GoalRuntime({
    scratchpadOf: (_canvasId, sessionId) => sessionScratchpadPath(agentRoot(dataDir), sessionId),
    hooksDir: goalHooksDir(agentRoot(dataDir), AGENT_PROJECT_ID, AGENT_ID),
    latestTraceOf: (sessionId) => findSessionTrace(tracesDirOf(agentRoot(dataDir)), sessionId),
    startRun: async (canvasId, sessionId, text, harnessText) => {
      const r = await agentRuntime.startRun(canvasId, {
        canvasId,
        sessionId,
        text,
        ...(harnessText ? { harnessText } : {}),
      })
      return { started: r.started }
    },
    isRunning: (canvasId, sessionId) => agentRuntime.isRunning(canvasId, sessionId),
    // 经 SDK 会话跑官方 start.mjs（它注入 sessionId / scratchpadDir —— 会话才知道的）
    runUserPromptHook: (canvasId, sessionId, name, prompt, extras) =>
      agentRuntime.runUserPromptHook(canvasId, sessionId, name, prompt, extras),
    emit: (canvasId, sessionId, ev) => agentHub.append(canvasId, sessionId, ev),
    setPausedFlag: (canvasId, sessionId, paused) => agentSessions.setGoalPaused(canvasId, sessionId, paused),
    isPausedFlag: async (canvasId, sessionId) => (await agentSessions.get(canvasId, sessionId))?.goalPaused === true,
    log: (message, extra) => console.log('[agent-goal] ' + message, extra ?? ''),
  })
  // 同步引用：makeUserMessage 是同步签名，SDK 一旦加载就填进来
  let sdkRef: typeof import('@prismshadow/penguin-core') | undefined
  void loadSdk().then((sdk) => {
    sdkRef = sdk
  }).catch(() => undefined)

  // 目标（goal）插件的 hook 包：装进 agent_state/hooks/goal/ 之后才有目标功能（设计 §3.4.1）。
  // 恒幂等（已装且版本一致时一个字节都不写），且**永不抛错** —— 插件取不到只记一条日志，
  // 没配模型时启动照常成功（它只读插件库、写本地文件，不碰网络）。
  // 必须 await（与下面内置画布 MCP 同一条规矩）：不能留一条还在写的异步尾巴，
  // 否则调用方（测试清理 / 进程退出）会在写完成前就把数据目录删掉（实测 ENOTEMPTY）。
  if (agentEnabled) {
    await ensureGoalInstalled(agentRoot(dataDir), AGENT_PROJECT_ID, AGENT_ID)
  }

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
  /**
   * 实际监听端口（start() 之后才有真值；port=0 时由系统分配）。
   * 「自己取字节」要靠它判断"是不是本服务的地址"，所以延迟到调用时再读。
   */
  let actualPort: number | undefined
  /**
   * 「服务器自己把画布里的地址取回来」（见 tasks/selfFetch 的说明）。
   *
   * 在 TaskManager 之前建：参考图解析要用它。app 与真实端口都在后面才就绪，
   * 所以这里是**延迟取值**的闭包（真正调用时早就齐了）。
   */
  const fetchSelfBytes = makeFetchSelfBytes({
    fetch: (req) => host.app.fetch(req),
    origin: () => `http://${hostname}:${actualPort ?? port}`,
  })
  // 参考图交给 web2api 时要转成 **data URL**（它自己会落盘）——
  // 两个服务可能不在同一台机器，地址（尤其 127.0.0.1）它够不到；内嵌字节则与网络无关。
  const tasks = new TaskManager({
    doc,
    // 多画布：任务的进度/终态写进**它所属的那张画布**（用默认 doc 会写错画布 → 进度卡 0）
    docForCanvas: (canvasId) => (canvasId === DEFAULT_CANVAS_ID ? doc : new CanvasDocument(canvasStore, canvasResources, canvasId)),
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
      const docFor = canvasId === DEFAULT_CANVAS_ID ? doc : new CanvasDocument(canvasStore, canvasResources, canvasId)
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
  const app = host.app

  // ---- 装配阶段（顺序即匹配优先级；全部必须在 start() 之前完成，Hono 首次 fetch 后冻结）----
  // ① 跨域：**必须最先**（实测：cors 后注册对已注册路由不生效）
  app.use('*', cors())

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
    host.ctx.inject('agentBranches', branchStore(dataDir))
    host.ctx.inject('agentHub', agentHub)
    host.ctx.inject('agentQueue', queueScheduler)
    host.ctx.inject('agentGoal', goalRuntime)
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
  // 注入一个**活的共享数组**：启动登记的那批 + 运行期热装/热卸都要反映在它身上。
  // 为什么不能只注入启动快照：热装的插件不在快照里，插件自省/诊断都看不到它
  // （实测：从 NPM 装完 hello.plugins 为空）。hotLoad 会往这个数组里增删。
  host.ctx.inject('serverPluginsLoaded', registeredServerPlugins)
  bindHotLoadedTracking(registeredServerPlugins)

  // ④ MCP 直挂（**不收敛成插件**：SDK transport，与「代理 handler」模型不兼容）。
  //    ui 静态托管放在最后（见 ⑤ 的 afterRoutes）——它是兜底通配，必须排在插件路由之后。
  const mcpEnabled = opts.mcp !== false
  if (mcpEnabled) {
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
        async (canvasId) => {
          if (canvasId === DEFAULT_CANVAS_ID) return doc
          const ids = await canvasStore.list()
          return ids.includes(canvasId) ? new CanvasDocument(canvasStore, canvasResources, canvasId) : undefined
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
    await agentConfig
      .ensureBuiltinCanvasMcp(`http://${opts.hostname ?? '127.0.0.1'}:${port}/mcp`)
      .catch((err) => console.warn('[agent] 内置画布 MCP 写入失败：' + String(err)))
  }

  // ⑤ 装载插件 + 把插件路由翻成代理；**插件路由挂好之后**再挂 ui 兜底。
  //    顺序不可调换：ui 的 get('*') 若先挂，会把 /health、/api/* 全吃掉（实测）。
  await host.start(() => {
    app.route('/', uiRoutes(uiDist))
  })

  let server: ServerType | undefined
  const hostname = opts.hostname ?? '127.0.0.1'

  /**
   * 保证「test模型」在配置里（用户口径 2026-10-09）。
   * 写它的 base_url 时用**请求的**端口先写一次，等真正监听端口确定后再纠正一次
   * （port 传 0 / CLI 换端口时实际端口 ≠ 请求端口，与内置画布 MCP 同一套做法）。
   */
  const ensureTestModel = (origin: string): Promise<void> =>
    agentConfig
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
          // 真实端口记下来：「自己取字节」判断"是不是本服务地址"要用它
          actualPort = info.port
          // 真实端口定了，纠正内置画布 MCP 的地址：
          //   · port 传 0（测试）时真实端口由系统分配 —— 不纠正就会把 `...:0/mcp` 写死；
          //   · CLI 换端口兜底时实际监听端口 ≠ 请求端口 —— 同理。
          if (agentEnabled && mcpEnabled && opts.builtinCanvasMcp !== false) {
            void agentConfig
              .ensureBuiltinCanvasMcp(`http://${hostname}:${info.port}/mcp`)
              .catch((err) => console.warn('[agent] 内置画布 MCP 地址纠正失败：' + String(err)))
          }
          // test 模型同理：真实端口定了，纠正它的 base_url（否则会指向 ...:0）
          if (agentEnabled) {
            void ensureTestModel(`http://${hostname}:${info.port}`)
          }
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
    agentHub.disposeAll()
      void tasks.dispose()
      // 回收插件作用域：jobs 的定时器、store 的命名空间清理都在插件的 ctx.effect 里，
      // 不调它永不 dispose（审查发现的泄漏）。
      host.stop()
      server?.close()
      server = undefined
    },
  }
}
