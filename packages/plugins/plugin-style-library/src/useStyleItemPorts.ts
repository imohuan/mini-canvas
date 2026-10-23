/**
 * 组件侧接线：把渲染上下文里的 `media` / `nodes` 能力交给 useStyleItem。
 *
 * 为什么单独一处：风格库与特效库的「加入画布」是**同一套逻辑**（用户口径 2026-10-22：
 * 「特效库不是一样的吗，也可以加入画布中，只不过它的 UI 可能有些许不同」）。
 * 各写一份最容易漂移 —— 一处改了走 media，另一处忘了又写回 imageUrl。
 *
 * 这里只做「取能力 + 记录日志」，不做任何节点字段拼装（那是图片插件的职责）。
 */
import type { UseStyleItemDeps, StyleItemMedia } from './useStyleItem'

/** 渲染上下文里本文件用到的部分（`useCanvasRender()` 给的 ctx） */
export interface StyleItemCtxLike {
  tryGet<T = unknown>(name: string): T | undefined
  /** 能力场（`registryOf('capability')`）：media 是**能力**，不是服务 */
  registryOf?<T = unknown>(kind: string): { top(key: string): { value: T } | undefined } | undefined
}

/** 设节点标题的公开入口（`ctx.nodes.setLabel`） */
interface NodesLabelPort {
  setLabel(id: string, label: string | undefined): void
}

/** 能力工厂：收节点上下文，返回该能力实例（与 canvas-render 的 CapabilityFactory 同形） */
type CapabilityFactory = (node: unknown) => unknown

/** 能力场名（与 canvas-render 的 createMiniCanvasHost 注册用的一致） */
const CAPABILITY_FIELD = 'capability'

/**
 * 从能力场造一个能力实例。
 *
 * **为什么不能 `ctx.tryGet('media')`**（2026-10-23 用户实测 `no-media`）：
 * media 是标准**能力**，注册在 `registryOf('capability')` 里，值是一个工厂；
 * 服务场（`ctx.get/tryGet`）里根本没有 `media` 这个键，所以 tryGet 永远 undefined。
 *
 * 工厂需要一个节点上下文（per-node 实例）；画布级浮层没有"当前节点"，
 * 这里给一个只带 ctx 的最小上下文 —— media 的实现只读 ctx（put/resolve/addNode 都在调用时现取），
 * 不读节点的 data/position，所以够用。
 */
function capabilityOf<T>(ctx: StyleItemCtxLike, name: string): T | undefined {
  const field = ctx.registryOf?.(CAPABILITY_FIELD) as
    | { top(key: string): { value: CapabilityFactory } | undefined }
    | undefined
  const factory = field?.top(name)?.value
  if (typeof factory !== 'function') return undefined
  try {
    return factory({ ctx }) as T
  } catch (err) {
    console.warn('[style-library] 造能力实例失败：' + name, err)
    return undefined
  }
}

/**
 * 造 useStyleItem 的依赖。
 *
 * - `media`：宿主默认注册的能力（图片插件提供 addNode 创建器）；缺了就是 undefined，
 *   调用方会拿到 `no-media` 并显示可见提示。
 * - `setLabel`：标题走公开入口；缺了就不设标题，不往 data 里手塞字段。
 */
export function styleItemDepsOf(ctx: StyleItemCtxLike): UseStyleItemDeps {
  return {
    media: capabilityOf<StyleItemMedia>(ctx, 'media'),
    setLabel: (id, text) => ctx.tryGet<NodesLabelPort>('nodes')?.setLabel(id, text),
    onError: (msg, err) => console.warn(msg, err),
  }
}
