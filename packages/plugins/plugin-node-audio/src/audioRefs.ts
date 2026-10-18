/**
 * audioRefs —— audio 节点“资源引用 → 可播放地址”的唯一解析处（纯逻辑，零 Vue / 零 DOM）。
 *
 * 目标形态：节点数据只保存持久资源引用 `resourceId`；播放地址现取、不写回 data。
 * 迁移期兼容：旧存档仍在 `audioUrl` 里放地址，回退分支只允许出现在本文件。
 */

/** 只认“按名字取服务”这一件事（插件 ctx 与渲染上下文都满足；用 unknown 兼容泛型 tryGet） */
export interface ResourceResolverLike {
  tryGet?(name: string): unknown
  get?(name: string): unknown
}

/** 资源服务里本文件用到的最小形状 */
export interface AudioResourcePort {
  resolve(ref: string): Promise<string | undefined>
}

/** 从 ctx 取资源服务；取不到返回 undefined（极简宿主 / 单测桩） */
export function audioResourcePort(ctx: ResourceResolverLike | undefined): AudioResourcePort | undefined {
  if (!ctx) return undefined
  const port = (typeof ctx.tryGet === 'function'
    ? ctx.tryGet('resources')
    : typeof ctx.get === 'function'
      ? ctx.get('resources')
      : undefined) as AudioResourcePort | undefined
  return port && typeof port.resolve === 'function' ? port : undefined
}

/** 节点数据里与音频来源相关的两个字段（迁移期并存） */
export interface AudioSourceFields {
  /** 持久资源引用（目标形态） */
  resourceId: string
  /** 显示地址（迁移期兼容字段） */
  legacyUrl: string
}

/** 读节点上的资源引用与旧地址；都不是字符串时给空串 */
export function readAudioSourceFields(data: Record<string, unknown> | undefined): AudioSourceFields {
  const resourceId = typeof data?.resourceId === 'string' ? data.resourceId : ''
  const legacyUrl = typeof data?.audioUrl === 'string' ? data.audioUrl : ''
  return { resourceId, legacyUrl }
}

/**
 * 把节点数据换成“现在能直接给播放器的地址”。
 *
 * 顺序：`resourceId` → 资源服务 resolve → 取不到时的**迁移期**回退 `audioUrl`。
 * 解析结果只用于本次播放，调用方不得写回 data。
 */
export async function resolveAudioSrc(
  ctx: ResourceResolverLike | undefined,
  data: Record<string, unknown> | undefined,
): Promise<string> {
  const { resourceId, legacyUrl } = readAudioSourceFields(data)
  if (!resourceId) return legacyUrl
  const port = audioResourcePort(ctx)
  if (port) {
    try {
      const url = await port.resolve(resourceId)
      if (url) return url
    } catch {
      // 资源服务异常按“取不到”处理
    }
  }
  return legacyUrl // 迁移期：旧存档 / 资源已删时仍要能播
}

