/**
 * kvStore —— 服务端"零碎小数据"的落盘（纯逻辑，Node fs，可单测）。
 *
 * ## 布局：全部装在一个文件里
 *
 *   {dir}/settings.json
 *   {
 *     "config":   { "settings": {...}, "plugin-manager:installed": [...] },
 *     "shortcut": { "map": {...} }
 *   }
 *
 * 文件里按 type 分桶、桶里按 key 存值。
 *
 * ## 为什么一个文件
 *
 * 这里存的全是几十字节的零碎：设置快照、快捷键表、插件安装清单。
 * 一项一个文件会让磁盘长出一堆两行的小文件，名字还得整串转义成 config%3Asettings.json ——
 * 收益为零，代价是认不出、也删不干净。
 *
 * ## 为什么不是"一个大 JSON 全放"
 *
 * 画布与资源**不在这里**：它们各有自己的目录（见 canvasStore / canvasResources）——
 * 那两类是大数据、还要按画布分家。这里只装真正的配置类小数据。
 *
 * ## 对外契约没变
 *
 * 客户端看到的仍是 (type, key) 两级：HTTP 接口 /api/kv/:type/:key 与 SSE 事件形状都没动，
 * 改的只是"磁盘上一个文件装下全部"。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWriteJson } from './atomicWrite.js'

/** 允许的作用域（与客户端 SaveType 一致） */
export type KvType = 'config' | 'canvas' | 'resource' | 'shortcut'

const KV_TYPES: readonly KvType[] = ['config', 'canvas', 'resource', 'shortcut']

/**
 * 真正落到 settings.json 里的作用域。
 * canvas / resource 各有自己的目录（canvases/<id>/），不走这里 —— 留着这份名单是为了
 * 迁移旧数据时只搬"还活着"的两类，别把早就废弃的 canvas:* 塞回配置里。
 */
const STORED_TYPES: readonly string[] = ['config', 'shortcut']

/**
 * 一次 kv 变更（set 或 remove 之后发出）。
 *
 * type 是作用域，key 是**裸 key**（不带 type: 前缀，如 settings）—— 与
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

/** 小数据落盘文件的绝对路径：{dir}/settings.json */
export function settingsFilePath(dir: string): string {
  return path.join(dir, 'settings.json')
}

/** 文件内容形状：type → key → value */
export type KvFileData = Record<string, Record<string, unknown>>

/**
 * kvStore —— 全部小数据装在一个 settings.json 里。
 *
 * 语义：get 未命中返回 **undefined**（不是 null）—— 调用方（CloudKvAdapter）靠它判
 * "从未保存过"，与客户端 SaveStore 的 undefined 语义对齐。
 */
export class KvStore {
  /** 变更订阅者（见 onChange） */
  private readonly changeListeners = new Set<(e: KvChangeEvent) => void>()

  /**
   * 写链：**所有写都排这一条**。
   *
   * 与"一项一文件"时代的关键差别：那时可以按 (type,key) 各排一条（不同项互不影响）；
   * 现在全部落同一个文件，读-改-写必须整体串行 —— 否则两个并发写各读到同一份旧内容、
   * 各自写回，后写的把先写的整段盖掉（丢配置）。
   */
  private chain: Promise<unknown> = Promise.resolve()

  /** 旧布局迁移：只做一次（首次访问触发）；记住 promise，避免并发首访各迁一遍 */
  private migration: Promise<void> | null = null

  constructor(private readonly dir: string) {}

  /** 把一次写排进链尾（链上任务失败不卡住后面的） */
  private runExclusive<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job, job)
    this.chain = next.catch(() => undefined)
    return next
  }

  /**
   * 订阅"某一项被写过/删过"。返回取消函数。
   *
   * 存在的理由：网页端与 AI（MCP）共用一个服务、一份数据，但**写入口是分散的**。
   * 要让网页端在 AI 改完之后实时看到变化，就必须有个统一的"谁写完了"信号 ——
   * 放在这一层，因为所有写路径最终都要落到 set/remove。
   *
   * 有意只报"哪个 type/key 变了"，不带新值：订阅方按需自己去读。
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

  /**
   * 读整个文件。
   *
   * 内容坏掉（非法 JSON）**抛错**，不静默当空：
   * 若当成空再写回，会把用户剩下的全部配置一起抹掉 —— 宁可这次请求失败、让人看见。
   * （get() 会把这个错误降级成 undefined + 一条 warn。）
   */
  private async readFile(): Promise<KvFileData> {
    await this.ensureMigrated()
    const file = settingsFilePath(this.dir)
    let raw: string
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch (err) {
      if (isNotFound(err)) return {}
      throw err
    }
    const parsed = JSON.parse(raw) as unknown
    return isPlainObject(parsed) ? (parsed as KvFileData) : {}
  }

  /** 写整个文件（原子写：临时文件 + rename，读者永远看到完整内容） */
  private async writeFile(data: KvFileData): Promise<void> {
    await atomicWriteJson(settingsFilePath(this.dir), data)
  }

  /** 读一项；不存在返回 undefined */
  async get<T = unknown>(type: string, key: string): Promise<T | undefined> {
    let data: KvFileData
    try {
      data = await this.readFile()
    } catch (err) {
      console.warn('[kvStore] ' + settingsFilePath(this.dir) + ' 读不出来，按空处理：' + String(err))
      return undefined
    }
    const bucket = data[type]
    return bucket ? (bucket[key] as T | undefined) : undefined
  }

  /** 写一项 */
  async set(type: string, key: string, value: unknown): Promise<void> {
    // JSON.stringify(undefined) 返回 undefined（不是字符串），直接写会抛难懂的 TypeError。
    // 明确拒绝：想删用 remove（语义清晰，调用方不会"以为存了 undefined"）。
    if (value === undefined) {
      throw new Error('[kvStore] 不接受 undefined 值（type=' + type + ' key=' + key + '）：要删请用 remove')
    }
    // 序列化先做一次（同步、快）：早点暴露循环引用，也别让 stringify 占着写链。
    // 注意它也可能因**嵌套过深**抛 RangeError（爆栈）—— 那是调用方的输入问题，照抛给上层。
    JSON.stringify(value)
    await this.runExclusive(async () => {
      const data = await this.readFile()
      const bucket = data[type] ?? (data[type] = {})
      bucket[key] = value
      await this.writeFile(data)
    })
    this.notifyChange(type, key)
  }

  /** 删一项；返回是否真删到 */
  async remove(type: string, key: string): Promise<boolean> {
    let removed = false
    await this.runExclusive(async () => {
      const data = await this.readFile()
      const bucket = data[type]
      if (!bucket || !(key in bucket)) return
      delete bucket[key]
      // 桶空了就把 type 也去掉，免得文件里留一堆空对象
      if (Object.keys(bucket).length === 0) delete data[type]
      removed = true
      await this.writeFile(data)
    })
    if (removed) this.notifyChange(type, key)
    return removed
  }

  /** 列某作用域下全部裸 key（诊断/后台查看用） */
  async keys(type: string): Promise<string[]> {
    const data = await this.readFile().catch(() => ({}) as KvFileData)
    return Object.keys(data[type] ?? {}).sort()
  }

  // ==================== 旧布局迁移（只做一次） ====================

  /** 迁移只跑一次；并发首访共用同一个 promise */
  private ensureMigrated(): Promise<void> {
    this.migration ??= this.migrateLegacy()
    return this.migration
  }

  /**
   * 把旧布局的文件折进 settings.json。
   *
   * 要认两种旧形态：
   *   1. {dir}/kv/{type}/{key}.json      —— 上一版
   *   2. {dir}/kv/{type}%3A{key}.json    —— 最早那版（整串转义）
   *
   * 只搬 STORED_TYPES 里的两类（config / shortcut）：canvas / resource 早已各有目录，
   * 把它们搬回来只会往配置里塞死数据。
   *
   * 搬完把整个 kv 目录**改名**（不是删）成 kv.migrated —— 留一份人肉可查的备份。
   * 新文件已存在时整段跳过。
   */
  private async migrateLegacy(): Promise<void> {
    const target = settingsFilePath(this.dir)
    if (await exists(target)) return
    const kvDir = path.join(this.dir, 'kv')
    let names: string[]
    try {
      names = await fs.readdir(kvDir)
    } catch {
      return // 没有旧目录 = 全新安装
    }
    const data: KvFileData = {}
    const put = (type: string, key: string, value: unknown): void => {
      if (!STORED_TYPES.includes(type)) return
      const bucket = data[type] ?? (data[type] = {})
      bucket[key] = value
    }
    for (const name of names) {
      if (name.includes('.tmp-')) continue
      const full = path.join(kvDir, name)
      const stat = await fs.stat(full).catch(() => null)
      if (!stat) continue
      if (stat.isDirectory()) {
        // 形态 1：目录名是 type，里面是 {key}.json
        const inner = await fs.readdir(full).catch(() => [] as string[])
        for (const f of inner) {
          if (!f.endsWith('.json') || f.includes('.tmp-')) continue
          const value = await readJsonSafe(path.join(full, f))
          if (value !== undefined) put(name, tryDecode(f.slice(0, -'.json'.length)), value)
        }
      } else if (name.endsWith('.json')) {
        // 形态 2：文件名是 {type}%3A{key}.json
        const decoded = tryDecode(name.slice(0, -'.json'.length))
        const i = decoded.indexOf(':')
        if (i < 0) continue
        const value = await readJsonSafe(full)
        if (value !== undefined) put(decoded.slice(0, i), decoded.slice(i + 1), value)
      }
    }
    if (Object.keys(data).length === 0) return
    await this.writeFile(data)
    // 改名而不是删：万一看走眼，备份还在
    await fs.rename(kvDir, kvDir + '.migrated').catch(() => undefined)
    console.log('[kvStore] 已把旧 kv/ 折进 settings.json（旧目录改名 kv.migrated 备份）')
  }
}

/** 判断 fs 错误是不是"文件不存在" */
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

/** 是不是普通对象（不是数组 / null） */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 文件存在与否 */
async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

/** 读一个 JSON 文件；坏掉/读不到都返回 undefined（迁移不因单个坏文件中断） */
async function readJsonSafe(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/** 解 key 的转义（旧布局对 key 做过 encodeURIComponent）；坏串原样返回 */
function tryDecode(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

