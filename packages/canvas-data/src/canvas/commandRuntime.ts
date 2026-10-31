/**
 * 命令运行时句柄（模块级单例，随基础插件 apply 绑定/解绑）。
 *
 * 为什么需要：Spec 3.1 要求基础服务只剩 7 个，`command` 不再作为服务名。
 * 但 `ctx.commands` 糖、canvas 门面、宿主键盘分发都需要同一个 CommandRegistry ——
 * 这里给一个内部运行时句柄，插件不按名取 command 也能执行/枚举/改键。
 */
import type { CommandDef, CommandService, Disposable } from '@mini-canvas/kernel'

export interface CommandRuntime {
  execute(id: string, ...payload: unknown[]): unknown
  list(): CommandDef[]
  has(id: string): boolean
  register(def: CommandDef): Disposable
  remapKeys(id: string, keys: string[]): string[]
  resetKeys(id: string): string[] | undefined
  originalKeys(id: string): string[] | undefined
  isRemapped(id: string): boolean
}

let runtime: CommandRuntime | undefined
/** 宿主/基础插件保留的原始 CommandService（canvasCommands 等内部装配用） */
let service: CommandService | undefined

export function setCommandRuntime(next: CommandRuntime, original?: CommandService): void {
  runtime = next
  if (original) service = original
}

export function clearCommandRuntime(): void {
  runtime = undefined
  service = undefined
}

export function commandRuntime(): CommandRuntime | undefined {
  return runtime
}

/** 基础插件内部装配用的原始命令表（插件侧一律走 ctx.commands / canvas） */
export function commandService(): CommandService | undefined {
  return service
}
