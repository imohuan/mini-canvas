/**
 * node-ui 后台的共享类型（从 server.ts 原样迁出，行为不变）。
 */
/** 后台 ctx 的最小形状（就地声明，不 import 工作区包 —— 见文件头说明） */
export interface ServerCtx {
  routes: {
    get(path: string, handler: (c: ServerCtxLike) => Response | Promise<Response>): void
    post(path: string, handler: (c: ServerCtxLike) => Response | Promise<Response>): void
  }
  mcp: {
    tool(def: {
      name: string
      description: string
      input?: Record<string, 'string' | 'number' | 'boolean'>
      required?: string[]
      handler(args: Record<string, unknown>): unknown | Promise<unknown>
    }): void
  }
  tryGet<T = unknown>(name: string): T | undefined
}

/** Hono 处理函数的参数（只声明本文件用到的字段） */
export interface ServerCtxLike {
  json(body: unknown, status?: number): Response
  req: {
    json(): Promise<unknown>
    header(name: string): string | undefined
    url: string
    /** 查询串参数（真 Hono 的 ctx 一定有；声明成可选是为了让测试里的假 ctx 也成立） */
    query?(name: string): string | undefined
  }
}

/** 画布存储（宿主上架的服务；用来读任意画布的节点） */
export interface CanvasStoreLike {
  /** 数据根目录（<root>/canvases/<id> 的上一级）—— 调试文件落盘要用 */
  dataRoot?(): string
  readCanvas(id: string): Promise<{ nodes: unknown[]; edges: unknown[] } | undefined>
  writeCanvas(id: string, data: { nodes: unknown[]; edges: unknown[] }): Promise<void>
  list(): Promise<string[]>
}

/** 节点形状（本文件只关心这几个字段） */
export interface NodeLike {
  id: string
  type: string
  data?: Record<string, unknown>
}

/**
 * 资产库里一条登记（本文件只用到这几个字段）。
 *
 * 为什么要读它：用户要「列出**收藏的**可视化节点」—— 收藏就是资产库里 kind 为
 * node-package 的那些条目。没有这一条，有哪些收藏可复用就只能靠人肉翻抽屉。
 */
export interface AssetLike {
  id: string
  name: string
  kind?: string
  url: string
  folderId?: string
  size?: number
  createdAt?: number
}

/** 资产服务的最小用面（读清单 + 读某个包的字节） */
export interface AssetStoreLike {
  list(): Promise<AssetLike[]>
  readFile?(hashName: string): Promise<Uint8Array | undefined>
}

/** 增量改画布的结果（只声明用到的那几个字段） */
export interface PatchResult {
  ok?: boolean
  added?: string[]
  deleted?: string[]
  updated?: string[]
  errors?: Array<{ message: string }>
}

/** 默认画布的文档（宿主上架的服务；有写锁，优先用它） */
export interface DocLike {
  getNodes(): NodeLike[]
  getEdges(): Array<{ source: string; target: string }>
  batchNodes(input: unknown): Promise<PatchResult>
}

/** 宿主画布文档池（非默认画布也走同一个实例 → 同一把写锁 / 同一个版本发号点） */
export interface DocPoolLike {
  for(canvasId: string): DocLike
}

/** 一次「生成调试产物」的入参（MCP 工具与画布内按钮共用） */
export interface BuildDebugDocsInput {
  canvasId: string
  nodeId: string
  html: string
  inputs: Record<string, unknown>
  /** 上游素材（未规整；builder 内部按同一套规则归一） */
  upstream?: unknown
  version?: string
  /** 要不要回本机绝对路径（MCP 工具要，HTTP 路由不要 —— 路径对前端没用） */
  withPaths: boolean
  hint: string
}


