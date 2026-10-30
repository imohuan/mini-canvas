/**
 * videoClipFlow —— 剪辑确认的编排：先试后台真剪辑，不行再回落元数据式。
 *
 * 与 videoCropFlow 同一条结构（读 data → 解析可显示地址 → 调后台 → 新建节点），
 * 分开成两个文件是因为两条链路的产物形状不同：裁剪带回新宽高，剪辑只带回时长。
 */
import type { Context } from '@mini-canvas/canvas-base'
import { resolveVideoSrc } from './videoRefs'
import { canCropOnBackend, cutVideoOnBackend } from './videoCropService'
import { createPendingVideoNode, failVideoNode, writeVideoResult, type VideoOpsContext } from './videoOps'

/**
 * 按后台能力切段；后台不可用返回 null（调用方回落元数据式 clipVideo）。
 *
 * @returns true/false = 走了后台（成功/失败）；null = 后台不可用
 */
export async function clipNodeWithBackend(
  ctx: Context,
  ops: VideoOpsContext,
  nodeId: string,
  start: number,
  end: number,
): Promise<boolean | null> {
  const data = ctx.get('doc').getNode(nodeId)?.data
  if (!data) return false
  const srcUrl = await resolveVideoSrc(ctx, data)
  if (!srcUrl) return null
  // 先问后台有没有 ffmpeg：没有就走老的元数据式，不留下一个注定失败的占位节点。
  if (!(await canCropOnBackend())) return null
  // ① 确认那一刻先出新节点 + 连线（占位，带后台进度盖层）——与裁剪同一条口径。
  const pending = createPendingVideoNode(ops, {
    kind: 'clip',
    sourceId: nodeId,
    width: Number(data.videoWidth) || 0,
    height: Number(data.videoHeight) || 0,
    cropRect: data.cropRect as { x: number; y: number; width: number; height: number } | undefined,
  })
  if (!pending) return null
  // 与裁剪同一条：新节点立刻选中，进度盖层才显示得出来
  ctx.tryGet<{ set(ids: Iterable<string>): void }>('selection')?.set([pending])
  const failed = (message: string): boolean => {
    failVideoNode(ops, pending, message)
    return false
  }
  // ② 后台转码。
  const result = await cutVideoOnBackend({ nodeId, srcUrl, start, end })
  if (!result) return failed('后台剪辑失败（源视频可能不是画布资源，或 ffmpeg 转码出错）')
  // ③ 完成后把成品一次写进占位节点；切时间不改画面尺寸，宽高沿用占位时抄的源节点。
  return writeVideoResult(ops, pending, {
    videoUrl: result.url,
    videoDuration: result.duration,
    ...(result.resourceId ? { resourceId: result.resourceId } : {}),
  })
}

