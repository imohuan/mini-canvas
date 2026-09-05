/**
 * nodeRegistry —— 节点"展示"注册表（纯逻辑，零 Vue 依赖，Node 可单测）。
 *
 * 职责边界（对齐 docs/plan/canvas-core-v2-api.md §四 + runbook M2）：
 * - 一个业务 type 的**数据形状/尺寸**由 nodeStore.registerType 管（services/nodeStore，M1 已做）。
 * - 这个 registry 只补"**用什么组件渲染该 type 的每一段**"（content/title/top-toolbar/bottom-toolbar）。
 *   组件句柄是 opaque 引用：内核不 import Vue，宿主在浏览器侧喂 .vue，测试喂 stub。
 *
 * 开放插槽语义（对齐 docs/goal/plugin-system-goal.md 目标 A）：
 * - 一个 type 的展示段既是"基座"(register 的 base segments)，也是可叠加的开放"槽"：
 *   其它插件可经 registerContribution 往某 type 的某段**叠多个 occupant**（带 id/order），
 *   与该段的基座组件一起、按 order 同屏渲染（content/装饰层/徽标等多插件叠加）。
 * - 热卸某插件只抽走它贡献的 occupant，基座与其它贡献原位保留。
 *
 * 兼容旧单值 API（register/get/set/unregister/has/types）：语义不变（读 base segments），存量零改动。
 */
import { SlotRegistry } from './slotRegistry'

/** 一段式节点展示可能有的段。M2 只路由这四段，top/bottom 缺省为空。 */
export type NodeSegment = 'content' | 'title' | 'top-toolbar' | 'bottom-toolbar'

/** 节点展示定义：每段一个组件句柄(opaque)，没给就不渲染该段。 */
export interface NodePresentation {
  type: string
  segments: Partial<Record<NodeSegment, unknown>>
}

/** 往某 type 某段叠加一个 occupant 的请求（id 决定"替换该格/新增"，order 决定顺序） */
export interface NodeSegmentContribution {
  id?: string
  order?: number
  component: unknown
}

/** 段内叠加槽的 slot 键：`${type}/${segment}` */
function segKey(type: string, segment: NodeSegment): string {
  return `${type}/${segment}`
}

/**
 * 节点展示注册表。注册即查得（host 在渲染前先 seed；CanvasDemo 从它取各 type 的 content 组件）。
 */
export class NodeRegistry {
  private byType = new Map<string, NodePresentation>()
  /** 段级叠加 occupant 容器（slot = `${type}/${segment}`） */
  private contributions = new SlotRegistry()

  /** 注册某 type 的展示定义。type 重复注册抛错（防覆盖，与 nodeStore.registerType 同语义）。 */
  register(type: string, segments: NodePresentation['segments']): void {
    if (this.byType.has(type)) {
      throw new Error(`[nodeRegistry] presentation for node type "${type}" already registered`)
    }
    this.byType.set(type, { type, segments })
  }

  /** 取某 type 的展示定义（未注册返回 undefined） */
  get(type: string): NodePresentation | undefined {
    return this.byType.get(type)
  }

  /** 注销某 type 的展示定义（热卸插件时回收；不存在则 no-op） */
  unregister(type: string): void {
    this.byType.delete(type)
    // 一并清掉该 type 的段级叠加 occupant
    this.contributions.clearByPrefix(`${type}/`)
  }

  /** 是否已注册 */
  has(type: string): boolean {
    return this.byType.has(type)
  }

  /** 已注册的 type 列表 */
  types(): string[] {
    return [...this.byType.keys()]
  }

  /** 覆盖式重设某 type（宿主升级/热更用）；未注册则新建 */
  set(type: string, segments: NodePresentation['segments']): void {
    this.byType.set(type, { type, segments })
  }

  // ==================== 段级多 occupant（开放叠加槽） ====================

  /**
   * 往某 type 的某段叠一个 occupant（多插件同段叠加）。同 id 已存在→替换该格；否则追加。
   * 基座(base segments[segment])始终是渲染的默认第一层；叠加层按 order 排在基座之后。
   * @returns 该 occupant id（供 unregisterContribution）
   */
  registerContribution(type: string, segment: NodeSegment, req: NodeSegmentContribution): string {
    const slot = segKey(type, segment)
    // 新加 occupant 默认排基座之后：order 缺省 = 当前叠加层最大 order + 1
    const base = this.get(type)?.segments[segment]
    let order = req.order
    if (order === undefined) {
      const existing = this.contributions.list(slot)
      order = existing.length === 0 ? (base !== undefined ? 1 : 0) : Math.max(...existing.map((e) => e.order)) + 1
    }
    return this.contributions.add(slot, { id: req.id, order, value: req.component })
  }

  /** 移除某 type 某段的一个叠加 occupant；不存在 no-op。返回是否真移除 */
  unregisterContribution(type: string, segment: NodeSegment, id: string): boolean {
    return this.contributions.remove(segKey(type, segment), id)
  }

  /** 某 type 某段已叠的 occupant id 列表（诊断/热卸用） */
  contributionIds(type: string, segment: NodeSegment): string[] {
    return this.contributions.ids(segKey(type, segment))
  }

  /** 某 type 某段当前的全部叠加 occupant（按 order 升序） */
  contributionOccupants(type: string, segment: NodeSegment): Array<{ id: string; order: number; component: unknown }> {
    return this.contributions.list(segKey(type, segment)).map((e) => ({
      id: e.id,
      order: e.order,
      component: e.value,
    }))
  }
}
