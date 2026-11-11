/**
 * cloud-server 的对外类型：启动选项与启动后的实例句柄。
 *
 * 从 server.ts 原样搬出，避免入口文件过长；导出路径仍是 `server.js`（由 server.ts 重导出）。
 */
import type { Hono } from 'hono'
import type { Context } from '@plume-canvas/kernel'

export interface CloudServerOptions {
  /** 监听端口（缺省 8865；0 = 让系统分配，单测/多实例用） */
  port?: number
  /** 数据根目录（缺省 .plume）：其下 kv/（小数据）与 canvases/（一个画布一个文件夹） */
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
  /**
   * 管理令牌鉴权（缺省**开**）。
   *
   * 关掉要配合 `PLUME_ALLOW_INSECURE=1`（命令行 `--no-admin-auth` 也是这条规则），
   * 否则任何人都能用一个环境变量把整个管理面敞开。
   */
  adminAuth?: boolean
  /** 固定管理令牌（缺省读 `PLUME_ADMIN_TOKEN`；都没有就生成/复用 <数据根>/admin-token） */
  adminToken?: string
  /**
   * 请求来源边界（Host/Origin）。缺省**开**。
   * 测试里关掉（`app.fetch` 造出来的 Request 没有可信 Host），真机必须开。
   */
  requestTrust?: boolean
  /** 额外信任的 Host（如 `localhost:8865`、反代域名），与启动时的 hostname:port 一并生效 */
  trustedHosts?: string[]
  /** 额外信任的 Origin（如 dev 的 `http://localhost:5288`） */
  trustedOrigins?: string[]
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
  /** 管理令牌（启动日志与前端手填用；`adminAuthEnabled=false` 时为空串） */
  adminToken: string
  /** 令牌来源：env 固定 / 数据根文件 / 已关闭 */
  adminTokenSource: 'env' | 'file' | 'disabled'
  /** 令牌文件路径（env 固定令牌时为 null） */
  adminTokenFile: string | null
  /** 实际生效的 Host / Origin 白名单（启动日志要逐行打印，配错时能一眼看出来） */
  trust: { hosts: string[]; origins: string[] }
  /** 独立调试源的地址（未启用 / 没起来时为空串；文档里让用户去启动日志找它） */
  debugOriginUrl: string
  /** 重扫 provider 目录（目录变了由 watcher 调；也可手动触发） */
  reloadProviders(): Promise<{ count: number; version: number }>
}
