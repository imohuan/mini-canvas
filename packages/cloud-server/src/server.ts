/**
 * createCloudServer —— 组装 cloud-server 的 HTTP 应用（可测：不启真端口也能喂 Request 进去）。
 *
 * 四块能力：
 *   1. /api/kv/*                   画布数据（KV）
 *   2. /api/files + /uploads/*     资源字节（上传/回读）
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
import { FileStore } from './store/fileStore.js'
import { kvRoutes } from './routes/kv.js'
import { fileRoutes } from './routes/files.js'
import { pluginRoutes, resolvePluginsDir, resolveUiDist, uiRoutes } from './static.js'

/** 默认端口：避开 ui dev 的 5288 与 mcp-server 的 8765 */
export const DEFAULT_PORT = 8865

/** 默认数据目录名（相对启动目录） */
export const DEFAULT_DATA_DIR = '.mini-canvas'

export interface CloudServerOptions {
  /** 监听端口（缺省 8865；0 = 让系统分配，单测/多实例用） */
  port?: number
  /** 数据根目录（缺省 .mini-canvas）：其下 kv/ 与 uploads/ */
  dir?: string
  /** 监听地址（缺省 127.0.0.1：本机自用，不对外暴露） */
  hostname?: string
  /** ui 构建产物目录；不传则自动探测 packages/ui/dist（探测不到 → 页面给"先构建"提示） */
  uiDist?: string
  /** 插件目录（含各插件的 dist）；不传则自动探测 packages/plugins */
  pluginsDir?: string
}

export interface CloudServer {
  /** Hono 应用（测试可直接 app.fetch(new Request(...))，不必启端口） */
  app: Hono
  /** 启服务；resolve 后服务已在监听 */
  start(): Promise<{ port: number; url: string }>
  /** 停服务 */
  stop(): void
  /** 解析后的实际路径（启动时用于打印，便于确认数据落在哪） */
  paths: { data: string; kv: string; uploads: string; ui?: string; plugins?: string }
}

export async function createCloudServer(opts: CloudServerOptions = {}): Promise<CloudServer> {
  const port = opts.port ?? DEFAULT_PORT
  const dataDir = path.resolve(opts.dir ?? DEFAULT_DATA_DIR)
  const uiDist = await resolveUiDist(opts.uiDist)
  const pluginsDir = await resolvePluginsDir(opts.pluginsDir)

  const kvStore = new KvStore(dataDir)
  const fileStore = new FileStore(dataDir)

  const app = new Hono()
  // 允许跨域：画布可能在 ui dev server(5288) 跑，数据想指到本服务
  app.use('*', cors())
  app.get('/health', (c) => c.json({ ok: true }))
  // 挂载顺序即匹配优先级：接口在前，最后的 ui 通配（含 SPA 回落）兜底
  app.route('/', kvRoutes(kvStore))
  app.route('/', fileRoutes(fileStore))
  app.route('/', pluginRoutes(pluginsDir))
  app.route('/', uiRoutes(uiDist))

  let server: ServerType | undefined
  const hostname = opts.hostname ?? '127.0.0.1'

  return {
    app,
    paths: {
      data: dataDir,
      kv: path.join(dataDir, 'kv'),
      uploads: path.join(dataDir, 'uploads'),
      ...(uiDist ? { ui: uiDist } : {}),
      ...(pluginsDir ? { plugins: pluginsDir } : {}),
    },
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
      server?.close()
      server = undefined
    },
  }
}
