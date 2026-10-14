/**
 * audioOps —— 音频节点的各项操作（载入音频 / 上传 / 下载 / 重分析波形）的业务实现。
 *
 * 为什么要单独一层（与 videoOps / imageOps 同因）：同一件事有两个入口 —— **界面按钮**
 * （内容组件上的播放/上传）和**命令**（ctx.commands.register 的 audio.upload / audio.download /
 * audio.reanalyze，供快捷键、右键菜单、MCP 调用）。两处各写一遍必然漂移，所以实现收敛成
 * 纯异步函数，两边都只是"备好读/写句柄再调它"。
 *
 * 读/写句柄（AudioOpsContext）由调用方注入：
 * - 组件侧：ctx.get('doc').getNode(id).data 读；doc.updateNode / updateNodeRuntime 写。
 * - 命令侧：同一对服务，只是从命令的 ctx 上取。
 *
 * 写回分两条路，差别是**要不要进撤销栈**：
 * - 音频地址 / 时长 / 文件名 = 作品属性 → `write`（= doc.updateNode，进历史、可撤销）；
 * - 波形 = 派生数据（解码算出来的缓存）→ `writeRuntime`（= doc.updateNodeRuntime，落盘、不进撤销栈）。
 *   理由：用户按一次撤销，期望退掉"我换了一段音频"，而不是退掉"波形缓存被写了一次"。
 *
 * 本模块不 import Vue；Web Audio 只在浏览器存在，故所有解码经注入的 AudioTransform 端口，
 * node 环境下调用真实实现会安全返回 null（不会抛）。
 */
import { isValidWaveform, fallbackWaveform, WAVEFORM_BUCKETS } from './waveform'
import { analyzeAudio, audioObjectUrl, downloadAudio, pickAudioFile, type AudioInspection } from './audioTransform'

/** 音频加工端口（解码取波形与时长 / 选文件 / 下载 / 生成 objectURL）。
 *
 * 抽成端口是为了**可测**：解码要 Web Audio，node 环境下跑不了真实实现；
 * 单测注入假实现即可验证"算得对不对、写回得对不对"，而不必启动浏览器。
 */
export interface AudioTransform {
  /** 解码一次，同时拿波形与时长；失败返回 null（调用方用回落波形兜底） */
  analyze(url: string, buckets?: number): Promise<AudioInspection | null>
  /** 打开系统选音频框；非浏览器/取消返回 null */
  pickFile(): Promise<File | null>
  /** 触发下载；非浏览器/地址不合法返回 false */
  download(url: string, fileName: string): boolean
  /** File/Blob → objectURL；非浏览器返回空串 */
  objectUrl(blob: Blob): string
}

/** 生产实现：全部走浏览器原生能力（见 audioTransform） */
export const defaultTransform: AudioTransform = {
  analyze: (url, buckets) => analyzeAudio(url, buckets ?? WAVEFORM_BUCKETS),
  pickFile: pickAudioFile,
  download: downloadAudio,
  objectUrl: audioObjectUrl,
}

/**
 * 操作所需的读/写句柄（组件与命令各备一份，实现只写一遍）。
 *
 * 两个写入口刻意分开 —— 一条进历史（作品），一条不进（派生缓存），见文件头说明。
 */
export interface AudioOpsContext {
  /** 读节点当前 data；节点不存在返回 undefined */
  read(nodeId: string): Record<string, unknown> | undefined
  /** 写节点 data（务必走内核 graph：进历史、可撤销、自动落盘） */
  write(nodeId: string, data: Record<string, unknown>): void
  /** 写派生数据（= doc.updateNodeRuntime：落盘但不进撤销栈） */
  writeRuntime(nodeId: string, data: Record<string, unknown>): void
  /**
   * 把一段音频字节存进宿主资源库，返回持久引用 + 当前可用地址
   * （云端是同源 URL、本地是资源库重建的地址）。上传的节点字段写这条地址，不写临时 objectURL。
   * 未注入 / 存取失败 → undefined（调用方回落 objectURL 兜底）。
   */
  persistAudio?(blob: Blob, name?: string): Promise<{ resourceId: string; url: string } | undefined>
}

/**
 * 只要"按名字取服务"这一件事的宿主形状（内核 Context 与渲染上下文都满足）。
 * 保留内核那套"服务名 → 类型"重载：内置服务名按名推导，插件自有窄端口仍可显式泛型。
 */
export interface ServiceGetter {
  get<T = unknown>(name: string): T
  tryGet<T = unknown>(name: string): T | undefined
}

/**
 * 用内核服务拼出 ops 读/写句柄 —— 组件与命令共用同一份接线，避免两处各写一遍取值兜底。
 * 服务缺失（纯逻辑测试未注入）时读写都安全降级：读返回 undefined、写 no-op。
 */
export function createAudioOps(svc: ServiceGetter): AudioOpsContext {
  interface NodeLike {
    id: string
    data: Record<string, unknown>
  }
  /** doc 门面（5c 起数据唯一来源）；缺 doc 则安全降级（读 undefined、写 no-op） */
  type AudioDocPort = {
    getNode(id: string): NodeLike | undefined
    updateNode(id: string, patch: { data: Record<string, unknown> }): void
    updateNodeRuntime(id: string, patch: { data: Record<string, unknown> }): void
  }
  const doc = (): AudioDocPort | undefined => svc.get<AudioDocPort | undefined>('doc')

  return {
    read: (nodeId) => doc()?.getNode(nodeId)?.data,
    write: (nodeId, data) => doc()?.updateNode(nodeId, { data }),
    writeRuntime: (nodeId, data) => doc()?.updateNodeRuntime(nodeId, { data }),
    // 上传音频的字节存进资源库：节点写 resolve 出来的地址（不写临时 objectURL）
    persistAudio: async (blob, name) => {
      const store = svc.tryGet<{
        put(b: Blob, o?: { kind?: string; name?: string }): Promise<string>
        resolve(ref: string): Promise<string | undefined>
      }>('resources')
      if (!store) return undefined
      try {
        const resourceId = await store.put(blob, { kind: 'audio', ...(name ? { name } : {}) })
        const url = await store.resolve(resourceId)
        return url ? { resourceId, url } : undefined
      } catch {
        return undefined
      }
    },
  }
}

/** 节点 data 里与音频相关的字段（读时统一收窄，避免到处 as string / as number） */
interface AudioData {
  audioUrl?: string
  audioName?: string
  audioDuration?: number
  audioWaveform?: number[]
}

function asAudioData(data: Record<string, unknown> | undefined): AudioData {
  if (!data) return {}
  return {
    audioUrl: typeof data.audioUrl === 'string' && data.audioUrl ? data.audioUrl : undefined,
    audioName: typeof data.audioName === 'string' ? data.audioName : undefined,
    audioDuration:
      typeof data.audioDuration === 'number' && Number.isFinite(data.audioDuration) && data.audioDuration > 0
        ? data.audioDuration
        : undefined,
    audioWaveform: isValidWaveform(data.audioWaveform) ? data.audioWaveform : undefined,
  }
}

/**
 * 解码一次拿波形：失败就落**确定性回落波形**（同地址同形状）。
 *
 * 为什么不返回空数组：留空等于"波形永远画不出来"，用户看到一条空白会以为节点坏了；
 * 回落波形至少给出一个稳定的形状，并且**会写进节点**（下次不再尝试解码）。
 */
async function resolveWaveform(url: string, transform: AudioTransform): Promise<{ peaks: number[]; duration: number }> {
  const inspected = await transform.analyze(url, WAVEFORM_BUCKETS)
  if (inspected && isValidWaveform(inspected.peaks)) {
    return { peaks: inspected.peaks, duration: Number.isFinite(inspected.duration) ? inspected.duration : 0 }
  }
  return { peaks: fallbackWaveform(url), duration: 0 }
}

/** 分析结果里"能不能用"的判据：波形合法 / 时长是正有限数 */
function usablePeaks(inspected: AudioInspection | null): number[] | null {
  return inspected && isValidWaveform(inspected.peaks) ? inspected.peaks : null
}
function usableDuration(inspected: AudioInspection | null): number | null {
  const d = inspected?.duration
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null
}

/**
 * 载入一段音频：解码一次 → 一次写回。
 *
 * 两个刻意的取舍：
 * - **一次写回**：地址/文件名/时长用 `write`（进历史），波形用 `writeRuntime`（不进历史）——
 *   两次而不是多次，且都在元数据/波形就绪之后写，不会出现"先写地址再补时长"的中间态；
 * - **换地址必重算**：波形是上一段音频的形状，留着必然画错（这里无条件重算并覆盖）。
 *
 * @param url   已就绪的音频地址（objectURL / dataURL / 远程 URL）
 * @param extra 额外要一起写进 data 的字段（如 resourceId）—— 与本次写入**同一条历史**
 * @returns 是否写成功（节点不存在 / 地址为空 → false）
 */
export async function loadAudio(
  ops: AudioOpsContext,
  nodeId: string,
  url: string,
  metaIn?: { name?: string; resourceId?: string },
  transform: AudioTransform = defaultTransform,
): Promise<boolean> {
  const current = ops.read(nodeId)
  if (!current || !url) return false
  const { peaks, duration } = await resolveWaveform(url, transform)
  const patch: Record<string, unknown> = { audioUrl: url }
  const name = typeof metaIn?.name === 'string' && metaIn.name ? metaIn.name : undefined
  if (name) patch.audioName = name
  if (duration > 0) patch.audioDuration = duration
  else patch.audioDuration = undefined
  if (metaIn?.resourceId) patch.resourceId = metaIn.resourceId
  ops.write(nodeId, patch)
  ops.writeRuntime(nodeId, { audioWaveform: peaks })
  return true
}

/**
 * 上传音频文件：字节先进资源库（put → resolve 拿当前可用地址）→ 载入。
 *
 * 为什么音频不像图片那样转 dataURL：几分钟的音频转 base64 会膨胀约三分之一，
 * 写进 localStorage 直接撑爆配额、刷新反而丢数据。
 *
 * 节点里写的是**资源库解析出来的地址**（云端是同源 URL / 本地是资源库地址）：
 * `URL.createObjectURL(file)` 的 `blob:` 只在当前页面有效 —— 存到服务器后别的标签页取不到、
 * 刷新后失效、云端生成任务时服务器也拿不到。objectURL 只在**没有资源库 / 解析失败**时
 * 兜底（极简宿主）—— 那种情况下节点数据本来就只在本次会话有效，写它不会更糟。
 *
 * 资源登记**先做、且不单独写库**：resourceId 随本次载入一起提交，
 * 于是"换音频"对用户始终是**一次撤销**就退回原样（分两次写会让撤销只退半步）。
 *
 * @param file 不给（命令触发）时开系统选文件框；用户取消 → false
 */
export async function uploadAudio(
  ops: AudioOpsContext,
  nodeId: string,
  file: Blob | undefined,
  transform: AudioTransform = defaultTransform,
): Promise<boolean> {
  if (!ops.read(nodeId)) return false
  const picked = file ?? (await transform.pickFile())
  if (!picked) return false
  const name = (picked as File).name
  // 字节先进资源库、拿回可用地址（createAudioOps.persistAudio 装配）；拿不到才回落 objectURL
  const persisted = await ops.persistAudio?.(picked, typeof name === 'string' && name ? name : undefined)
  const url = persisted?.url || transform.objectUrl(picked)
  if (!url) return false
  return loadAudio(
    ops,
    nodeId,
    url,
    { ...(typeof name === 'string' && name ? { name } : {}), ...(persisted ? { resourceId: persisted.resourceId } : {}) },
    transform,
  )
}

/**
 * 保证节点上**波形与时长都有**，缺哪个就解码一次补齐（"第一次加载就存下来"）。
 *
 * 这是内容组件挂载时走的路径。为什么要连**时长**一起管：波形与时长来自同一次解码，
 * 只补波形不补时长，就会出现"波形画得出来、时间显示 0:00 / 0:00"（实测踩到的 bug）。
 * 两者齐了就完全不再解码（画布上音频节点多时这是零开销的那条路）。
 *
 * @returns 是否真的解码分析过（true = 本次补齐了某些东西）
 */
export async function ensureAudioMeta(
  ops: AudioOpsContext,
  nodeId: string,
  transform: AudioTransform = defaultTransform,
): Promise<boolean> {
  const data = asAudioData(ops.read(nodeId))
  if (!data.audioUrl) return false
  // 波形与时长都在 → 真正的零开销路径（不解码、不写库）
  if (data.audioWaveform && data.audioDuration) return false
  const inspected = await transform.analyze(data.audioUrl, WAVEFORM_BUCKETS)
  const peaks = usablePeaks(inspected)
  const duration = usableDuration(inspected)
  // 已有真波形而这次分析失败 → 保留原波形（回落波形只用于"本来就没波形"的场合）
  if (peaks || !data.audioWaveform) ops.writeRuntime(nodeId, { audioWaveform: peaks ?? fallbackWaveform(data.audioUrl) })
  // 时长是**作品属性**（进历史），但这里只是"补一个之前没记下来的数"；已有就别动，
  // 免得一次缓存补写把用户的撤销栈顶掉。
  if (duration !== null && !data.audioDuration) ops.write(nodeId, { audioDuration: duration })
  return true
}

/**
 * 强制重新解码分析（用户点"刷新"时用）：无论有没有缓存都重新解码一次，
 * 同时刷新波形与时长 —— 用在"当时网络不好、只拿到回落波形"或"地址换了内容"之后想再试一次的场合。
 */
export async function reanalyzeAudio(
  ops: AudioOpsContext,
  nodeId: string,
  transform: AudioTransform = defaultTransform,
): Promise<boolean> {
  const data = asAudioData(ops.read(nodeId))
  if (!data.audioUrl) return false
  const { peaks, duration } = await resolveWaveform(data.audioUrl, transform)
  ops.writeRuntime(nodeId, { audioWaveform: peaks })
  // 拿不到时长就**不写**（不把节点上已有的好数据抹成 0）
  if (duration > 0) ops.write(nodeId, { audioDuration: duration })
  return true
}

/** 下载音频（文件名按节点上的 audioName 清洗）；非浏览器环境返回 false */
export function downloadAudioNode(
  ops: AudioOpsContext,
  nodeId: string,
  transform: AudioTransform = defaultTransform,
): boolean {
  const data = asAudioData(ops.read(nodeId))
  if (!data.audioUrl) return false
  return transform.download(data.audioUrl, data.audioName || 'audio')
}

/** 状态栏/无障碍用的摘要文案（名字 / 时长）——组件直接用，避免文案散在模板里 */
export function readAudioSummary(data: Record<string, unknown> | undefined): { name: string; duration: number } {
  const a = asAudioData(data)
  return { name: a.audioName || '未命名音频', duration: a.audioDuration ?? 0 }
}
