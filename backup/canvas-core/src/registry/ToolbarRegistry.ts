import { reactive } from 'vue'
import type { ToolbarButtonDefinition, ToolbarRegistryAPI } from './types'

/**
 * Toolbar 按钮注册中心
 *
 * 插件通过 register() 注册按钮，按钮通过 commandId 引用命令。
 * BaseToolbar 组件读取这里的数据来渲染节点上/下工具栏。
 * 内部使用 reactive Map，注册变化时自动触发 Vue 重渲染。
 */
export class ToolbarRegistry implements ToolbarRegistryAPI {
  /** 按钮存储：id -> ToolbarButtonDefinition */
  private buttons = reactive(new Map<string, ToolbarButtonDefinition>())

  /**
   * 注册按钮
   *
   * 同 id 后注册的覆盖先注册的。
   */
  register(source: string, button: ToolbarButtonDefinition): void {
    const existing = this.buttons.get(button.id)
    if (existing) {
      console.warn(
        `[ToolbarRegistry] Button "${button.id}" is overridden: ` +
        `source "${existing.source}" -> "${source}"`,
      )
    }
    this.buttons.set(button.id, { ...button, source })
  }

  /** 注销按钮 */
  unregister(id: string): void {
    this.buttons.delete(id)
  }

  /** 注销某来源的所有按钮（插件卸载时调用） */
  unregisterSource(source: string): void {
    for (const [id, btn] of this.buttons) {
      if (btn.source === source) this.buttons.delete(id)
    }
  }

  /** 获取指定位置的按钮，按 order 排序 */
  getByPosition(position: 'top' | 'bottom'): ToolbarButtonDefinition[] {
    const result: ToolbarButtonDefinition[] = []
    for (const btn of this.buttons.values()) {
      if (btn.position === position) result.push(btn)
    }
    return result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  /** 获取所有按钮 */
  getAll(): ToolbarButtonDefinition[] {
    return [...this.buttons.values()]
  }
}


