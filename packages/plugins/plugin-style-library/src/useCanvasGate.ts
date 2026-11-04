/**
 * useCanvasGate —— 「能不能把素材加入画布」的唯一判据。
 *
 * 只判断 doc 在不在是不够的：加入画布要两条链路同时成立 ——
 * 1. 有画布（`doc` 服务在）；
 * 2. 有 `media` 能力（真正写字节、建节点的那一层，由图片插件注册）。
 *
 * 只缺 doc 时禁用是过去的行为；缺 media 时以前会等到点下去才拿到 `no-media`，
 * 用户看到的是一句“失败”，而不是一处禁用。这里把两者合并成一个判据与一句准确原因，
 * 风格库 / 特效库共用，避免两处各写一份慢慢漂移。
 */
import { computed, type ComputedRef } from 'vue'

/** 只声明这里用到的两件：服务表与能力场。 */
export interface CanvasGateCtx {
  tryGet<T = unknown>(name: string): T | undefined
  registryOf?<T = unknown>(kind: string): { top(key: string): { value: T } | undefined } | undefined
}

export interface CanvasGate {
  /** 有画布（doc 服务在场） */
  hasCanvas: ComputedRef<boolean>
  /** 有 media 能力（能真正写字节并建节点） */
  hasMedia: ComputedRef<boolean>
  /** 现在就能加入画布 */
  canUse: ComputedRef<boolean>
  /** 不能加入时给用户看的原因；能用时为空串 */
  reason: ComputedRef<string>
}

/** 能力场名（与 canvas-render 的 createMiniCanvasHost 注册用的一致） */
const CAPABILITY_FIELD = 'capability'

export function useCanvasGate(ctx: CanvasGateCtx, what: '素材' | '特效'): CanvasGate {
  const hasCanvas = computed(() => Boolean(ctx.tryGet('doc')))

  // media 是**能力**不是服务：注册在 registryOf('capability') 里，值是一个工厂。
  // 读能力场是同步的（注册场是普通表），所以可以放在 computed 里现取。
  const hasMedia = computed(() => {
    const field = ctx.registryOf?.<unknown>(CAPABILITY_FIELD)
    return typeof field?.top('media')?.value === 'function'
  })

  const canUse = computed(() => hasCanvas.value && hasMedia.value)

  const reason = computed(() => {
    if (!hasCanvas.value) return '打开一张画布后可使用' + what
    if (!hasMedia.value) return '当前没有可用的媒体能力（图片节点插件未启用），暂时无法加入' + what
    return ''
  })

  return { hasCanvas, hasMedia, canUse, reason }
}
