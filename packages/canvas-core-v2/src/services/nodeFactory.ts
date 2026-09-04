/**
 * nodeFactory —— 统一节点创建工厂服务（ctx.get('nodeFactory')）。
 *
 * 目的（api.md §3.4 的 createAt + runbook M3"一份节点创建"）：把"放一个 X 节点"收敛成
 * 每个 type 注册一个 creator，host/命令/菜单只调 `create(type,pos)`，别处不再各自抄建节点。
 * 纯逻辑、无 Vue，可单测。
 */
export interface NodeCreator {
  /** 在画布 pos 处建一个该 type 节点，返回短 id；creator 内部负责写默认 data */
  (position: { x: number; y: number }, extra?: unknown): string
}

export interface NodeFactoryService {
  /** 注册某 type 的 creator。type 重复注册抛错。 */
  register(type: string, creator: NodeCreator): void
  /** 按 type 建节点；type 未注册 creator → 抛错（别静默） */
  create(type: string, position: { x: number; y: number }, extra?: unknown): string
  /** 已注册可创建的 type 列表（供"从菜单建 text/image"枚举） */
  creatableTypes(): string[]
}

export class NodeFactory implements NodeFactoryService {
  private creators = new Map<string, NodeCreator>()

  register(type: string, creator: NodeCreator): void {
    if (this.creators.has(type)) {
      throw new Error(`[nodeFactory] creator for node type "${type}" already registered`)
    }
    this.creators.set(type, creator)
  }

  create(type: string, position: { x: number; y: number }, extra?: unknown): string {
    const creator = this.creators.get(type)
    if (!creator) throw new Error(`[nodeFactory] no creator for node type "${type}". Register it first.`)
    return creator(position, extra)
  }

  creatableTypes(): string[] {
    return [...this.creators.keys()]
  }
}
