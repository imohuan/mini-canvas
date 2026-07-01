import type { Component } from 'vue'

export interface NodeMenuItemDefinition {
  label: string
  description?: string
  /** 图标：SVG HTML 字符串或 Vue 组件，由插件注册时提供 */
  icon?: string | Component
  badge?: string
}

export interface CanvasNodeDefinition {
  /** 来源（插件名或 'core'），用于批量卸载 */
  source?: string
  /** 排序，数字越小越靠前 */
  order?: number
  type: string
  node?: Component
  label: string
  defaultSize: { cardWidth: number; cardHeight: number }
  menuItem: NodeMenuItemDefinition
  canReceiveInput?: boolean
  canProduceOutput?: boolean
  /** 允许连接到本节点的输入源 nodeType 列表。
   *  undefined = 接受全部（向后兼容）
   *  [] = 不接受任何输入
   *  ['image'] = 只接受 image 节点 */
  acceptsInputs?: string[]
  resizable?: boolean
  /** 自定义 top toolbar 组件，不传则使用默认 BaseToolbar */
  topToolbar?: Component
  /** 自定义 bottom toolbar 组件，不传则使用默认 BaseToolbar */
  bottomToolbar?: Component
  /** 标题栏图标（SVG HTML 字符串或 Vue 组件）。不传则回到 BaseNode 内置 fallback */
  titleIcon?: string | Component
  /** 自渲染模式：true 时 CustomNode 不做 BaseNode 组装，完全由 node 组件自己控制渲染。
   * 此时 topToolbar / bottomToolbar / titleIcon 等字段均被忽略。 */
  selfRender?: boolean
}

export interface CanvasNodeMenuItem {
  id: string
  label: string
  description?: string
  icon?: NodeMenuItemDefinition['icon']
  badge?: string
}

const FALLBACK_SIZE = { cardWidth: 256, cardHeight: 256 }

export class NodeRegistry {
  private definitions = new Map<string, CanvasNodeDefinition>()

  register(definition: CanvasNodeDefinition): void {
    this.definitions.set(definition.type, definition)
  }

  unregister(type: string): void {
    this.definitions.delete(type)
  }

  get(type: string): CanvasNodeDefinition | null {
    return this.definitions.get(type) ?? null
  }

  getAllTypes(): string[] {
    return [...this.definitions.keys()]
  }

  getDefaultSize(type: string): { cardWidth: number; cardHeight: number } {
    return this.definitions.get(type)?.defaultSize ?? FALLBACK_SIZE
  }

  getLabel(type: string): string {
    return this.definitions.get(type)?.label ?? type
  }

  canReceiveInput(type: string): boolean {
    return this.definitions.get(type)?.canReceiveInput ?? true
  }

  canProduceOutput(type: string): boolean {
    return this.definitions.get(type)?.canProduceOutput ?? true
  }

  getAcceptsInputs(type: string): string[] | undefined {
    return this.definitions.get(type)?.acceptsInputs
  }

  isResizable(type: string): boolean {
    return this.definitions.get(type)?.resizable ?? false
  }

  getMenuItems(): CanvasNodeMenuItem[] {
    return [...this.definitions.values()].map(definition => ({
      id: definition.type,
      label: definition.menuItem.label,
      description: definition.menuItem.description,
      icon: definition.menuItem.icon,
      badge: definition.menuItem.badge,
    }))
  }
}
