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
}

/** 设节点标题的公开入口（`ctx.nodes.setLabel`） */
interface NodesLabelPort {
  setLabel(id: string, label: string | undefined): void
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
    media: ctx.tryGet<StyleItemMedia>('media'),
    setLabel: (id, text) => ctx.tryGet<NodesLabelPort>('nodes')?.setLabel(id, text),
    onError: (msg, err) => console.warn(msg, err),
  }
}
