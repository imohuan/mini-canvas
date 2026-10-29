/**
 * videoCropFlow —— 裁剪确认的编排：先试后台真裁剪，不行再回落取景式。
 *
 * 单独一层的原因：这条链路要同时碰「读节点 data」「解析可显示地址」「调后台」「写回」，
 * 塞进命令注册里会让命令体长到看不清主次；塞进 videoOps 又会把 fetch 带进纯逻辑模块。
 */
import type { Context } from '@mini-canvas/canvas-base'
import type { Rect } from './videoCrop'
import { resolveVideoSrc } from './videoRefs'
import { cropVideoOnBackend } from './videoCropService'
import { applyRealCrop, type VideoOpsContext } from './videoOps'

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
  const result = await cropVideoOnBackend({ nodeId, srcUrl, rect })
  if (!result) return null
  return applyRealCrop(ops, nodeId, result)
}

