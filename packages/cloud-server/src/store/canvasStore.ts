/**
 * CanvasStore —— 一个画布文件夹的读写（canvas.json / view.json）。
 *
 * 分工（§七 的判据：是「这张画布是什么」，还是「现在怎么看它」）：
 * - canvas.json：**画布本体** —— 节点 + 边 + 画布信息（名称 / 创建时间）
 * - view.json  ：**视图状态** —— 视口。单独放，改视野不必重写整份节点边。
 *
 * 历史（history.json）与资源（resources/）由各自模块管，本类不碰。
 *
 * 「读不到」一律返回 `undefined`（不是空对象）：让上层能区分
 * 「从未保存过」与「保存过一张空画布」—— 空画布刷新后不该重新长出默认节点。
 */
import { promises as fs } from 'node:fs'
import { canvasDir, canvasFilePath, canvasResourcesDir, canvasesRoot } from './canvasPaths.js'
import { atomicWriteJson, atomicWriteText } from './atomicWrite.js'

/** 画布本体。name / createdAt 是画布信息，随节点边一起住 canvas.json */
export interface CanvasData {
  nodes: unknown[]
  edges: unknown[]
  name?: string
  createdAt?: number
}

/**
 * 一次画布变更（写成功后发出）。
 *
 * 为什么要有：实时通道（SSE）原本靠 KvStore 的写事件驱动，而画布数据**已经不经过 kv 了**。
 * 没有这个信号，AI 改完画布网页端永远收不到通知 —— 得手动刷新才看得见。
 */
export interface CanvasChangeEvent {
  canvasId: string
  /** 变了哪一块：本体（节点 + 边，一起住 canvas.json）还是视口 */
  key: 'graph' | 'graph-edges' | 'graph-viewport'
}

export class CanvasStore {
  private readonly listeners = new Set<(e: CanvasChangeEvent) => void>()

  /**
   * 每个文件一条写链。
   *
   * 为什么必须在这一层做（与 KvStore 同款问题、同款解法）：写是「写临时文件 → rename 到目标」
   * 两步，而 **Windows 上两个 rename 打同一个目标会直接 EPERM**（"另一个程序正在使用此文件"）。
   * CanvasDocument 上层虽有写锁，但它只覆盖画布写路径，而这里的地基是**所有**画布文件写
   * （canvas.json / view.json）。实测过：并发写时偶发 500，重试一次就好了 —— 与其赌运气，
   * 不如把同文件的写排成一条链，再对残余的瞬时占用做几次退避重试。
   */
  private readonly writeChains = new Map<string, Promise<unknown>>()

  constructor(private readonly root: string) {}

  /** 把一次写排进「同文件串行」的链尾（不同文件互不影响） */
  private runFor(file: string, job: () => Promise<void>): Promise<void> {
    const prev = this.writeChains.get(file) ?? Promise.resolve()
    const next = prev.then(job, job)
    const tail = next.catch(() => undefined)
    this.writeChains.set(file, tail)
    void tail.then(() => {
      if (this.writeChains.get(file) === tail) this.writeChains.delete(file)
    })
    return next
  }

  /** 订阅「某张画布被写过」。返回取消订阅函数。 */
  onChange(listener: (e: CanvasChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 广播变更；单个订阅者抛错不影响其它订阅者，也不影响这次写 */
  private notify(e: CanvasChangeEvent): void {
    for (const l of this.listeners) {
      try {
        l(e)
      } catch {
        /* 订阅者自己的问题，不该把写操作带崩 */
      }
    }
  }

  /** 读画布本体；没存过返回 undefined */
  async readCanvas(id: string): Promise<CanvasData | undefined> {
    const raw = (await readJson(canvasFilePath(this.root, id, 'canvas'))) as
      | { nodes?: unknown; edges?: unknown; name?: unknown; createdAt?: unknown }
      | undefined
    if (raw === undefined) return undefined
    return {
      nodes: Array.isArray(raw?.nodes) ? raw.nodes : [],
      edges: Array.isArray(raw?.edges) ? raw.edges : [],
      ...(typeof raw?.name === 'string' ? { name: raw.name } : {}),
      ...(typeof raw?.createdAt === 'number' ? { createdAt: raw.createdAt } : {}),
    }
  }

  /**
   * 写画布本体。
   *
   * 画布信息要**继承**：调用方通常只交来节点与边，若每次都重建对象，
   * 名字与创建时间会被悄悄抹掉。所以先读旧值，缺的字段用旧的补。
   */
  async writeCanvas(id: string, data: CanvasData): Promise<void> {
    const prev = await this.readCanvas(id)
    const out: Record<string, unknown> = { nodes: data.nodes, edges: data.edges }
    const name = data.name ?? prev?.name
    if (name !== undefined) out.name = name
    out.createdAt = prev?.createdAt ?? data.createdAt ?? Date.now()
    await this.runFor(canvasFilePath(this.root, id, 'canvas'), () =>
      atomicWriteJson(canvasFilePath(this.root, id, 'canvas'), out),
    )
    // 节点与边住同一个文件，所以一次写要报两个 key —— 订阅方按 key 过滤，
    // 只关心边的（如合并层）也能收到通知。
    this.notify({ canvasId: id, key: 'graph' })
    this.notify({ canvasId: id, key: 'graph-edges' })
  }

  /** 读视口；没存过返回 undefined */
  async readView<T = { x: number; y: number; zoom: number }>(id: string): Promise<T | undefined> {
    return (await readJson(canvasFilePath(this.root, id, 'view'))) as T | undefined
  }

  async writeView(id: string, view: unknown): Promise<void> {
    await this.runFor(canvasFilePath(this.root, id, 'view'), () =>
      atomicWriteJson(canvasFilePath(this.root, id, 'view'), view),
    )
    this.notify({ canvasId: id, key: 'graph-viewport' })
  }

  /** 列出全部画布 id（目录不存在 = 还没有画布，返回空数组而不是抛错） */
  async list(): Promise<string[]> {
    try {
      const names = await fs.readdir(canvasesRoot(this.root))
      return names.filter((n) => /^[A-Za-z0-9_-]{1,64}$/.test(n)).sort()
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
  }

  /**
   * 删掉一张画布的整个文件夹（画布本体 / 视口 / 历史 / 资源 / agent 会话一起没）。
   * 目录不存在也算删成功（幂等）。
   */
  async remove(id: string): Promise<void> {
    await fs.rm(canvasDir(this.root, id), { recursive: true, force: true })
  }

  /**
   * 把一张画布的内容**复制进另一张已存在的画布文件夹**（「复制画布」用）。
   *
   * 复制的范围：节点 + 边 + 资源字节 + 生成历史。
   * **视口不复制** —— 复制是为了分享内容，不是分享「我当时看到哪儿」（设计文档已定）。
   *
   * 关键一步是**改写资源地址里的画布 id**：节点里存的是同源 URL
   * `/api/canvases/<画布id>/resources/<哈希>`，不换 id 的话副本里的图全都指回原画布
   * （原画布一删，副本全裂）。换掉之后副本自包含，与「复制文件夹 = 复制画布」同义。
   */
  async copyInto(fromId: string, toId: string, name?: string): Promise<void> {
    const src = await this.readCanvas(fromId)
    const fromMarker = '/api/canvases/' + fromId + '/resources/'
    const toMarker = '/api/canvases/' + toId + '/resources/'
    // 资源字节整目录拷一份：文件夹自包含的代价（不复用去重），设计文档已认。
    try {
      await fs.cp(canvasResourcesDir(this.root, fromId), canvasResourcesDir(this.root, toId), {
        recursive: true,
      })
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
    // 节点/边：走 JSON 文本级替换（画布 id 是白名单字符，不会碰坏 JSON 结构）。
    const rewrite = (value: unknown): unknown =>
      JSON.parse(JSON.stringify(value ?? []).split(fromMarker).join(toMarker))
    await this.writeCanvas(toId, {
      nodes: rewrite(src?.nodes) as unknown[],
      edges: rewrite(src?.edges) as unknown[],
      // 名字用调用方给的（副本要叫「原名字 副本」）；没给才继承原画布的名字
      ...(name !== undefined ? { name } : src?.name !== undefined ? { name: src.name } : {}),
      createdAt: Date.now(),
    })
    // 生成历史：同样换地址（历史里的产物地址也带画布 id）；读不到就当没有。
    const history = await readJson(canvasFilePath(this.root, fromId, 'history'))
    if (history !== undefined) {
      await atomicWriteText(
        canvasFilePath(this.root, toId, 'history'),
        JSON.stringify(history).split(fromMarker).join(toMarker),
      )
    }
  }
}

/** 读 JSON；不存在返回 undefined（正常路径）。内容坏掉按缺失处理并出声（与 kvStore 同口径） */
async function readJson(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if (isNotFound(err)) return undefined
    if (err instanceof SyntaxError) {
      console.warn('[canvasStore] ' + file + ' 不是合法 JSON，按缺失处理')
      return undefined
    }
    throw err
  }
}


function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
