/**
 * nodeRegistry —— 节点"展示"注册表（纯逻辑，零 Vue 依赖，Node 可单测）。
 *
 * 职责边界（对齐 docs/plan/canvas-core-v2-api.md §四 + runbook M2）：
 * - 一个业务 type 的**数据形状/尺寸**由 nodeStore.registerType 管（services/nodeStore，M1 已做）。
 * - 这个 registry 只补"**用什么组件渲染该 type 的每一段**"（content/title/top-toolbar/bottom-toolbar）。
 *   组件句柄是 opaque 引用：内核不 import Vue，宿主在浏览器侧喂 .vue，测试喂 stub。
 * - 为什么不分两处：data(尺寸/类型合法性) 与 presentation(组件) 关注点不同，M2 只做 presentation 这一半，
 *   NodeRenderer 用它决定"type → content 组件"。
 *
 * 红线（runbook M2）：不引入 MovingHandle 吸附 / ResizeHandle 高级 resize / overlay + _toolbarGroup 六插槽——
 * 那些等 M6 image 真进来再逐段移植。
 */

/** 一段式节点展示可能有的段。M2 只路由这四段，top/bottom 缺省为空。 */
export type NodeSegment = 'content' | 'title' | 'top-toolbar' | 'bottom-toolbar'

/** 节点展示定义：每段一个组件句柄(opaque)，没给就不渲染该段。 */
export interface NodePresentation {
  type: string
  segments: Partial<Record<NodeSegment, unknown>>
}

/**
 * 节点展示注册表。注册即查得（host 在渲染前先 seed；CanvasDemo 从它取各 type 的 content 组件）。
 */
export class NodeRegistry {
  private byType = new Map<string, NodePresentation>()

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
}
