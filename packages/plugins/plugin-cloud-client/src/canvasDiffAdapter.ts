/**
 * CanvasDiffAdapter —— 把宿主的"画布保存"接到 cloud-server 上。
 *
 * 宿主交来的一律是**整张画布**（节点 + 边）。直接整包 PUT 会把另一个写方
 * （AI 经 MCP 改的画布）在这两次提交之间做的改动整个盖掉 —— 实测过：
 * "AI 刚加的节点，被画布紧接着的一次保存抹掉"。
 *
 * 所以这里比出差集、只发差异（复用 graphDiff）。谁都不覆盖谁。
 *
 * 与老 cloud-save 的 HttpAdapter 的差别：那份打的是 /api/kv/canvas/*（按 key 存），
 * 现在画布是"一个画布一个文件夹"，读写都走 /api/canvases/*。
 */
import { diffGraph, isEmptyOps, type GraphOps } from './graphDiff.js'
import type { CloudApi } from './api.js'
import { CANVAS_ID, canvasId } from './keys.js'

/** 宿主交给 adapter 的 key 是带 type 前缀的物理 key（如 canvas:graph） */
function bareKey(key: string): string {
  const i = key.indexOf(':')
  return i >= 0 ? key.slice(i + 1) : key
}

const GRAPH = 'graph'
const EDGES = 'graph-edges'
const VIEWPORT = 'graph-viewport'

interface CanvasNodeLike {
  id?: unknown
  [k: string]: unknown
}

/**
 * 只发差异，且**记住"服务器实际拥有什么"**（没送成功的项要留在待发状态）
 *
 * 节点**原样**读、**原样**写：资源字段里就是同源 URL，不做任何形态转换。
 * **资源字节不在这里上传** —— 上传/生成时就已经由 resource adapter 存进画布文件夹了
 * （见 cloudResourceAdapter）。这条分工是本次重构的核心：保存路径不再碰字节。
 */
export class CanvasDiffAdapter {
  readonly id = 'canvas'
  readonly capability = { list: false, transactional: false, offline: false }
  /** 上次提交成功的节点 / 边（差的基准） */
  private submittedNodes: unknown[] | undefined
  private submittedEdges: unknown[] | undefined
  /**
   * 保存串行链。
   *
   * 为什么必须串行（2026-10-31 实测）：一次拖拽会连着触发两次提交 ——
   * 宿主先写「拖动结束的相对坐标」，插件随后写「吸附后的槽位坐标」。
   * 两次 set 各自 diff、各自发请求，若后一次先到服务器，先一次随后到达，
   * 就会把已经吸附好的结果盖回拖动中间态（现象：拖出分镜组后刷新又回到组里、
   * 画布偶尔被写回旧快照）。串行之后每次 diff 都基于上一次真正成功的结果，
   * 请求先后顺序与用户操作顺序一致。
   */
  private saveChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly api: CloudApi,
    private readonly fixedCanvasId: string = CANVAS_ID,
  ) {}

  /**
   * 当前画布 id —— **每次操作现算**（不是构造时定死）。
   *
   * 为什么必须现算：这个 adapter 是插件在**冷启动装载时**构造的，那时 hash 路由 `#/canvas/<id>`
   * 可能还没落地（`canvasId()` 读 hash 读不到 → 回落 `default`），于是整张新画布的读写都跑到
   * `default` 去了（实测：新建画布里的改动切走就没了 —— 其实写进了 default）。
   * 每次现读，任何挂载时机都拿到当前真正在看的那张画布。
   */
  private cid(): string {
    return typeof window !== 'undefined' ? canvasId() : this.fixedCanvasId
  }

  async get<T>(key: string): Promise<T | undefined> {
    const bare = bareKey(key)
    const snap = await this.api.readCanvas(this.cid())
    if (bare === GRAPH) return snap.nodes as T
    if (bare === EDGES) return snap.edges as T
    if (bare === VIEWPORT) return (snap.view ?? undefined) as T
    return undefined
  }

  async set(key: string, value: unknown): Promise<void> {
    const job = this.saveChain.then(() => this.writeNow(key, value))
    // 一条失败不能卡死后续保存：链尾吞掉错误，错误仍抛给本次调用方。
    this.saveChain = job.catch(() => undefined)
    return job
  }

  /** 真正写一次（由 set 排进串行链后调用） */
  private async writeNow(key: string, value: unknown): Promise<void> {
    const bare = bareKey(key)
    if (bare === VIEWPORT) {
      await this.api.putView(this.cid(), value)
      return
    }
    // 写出去的节点**原样**发：资源字段里是逻辑 ID（`<canvasId>/<hashName>`）或迁移期的旧 URL，
    // 不做任何转换 —— 地址由读取侧的 resolve 现拼。
    // 资源的**字节**在更早的时候就存好了（上传/生成时经 resource adapter 直接进画布文件夹），
    // 所以这里不做任何上传 —— 保存路径只负责"把节点原样发出去"。
    if (bare === GRAPH) return this.submitDelta('nodes', this.submittedNodes, value, (v) => (this.submittedNodes = v))
    if (bare === EDGES) return this.submitDelta('edges', this.submittedEdges, value, (v) => (this.submittedEdges = v))
    // 其它 key（不该出现）静默忽略：画布域只有这三个
  }

  async remove(key: string): Promise<void> {
    const job = this.saveChain.then(() => this.removeNow(key))
    this.saveChain = job.catch(() => undefined)
    return job
  }

  /** 真正删一次（由 remove 排进串行链后调用） */
  private async removeNow(key: string): Promise<void> {
    const bare = bareKey(key)
    if (bare === GRAPH) {
      await this.api.patchNodes(this.cid(), { delete: collectIds(this.submittedNodes) })
      this.submittedNodes = []
      return
    }
    if (bare === EDGES) {
      await this.api.patchEdges(this.cid(), { delete: collectIds(this.submittedEdges) })
      this.submittedEdges = []
    }
  }

  /** 把"服务器现有的这份"记成基准（装载时先读一次，免得第一次保存把已有的全当成新增） */
  async primeFromServer(): Promise<void> {
    const snap = await this.api.readCanvas(this.cid())
    this.primeFromSnapshot({ nodes: snap.nodes, edges: snap.edges })
  }

  /**
   * 把「刚确认过的云端快照」记为提交基准（实时合并成功后调用）。
   *
   * 为什么必须与 remoteSync 的合并基准同步推进：远端节点已经合进本地后再保存，
   * 若 adapter 还停在旧基准，就会把这些已同步的节点当成“本地新增”重发；
   * 极端情况下更新/删除还会与远端再打一次架。两份基准必须来自同一份服务端快照。
   *
   * 只记录**云端已有的那份**，不改本地的待提交内容；用户此刻的本地编辑仍由
   * 下一次 set 与这份基准做 diff，正常发出。
   */
  primeFromSnapshot(snapshot: { nodes: unknown[]; edges: unknown[] }): void {
    this.submittedNodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : []
    this.submittedEdges = Array.isArray(snapshot.edges) ? snapshot.edges : []
  }

  /**
   * 这个节点 id 是否已经成功写进服务器（保存基准里有它）。
   *
   * 合并层用它区分两种“本地有、云端也有同 id”：
   * - 已提交 → 同一个节点，绝不能换号；
   * - 未提交 → 真正的撞号，换号保住本地编辑。
   * 只看合并基准会漏掉「保存成功、通知先到」的窗口，凭空复制一份节点。
   */
  wasSubmittedNode(id: string): boolean {
    if (!Array.isArray(this.submittedNodes)) return false
    return this.submittedNodes.some((n) => n && typeof n === 'object' && (n as CanvasNodeLike).id === id)
  }

  /**
   * 保存适配器确认过的服务器快照（没有完整确认过时为 undefined）。
   *
   * 合并基准只在收到同步时推进，而本地保存会先写服务器；两者之间的窗口里，
   * 基准仍停留在保存前。把这份快照交给合并层补缺口，才能同时避免“复制副本”
   * 与“服务器随后改了同 id 节点却被当成新增忽略”。
   */
  submittedSnapshot(): { nodes: unknown[]; edges: unknown[] } | undefined {
    if (!Array.isArray(this.submittedNodes) || !Array.isArray(this.submittedEdges)) return undefined
    return { nodes: [...this.submittedNodes], edges: [...this.submittedEdges] }
  }

  /**
   * 读服务器那份（恢复路径：装载时以云端为准覆盖本地）。
   *
   * 存的就是同源 URL，渲染组件拿去直接塞 `<img src>` 就能用，这里原样给。
   */
  async getRaw(): Promise<{ nodes: unknown[]; edges: unknown[]; view: unknown }> {
    return this.api.readCanvas(this.cid())
  }

  /**
   * 只发差集。
   *
   * 成功才把基准推到现在这份；失败就让基准停在原地 —— 下一轮保存会重发同一批差集
   * （宁可重发，也不要让改动悄悄丢掉）。
   */
  private async submitDelta(
    kind: 'nodes' | 'edges',
    base: unknown[] | undefined,
    value: unknown,
    remember: (v: unknown[]) => void,
  ): Promise<void> {
    if (!Array.isArray(value)) return
    const ops: GraphOps = diffGraph(base as never, value as never)
    if (isEmptyOps(ops)) {
      remember(value)
      return
    }
    const body = {
      ...(ops.add.length > 0 ? { add: ops.add } : {}),
      ...(ops.delete.length > 0 ? { delete: ops.delete } : {}),
      ...(ops.update.length > 0 ? { update: ops.update } : {}),
    }
    if (kind === 'nodes') await this.api.patchNodes(this.cid(), body as never)
    else await this.api.patchEdges(this.cid(), body as never)
    remember(value)
  }
}

function collectIds(list: unknown[] | undefined): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const item of list) {
    const id = item && typeof item === 'object' ? (item as CanvasNodeLike).id : undefined
    if (typeof id === 'string') out.push(id)
  }
  return out
}
