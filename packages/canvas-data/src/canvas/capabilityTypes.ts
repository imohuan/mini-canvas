/**
 * capabilityTypes —— 画布能力段的**类型**（声明合并回框架的 PluginCapabilities）。
 *
 * 框架（@mini-canvas/kernel）不认识 node/theme/command 这些画布字眼，故它的 PluginCapabilities
 * 只声明了通用的 tools；本文件把画布独有的段（nodes/theme/commands/slots/settings）经声明合并补上，
 * 于是作者在插件里写 ctx.nodes.register(...) 有完整类型提示，而框架包保持干净。
 *
 * 只要本文件被加载（canvas-pack 入口会 import 它），合并即生效。
 */
import type { CommandDef } from '@mini-canvas/kernel'
import type { NodeRegisterDef } from './capabilities'
import type { ThemeSlot } from './registry/themeRegistry'
import type { NodeSegment } from './registry/nodeRegistry'

declare module '@mini-canvas/kernel' {
  interface PluginCapabilities {
    /** 注册一个节点类型（数据+展示+可选建节点），自动回收 */
    nodes: {
      register(def: NodeRegisterDef): void
      /** 往某 type 的某段叠 occupant（多插件同段叠加；自动回收）。返回 occupant id */
      contribute(
        type: string,
        segment: NodeSegment,
        component: unknown,
        opts?: { id?: string; order?: number },
      ): string
    }
    /** 往主题槽叠 occupant（order 最小者获胜），自动回收 */
    theme: {
      register(slot: ThemeSlot, component: unknown, opts?: { id?: string; order?: number }): void
      add(slot: ThemeSlot, component: unknown, opts?: { id?: string; order?: number }): void
      remove(slot: ThemeSlot, id: string): void
    }
    /** 注册命令，自动回收（CommandDef 定义在 kernel.command，与命令注册表同源） */
    commands: {
      register(def: CommandDef): void
      has(id: string): boolean
    }
    /** 往通用 UI 槽叠 occupant（宿主按序渲染），自动回收 */
    slots: {
      register(slot: string, req: { id?: string; order?: number; component: unknown; meta?: unknown }): string
      remove(slot: string, id: string): boolean
      occupants(slot: string): Array<{ id: string; order: number; component: unknown; meta?: unknown }>
    }
    /**
     * 配置（cordis P4 形态）：插件在模块级导出 `Config` schema，装配处给 config，
     * 框架校验+补默认后 `apply(ctx, config)` 收到完整 config。此段是"已装配 config"的读 + 订阅。
     */
    settings: {
      /** 改一项已装配 config 的值（未知 key 抛错；number 越界夹取，实时生效） */
      set(key: string, value: string | number | boolean): boolean
      /** 读一项已装配 config 的当前值 */
      get(key: string): string | number | boolean
      /** 订阅某作用域(插件)的 config 变化：scope 传本插件名=只收自己的；不传全局 */
      onChange(scope: string, cb: (key: string, value: unknown) => void): { dispose(): void }
      /** 已装配(声明)的组名（UI 面板用） */
      groups(): string[]
    }
  }
}
