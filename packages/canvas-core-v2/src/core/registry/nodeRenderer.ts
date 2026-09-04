/**
 * NodeRenderer —— 把"业务 type"解析成"该节点该用什么组件渲染"的纯逻辑（无 Vue 依赖）。
 *
 * 契约见 docs/plan/canvas-core-v2-api.md §四：v2 节点一律走 content 组件 + 具名 slot 声明，
 * selfRender 假概念废弃。BaseNode.vue(壳)消费本模块：给 type 就问出 content/title/toolbar 组件。
 *
 * M2 范围（runbook）：只做 type→段组件 的最小解析 + 缺省兜底；段只在 content/title/top/bottom 四者。
 */
import { NodeRegistry } from './nodeRegistry'
import type { NodeSegment } from './nodeRegistry'

/**
 * 解析某 type 的某一段该用什么组件渲染。
 * @returns 组件句柄(opaque)，未注册或该段没给 → undefined（调用方决定缺省渲染）。
 */
export function resolveSegment(registry: NodeRegistry, type: string, segment: NodeSegment): unknown {
  return registry.get(type)?.segments[segment]
}

/** content 段是否显式注册（没有就应渲染缺省内容） */
export function hasContent(registry: NodeRegistry, type: string): boolean {
  return registry.has(type) && !!registry.get(type)!.segments.content
}

/**
 * 一个 type 的全部段里，哪些段"要渲染"（有组件句柄）。供 BaseNode 决定显示 title/toolbar 与否。
 */
export function activeSegments(registry: NodeRegistry, type: string): NodeSegment[] {
  const def = registry.get(type)
  if (!def) return []
  return (['content', 'title', 'top-toolbar', 'bottom-toolbar'] as NodeSegment[]).filter(
    (s) => !!def.segments[s],
  )
}
