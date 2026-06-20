import type { Component } from 'vue'
import type { Node, Edge } from '@vue-flow/core'

/**
 * 命令执行时的上下文
 */
export interface CommandContext {
  runtime: unknown
  actions: unknown
  selection: unknown
  viewport: unknown
  store: unknown
  logger: {
    debug(...args: unknown[]): void
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
    error(...args: unknown[]): void
  }
  node?: Node
  edge?: Edge
  nodeType?: string
  position?: { x: number; y: number }
}

export interface BaseRegistryItem {
  id: string
  source: string
  order?: number
  group?: string
  visible?: boolean | ((ctx: CommandContext) => boolean)
  disabled?: boolean | ((ctx: CommandContext) => boolean)
}

export interface CanvasCommand extends BaseRegistryItem {
  title?: string
  description?: string
  icon?: string | Component
  category?: string
  keybinding?: string
  priority?: number
  nodeTypes?: string[]
  tooltip?: string
  dropdown?: ToolbarDropdownItem[]
  customRender?: Component
  areas?: Array<'pane' | 'node' | 'edge' | 'connection'>
  run: (ctx: CommandContext, args?: unknown) => void | Promise<void>
}

export interface MenuItemDefinition extends BaseRegistryItem {
  commandId: string
  title?: string
  icon?: string | Component
  areas?: Array<'pane' | 'node' | 'edge' | 'connection'>
  nodeTypes?: string[]
  tooltip?: string
  dropdown?: ToolbarDropdownItem[]
  customRender?: Component
  danger?: boolean
  shortcut?: string
}


export interface ToolbarDropdownItem {
  id: string
  title?: string
  icon?: string | Component
  commandId?: string
  disabled?: boolean | ((ctx: CommandContext) => boolean)
  danger?: boolean
}
export interface ToolbarButtonDefinition extends BaseRegistryItem {
  commandId: string
  title?: string
  icon?: string | Component
  position: 'top' | 'bottom'
  nodeTypes?: string[]
  tooltip?: string
  dropdown?: ToolbarDropdownItem[]
  customRender?: Component
}

export interface PanelSettingDefinition extends BaseRegistryItem {
  title: string
  description?: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'color' | 'slider'
  defaultValue?: unknown
  options?: Array<{ title: string; value: unknown }>
  min?: number
  max?: number
  step?: number
}

export interface CommandRegistryAPI {
  register(command: CanvasCommand): void
  unregister(id: string): void
  unregisterSource(source: string): void
  execute(id: string, ctx: CommandContext, args?: unknown): void | Promise<void>
  canExecute(id: string, ctx?: CommandContext): boolean
  has(id: string): boolean
  get(id: string): CanvasCommand | null
  getPublic(): CanvasCommand[]
  getAll(): CanvasCommand[]
}

export interface ToolbarRegistryAPI {
  register(source: string, button: ToolbarButtonDefinition): void
  unregister(id: string): void
  unregisterSource(source: string): void
  getByPosition(position: 'top' | 'bottom'): ToolbarButtonDefinition[]
  getAll(): ToolbarButtonDefinition[]
}

export interface PanelRegistryAPI {
  registerSetting(source: string, setting: PanelSettingDefinition): void
  unregisterSetting(id: string): void
  unregisterSource(source: string): void
  getAll(): PanelSettingDefinition[]
  getBySource(source: string): PanelSettingDefinition[]
}

export interface MenuRegistryAPI {
  /** 注册单个菜单项（同 id 覆盖，打 warn 日志） */
  register(source: string, item: MenuItemDefinition): void
  /** 按 id 注销单个菜单项 */
  unregister(id: string): void
  /** 注销某来源的所有菜单项 */
  unregisterSource(source: string): void
  /** 获取所有菜单项 */
  getAll(): { source: string; item: MenuItemDefinition }[]
  /** 获取指定区域的菜单项，按 order 排序 */
  getByArea(area: string): MenuItemDefinition[]
}

// ============================================================
// CanvasMenu 类型（供 CanvasMenu.vue 使用）
// ============================================================

export type CanvasMenuMode = 'pane' | 'node' | 'connection' | 'edge'

export interface CanvasMenuItem {
  id: string
  label: string
  description?: string
  badge?: string
  disabled?: boolean
  danger?: boolean
  shortcut?: string
  group?: string
  icon?: 'text' | 'image' | 'video' | 'layers' | 'link' | 'delete' | 'duplicate'
}

export interface CanvasMenuState {
  visible: boolean
  title: string
  mode: CanvasMenuMode
  position: { x: number; y: number }
  items: CanvasMenuItem[]
}
