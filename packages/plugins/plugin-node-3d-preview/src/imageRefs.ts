/**
 * imageRefs —— 3D 预览读图片时用的资源引用解析（纯逻辑，零 Vue / 零 DOM）。
 *
 * 契约：节点数据只保存 `resourceId`，显示地址现取。
 * 迁移期兼容：旧存档 / 旧上游只有 `imageUrl`，回退分支只在这一处。
 */

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
export async function resolveImageSrc(
  ctx: ResourceResolverLike | undefined,
  data: Record<string, unknown> | undefined,
): Promise<string> {
  const resourceId = typeof data?.resourceId === 'string' ? data.resourceId : ''
  const legacyUrl = typeof data?.imageUrl === 'string' ? data.imageUrl : ''
  if (!resourceId) return legacyUrl
  // 引用可能被上一代写入方写成「已经解析好的地址」（新链路曾把同源 URL 同时写进
  // resourceId）：那它本身就是可显示地址，不必再问资源服务（问也会原样回来）。
  if (isDisplayUrl(resourceId)) return resourceId
  const port = imageResourcePort(ctx)
  if (port) {
    try {
      const url = await port.resolve(resourceId)
      if (url) return url
    } catch {
      // 资源服务异常按取不到处理
    }
  }
  return legacyUrl // 迁移期：旧存档只有 imageUrl
}

/** 能直接交给 `<img>` / 纹理加载器的地址（http(s) / blob / data / 同源根路径） */
export function isDisplayUrl(value: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(value) || /^(?:blob:|data:)/i.test(value) || value.startsWith('/')
}

