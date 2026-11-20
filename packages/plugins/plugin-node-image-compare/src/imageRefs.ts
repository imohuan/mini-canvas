/**
 * imageRefs —— 对比节点读“上游图片”时用的资源引用解析（纯逻辑，零 Vue / 零 DOM）。
 *
 * 契约：节点数据只保存 `resourceId`；显示地址现取。
 * 迁移期兼容：旧节点只有 `imageUrl`，回退分支只在这一处。
 *
 * TODO(upstream): 换成 `upstream.media('left'/'right')` 后，本文件只剩 resolve 一段。
 */

import { resolveMediaSrc } from '@plume-canvas/canvas-data'

/** 只认“按名字取服务”这一件事（用 unknown 兼容真实 ctx 的泛型 tryGet） */
export interface ResourceResolverLike {
  tryGet?(name: string): unknown
  get?(name: string): unknown
}

export interface ImageResourcePort {
  resolve(ref: string): Promise<string | undefined>
}

/** 从 ctx 取资源服务；取不到返回 undefined */
export function imageResourcePort(ctx: ResourceResolverLike | undefined): ImageResourcePort | undefined {
  if (!ctx) return undefined
  const port = (typeof ctx.tryGet === 'function'
    ? ctx.tryGet('resources')
    : typeof ctx.get === 'function'
      ? ctx.get('resources')
      : undefined) as ImageResourcePort | undefined
  return port && typeof port.resolve === 'function' ? port : undefined
}

/**
 * 上游图片的显示地址：有 `resourceId` 先解析；解析不出来再退回旧 `imageUrl`。
 * 结果只用于渲染，不写回任何节点 data。
 */
export async function resolveImageSrc(
  ctx: ResourceResolverLike | undefined,
  data: Record<string, unknown> | undefined,
): Promise<string> {
  // 统一实现（引用 → 资源服务 → 回退旧地址）在 canvas-data 的 resolveMediaSrc
  return resolveMediaSrc(ctx, data, 'imageUrl')
}

