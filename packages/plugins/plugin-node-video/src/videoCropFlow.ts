/**
 * videoCropFlow —— 裁剪确认的编排：先试后台真裁剪，不行再回落取景式。
 *
 * 单独一层的原因：这条链路要同时碰「读节点 data」「解析可显示地址」「调后台」「写回」，
 * 塞进命令注册里会让命令体长到看不清主次；塞进 videoOps 又会把 fetch 带进纯逻辑模块。
 */
import type { Context } from '@mini-canvas/canvas-base'
import type { Rect } from './videoCrop'
import { resolveVideoSrc } from './videoRefs'
import { canCropOnBackend, cropVideoOnBackend } from './videoCropService'
import { createPendingVideoNode, failVideoNode, writeVideoResult, type VideoOpsContext } from './videoOps'

/**
 * 按后台能力裁剪；后台不可用返回 null（调用方回落取景式 cropVideo）。
 *
 * @returns true/false = 走了后台（成功/失败）；null = 后台不可用
 */
export async function cropNodeWithBackend(
  ctx: Context,
  ops: VideoOpsContext,
  nodeId: string,
  rect: Rect,
): Promise<boolean | null> {
  const data = ctx.get('doc').getNode(nodeId)?.data
  if (!data) return false
  const srcUrl = await resolveVideoSrc(ctx, data)
  if (!srcUrl) return null
  const sourceDuration = Number(data.videoDuration) || 0
  // 先问后台有没有 ffmpeg：没有就走老的取景式，不留下一个注定失败的占位节点。
  if (!(await canCropOnBackend())) return null
  // ① 确认那一刻先出新节点 + 连线（占位，带后台进度盖层）——用户立刻看到结果落到哪。
  const pending = createPendingVideoNode(ops, {
    kind: 'crop',
    sourceId: nodeId,
    width: rect.width,
    height: rect.height,
  })
  if (!pending) return null
  // 造好的新节点立刻选中：进度盖层挂在底栏插件上，只有"恰好选中这个节点"时才渲染。
  // 不选中 = 用户等了半天只看到一个空节点，不知道后台在干活（本轮实测反馈的核心）。
  ctx.tryGet<{ set(ids: Iterable<string>): void }>('selection')?.set([pending])
  // 后台的原文原因优先（如「源视频不存在」/「该节点已有任务在跑」），拿不到才用兜底文案
  let backendReason = ''
  const failed = (fallback: string): boolean => {
    const message = backendReason.trim() || fallback
    failVideoNode(ops, pending, message)
    return false
  }
  // ② 后台转码。源视频不是画布资源 / 转码失败 → 失败原因写在占位节点上。
  const result = await cropVideoOnBackend({
    nodeId,
    srcUrl,
    rect,
    onFailure: (failure) => { backendReason = failure.message },
  })
  if (!result) return failed('后台裁剪失败（源视频可能不是画布资源，或 ffmpeg 转码出错）')
  // ③ 完成后把成品一次写进占位节点：地址、尺寸、持久引用与卡片比例同一条历史。
  // 卡片尺寸由 writeVideoResult 按新画面比例算（不是直接把视频像素当卡片尺寸）。
  return writeVideoResult(ops, pending, {
    videoUrl: result.url,
    videoWidth: result.width,
    videoHeight: result.height,
    // 裁画面不动时间轴：后台保留音轨，时长与源视频一致。不抄过来，底栏参考卡会显示 0:00
    ...(sourceDuration > 0 ? { videoDuration: sourceDuration } : {}),
    ...(result.resourceId ? { resourceId: result.resourceId } : {}),
  })
}

