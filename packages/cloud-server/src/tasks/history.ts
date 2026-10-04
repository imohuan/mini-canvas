/**
 * HistoryStore —— 生成历史（画布文件夹里的 history.json）。
 *
 * 存法：`<画布>/history.json`，值是 `HistoryEntry[]`。
 * 为什么单独一个文件：它是**账本**（按时间只增不减），与画布本体互不干扰 ——
 * 每次生成记一笔，不必重写整份节点边。
 *
 * 为什么连"提醒订阅者"也在这里做：实时通道（SSE）靠的是**写事件**，
 * 而 history.json 不经过 KvStore，写它不会产生事件。所以归档后要额外惊动一次
 * （写一个信号键）—— 否则后台记了账，前端永远收不到通知。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { canvasFilePath } from '../store/canvasPaths.js'
import type { HistoryEntry, HistoryPage, HistoryQuery } from './types.js'

/** 历史条数上限：超出丢最旧的（生成要花钱，量不会大；但账本不能无限长） */
export const DEFAULT_HISTORY_LIMIT = 500

/** 默认分页大小 */
export const DEFAULT_PAGE_SIZE = 20

export class HistoryStore {
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly root: string,
    private readonly limit: number = DEFAULT_HISTORY_LIMIT,
  ) {}

  /** 订阅「有新的历史」（后端把它接到 SSE 的信号键上） */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l()
      } catch {
        /* 订阅者自己的问题，不该把归档带崩 */
      }
    }
  }

  /** 读某画布的全部历史（最新的在前） */
  async readAll(canvasId: string): Promise<HistoryEntry[]> {
    const raw = await readJson(canvasFilePath(this.root, canvasId, 'history'))
    if (!Array.isArray(raw)) return []
    return raw as HistoryEntry[]
  }

  /**
   * 归档一笔。
   *
   * 最新在前（新的一笔插到头部），超出上限丢尾部（最旧的）。
   */
  async append(canvasId: string, entry: HistoryEntry): Promise<void> {
    const all = await this.readAll(canvasId)
    const next = [entry, ...all]
    if (next.length > this.limit) next.length = this.limit
    await atomicWriteJson(canvasFilePath(this.root, canvasId, 'history'), next)
    this.notify()
  }

  /**
   * 查询：筛选 + 排序 + 分页 + 汇总。
   *
   * 汇总（一共生成过多少 / 按类型分）**不受分页影响** —— 前端那几个计数徽章要的是总量。
   */
  async query(q: HistoryQuery = {}): Promise<HistoryPage> {
    const page = Math.max(1, Math.floor(q.page ?? 1))
    const pageSize = Math.max(1, Math.floor(q.pageSize ?? DEFAULT_PAGE_SIZE))
    const order = q.order === 'asc' ? 'asc' : 'desc'

    const source = q.canvasId ? await this.readAll(q.canvasId) : await this.readAllCanvases()
    // readAll 已是"最新在前"，这里只需在 asc 时反过来
    const ordered = order === 'desc' ? source : [...source].reverse()

    const filtered = ordered.filter((e) => {
      if (q.kind && e.kind !== q.kind) return false
      if (q.status && e.status !== q.status) return false
      // 'all' 与省略等价（前端那个下拉的"所有评级"）
      if (q.rating && q.rating !== 'all' && e.rating !== q.rating) return false
      return true
    })

    const byKind: Record<string, number> = {}
    for (const e of filtered) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1

    const start = (page - 1) * pageSize
    return {
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
      // 汇总也按筛选后的集合算（用户筛了"图片"，那"一共多少"就该是图片的数）
      summary: { total: filtered.length, byKind },
    }
  }

  /** 跨全部画布读（"全部画布"那个筛选） */
  private async readAllCanvases(): Promise<HistoryEntry[]> {
    const { promises: fsp } = await import('node:fs')
    const root = path.join(this.root, 'canvases')
    let ids: string[]
    try {
      ids = (await fsp.readdir(root)).filter((n) => /^[A-Za-z0-9_-]{1,64}$/.test(n))
    } catch {
      return []
    }
    const out: HistoryEntry[] = []
    for (const id of ids) out.push(...(await this.readAll(id)))
    // 跨画布时按时间重排（各画布内部有序，合起来要再排一次）
    return out.sort((a, b) => b.finishedAt - a.finishedAt)
  }
}

/** 读 JSON；不存在或坏掉都按"没有历史"处理（与 kvStore 同口径：坏内容要出声） */
async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if (isNotFound(err)) return undefined
    if (err instanceof SyntaxError) {
      console.warn('[history] ' + file + ' 不是合法 JSON，按空历史处理')
      return undefined
    }
    throw err
  }
}

/** 原子写（先临时再 rename） */
async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  await fs.writeFile(tmp, JSON.stringify(value), 'utf8')
  await fs.rename(tmp, file)
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
