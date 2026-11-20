/**
 * imageRefs —— 3D 预览读图片时用的资源引用解析（纯逻辑，零 Vue / 零 DOM）。
 *
 * 契约：节点数据只保存 `resourceId`，显示地址现取。
 * 迁移期兼容：旧存档 / 旧上游只有 `imageUrl`，回退分支只在这一处。
 */

import { isDisplayUrl, resolveMediaSrc } from '@plume-canvas/canvas-data'

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
 * 图片显示地址：`resourceId` 优先，解析不出来再退回旧 `imageUrl`。
 * 结果只用于本次渲染，不写回任何节点 data。
 */
/**
 * 统一实现（引用 → 资源服务 → 回退旧地址）在 canvas-data 的 resolveMediaSrc。
 * 那条「引用本身已是地址就不必再解析」的历史兜底也已收进同一处（所有节点行为一致）。
 */
export async function resolveImageSrc(
  ctx: ResourceResolverLike | undefined,
  data: Record<string, unknown> | undefined,
): Promise<string> {
  return resolveMediaSrc(ctx, data, 'imageUrl')
}

/** 能直接交给 `<img>` / 纹理加载器的地址（直接复用数据层那份） */
export { isDisplayUrl }

