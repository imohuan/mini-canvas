/**
 * TaskManager —— 后台的任务调度中心（唯一驱动层）。
 *
 * 流程：下单 → 立刻返回 jobId → 后台自己轮 provider → 每一帧都把状态**写进节点**
 * （`data.runState`）→ 前端经 SSE 跟着变 → 终态归档一笔历史。
 *
 * 两条设计要点：
 *
 * 1. **写节点走增量口**（`batchNodes`，内部有串行锁）。整包写会与网页端的保存互相覆盖
 *    （网页端与后台是两个写方，谁后写谁覆盖 —— 这正是增量口存在的理由）。
 * 2. **进度帧不节流到"不写"**：前端要知道跑到哪了，所以每帧都写；
 *    但写的是**同一个 runState 键**，不会把节点撑大。
 */
import { randomUUID } from 'node:crypto'
import type { CanvasDocument } from '../mcp/canvasDoc.js'
import type { ProviderRegistry } from '../providers/registry.js'
import type { ActionDef, JobInput, Provider } from '../providers/types.js'
import type { HistoryStore } from './history.js'
import type { HistoryEntry, Job } from './types.js'
import {
  imageSizeFromBytes,
  videoSizeFromBytes,
  mediaKindFromName,
  probeMedia,
  type MediaProbe,
} from './mediaSize.js'

/** 默认轮询间隔（ms） */
export const DEFAULT_INTERVAL = 1500
/** 默认整体超时（ms）—— 长视频会被动作自己的 pollTimeoutMs 顶掉 */
export const DEFAULT_TIMEOUT = 300_000

/** 一次任务要用的外部能力（注入，便于单测给假货） */
export interface TaskDeps {
  doc: CanvasDocument
  /**
   * 按画布 id 取该画布的文档（多画布：**进度/终态要写进任务所属的那张画布**）。
   *
   * 不传时回落 `doc`（默认画布）。曾经的写法固定用 `doc`（默认画布的文档），于是
   * **非默认画布**上的任务，进度全写进了 default（那里根本没有那个节点 id）→ 静默失败，
   * 表现就是"进度一直卡在 0%"（用户实测）。
   */
  docForCanvas?: (canvasId: string) => CanvasDocument
  registry: ProviderRegistry
  history: HistoryStore
  /**
   * 把节点里的资源地址解析成 **provider 能拿到的素材**（多画布 + 跨服务器的关键）。
   *
   * 返回 **data URL**（内嵌字节），不是地址：cloud-server 与 web2api 是**两个独立服务**
   * （可能不在同一台机器），给 web2api 一个 cloud-server 的地址它可能根本下载不到。
   * 而 web2api 的 `utils/reference-images.ts` 明确支持 data URL（**它会自己落盘成本地文件**），
   * 所以把字节直接交给它最稳，不依赖任何网络可达性。
   */
  resolveResourceUrl(canvasId: string, ref: string): Promise<string>
  /** 测试可注入假时钟 / 睡眠 */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** 任务成功产出资源时的回调（server 用来把产物登记进资产目录；测试可省） */
  onArtifact?: (canvasId: string, urls: string[]) => void
  /**
   * 取产物字节（落进画布资源目录用）。默认真 fetch；测试注入假货，免得去连真地址。
   */
  fetchArtifact?: (url: string) => Promise<Uint8Array>
  /**
   * 查某个节点**当前是否有在跑的任务**（用于挡住重复下单）。
   *
   * 返回 undefined 表示没有。宿主（server）可以用它做跨实例的判定；
   * 省略时 TaskManager 退回查自己内存里的任务表（单实例足够）。
   */
  activeJob?: (canvasId: string, nodeId: string) => { id: string } | undefined
  onError?: (message: string, err?: unknown) => void
}

/** 写 runState 的小工具（把"节点可能已被删"收敛掉：任务还在跑，只是没地方写进度） */
function nodeRunStatePatch(runState: Record<string, unknown>): { data: Record<string, unknown> } {
  return { data: { runState } }
}

export class TaskManager {
  private readonly jobs = new Map<string, Job>()
  /** 每个 job 一个取消句柄 */
  private readonly cancels = new Map<string, AbortController>()
  /** 已经不在跑的 job（终态）；后台循环据此提前收工，不留悬挂的循环 */
  private readonly settled = new Set<string>()
  /** 在跑的后台循环（dispose 要等它们退干净，否则关停后还有人在写盘） */
  private readonly running = new Set<Promise<void>>()

  constructor(private readonly deps: TaskDeps) {}

  /**
   * 停掉所有在跑的任务（服务关停 / 测试收尾）。
   *
   * **要 await**：abort 只是让循环"下一次检查时退出"，它可能正卡在一次写盘中间；
   * 不等的话，关停之后还会有一次迟到的写入（测试里实测过：清理临时目录时报非空）。
   */
  async dispose(): Promise<void> {
    for (const ctrl of this.cancels.values()) ctrl.abort()
    this.cancels.clear()
    await Promise.allSettled([...this.running])
  }

  /**
   * 建一个任务。**立即返回**（后台开始跑）。
   *
   * 提交是同步等 provider 的 `submit`（拿到 taskId 或立即完成），
   * 之后的推进全在后台循环里 —— 所以前端点完"发送"马上拿得到 jobId。
   */
  async createJob(input: JobInput): Promise<Job | { error: string }> {
    const action = this.deps.registry.getAction(input.actionId)
    if (!action) return { error: '未找到动作 ' + input.actionId }
    const provider = this.deps.registry.providerOf(input.actionId)
    if (!provider) return { error: '动作 ' + input.actionId + ' 没有归属的 provider' }

    // ★ 挡重复下单：同一个（画布, 节点）已经有在跑的任务时，直接返回它，不再新建。
    //   用户实测：卡的时候连点「发送」会创建多个相同任务（既浪费额度、又互相打架）。
    //   前端也会在点后禁用按钮，但那是 UI 层的尽力而为；**服务端这一层才是权威**（多标签页/重放也挡得住）。
    const active = this.deps.activeJob
      ? this.deps.activeJob(input.canvasId, input.nodeId)
      : [...this.jobs.values()].find((j) => j.canvasId === input.canvasId && j.nodeId === input.nodeId && j.status === 'running')
    if (active) return { error: '该节点已有任务在进行中（jobId: ' + active.id + '）' }

    const job: Job = {
      id: randomUUID(),
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      actionId: input.actionId,
      providerId: provider.id,
      status: 'running',
      progress: 0,
      message: '任务已提交，等待执行…',
      request: {
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.values ? { values: input.values } : {}),
        ...(input.resources && input.resources.length > 0
          ? {
              resources: input.resources.map((r) => ({
                kind: r.kind,
                ...(r.url ? { url: r.url } : {}),
                ...(typeof r.value === 'string' ? { value: r.value } : {}),
              })),
            }
          : {}),
      },
      createdAt: this.now(),
    }
    this.jobs.set(job.id, job)

    // 提交帧：立刻写节点，用户马上能看到"排队中"
    await this.writeRunState(job, { status: 'running', progress: 0, message: job.message, actionId: action.id, taskId: job.id, startedAt: job.createdAt })

    const ctrl = new AbortController()
    this.cancels.set(job.id, ctrl)
    // 后台跑（不阻塞 createJob 返回）
    // resolveInput 要读资源字节（异步）→ 先把它算出来再交给后台循环
    const resolved = await this.resolveInput(job.canvasId, input)
    const loop = this.run(job, provider, action, resolved, ctrl.signal)
    this.running.add(loop)
    void loop.finally(() => this.running.delete(loop))
    return job
  }

  /** 查任务（前端轮询 / 续查用） */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId)
  }

  /** 按节点反查（诊断用） */
  findJobByNode(canvasId: string, nodeId: string): Job | undefined {
    return [...this.jobs.values()].find((j) => j.canvasId === canvasId && j.nodeId === nodeId)
  }

  /** 列出全部任务（诊断用） */
  listJobs(): Job[] {
    return [...this.jobs.values()]
  }

  /**
   * 取消一个任务。
   *
   * 先 abort 本地等待（立刻收敛），再让 provider 去服务端真取消 ——
   * 只 abort 的话服务端那个任务还在跑、还在花钱。
   */
  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId)
    if (!job) return false
    this.cancels.get(jobId)?.abort()
    if (job.providerTaskId) {
      const provider = this.deps.registry.providerOf(job.actionId)
      const action = this.deps.registry.getAction(job.actionId)
      if (provider?.cancel && action) {
        try {
          await provider.cancel(job.providerTaskId, action)
        } catch (err) {
          // 服务端取消失败不改变"本地已取消"这个事实（用户已经看到取消了）
          this.deps.onError?.('[tasks] 服务端取消失败', err)
        }
      }
    }
    return true
  }

  // ==================== 内部 ====================

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep ? this.deps.sleep(ms) : new Promise((r) => setTimeout(r, ms))
  }

  /** 把节点里的资源地址换成 provider 能取的真实字节（data URL） */
  private async resolveInput(canvasId: string, input: JobInput): Promise<JobInput> {
    const resources = await Promise.all(
      (input.resources ?? []).map(async (r) => ({
        ...r,
        // 只要给了 url 就走一遍解析：画布资源（`/api/canvases/<id>/resources/<hash>`）
        // 与资产地址（`/api/assets/files/<hash>`）→ 转 data URL；别的地址原样返回。
        ...(typeof r.url === 'string' && r.url
          ? { url: await this.deps.resolveResourceUrl(canvasId, r.url) }
          : {}),
      })),
    )
    return { ...input, resources }
  }

  /**
   * 产物该写进节点的哪个字段 —— 按节点类型决定（与前端 applier 同一套映射）。
   * 认不出类型时退回 imageUrl（图片是最常见的产物）。
   */
  private mediaFieldFor(type: string | undefined): string {
    switch (type) {
      case 'audio':
        return 'audioUrl'
      case 'video':
        return 'videoUrl'
      case '3d-preview':
      case 'image-compare':
      case 'image':
      default:
        return 'imageUrl'
    }
  }

  /**
   * 按产物后缀给出该写进节点的那对「尺寸字段」名。
   * 图片写 `imageWidth/imageHeight`、视频写 `videoWidth/videoHeight`（前端就是读这两对来定卡片比例）。
   */
  private sizeFieldsFor(fileName: string): { w: string; h: string } | null {
    const kind = mediaKindFromName(fileName)
    if (kind === 'image') return { w: 'imageWidth', h: 'imageHeight' }
    if (kind === 'video') return { w: 'videoWidth', h: 'videoHeight' }
    return null
  }

  /** 从字节里量尺寸（按后缀选图片还是视频解析器；认不出返回 null） */
  private measureBytes(bytes: Uint8Array, fileName: string): { width: number; height: number } | null {
    const kind = mediaKindFromName(fileName)
    if (kind === 'image') return imageSizeFromBytes(bytes)
    if (kind === 'video') return videoSizeFromBytes(bytes)
    // 后缀认不出：两种都试一下（产物常见就是图 / 视频）
    return imageSizeFromBytes(bytes) ?? videoSizeFromBytes(bytes)
  }

  /**
   * 把产物**字节**收进本画布资源目录，再把**同源地址**写进节点的媒体字段。
   *
   * 关键：不能只把 provider 的地址（`http://localhost:8033/...`）抄进节点 —— 那是另一个服务的地址，
   * 换机器 / 换端口就取不到，画布上只会显示「图片已失效」。必须先 `saveResource` 把字节落到
   * `<画布>/resources/`（按内容哈希，重复不重复存），再把 `saveResource` 返回的同源地址写进节点。
   * 这个地址形如 `/api/canvases/<画布>/resources/<hash>.<ext>`，文件**确实存在**，图片节点直接就能加载。
   */
  private async writeMediaFields(
    job: Job,
    action: ActionDef,
    urls: string[] | undefined,
  ): Promise<{ url: string; media: MediaProbe } | undefined> {
    const raw = urls?.[0]
    if (!raw) return undefined
    try {
      const doc = this.deps.docForCanvas?.(job.canvasId) ?? this.deps.doc
      const bytes = this.deps.fetchArtifact
        ? await this.deps.fetchArtifact(raw)
        : await (async () => {
            // 加超时：产物地址取不到时不能让「收敛成终态」一直等（超时就当没拿到，任务照常 done）
            const res = await fetch(raw, { signal: AbortSignal.timeout(30_000) })
            if (!res.ok) throw new Error('取产物失败 ' + res.status + '：' + raw)
            return new Uint8Array(await res.arrayBuffer())
          })()
      const fileName = raw.split('?')[0]?.split('/').pop() ?? undefined
      const stored = await doc.saveResource(bytes, fileName ? { fileName } : {})
      // 一次量全卡片要用的元数据（尺寸 / 时长 / 字节数）：历史里存下来，
      // 卡片就不必等 <video>/<audio> 的 metadata 才敢画真实比例（会先闪一下再跳）。
      // 后缀认不出（如 web2api 给的 .bin / 无扩展名）时按节点类型兜底：
      // 视频节点必然要量视频、音频节点必然要量音频，否则历史里就永远缺时长。
      const kindByAction = this.kindOf(action)
      const probeName =
        fileName && mediaKindFromName(fileName) !== 'unknown'
          ? fileName
          : fileName
            ? fileName.replace(/\.[^./]*$/, '') + (kindByAction === 'video' ? '.mp4' : kindByAction === 'audio' ? '.mp3' : '.png')
            : kindByAction === 'video'
              ? 'out.mp4'
              : kindByAction === 'audio'
                ? 'out.mp3'
                : 'out.png'
      const media = fileName ? probeMedia(bytes, probeName) : { bytes: bytes.length }
      // 量出宽高一起写：前端靠 imageWidth/Height（图片）或 videoWidth/Height（视频）算卡片比例，
      // 缺了就会停在类型默认的 4:3 —— 9:16 的竖图被塞成横的（用户实测）。
      const size = fileName ? this.measureBytes(bytes, fileName) : null
      const sizeFields = fileName ? this.sizeFieldsFor(fileName) : null
      await doc.batchNodes({
        update: [
          {
            id: job.nodeId,
            data: {
              [this.mediaFieldFor(action.nodeTypes?.[0])]: stored.url,
              ...(size && sizeFields ? { [sizeFields.w]: size.width, [sizeFields.h]: size.height } : {}),
            },
          },
        ],
      })
      // 返回**同源地址**（存在的那份）：历史 / runState 都用它，前端缩略图才加载得出来
      return { url: stored.url, media }
    } catch (err) {
      this.deps.onError?.('[tasks] 写节点产物字段失败（产物可能取不到，或节点已被删除）', err)
      return undefined
    }
  }

  private async writeRunState(job: Job, runState: Record<string, unknown>): Promise<void> {
    try {
      // 写进**任务所属那张画布**的文档（多画布）：用 deps.doc 会写错画布 → 静默失败 → 进度卡 0
      const doc = this.deps.docForCanvas?.(job.canvasId) ?? this.deps.doc
      await doc.batchNodes({ update: [{ id: job.nodeId, ...nodeRunStatePatch(runState) }] })
    } catch (err) {
      this.deps.onError?.('[tasks] 写节点进度失败（节点可能已被删除）', err)
    }
  }

  /** 后台推进：提交 → 轮询 → 终态 → 归档 */
  private async run(job: Job, provider: Provider, action: ActionDef, input: JobInput, signal: AbortSignal): Promise<void> {
    const interval = action.pollIntervalMs ?? DEFAULT_INTERVAL
    const timeoutMs = action.pollTimeoutMs ?? DEFAULT_TIMEOUT
    const startedAt = this.now()
    /**
     * 「等外部条件」累计时长（ms）—— 从超时预算里扣掉。
     *
     * 为什么必须扣：web2api 的 paused 是「等用户在浏览器里过验证码」，人处理多久不由程序决定；
     * 拿它顶 pollTimeoutMs 的话，人还在操作就被判超时失败（真出过的 bug：
     * 用户过验证码时 cloud-server 那边已经收工）。普通生成中的等待不在此列，仍按超时算。
     */
    let waitingMs = 0
    let lastPollAt = startedAt

    try {
      const submitted = await provider.submit(action, input)

      // 提交即完成（同步生成）
      if ('done' in submitted) {
        if (submitted.urls && submitted.urls.length > 0) this.deps.onArtifact?.(job.canvasId, submitted.urls)
        return this.finish(job, action, { ok: true, urls: submitted.urls, text: submitted.text })
      }
      if ('error' in submitted) {
        return this.finish(job, action, { ok: false, error: submitted.error })
      }

      job.providerTaskId = submitted.taskId

      // 轮询到终态
      while (true) {
        // 已经收敛过（被取消 / 已判超时）→ 立刻退出，不留悬挂循环
        if (this.settled.has(job.id)) return
        if (signal.aborted) {
          this.settled.add(job.id)
          await this.writeRunState(job, { status: 'error', message: '已取消', actionId: action.id, taskId: job.id })
          job.status = 'error'
          job.message = '已取消'
          job.finishedAt = this.now()
          return
        }
        if (this.now() - startedAt - waitingMs > timeoutMs) {
          const minutes = Math.max(1, Math.round(timeoutMs / 60000))
          return this.finish(job, action, { ok: false, error: '任务超时（已等待 ' + minutes + ' 分钟）' })
        }

        const poll = provider.poll ? await provider.poll(submitted.taskId, action) : { status: 'running' as const }
        // 这一拍如果是「等外部条件」（过验证码 / 换号退避），把它耗掉的时间记进 waitingMs
        if (poll.waiting) waitingMs += Math.max(0, this.now() - lastPollAt)
        lastPollAt = this.now()
        if (poll.taskId) job.providerTaskId = poll.taskId

        if (poll.status === 'running') {
          job.progress = poll.progress ?? job.progress
          job.message = poll.message ?? job.message
          await this.writeRunState(job, {
            status: 'running',
            progress: job.progress,
            message: job.message,
            actionId: action.id,
            taskId: job.id,
            startedAt: job.createdAt,
          })
          await this.sleep(interval)
          continue
        }

        if (poll.status === 'error') {
          return this.finish(job, action, { ok: false, error: poll.error ?? '任务失败' })
        }
        // 产物是 provider 那边的地址（可能跨机 / 换端口就取不到）：先让宿主把它收进本画布资源目录
        // （onArtifact），再写回节点 —— 顺序不能反，否则节点上写的同源地址取不到字节（显示空白）。
        const urls = poll.urls
        if (urls && urls.length > 0) this.deps.onArtifact?.(job.canvasId, urls)
        return this.finish(job, action, { ok: true, urls, text: poll.text })
      }
    } catch (err) {
      // 任何异常都收敛成失败，不留悬挂的 running
      return this.finish(job, action, { ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      this.cancels.delete(job.id)
    }
  }

  /** 终态：写节点 + 归档历史 */
  private async finish(
    job: Job,
    action: ActionDef,
    result: { ok: boolean; urls?: string[]; text?: string; error?: string },
  ): Promise<void> {
    if (this.settled.has(job.id)) return
    this.settled.add(job.id)
    // 先落盘（节点 + 历史），**最后**才把 job 标成终态 ——
    // 反过来的话，别人一看到 status 变了就来读节点，可能读到的还是上一帧
    // （测试里实测过这个竞态）。
    const finishedAt = this.now()
    // 产物落到节点的**媒体字段**（imageUrl / audioUrl / videoUrl）—— 这一步不能少：
    // 节点只有在「有产物字段」时才把图/音频显示出来；只写 runState.urls 的话画布上是空的。
    // 前端那条路是靠底栏的 applier 写这个字段；MCP 下的单没有底栏，必须由后台补写。
    // 写之前先把字节收进画布资源目录（见 writeMediaFields），写的是**确实存在**的同源地址。
    // 它返回的同源地址要**回填进 result**：历史 / runState 也用它 —— 否则那两处仍存 web2api 的原始地址，
    // 前端拿它当缩略图会因为「文件名不是内容哈希」被资源接口判非法（400），历史卡片就是一片裂图。
    let media: MediaProbe | undefined
    if (result.ok) {
      const sameOrigin = await this.writeMediaFields(job, action, result.urls)
      if (sameOrigin) {
        result = { ...result, urls: [sameOrigin.url, ...(result.urls ?? []).slice(1)] }
        media = sameOrigin.media
      }
    }
    await this.writeRunState(
      job,
      result.ok
        ? { status: 'done', progress: 100, message: '已完成', actionId: action.id, taskId: job.id, urls: result.urls ?? [] }
        : { status: 'error', message: result.error ?? '任务失败', actionId: action.id, taskId: job.id },
    )

    await this.deps.history.append(job.canvasId, this.toHistoryEntry(job, action, result, finishedAt, media))

    // 产物登记（onArtifact）**已经在上游做过**（见 run 里轮询到终态那一步）——
    // 这里不再重复调：目的是让「字节先落进画布资源目录」发生在写节点媒体字段之前。
    job.status = result.ok ? 'done' : 'error'
    job.progress = result.ok ? 100 : job.progress
    job.result = { ...result, taskId: job.id }
    job.finishedAt = finishedAt
  }

  /** 从动作声明推断产物类型（前端按它分组 / 计数） */
  private kindOf(action: ActionDef): HistoryEntry['kind'] {
    const t = action.nodeTypes?.[0]
    return t === 'image' || t === 'video' || t === 'audio' ? t : 'other'
  }

  private toHistoryEntry(
    job: Job,
    action: ActionDef,
    result: { ok: boolean; urls?: string[]; text?: string; error?: string },
    finishedAt: number,
    media?: MediaProbe,
  ): HistoryEntry {
    const req = job.request
    return {
      id: randomUUID(),
      jobId: job.id,
      canvasId: job.canvasId,
      nodeId: job.nodeId,
      actionId: action.id,
      title: action.title,
      kind: this.kindOf(action),
      status: result.ok ? 'done' : 'error',
      // 还没有人工审核流程：一律 passed（前端的评级下拉因此不是死控件）
      rating: 'passed',
      ...(result.urls && result.urls.length > 0 ? { urls: result.urls } : {}),
      ...(result.text ? { text: result.text } : {}),
      // 生成参数与参考素材：详情弹窗据此还原"当时到底用了什么"
      ...(req?.prompt ? { prompt: req.prompt } : {}),
      ...(req?.values && Object.keys(req.values).length > 0 ? { values: req.values } : {}),
      ...(req?.resources && req.resources.length > 0 ? { resources: req.resources } : {}),
      ...(media && Object.keys(media).length > 0 ? { media } : {}),
      createdAt: job.createdAt,
      finishedAt,
      ...(result.error ? { error: result.error } : {}),
    }
  }
}
