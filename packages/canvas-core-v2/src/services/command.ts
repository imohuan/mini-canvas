/**
 * Command —— 命令服务（ctx.get('command')）。菜单/工具栏/快捷键/删除都走统一 execute。
 *
 * 契约见 api.md §3.2：快捷键 = 命令上一个可选 keys 字段（宿主负责绑键）；
 * 内核 pre-register 'command:delete'。本服务纯逻辑、无 DOM，可独立单测。
 *
 * run 签名 `(ctx, ...payload)`：ctx 由宿主 `setContext()` 提供（通常是当前 ctx，
 * 命令内部经它 ctx.get 用服务），execute 的后续参数是命令 payload。
 */
import type { Disposable } from '../core/types'

export interface CommandDef {
  id: string
  title?: string
  /** 执行体：ctx 为宿主 setContext 的执行上下文；payload 经 execute(...args) 传入 */
  run(ctx: unknown, ...payload: unknown[]): unknown
  /** 可选快捷键（宿主绑键用），如 ['Delete','Backspace'] */
  keys?: string[]
  /** 可选使能条件（false → execute 直接 no-op） */
  when?: (ctx: unknown) => boolean
  // —— v2 可选 UI 元数据（纯声明，菜单/工具栏插件读；不影响 run 语义）——
  /** 图标（字符串标识或 svg 路径，UI 插件自行解析） */
  icon?: string
  /** 该命令出现在哪些区域（'node' | 'edge' | 'pane' | 'toolbar'…） */
  areas?: string[]
  /** 分组（菜单/工具栏分组名） */
  group?: string
  /** 排序权重（越小越靠前） */
  order?: number
}

export interface CommandService {
  /** 注册命令；返回撤销(注销)句柄。重复 id 抛错。 */
  register(def: CommandDef): Disposable
  /** 执行命令（未注册/不满足 when → no-op 不抛）；返回 run 的返回值 */
  execute(id: string, ...payload: unknown[]): unknown
  /** 是否存在某命令 */
  has(id: string): boolean
  /** 按 id 取命令定义（含 UI 元数据；未注册返回 undefined） */
  get(id: string): CommandDef | undefined
  /** 枚举全部命令定义 */
  list(): CommandDef[]
  /** 按 id 注销（未注册返回 false） */
  unregister(id: string): boolean
  /** 宿主注入执行上下文（供 run/when 拿 ctx.get 等服务） */
  setContext(ctx: unknown): void
}

export class CommandRegistry implements CommandService {
  private cmds = new Map<string, CommandDef>()
  private ctx: unknown = null

  register(def: CommandDef): Disposable {
    if (this.cmds.has(def.id)) {
      throw new Error(`[command] command "${def.id}" already registered`)
    }
    this.cmds.set(def.id, def)
    return {
      dispose: () => {
        if (this.cmds.get(def.id) === def) this.cmds.delete(def.id)
      },
    }
  }

  has(id: string): boolean {
    return this.cmds.has(id)
  }

  get(id: string): CommandDef | undefined {
    return this.cmds.get(id)
  }

  list(): CommandDef[] {
    return [...this.cmds.values()]
  }

  unregister(id: string): boolean {
    const existed = this.cmds.has(id)
    this.cmds.delete(id)
    return existed
  }

  setContext(ctx: unknown): void {
    this.ctx = ctx
  }

  execute(id: string, ...payload: unknown[]): unknown {
    const cmd = this.cmds.get(id)
    if (!cmd) return undefined
    if (cmd.when && !cmd.when(this.ctx)) return undefined
    return cmd.run(this.ctx, ...payload)
  }
}


