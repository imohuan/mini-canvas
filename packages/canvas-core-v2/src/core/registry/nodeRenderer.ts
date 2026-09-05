/**
 * NodeRenderer —— 把"业务 type"解析成"该节点该用什么组件渲染"的纯逻辑（无 Vue 依赖）。
 *
 * 契约见 docs/plan/canvas-core-v2-api.md §四：v2 节点一律走 content 组件 + 具名 slot 声明，
 * selfRender 假概念废弃。BaseNode.vue(壳)消费本模块：给 type 就问出 content/title/toolbar 组件。
 *
 * 开放插槽（对齐 docs/goal/plugin-system-goal.md 目标 A）：一段既可是单值(content/title/toolbar
 * 由 resolveSegment 单值决策)，也可让同段叠多 occupant —— nodeSegmentStack 返回"基座+全部叠加"按序，
 * 供可叠加段(如装饰层/徽标层)由 BaseNode 按序全量渲染。
 */
import { NodeRegistry } from './nodeRegistry'
import type { NodeSegment } from './nodeRegistry'

/**
 * 解析某 type 的某一段该用什么组件渲染（单值语义 = 该段的基座组件）。
 * @returns 组件句柄(opaque)，未注册或该段没给 → undefined（调用方决定缺省渲染）。
 */
export function resolveSegment(registry: NodeRegistry, type: string, segment: NodeSegment): unknown {
  return registry.get(type)?.segments[segment]
}

/**
 * 某 type 某段"可叠加渲染"的完整组件栈：基座(若有)在最前，随后是按 order 排好的叠加 occupant。
 * 供可叠加段(装饰层/徽标等)由宿主按序全量渲染；若只想要单值请用 resolveSegment。
 */
export function nodeSegmentStack(registry: NodeRegistry, type: string, segment: NodeSegment): unknown[] {
  const base = registry.get(type)?.segments[segment]
  const stack: unknown[] = base !== undefined ? [base] : []
  for (const occ of registry.contributionOccupants(type, segment)) stack.push(occ.component)
  return stack
}

/** content 段是否显式注册（没有就应渲染缺省内容） */
export function hasContent(registry: NodeRegistry, type: string): boolean {
  return registry.has(type) && !!registry.get(type)!.segments.content
}

/**
 * 一个 type 的全部段里，哪些段"要渲染"（有组件句柄或叠加 occupant）。供 BaseNode 决定显示 title/toolbar 与否。
 */
export function activeSegments(registry: NodeRegistry, type: string): NodeSegment[] {
  const def = registry.get(type)
  const all: NodeSegment[] = ['content', 'title', 'top-toolbar', 'bottom-toolbar']
  return all.filter(
    (s) => (def && !!def.segments[s]) || registry.contributionOccupants(type, s).length > 0,
  )
}
