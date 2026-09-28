/**
 * barRegistry —— 动作与写入器的纯逻辑容器（零 Vue，node 可单测）。
 *
 * 注意分两层：
 * - 本容器（Map）：供单测与 publishToolActions 的「先算后写」用；不负责跨插件归属。
 * - 跨插件落场：registerBarAction/registerBarApplier 走 ctx.registryOf('node/bar')，
 *   条目归**注册方**插件（卸载自动摘除、同 id 替换）——那才是运行时的正主。
 */
import type { BarAction, BarApplier } from './barTypes'

/** 排序键：没给 order 的一律排最后（与内核 resolveToolParams 的「缺省取第一项」同风格的兜底口径） */
const orderOf = (a: BarAction): number => a.order ?? Number.POSITIVE_INFINITY

export class BarRegistry {
  private actions = new Map<string, BarAction>()
  private appliers = new Map<string, BarApplier>()

  add(action: BarAction): void {
    this.actions.set(action.id, action)
  }

  remove(id: string): boolean {
    return this.actions.delete(id)
  }

  get(id: string): BarAction | undefined {
    return this.actions.get(id)
  }

  list(filter?: { type?: string }): BarAction[] {
    const all = [...this.actions.values()]
    const picked = filter?.type
      ? all.filter((a) => !a.types || a.types.includes(filter.type!))
      : all
    // Array.prototype.sort 在现代 V8 上稳定：同 order 保插入序
    return picked.sort((a, b) => orderOf(a) - orderOf(b))
  }

  addApplier(kind: string, fn: BarApplier): void {
    if (this.appliers.has(kind)) {
      throw new Error('[bottom-bar] applier already registered: ' + kind)
    }
    this.appliers.set(kind, fn)
  }

  applierOf(kind: string): BarApplier | undefined {
    return this.appliers.get(kind)
  }

  kinds(): string[] {
    return [...this.appliers.keys()]
  }
}

