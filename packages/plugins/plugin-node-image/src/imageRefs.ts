/**
 * imageRefs —— image 节点“资源引用 → 可显示地址”的唯一解析处（纯逻辑，零 Vue / 零 DOM）。
 *
 * 目标形态（docs/design/node-data-and-upstream-contract.md §七）：
 * - 节点数据只保存持久资源引用 `resourceId`；
 * - 显示地址每次现取（本地是临时 objectURL、云端是受控资源路由），**不写回 data**。
 *
 * 迁移期兼容：旧存档 / 旧写入方仍在 `imageUrl` 里放显示地址。
 * 回退分支集中在本文件（只此一处），组件不再各写一份 `imageUrl || ...`。
 */

/**
 * 只认 "按名字取服务" 这一件事（插件 ctx 与渲染上下文都满足）。
 *
 * 刻意用 `unknown` 而不是泛型：真实 ctx 的 tryGet 是泛型方法，泛型签名
 * 无法直接赋给“泛型接口字段”，写窄了会让调用方（含测试桩）类型不兼容。
 */
export interface ResourceResolverLike {
  tryGet?(name: string): unknown
  get?(name: string): unknown
}

/** 资源服务里本文件用到的最小形状 */
export interface ImageResourcePort {
  resolve(ref: string): Promise<string | undefined>
}

/** 从 ctx 取资源服务；取不到返回 undefined（极简宿主 / 单测桩） */
export function imageResourcePort(ctx: ResourceResolverLike | undefined): ImageResourcePort | undefined {
  if (!ctx) return undefined
  const port = (typeof ctx.tryGet === 'function'
    ? ctx.tryGet('resources')
    : typeof ctx.get === 'function'
      ? ctx.get('resources')
      : undefined) as ImageResourcePort | undefined
  return port && typeof port.resolve === 'function' ? port : undefined
}

/** 节点数据里与图片来源相关的两个字段（迁移期并存） */
export interface ImageSourceFields {
  /** 持久资源引用（目标形态，唯一应当长期保存的字段） */
  resourceId: string
  /** 显示地址（迁移期兼容字段；新写入不再只写它） */
  legacyUrl: string
}

/** 读节点上的资源引用与旧地址；都不是字符串时给空串 */
export function readImageSourceFields(data: Record<string, unknown> | undefined): ImageSourceFields {
  const resourceId = typeof data?.resourceId === 'string' ? data.resourceId : ''
  const legacyUrl = typeof data?.imageUrl === 'string' ? data.imageUrl : ''
  return { resourceId, legacyUrl }
}

/**
 * 把节点数据换成“现在能直接给 <img src> 的地址”。
 *
 * 顺序：
 * 1. 有 `resourceId` → 交给资源服务 resolve；
 * 2. resolve 不出来（资源已删 / 极简宿主没有资源服务）→ 迁移期回退旧 `imageUrl`；
 * 3. 两者都没有 → 空串（组件显示空态）。
 *
 * 返回值只用于本次渲染，调用方不得写回 data ——“只存 ID”这条规矩靠这一点成立。
 */
export async function resolveImageSrc(
  ctx: ResourceResolverLike | undefined,
  data: Record<string, unknown> | undefined,
): Promise<string> {
  const { resourceId, legacyUrl } = readImageSourceFields(data)
  if (!resourceId) return legacyUrl
  const port = imageResourcePort(ctx)
  if (port) {
    try {
      const url = await port.resolve(resourceId)
      if (url) return url
    } catch {
      // 资源服务异常按“取不到”处理，下面回退旧地址（不能让整张卡片渲染失败）
    }
  }
  return legacyUrl // 迁移期：旧存档只有 imageUrl，没有 resourceId 对应的资源条目
}

