/**
 * [迁移转发] Context —— 画布版上下文。
 *
 * 插件框架（装载 / 依赖编排 / 事件 / 作用域回收 / 能力层接缝）已迁往 @mini-canvas/kernel；
 * 本文件只做一件事：把"画布能力层"作为默认层装进 kernel 的 Context，
 * 于是 `new Context()` 依旧自带 ctx.nodes/theme/commands/slots/settings（包内 363 条测试零改动）。
 *
 * 为什么要留这一层而不是直接用 kernel 的 Context：
 * - kernel 是纯框架，不认识画布；直接 new 它就只有 ctx.tools（框架自带）+ 插件基础能力。
 * - 画布的消费方（render / 插件 / 测试）要的是"带画布能力段的 ctx"。
 * 于是"默认装哪层"由本包决定——将来要纯内核，直接 new kernel 的 Context 即可。
 */
import { Context as KernelContext } from '@mini-canvas/kernel'
import type { CapabilityLayer } from '@mini-canvas/kernel'
import { createCanvasCapabilityLayer } from './capabilityLayer'

export { runPlugin } from "@mini-canvas/kernel"
export type { ContextState, PluginRuntimeStatus } from "@mini-canvas/kernel"

/**
 * 画布上下文：kernel Context + 默认装好的画布能力层。
 *
 * 构造参数与 kernel 一致（dev / capabilityLayer）；不传 capabilityLayer 时默认用画布层。
 * 传 `capabilityLayer: undefined` 也能用 —— 但那时 ctx 上不会有 ctx.nodes 等画布段。
 */
export class Context extends KernelContext {
  constructor(options: { dev?: boolean; capabilityLayer?: CapabilityLayer } = {}) {
    // 默认装画布能力层：ctx 自带 nodes/theme/commands/slots/settings（tools 由框架自带）
    super({
      dev: options.dev ?? false,
      capabilityLayer: options.capabilityLayer ?? createCanvasCapabilityLayer(),
    })
  }
}

/** 画布能力层实例（导出供宿主/测试自行装配；通常不必直接用，Context 会默认装） */
export function canvasCapabilityLayer(): CapabilityLayer {
  return createCanvasCapabilityLayer()
}


