import { reactive } from 'vue'
import type { CanvasCommand, CommandContext, CommandRegistryAPI } from './types'

/**
 * 命令注册中心
 *
 * 所有可执行能力的中央仓库。菜单、Toolbar、快捷键都通过 commandId 引用这里的命令。
 * 内部使用 reactive Map，注册/注销时自动触发 Vue 重渲染。
 */
export class CommandRegistry implements CommandRegistryAPI {
  /** 命令存储：id -> CanvasCommand */
  private commands = reactive(new Map<string, CanvasCommand>())

  /** 快捷键管理器（可选，传入后 keybinding 自动绑定） */
  private shortcutManager: { register(entry: any): { ok: boolean }; unregister(id: string): void } | null = null

  /**
   * 注入快捷键管理器
   *
   * 注入后，注册带 keybinding 的命令会自动绑定快捷键。
   */
  setShortcutManager(mgr: typeof this.shortcutManager): void {
    this.shortcutManager = mgr
  }

  /**
   * 注册命令
   *
   * 同 id 后注册的覆盖先注册的（类似 Monaco 的覆盖机制），并打 warn 日志。
   */
  register(command: CanvasCommand): void {
    const existing = this.commands.get(command.id)
    if (existing) {
      console.warn(
        `[CommandRegistry] Command "${command.id}" is overridden: ` +
        `source "${existing.source}" -> "${command.source}"`,
      )
    }
    this.commands.set(command.id, { ...command })

    // 自动绑定快捷键
    if (command.keybinding && this.shortcutManager) {
      this.shortcutManager.register({
        id: `cmd:${command.id}`,
        command: command.title || command.id,
        keys: command.keybinding,
        handler: () => {
          this.execute(command.id, {
            runtime: null, actions: null, selection: null, viewport: null, store: null, logger: console,
          })
        },
        priority: command.priority ?? 30,
        pluginId: command.source,
        group: 'plugin',
      })
    }
  }

  /** 注销命令 */
  unregister(id: string): void {
    // 解绑快捷键
    const cmd = this.commands.get(id)
    if (cmd?.keybinding && this.shortcutManager) {
      this.shortcutManager.unregister(`cmd:${id}`)
    }
    this.commands.delete(id)
  }

  /** 注销某来源的所有命令（插件卸载时调用） */
  unregisterSource(source: string): void {
    for (const [id, cmd] of this.commands) {
      // 解绑快捷键
      if (cmd.keybinding && this.shortcutManager) {
        this.shortcutManager.unregister(`cmd:${id}`)
      }
      if (cmd.source === source) this.commands.delete(id)
    }
  }

  /**
   * 执行命令
   *
   * - 命令不存在 -> 抛错
   * - run 报错 -> 捕获并记入 logger，不抛出
   */
  async execute(id: string, ctx: CommandContext, args?: unknown): Promise<void> {
    const cmd = this.commands.get(id)
    if (!cmd) {
      throw new Error(`[CommandRegistry] Command not found: "${id}"`)
    }
    try {
      await cmd.run(ctx, args)
    } catch (err) {
      ctx.logger?.error?.(`[CommandRegistry] Command "${id}" failed:`, err)
    }
  }

  /** 是否可执行（考虑 disabled） */
  canExecute(id: string, ctx?: CommandContext): boolean {
    const cmd = this.commands.get(id)
    if (!cmd) return false
    if (cmd.disabled === undefined) return true
    if (typeof cmd.disabled === 'boolean') return !cmd.disabled
    if (ctx) {
      try {
        return !cmd.disabled(ctx)
      } catch {
        return false
      }
    }
    return true
  }

  /** 命令是否存在 */
  has(id: string): boolean {
    return this.commands.has(id)
  }

  /** 获取命令定义 */
  get(id: string): CanvasCommand | null {
    return this.commands.get(id) ?? null
  }

  /** 获取所有公开命令（有 title 的） */
  getPublic(): CanvasCommand[] {
    const result: CanvasCommand[] = []
    for (const cmd of this.commands.values()) {
      if (cmd.title) result.push(cmd)
    }
    return result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  /** 获取所有命令 */
  getAll(): CanvasCommand[] {
    return [...this.commands.values()]
  }
}



