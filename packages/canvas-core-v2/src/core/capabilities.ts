/**
 * capabilities —— 挂在插件 ctx 上的"能力段"收口（对齐 docs/goal/plugin-system-goal.md 2.1b / 目标 B）。
 *
 * 目的：把散装注册函数(registerNodeType/registerThemeSlot/ctx.get('command')/…)收口成
 * 作者一眼能用的 `ctx.nodes / ctx.theme / ctx.commands / ctx.slots`，注册一律自动回收
 * （revoke 经当前插件 scope 的 effect 登记，插件卸载/热卸即清，作者不手写 unregister）。
 *
 * 依赖方向：纯内核、零 Vue。组件句柄 opaque；节点数据/展示走 nodeStore/nodeRegistry(内核已注入服务)，
 * 通用 UI 槽(slots)走 ctx 自带的 SlotRegistry 服务('slots')，宿主按需渲染。
 */
import type { PluginScope } from './types'
import { registerNodeType } from './registry/registerNodeType'
import type { ThemeSlot } from './registry/themeRegistry'
import type { NodeSegment } from './registry/nodeRegistry'
import type { NodeStoreService } from '../services/nodeStore'
import type { NodeFactoryService, NodeCreator } from '../services/nodeFactory'
import type { CommandDef } from '../services/command'
import type { SlotRegistry } from './registry/slotRegistry'
import type { SettingsStore } from './settingsStore'

/** ctx.nodes.register 一次给全的定义（数据+展示+可选建节点实现） */
export interface NodeRegisterDef {
  type: string
  label: string
  size: { w: number; h: number }
  /** 内容段组件（opaque）—— 最常见；title 等可选 */
  content?: unknown
  title?: unknown
  segments?: Partial<Record<NodeSegment, unknown>>
  /** 声明式连接约束 */
  inputs?: Array<{ port?: string; accepts?: string[]; limit?: 'single' | 'multi' }>
  outputs?: Array<{ port?: string }>
  /** 可选：提供"建一个该 type 节点"的实现（挂 nodeFactory，自动回收） */
  create?: NodeCreator
}

/** ctx.theme.register 的可选 occupant 信息 */
export interface ThemeOccupantOpts {
  /** occupant id（默认=当前插件名 → 同插件重装替换该格） */
  id?: string
  /** order：单格换肤点里 order 最小者获胜（默认 0，后装可给更小 order 顶替） */
  order?: number
}

/** ctx.slots.register 的 occupant 请求 */
export interface SlotRegisterReq {
  id?: string
  order?: number
  component: unknown
}

/**
 * 能力段收口。给定一个插件 scope ctx（含 get/effect），返回 ctx 上挂的 nodes/theme/commands/slots。
 */
export function buildCapabilities(
  ctx: PluginScope,
  pluginName: string,
): {
  nodes: {
    register(def: NodeRegisterDef): void
  }
  theme: {
    register(slot: ThemeSlot, component: unknown, opts?: ThemeOccupantOpts): void
    add(slot: ThemeSlot, component: unknown, opts?: ThemeOccupantOpts): void
    remove(slot: ThemeSlot, id: string): void
  }
  commands: {
    register(def: CommandDef): void
    has(id: string): boolean
  }
  slots: {
    register(slot: string, req: SlotRegisterReq): string
    remove(slot: string, id: string): boolean
    occupants(slot: string): Array<{ id: string; order: number; component: unknown }>
  }
  settings: {
    set(key: string, value: string | number | boolean): boolean
    get(key: string): string | number | boolean
    onChange(scope: string, cb: (key: string, value: unknown) => void): { dispose(): void }
    groups(): string[]
  }
} {
  const theme = () => {
    try {
      return ctx.get<{ addOccupant(s: string, r: { id?: string; order?: number; value: unknown }): string; removeOccupant(s: string, id: string): boolean }>('themeRegistry')
    } catch {
      return undefined
    }
  }
  const uiSlots = () => {
    try {
      return ctx.get<SlotRegistry>('slots')
    } catch {
      return undefined
    }
  }
  const settingsStore = () => ctx.get<SettingsStore>('settings')

  return {
    // ---------- ctx.nodes：注册一个节点类型（数据+展示+可选建节点），自动回收 ----------
    nodes: {
      register(def: NodeRegisterDef): void {
        // ① 数据 + 展示(经 registerNodeType，内部已 ctx.effect 回收)
        const revoke = registerNodeType(ctx, {
          type: def.type,
          label: def.label,
          defaultSize: def.size,
          inputs: def.inputs,
          outputs: def.outputs,
          segments: def.content || def.title ? { content: def.content, title: def.title, ...(def.segments ?? {}) } : def.segments,
        })
        // ② 可选建节点实现 → nodeFactory.register + effect 回收
        if (def.create) {
          const factory = ctx.get<NodeFactoryService>('nodeFactory')
          factory.register(def.type, def.create)
          ctx.effect(() => () => {
            factory.unregister(def.type)
            revoke()
          })
        } else {
          ctx.effect(() => revoke)
        }
      },
    },

    // ---------- ctx.theme：往主题槽叠/取 occupant，自动回收 ----------
    theme: {
      register(slot: ThemeSlot, component: unknown, opts: ThemeOccupantOpts = {}): void {
        this.add(slot, component, opts)
      },
      add(slot: ThemeSlot, component: unknown, opts: ThemeOccupantOpts = {}): void {
        const reg = theme()
        if (!reg) return
        const id = opts.id ?? pluginName
        reg.addOccupant(slot, { id, order: opts.order, value: component })
        ctx.effect(() => () => reg.removeOccupant(slot, id))
      },
      remove(slot: ThemeSlot, id: string): void {
        theme()?.removeOccupant(slot, id)
      },
    },

    // ---------- ctx.commands：注册命令，自动回收 ----------
    commands: {
      register(def: CommandDef): void {
        const cmd = ctx.get<{ register(d: CommandDef): { dispose(): void }; has(id: string): boolean }>('command')
        const handle = cmd.register(def)
        ctx.effect(() => () => handle.dispose())
      },
      has(id: string): boolean {
        try {
          return ctx.get<{ has(id: string): boolean }>('command').has(id)
        } catch {
          return false
        }
      },
    },

    // ---------- ctx.slots：往通用 UI 槽叠 occupant（'slots' 服务由 ctx 自带），自动回收 ----------
    slots: {
      register(slot: string, req: SlotRegisterReq): string {
        const reg = uiSlots()
        if (!reg) return ''
        const id = reg.add(slot, { id: req.id, order: req.order, value: req.component })
        ctx.effect(() => () => reg.remove(slot, id))
        return id
      },
      remove(slot: string, id: string): boolean {
        return uiSlots()?.remove(slot, id) ?? false
      },
      occupants(slot: string) {
        return (uiSlots()?.list(slot) ?? []).map((e) => ({
          id: e.id,
          order: e.order,
          component: e.value,
        }))
      },
    },

    // ---------- ctx.settings：已装配 config 的读 + 订阅（声明改由插件 Config schema 自动完成，无 define 入口） ----------
    settings: {
      set(key: string, value: string | number | boolean): boolean {
        return settingsStore().set(key, value)
      },
      get(key: string): string | number | boolean {
        return settingsStore().get(key)
      },
      onChange(scope: string, cb: (key: string, value: unknown) => void): { dispose(): void } {
        return settingsStore().onChange(cb, { scope })
      },
      groups(): string[] {
        return settingsStore().groups()
      },
    },
  }
}
