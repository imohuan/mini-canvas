/**
 * kvStore —— 服务端 key-value 落盘（纯逻辑，Node fs，可单测）。
 *
 * 磁盘布局（对齐计划 §二）：`{dir}/kv/{type}:{key}.json`，每项一个文件。
 *
 * 为什么一项一文件（而不是一个总 JSON）：
 * - SaveService 是按 key 增量 set 的，整包写会把不相关的域也一起重写；
 * - 一个文件坏掉不会连带其它数据；
 * - 与客户端 `save.get(key)` 一一对应，语义直白。
 *
 * key 安全：物理 key（如 `canvas:graph`）含 `:`，Windows 文件名不允许，
 * 故落盘时按 `encodeURIComponent` 转义（`canvas%3Agraph.json`），读回时反解。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 允许的 value 作用域（与客户端 SaveType 一致） */
export type KvType = 'config' | 'canvas' | 'resource' | 'shortcut'

const KV_TYPES: readonly KvType[] = ['config', 'canvas', 'resource', 'shortcut']

/**
 * 一次 kv 变更（set 或 remove 之后发出）。
 *
 * type 是作用域，key 是**裸 key**（不带 type: 前缀，如 graph）—— 与
 * /api/kv/:type/:key 的 URL 段、keys() 的返回保持同一套写法，订阅方不用再做前缀拼接。
 */
export interface KvChangeEvent {
  type: string
  key: string
}

/** 校验作用域是否合法（挡住把任意路径写进来的可能） */
export function isKvType(v: string): v is KvType {
  return (KV_TYPES as readonly string[]).includes(v)
}

/**
 * 物理文件名：`{type}:{key}` → 安全文件名。
 * 同时反解用的前缀校验，避免 `..` 之类越权路径。
 */
export function kvFileName(type: string, key: string): string {
  return encodeURIComponent(`${type}:${key}`) + '.json'
}

/**
 * kvStore —— 一个根目录下的 KV 存储。
 *
 * 语义：`get` 未命中返回 **undefined**（不是 null）—— 调用方（HttpAdapter）
 * 靠这个判"从未保存过"，与客户端 `saved === undefined` 对齐（否则空画布会重新长 seed）。
 */
export class KvStore {
  /** 变更订阅者（见 onChange） */
  private readonly changeListeners = new Set<(e: KvChangeEvent) => void>()

  /**
   * 每个 key 一条写链（见 runFor）。
   *
   * 为什么必须在这一层做：`set` 是「写临时文件 → rename 到目标」两步。两个并发写同一个 key 时，
   * **撞的不是临时名，而是目标文件** —— Windows 上两个 rename 打同一个目标会直接 EPERM。
   * 实测（400 轮 ×3 并发）：不串行 ~31% 失败；按 key 串行后 0 失败。
   *
   * 上层的 CanvasDocument 也有把锁，但它只覆盖画布那两个 key，而这里是**所有**写路径的地基
   * （配置、视口、资源……都要过 set）。地基不稳，上面怎么排都会漏。
   */
  private readonly writeChains = new Map<string, Promise<unknown>>()

  constructor(private readonly dir: string) {}

  /**
   * 把一次写排进「同 key 串行」的链尾（不同 key 互不影响，各走各的）。
   *
   * 链上某个任务失败不会卡住后面的：错误交给它自己的调用方，链本身用 catch 吞掉状态继续。
   */
  private runFor(channel: string, job: () => Promise<void>): Promise<void> {
    const prev = this.writeChains.get(channel) ?? Promise.resolve()
    const next = prev.then(job, job)
    // 链上保存的是「吞掉错误后的尾巴」：某个任务失败不能把后面等着的一起带崩
    const tail = next.catch(() => undefined)
    this.writeChains.set(channel, tail)
    // 跑完且自己仍是链尾时才摘掉条目，免得 key 多了只增不减（长跑服务里的慢泄漏）。
    // 若期间又排了新任务，链尾已经换人，这里删会把新链一起删掉 —— 所以要判等。
    void tail.then(() => {
      if (this.writeChains.get(channel) === tail) this.writeChains.delete(channel)
    })
    return next
  }

  /**
   * 订阅"某一项被写过/删过"。返回取消函数。
   *
   * 存在的理由：MCP 与网页画布共用一个服务、一份数据，但**写入口是分散的**
   * （MCP 工具、网页端 PUT、上传接口……）。要让网页端在 AI 改完画布后实时看到变化，
   * 就必须有个统一的"谁写完了"信号 —— 放在这一层，因为所有写路径最终都要落到 set/remove。
   *
   * 有意只报"哪个 type/key 变了"，不带新值：订阅方按需自己去读，
   * 免得大画布每写一次就把整份数据塞进事件里穿过若干层。
   */
  onChange(listener: (e: KvChangeEvent) => void): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  /** 通知订阅者；单个订阅者抛错不影响其它订阅者，也不影响写操作本身 */
  private notifyChange(type: string, key: string): void {
    if (this.changeListeners.size === 0) return
    const event: KvChangeEvent = { type, key }
    for (const listener of this.changeListeners) {
      try {
        listener(event)
      } catch {
        /* 订阅者自己的问题，不该把写操作带崩 */
      }
    }
  }

  /** kv 目录绝对路径（懒创建） */
  private kvDir(): string {
    return path.join(this.dir, 'kv')
  }

  /** 某项的文件路径 */
  private filePath(type: string, key: string): string {
    return path.join(this.kvDir(), kvFileName(type, key))
  }

  /** 读一项；不存在返回 undefined */
  async get<T = unknown>(type: string, key: string): Promise<T | undefined> {
    try {
      const raw = await fs.readFile(this.filePath(type, key), 'utf8')
      return JSON.parse(raw) as T
    } catch (err) {
      // 文件不存在 = 从未保存过（正常路径，返回 undefined 是本模块的核心契约）。
      // 但**不能把所有错误都当成「没保存过」**：磁盘权限错、IO 错若也返回 undefined，
      // 上层的画布读取会看到一个空画布，AI 接着在「空画布」上写回 —— 整张画布被覆盖掉。
      // 所以只有 ENOENT 是正常缺失，JSON 坏掉要出声，其它错误照抛。
      if (isNotFound(err)) return undefined
      if (isSyntaxError(err)) {
        console.warn(`[kvStore] ${type}:${key} 的内容不是合法 JSON，按缺失处理（文件：${this.filePath(type, key)}）`)
        return undefined
      }
      throw err
    }
  }

  /** 写一项（原子写：先写临时文件再 rename，避免半截 JSON） */
  async set(type: string, key: string, value: unknown): Promise<void> {
    // JSON.stringify(undefined) 返回 undefined（不是字符串），直接写会抛难懂的 TypeError。
    // 明确拒绝：想删用 remove（语义清晰，调用方不会「以为存了 undefined」）。
    if (value === undefined) {
      throw new Error(`[kvStore] 不接受 undefined 值（type=${type} key=${key}）：要删请用 remove`)
    }
    // 序列化在这里做（同步、快）：一是早点暴露循环引用，二是别让 stringify 占着串行链。
    // 注意它也可能因**嵌套过深**抛 RangeError（爆栈）—— 那是调用方的输入问题，照抛给上层。
    const text = JSON.stringify(value)
    await this.runFor(`${type}:${key}`, async () => {
      await fs.mkdir(this.kvDir(), { recursive: true })
      const file = this.filePath(type, key)
      // 临时名唯一化：同一毫秒、同一 key 的两次写也不共用临时文件
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      await fs.writeFile(tmp, text, 'utf8')
      await fs.rename(tmp, file)
    })
    this.notifyChange(type, key)
  }

  /** 删一项；返回是否真删到 */
  async remove(type: string, key: string): Promise<boolean> {
    // 删除同样排进这条链：它和「写的 rename」是同一份文件上的两个动作，
    // 不排队就可能出现「删完了又被并发写还原」或 rename 撞到正在删的目标。
    let removed = false
    await this.runFor(`${type}:${key}`, async () => {
      try {
        await fs.unlink(this.filePath(type, key))
        removed = true
      } catch (err) {
        if (!isNotFound(err)) throw err
      }
    })
    if (removed) this.notifyChange(type, key)
    return removed
  }

  /** 列某作用域下全部裸 key（诊断/后台查看用） */
  async keys(type: string): Promise<string[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.kvDir())
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
    const prefix = `${type}:`
    const out: string[] = []
    for (const n of names) {
      if (!n.endsWith('.json') || n.includes('.tmp-')) continue
      const decoded = decodeURIComponent(n.slice(0, -'.json'.length))
      if (decoded.startsWith(prefix)) out.push(decoded.slice(prefix.length))
    }
    return out.sort()
  }
}

/** 判断 fs 错误是不是"文件不存在" */
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

/** 判断是不是「内容不是合法 JSON」（文件在、内容坏了，与「没保存过」不是一回事） */
function isSyntaxError(err: unknown): boolean {
  return err instanceof SyntaxError
}
