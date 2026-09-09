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
  /** 运行期重映射某命令的快捷键（shortcut-manager remap 的内核基础）。只改 keys，run/元数据不动。 */
  remapKeys(id: string, keys: string[]): string[]
  /** 恢复某命令 remap 前的原始快捷键（未 remap 过则 no-op）。返回恢复后的 keys */
  resetKeys(id: string): string[] | undefined
  /** 只读：该命令的原始（注册/未 remap）快捷键。remap 过则返回备份，否则返回当前 keys。无此命令返回 undefined。 */
  originalKeys(id: string): string[] | undefined
  /** 该命令当前 keys 是否被 remap 过 */
  isRemapped(id: string): boolean
}

export class CommandRegistry implements CommandService {
  private cmds = new Map<string, CommandDef>()
  private ctx: unknown = null
  /** 每命令 remap 前的原始 keys 备份（第一次 remap 时记录；register dispose/unregister 时随命令清理） */
  private keysBackup = new Map<string, string[]>()

  register(def: CommandDef): Disposable {
    if (this.cmds.has(def.id)) {
      throw new Error(`[command] command "${def.id}" already registered`)
    }
    this.cmds.set(def.id, def)
    return {
      dispose: () => {
        if (this.cmds.get(def.id) === def) {
          this.cmds.delete(def.id)
          this.keysBackup.delete(def.id)
        }
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
    this.keysBackup.delete(id)
    return existed
  }

  setContext(ctx: unknown): void {
    this.ctx = ctx
  }

  remapKeys(id: string, keys: string[]): string[] {
    const cmd = this.cmds.get(id)
    if (!cmd) throw new Error(`[command] cannot remap unknown command "${id}"`)
    if (!this.keysBackup.has(id)) this.keysBackup.set(id, cmd.keys ? [...cmd.keys] : [])
    cmd.keys = [...keys]
    return cmd.keys
  }

  resetKeys(id: string): string[] | undefined {
    const cmd = this.cmds.get(id)
    if (!cmd) return undefined
    const backup = this.keysBackup.get(id)
    if (backup) {
      cmd.keys = [...backup]
      this.keysBackup.delete(id)
    }
    return cmd.keys
  }

  originalKeys(id: string): string[] | undefined {
    const cmd = this.cmds.get(id)
    if (!cmd) return undefined
    const backup = this.keysBackup.get(id)
    return backup ? [...backup] : cmd.keys ? [...cmd.keys] : []
  }

  isRemapped(id: string): boolean {
    return this.keysBackup.has(id)
  }

  execute(id: string, ...payload: unknown[]): unknown {
    const cmd = this.cmds.get(id)
    if (!cmd) return undefined
    if (cmd.when && !cmd.when(this.ctx)) return undefined
    return cmd.run(this.ctx, ...payload)
  }
}

// ============================================================================
// CommandDef.keys → 键盘事件匹配（渲染层绑键用；纯逻辑零 DOM，可单测）
// ============================================================================

/** 键盘事件最小形状（DOM KeyboardEvent 兼容子集） */
export interface CommandKeyEvent {
  key: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

/** 友好键名 → KeyboardEvent.key（小写比较基准；其余原样小写） */
const KEY_ALIAS: Record<string, string> = {
  escape: 'escape', enter: 'enter', space: ' ', backspace: 'backspace',
  delete: 'delete', tab: 'tab',
  arrowup: 'arrowup', arrowdown: 'arrowdown', arrowleft: 'arrowleft', arrowright: 'arrowright',
  plus: '+', minus: '-', equal: '=', ' ': ' ',
}

/**
 * 命令某组 keys（如 'ctrl+a' / 'Delete' / 'mod+shift+z'）是否匹配键盘事件。
 * 语法：'+' 分隔；修饰键 ctrl/shift/alt/meta/mod(cmd)；mod = ctrl 或 meta 任一（跨平台）。
 * 主键大小写不敏感；单键名用 KeyboardEvent.key 语义（'Delete'/'Escape'/'ArrowUp'…）。
 */
export function keyComboMatches(combo: string, e: CommandKeyEvent): boolean {
  const parts = combo.toLowerCase().split('+')
  const isMod = (p: string) => p === 'ctrl' || p === 'shift' || p === 'alt' || p === 'meta' || p === 'mod' || p === 'cmd'
  const modifiers = parts.filter(isMod)
  const keyPart = parts.filter((p) => !isMod(p)).join('+') || ''

  const wantCtrl = modifiers.includes('ctrl')
  const wantShift = modifiers.includes('shift')
  const wantAlt = modifiers.includes('alt')
  const wantMetaOrCmd = modifiers.includes('meta') || modifiers.includes('cmd')
  const wantMod = modifiers.includes('mod')

  // mod = ctrl 或 meta 任一
  const hasMod = Boolean(e.ctrlKey) || Boolean(e.metaKey)
  if (wantMod && !hasMod) return false
  if (!wantMod) {
    // 精确匹配修饰键（无 mod 时 ctrl/meta 必须与期望一致）
    if (wantCtrl !== Boolean(e.ctrlKey)) return false
    if (wantMetaOrCmd !== Boolean(e.metaKey)) return false
  }
  if (wantShift !== Boolean(e.shiftKey)) return false
  if (wantAlt !== Boolean(e.altKey)) return false

  const eventKey = (e.key ?? '').toLowerCase()
  const wantKey = (KEY_ALIAS[keyPart] ?? keyPart).toLowerCase()
  return eventKey === wantKey
}

/**
 * 命令（CommandDef.keys 数组）是否匹配键盘事件；任一 keys 命中即 true。
 * 无 keys/空数组 → false。
 */
export function commandMatchesKeys(keys: string[] | undefined, e: CommandKeyEvent): boolean {
  if (!keys || keys.length === 0) return false
  return keys.some((combo) => keyComboMatches(combo, e))
}

/**
 * 在命令列表里找第一个 keys 命中键盘事件的命令（渲染层 keydown 分发用）。
 * 按列表顺序先到先得；无命中返回 undefined。无 keys 的命令跳过。
 */
export function findCommandByKeys<T extends { id: string; keys?: string[] }>(
  commands: readonly T[],
  e: CommandKeyEvent,
): T | undefined {
  for (const cmd of commands) {
    if (cmd.keys && cmd.keys.length > 0 && commandMatchesKeys(cmd.keys, e)) return cmd
  }
  return undefined
}


