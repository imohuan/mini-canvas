/**
 * videoClipFlow —— 剪辑确认的编排：先试后台真剪辑，不行再回落元数据式。
 *
 * 与 videoCropFlow 同一条结构（读 data → 解析可显示地址 → 调后台 → 新建节点），
 * 分开成两个文件是因为两条链路的产物形状不同：裁剪带回新宽高，剪辑只带回时长。
 */
import type { Context } from '@mini-canvas/canvas-base'
import { resolveVideoSrc } from './videoRefs'
import { cutVideoOnBackend } from './videoCropService'
import { createRealClipNode, type VideoOpsContext } from './videoOps'

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
  const result = await cutVideoOnBackend({ nodeId, srcUrl, start, end })
  if (!result) return null
  // 用户口径 2026-10-30：剪辑出新节点 + 连线，原视频保持不动
  return createRealClipNode(ops, nodeId, result) !== null
}

