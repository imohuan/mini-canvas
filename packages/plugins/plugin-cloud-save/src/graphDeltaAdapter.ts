/**
 * GraphDeltaAdapter —— 画布域的存储适配器：把「整张画布」的提交翻译成**增量**提交。
 *
 * ## 它解决什么
 *
 * 宿主的保存语义是「交来整张画布」，所以原来的 `HttpAdapter` 就整份 PUT 上去。可是画布有
 * **两个写方**：网页端和 AI（MCP）。整包写会覆盖掉对方在两次提交之间做的一切 ——
 * 实测就是「AI 刚加的节点，被画布紧接着的一次保存抹掉」。
 *
 * 这里把整份数据与「上次提交的那份」比出差集，只把差异发出去：我这次没提到的节点，
 * 服务端原样留着。谁都不会覆盖谁。
 *
 * ## 为什么基准是「上次提交的内容」而不是「服务端当时的内容」
 *
 * 因为本地的这份已经含了 AI 的改动（实时通道会把云端变化合进来）。于是「上次提交 → 本次提交」
 * 之间的差异**正好等于本地真正改了的东西**：AI 加的节点早就在两份里都有，不会出现在差集里。
 *
 * ## 读与写走不同的口子
 *
 * - 读：`/api/kv/...`（拿到的是权威的那一份，含 AI 的改动）；
 * - 写：`/api/canvas/nodes` · `/api/canvas/edges`（增量，服务端在同一份画布上应用）。
 *
 * ## 失败时怎么办（这块最容易做错，逐条说明为什么）
 *
 * 整包 PUT 是**最后手段**而不是第一反应：它会退回「可能覆盖 AI 改动」的老行为，
 * 所以只在确认「增量口真的用不了」时才用。三种结果分别对待：
 *
 *   ok        存上了 → 记住基准，清空失败计数
 *   failed    网络错 / 非 2xx → 本次**不写**、基准不动（下次保存会重试同一批差集）。
 *             只有**连续**失败到阈值才退整包 —— 一次网络抖动不该让之后所有保存都开始覆盖别人。
 *   rejected  服务端收下了但拒绝内容（个别项有问题，如边指向不存在的节点）→
 *             按服务端给的错误把出问题的项剔掉，剩下继续发。绝不因为几项坏数据就整包覆盖，
 *             也不会原地死循环（剔干净的次数有上限）。
 *
 * 失败计数**按 key 分开**：边那条失败不该把节点一起拖去整包。
 */
import { diffGraph, isEmptyOps, type GraphOps } from './graphDiff'
import { HttpAdapter } from './httpAdapter'
import { GRAPH_EDGES_KEY, GRAPH_KEY } from './keys'
// 仅类型导入（会被擦除，产物里不留 import —— 插件的硬约束，见 vite.config.ts）
import type { SaveType } from '@mini-canvas/canvas-data'

/** 服务端拒绝时给的错误项（与 BatchResult.errors 同形状） */
interface BatchError {
  op?: string
  index?: number
  message?: string
}

/** 一次增量提交的结果：三态分得很清楚，因为后续动作完全不同 */
type SubmitOutcome = { kind: 'ok' } | { kind: 'failed' } | { kind: 'rejected'; errors: BatchError[] }

export interface GraphDeltaAdapterOptions {
  baseUrl?: string
  type: SaveType
  fetchImpl?: typeof fetch
  /**
   * 有项目因服务端拒绝而被跳过时回调（给上层记一笔，便于发现「有东西一直存不上」）。
   *
   * 为什么要有：剔除坏项能让其它改动照常保存，但被剔掉的那个就**悄悄不同步**了。
   * 没有这个信号，这种不一致没有任何人看得见。
   */
  onSkipped?: (info: { key: string; messages: string[] }) => void
}

export class GraphDeltaAdapter extends HttpAdapter {
  /** 上次提交成功的那份（按裸 key 分开记：节点与边各自独立算差集） */
  private readonly submitted = new Map<string, unknown[]>()
  /**
   * 增量口的**连续**失败次数，按 key 分开记。
   *
   * 为什么是计数而不是一次性布尔：一次网络抖动不该让之后**所有**保存都退化成整包 PUT。
   * 为什么按 key：节点那条失败不该把边（或反过来）一起拖去整包。
   */
  private readonly failures = new Map<string, number>()
  /** 连续失败达到这个数 → 认「增量口不可用」，本次起退整包（成功一次即清零） */
  private static readonly FAILURE_LIMIT = 3
  /** 一轮保存里最多「剔掉坏项重试」几次（防原地死循环；坏项剔干净了就成功） */
  private static readonly DROP_ROUND_LIMIT = 3
  private readonly onSkipped?: GraphDeltaAdapterOptions['onSkipped']

  constructor(opts: GraphDeltaAdapterOptions) {
    super({ ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}), type: opts.type, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) })
    this.onSkipped = opts.onSkipped
  }

  override async set(key: string, value: unknown): Promise<void> {
    const bare = this.bareKey(key)
    // 只对画布那两个 key 做增量；其它 key（视口等）照旧整包写
    if (bare !== GRAPH_KEY && bare !== GRAPH_EDGES_KEY) return super.set(key, value)
    return this.submitDelta(bare, value)
  }

  /** 把这份记成「已提交」（下次就以它为基准算差集） */
  private remember(bare: string, value: unknown): void {
    if (Array.isArray(value)) this.submitted.set(bare, value)
  }

  /**
   * 记「服务器**实际**拥有什么」：这份里要剔掉没送成功的那些项。
   *
   * 为什么不能直接记整份：记了的话下次 `diff(submitted, value)` 会认为被拒的项已经
   * 在云端，从此再也不发 —— 而它们确实不在（实测：一条连线就此永久丢失）。
   * 剔掉之后，下一轮 diff 会正好把它们再算成「待发」，自然重试。
   *
   * 这比「整包重写」精确得多：整包写会把其它写方（AI）在此期间做的改动一起盖掉。
   */
  private rememberExcept(bare: string, value: unknown, dropped: GraphOps): void {
    if (!Array.isArray(value)) return
    const gone = new Set<string>()
    for (const item of [...dropped.add, ...dropped.update]) {
      if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
        gone.add((item as { id: string }).id)
      }
    }
    for (const id of dropped.delete) gone.add(id)
    this.submitted.set(
      bare,
      (value as Array<{ id?: unknown }>).filter((item) => {
        const id = item && typeof item === 'object' ? item.id : undefined
        return typeof id !== 'string' || !gone.has(id)
      }) as unknown[],
    )
  }
  /**
   * 记下「服务器**实际**拥有什么」：`value` 里去掉没送成功的那些项，再加上没删成功的 id。
   *
   * 为什么必须这么记：`submitted` 是下一轮差集的基准。若把没送成功的项也记成「已在云端」，
   * 下一轮 `diff` 会认为它们不用再发 —— 而它们确实不在服务器上，于是**永远补不回来**。
   * 实测到的场景：用户拖出一根连线时，边与它两端的新节点在同一次提交里，边那条请求先到、
   * 因「目标节点不存在」被拒；若就此记成已保存，那条边在屏幕上还在、服务器上没有，刷新即消失。
   *
   * 两类要**反向**处理，因为 diff 是「base 有、mine 没有 → 删」：
   *   - 没送成功的 add / update：从基准里去掉 → 下轮 diff 看它像「新增」，自然重发；
   *   - 没送成功的 delete：往基准里**补回**一个占位（只带 id）→ 下轮 diff 看它「还在」，重新发删。
   *
   * 这样就不需要「整包重写」兜底了 —— 整包写会把其它写方（AI）在此期间做的改动一起盖掉。
   */
  private rememberAfterDrop(bare: string, value: unknown, dropped: GraphOps): void {
    if (!Array.isArray(value)) return
    const missing = new Set<string>()
    for (const item of [...dropped.add, ...dropped.update]) {
      const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined
      if (typeof id === 'string') missing.add(id)
    }
    const kept = (value as Array<{ id?: unknown }>).filter((item) => {
      const id = item && typeof item === 'object' ? item.id : undefined
      return typeof id !== 'string' || !missing.has(id)
    })
    // 没删成功的：补个占位回去，下轮才会重新产生「删它」的意图
    for (const id of dropped.delete) kept.push({ id } as { id?: unknown })
    this.submitted.set(bare, kept as unknown[])
  }

  private async submitDelta(bare: string, value: unknown): Promise<void> {
    const fails = this.failures.get(bare) ?? 0
    // 已确认「增量口用不了」→ 本次直接整包，不再白试一趟
    if (fails >= GraphDeltaAdapter.FAILURE_LIMIT) {
      await this.putWhole(bare, value)
      return
    }

    let ops = diffGraph(this.submitted.get(bare), value)
    // 没变化就别发：否则「保存 → 通知 → 再保存」会转起来
    if (isEmptyOps(ops)) {
      this.remember(bare, value)
      return
    }

    /** 被服务端剔掉、还没送出去的项（见 finalize 的说明） */
    const dropped: GraphOps = { add: [], delete: [], update: [] }

    for (let round = 0; round <= GraphDeltaAdapter.DROP_ROUND_LIMIT; round++) {
      const outcome = await this.postOps(bare, ops)

      if (outcome.kind === 'ok') {
        return this.finalize(bare, value, dropped)
      }

      if (outcome.kind === 'failed') {
        // 传输层失败（网络抖动 / 5xx）。先在**同一次保存里**重试一次：
        // 单次抖动很常见，直接整包覆盖会白丢一次「可能覆盖 AI 改动」的机会；
        // 但也不能只记着「下次再试」—— 用户可能改完就关页面，那这次改动就永远没了。
        if ((await this.onTransportFailure(bare)) === 'retry') {
          const retry = await this.postOps(bare, ops)
          if (retry.kind === 'ok') {
            return this.finalize(bare, value, dropped)
          }
          if (retry.kind === 'rejected') {
            // 重试时服务端说内容有问题：交给下面那套「剔坏项」的逻辑处理
            const split = splitOffending(ops, retry.errors)
            if (split) {
              dropped.add.push(...split.dropped.add)
              dropped.delete.push(...split.dropped.delete)
              dropped.update.push(...split.dropped.update)
              ops = split.kept
            }
            continue
          }
        }
        // 重试也没成 / 已判定接口不可用 → 退整包，保证这次改动一定写出去
        await this.putWhole(bare, value)
        return
      }

      // rejected：服务端收下了但拒绝内容。按它给的错误剔掉出问题的项，剩下的继续发 ——
      // 既不会因为几项坏数据就退化成整包覆盖，也不会原地死循环。
      const split = splitOffending(ops, outcome.errors)
      if (!split) {
        // 说不清是哪几项出问题（或没有可剔的）：重试一次这条相同的增量，
        // 仍不成则退整包（宁可覆盖一次，也不能让用户的改动落不了地）。
        if ((await this.onTransportFailure(bare)) === 'retry') {
          const retry = await this.postOps(bare, ops)
          if (retry.kind === 'ok') {
            return this.finalize(bare, value, dropped)
          }
        }
        await this.putWhole(bare, value)
        return
      }
      const messages = outcome.errors.map((e) => e.message ?? '服务端拒绝')
      this.onSkipped?.({ key: bare, messages })
      console.warn(
        `[cloud-save] ${bare} 有 ${split.dropped.add.length + split.dropped.delete.length + split.dropped.update.length} 项被服务端拒绝，先发其余的、随后重投这些：${messages.join('; ')}`,
      )
      dropped.add.push(...split.dropped.add)
      dropped.delete.push(...split.dropped.delete)
      dropped.update.push(...split.dropped.update)
      ops = split.kept
      if (isEmptyOps(ops)) {
        // 其余的发完了，但「被剔掉的」还没送出去 —— 不能就这么记成已保存，
        // 那会让它永远留在「已在云端」的假象里（实测过：一条连线就此永久丢失）。
        return this.finalize(bare, value, dropped)
      }
    }

    // 反复剔不干净（坏项剔完又冒出来）：当作失败，别把基准记成已保存
    await this.putWhole(bare, value)
  }

  /**
  * 增量部分发完了，收尾。
  *
  * 关键点：**只要还有被剔掉、没送出去的项，就绝不能把基准记成「已保存」**。
  * 记了的话，下次 `diff(submitted, value)` 会认为它们已经在云端，从此再也不发 ——
  * 而它们在服务器上确实不存在（最典型的是「边先到、节点后到」：用户拖出连线时，
  * 边与两端的新节点在同一次提交里，边那条请求先到就会因「目标节点不存在」被拒）。
  *
  * 所以这里先重投一次（等其余部分落定后，依赖通常已经就绪）；仍不成则整包兜底 ——
  * 宁可整包一次，也不能让用户的改动悄悄丢掉。
  */
  private async finalize(bare: string, value: unknown, dropped: GraphOps): Promise<void> {
    if (!isEmptyOps(dropped)) {
      const retry = await this.postOps(bare, dropped)
      if (retry.kind === 'ok') {
        this.failures.set(bare, 0)
        this.remember(bare, value)
        return
      }
      // 重投还是不成：**不整包**（那会覆盖其它写方这段时间的改动），而是把基准记成
      // 「服务器实际的样子」—— 这些项留在待发状态，下次保存自然会再试。
      // 用户这次的其它改动已经写进去了，没写进去的也不会被误当成「已同步」。
      console.warn(`[cloud-save] ${bare} 有 ${dropped.add.length + dropped.delete.length + dropped.update.length} 项重投仍未成功，保留待下次保存重试`)
      this.rememberAfterDrop(bare, value, dropped)
      return
    }
    this.failures.set(bare, 0)
    this.remember(bare, value)
  }

  /**
   * 记一次传输层失败，并告诉调用方「要不要就地重试一次」。
   *
   * 返回 `retry` = 值得重试（失败次数还没到「接口不可用」的程度）；
   * 返回 `fallback` = 已经认定增量口用不了，直接退整包。
   */
  private async onTransportFailure(bare: string): Promise<'retry' | 'fallback'> {
    const fails = (this.failures.get(bare) ?? 0) + 1
    this.failures.set(bare, fails)
    if (fails < GraphDeltaAdapter.FAILURE_LIMIT) {
      console.warn(`[cloud-save] ${bare} 增量保存未成功（第 ${fails} 次），就地重试一次`)
      return 'retry'
    }
    console.warn(
      `[cloud-save] ${bare} 增量保存连续失败 ${fails} 次，本次起退回整包保存（可能覆盖其它写方的改动）。` +
        '常见原因是服务端版本较旧；升级服务端后会自动恢复。',
    )
    return 'fallback'
  }

  /** 整包写（兜底），并让下一次保存再探一次增量口（服务端升级/网络恢复后能自愈） */
  private async putWhole(bare: string, value: unknown): Promise<void> {
    await super.set(`${this.type}:${bare}`, value)
    this.failures.set(bare, GraphDeltaAdapter.FAILURE_LIMIT - 1)
    this.remember(bare, value)
  }

  /** 发一次增量。三种结果分得很清楚，因为后续动作完全不同（见文件头） */
  private async postOps(bare: string, ops: GraphOps): Promise<SubmitOutcome> {
    const isEdges = bare === GRAPH_EDGES_KEY
    try {
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, '')}/api/canvas/${isEdges ? 'edges' : 'nodes'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ add: ops.add, delete: ops.delete, update: ops.update }),
      })
      if (!res.ok) return { kind: 'failed' }
      const body = (await res.json()) as { ok?: boolean; errors?: BatchError[] }
      if (body.ok === false) return { kind: 'rejected', errors: body.errors ?? [] }
      return { kind: 'ok' }
    } catch {
      return { kind: 'failed' }
    }
  }
}

/**
 * 按服务端报的错误把这一批分成两份：`kept` 现在能发的、`dropped` 被拒的。
 *
 * 为什么要把「被拒的」交回调用方而不是丢掉：被拒**不等于**这批数据是坏的。
 * 最典型的是「边先到、节点后到」—— 用户拖出连线时，边与它两端的新节点在同一次提交里，
 * 边那条请求先到就会因「目标节点不存在」被拒；等节点落定后这条边是能成功的。
 * 丢掉它 = 用户屏幕上那条边看着在、服务器上没有，刷新就消失（实测复现过）。
 * 所以调用方拿到 `dropped` 后要重投一次、重投不成则整包兜底。
 *
 * 返回 undefined = 压根不知道能剔谁（错误里没给可用下标）：调用方应当放弃这一轮，
 * 而不是当成「都成功了」。
 */
export function splitOffending(
  ops: GraphOps,
  errors: BatchError[],
): { kept: GraphOps; dropped: GraphOps } | undefined {
  if (errors.length === 0) return undefined
  const drop: Record<'add' | 'delete' | 'update', Set<number>> = {
    add: new Set(),
    delete: new Set(),
    update: new Set(),
  }
  for (const e of errors) {
    if (e.op !== 'add' && e.op !== 'delete' && e.op !== 'update') continue
    if (typeof e.index !== 'number' || !Number.isInteger(e.index) || e.index < 0) continue
    drop[e.op].add(e.index)
  }
  const kept: GraphOps = { add: [], delete: [], update: [] }
  const dropped: GraphOps = { add: [], delete: [], update: [] }
  ops.add.forEach((item, i) => (drop.add.has(i) ? dropped.add : kept.add).push(item))
  ops.delete.forEach((item, i) => (drop.delete.has(i) ? dropped.delete : kept.delete).push(item))
  ops.update.forEach((item, i) => (drop.update.has(i) ? dropped.update : kept.update).push(item))
  // 一个都剔不掉 → 服务端报了错却指不出是哪项，交给调用方按失败处理
  if (isEmptyOps(dropped)) return undefined
  return { kept, dropped }
}
