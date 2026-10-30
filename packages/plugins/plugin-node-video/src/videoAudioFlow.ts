/**
 * videoAudioFlow —— 「视频转音频」的编排：先出音频占位节点 + 连线，再等后台抽音轨回填。
 *
 * 与 videoCropFlow / videoClipFlow 同一条顺序（用户口径 2026-10-30）：
 *   1. 点按钮那一刻：新建**音频**节点并连到视频下方，节点上带 running 进度；
 *   2. 后台跑 ffmpeg 抽音轨（/api/video-audio）；
 *   3. 回来后把 resourceId / 时长写进同一个音频节点，进度换 done。
 *
 * 为什么新节点是 audio 而不是 video：产物是声音，用户要在画布上直接听、能连给别处；
 * 音频节点由音频插件自己负责字段（resourceId / audioName / audioDuration），
 * 视频插件不替它写 —— 两者只通过 media 能力（kind = 'audio'）协作，互不 import。
 */
import type { Context } from '@mini-canvas/canvas-base'
import { canCropOnBackend, extractAudioOnBackend } from './videoCropService'
import { resolveVideoSrc } from './videoRefs'
import { placeAdjacent } from '@mini-canvas/canvas-render'

/** 音频占位节点相对视频节点的间距（与裁剪/剪辑同一档，视觉上成一列） */
const AUDIO_GAP = 100
/** 音频节点在自己没尺寸可参考时的兜底外框（与音频插件默认尺寸同值） */
const AUDIO_FALLBACK = { w: 320, h: 120 }

/**
 * 建一个「正在转音频」的音频占位节点，并从源视频连一条线过去。
 *
 * 为什么占位节点由**本文件建**（而不是交给 media 能力）：media.addNode 只建"有资源"的节点，
 * 而这里要的是一上来就带 runState 的空节点（用户要看到进度）。等资源到手后，
 * 直接把 resourceId 写进这个节点即可 —— 同一条链路只建一次节点，撤销也只退一次。
 *
 * @returns 新节点 id；拿不到 doc / 音频类型没装 → null
 */
function createPendingAudioNode(ctx: Context, sourceId: string, label: string): string | null {
  const doc = ctx.tryGet<{
    getNode(id: string): { id: string; type: string; position: { x: number; y: number }; size?: { w: number; h: number }; data: Record<string, unknown> } | undefined
    getNodes(): Array<{ id: string; type: string; position: { x: number; y: number }; size?: { w: number; h: number }; data: Record<string, unknown> }>
    types: ReadonlyMap<string, unknown>
    transaction<T>(reason: string, fn: (tx: {
      createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string
      connectEdge(input: { source: string; target: string; sourceHandle?: string; targetHandle?: string }): { status: string }
      removeNodes(ids: string[]): number
    }) => T): T
  }>('doc')
  if (!doc) return null
  // 音频节点插件没装 → 明确失败（不建一个没人渲染的孤儿节点）
  if (!doc.types.has('audio')) return null
  const source = doc.getNode(sourceId)
  if (!source) return null

  // 落点：摆在源视频下方；用与其它媒体同一个纯函数，避免各插件各写一套偏移
  const nodes = doc.getNodes()
  const rectOf = (n: (typeof nodes)[number]) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    w: n.size?.w ?? (Number(n.data?.cardWidth) || AUDIO_FALLBACK.w),
    h: n.size?.h ?? (Number(n.data?.cardHeight) || AUDIO_FALLBACK.h),
  })
  const sourceRect = rectOf(source)
  const position = placeAdjacent({
    size: AUDIO_FALLBACK,
    source: sourceRect,
    obstacles: nodes.map(rectOf),
    gap: AUDIO_GAP,
  })

  const data: Record<string, unknown> = {
    label,
    audioName: label,
    runState: { status: 'running', message: '后台提取音轨中…', startedAt: Date.now() },
  }
  try {
    return doc.transaction('video-to-audio-node', (tx) => {
      const created = tx.createNode('audio', position, data)
      const edge = tx.connectEdge({
        source: sourceId,
        target: created,
        sourceHandle: 'source',
        targetHandle: 'target',
      })
      // 连不上（类型不符/容量拒绝）就**退回**这个节点：这个入口承诺的是「节点 + 连线」，
      // 留一个连不上线的空音频节点只会让人以为转成功了
      if (edge.status === 'rejected') {
        tx.removeNodes([created])
        return ''
      }
      return created
    }) || null
  } catch {
    return null
  }
}

/** 把后台抽出来的音频写进占位节点：resourceId + 名字 + 时长，同一个 patch 进历史 */
function writeAudioResult(
  ctx: Context,
  nodeId: string,
  data: Record<string, unknown>,
): boolean {
  const doc = ctx.tryGet<{
    getNode(id: string): { data: Record<string, unknown> } | undefined
    updateNode(id: string, patch: { data: Record<string, unknown> }): void
  }>('doc')
  const current = doc?.getNode(nodeId)
  if (!doc || !current) return false
  try {
    doc.updateNode(nodeId, {
      data: { ...current.data, ...data, runState: { status: 'done', progress: 100 } },
    })
    return true
  } catch {
    return false
  }
}

/** 失败：把原因写进占位节点（覆盖层据此显示；节点保留，用户能看到是哪一步不行） */
function failAudioNode(ctx: Context, nodeId: string, message: string): void {
  const doc = ctx.tryGet<{
    getNode(id: string): unknown
    updateNodeRuntime(id: string, patch: { data: Record<string, unknown> }): void
  }>('doc')
  if (!doc?.getNode(nodeId)) return
  try {
    doc.updateNodeRuntime(nodeId, { data: { runState: { status: 'error', message } } })
  } catch {
    /* 节点可能刚被删：进度没有落点，静默 */
  }
}

/**
 * 视频 → 音频。
 *
 * @returns true = 走了后台（成功）；false = 失败（原因已写到占位节点）；
 *          null = 后台不可用（没装 ffmpeg 插件 / 源没有可解析地址），调用方给用户一句话说明
 */
export async function videoToAudio(ctx: Context, nodeId: string): Promise<boolean | null> {
  const data = ctx.get('doc').getNode(nodeId)?.data
  if (!data) return false
  const srcUrl = await resolveVideoSrc(ctx, data)
  if (!srcUrl) return null
  // 先问后台有没有 ffmpeg：转音频没有浏览器端回落方案，没有后台就别在画布上留一个注定失败的节点
  if (!(await canCropOnBackend())) return null

  const name = typeof data.videoName === 'string' && data.videoName.trim() ? data.videoName.trim() : '视频'
  const base = name.replace(/.[^.]+$/, '') || '视频'
  const pending = createPendingAudioNode(ctx, nodeId, base + ' 的声音')
  if (!pending) return null
  // 立刻选中新节点：进度覆盖层只在「恰好选中这个节点」时渲染
  ctx.tryGet<{ set(ids: Iterable<string>): void }>('selection')?.set([pending])

  let backendReason = ''
  const result = await extractAudioOnBackend({
    nodeId,
    srcUrl,
    onFailure: (failure) => { backendReason = failure.message },
  })
  if (!result) {
    failAudioNode(ctx, pending, backendReason.trim() || '后台提取音轨失败')
    return false
  }

  const ok = writeAudioResult(ctx, pending, {
    // 两个字段都写：resourceId 是持久引用（云端按它现取地址），audioUrl 是迁移期兜底，
    // 也让本地资源库解析不到这个后台产物时仍能播（与视频裁剪回填同一条口径）
    ...(result.resourceId ? { resourceId: result.resourceId } : {}),
    audioUrl: result.url,
    audioName: base + '.mp3',
    ...(result.duration > 0 ? { audioDuration: result.duration } : {}),
  })
  if (!ok) {
    failAudioNode(ctx, pending, '音频已生成，但节点没找到（可能被删了）')
    return false
  }
  return true
}

