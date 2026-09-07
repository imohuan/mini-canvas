/**
 * plugin-auto-save —— 定时自动保存插件（v2 薄适配包，复刻老版 canvas-core/plugins/auto-save）。
 *
 * 老版做了什么：interval(默认 1000ms) 定时把 nodes/edges 落盘 + hidden/pagehide 立即保存 +
 * 上架 auto-save API(isDirty/isEnabled/saveNow/setEnabled) + 事件。
 *
 * v2 分工（不重复造、零耦合）：
 * - 落盘本体：内核 SaveService（ctx.save.set → 防抖 flush；CanvasHost 已做 hidden/pagehide 即时 flush）。
 * - 本包只补老版独有的「周期性兜底保存」：interval 轮询脏位 → ctx.save.flush()。
 * - 上架 auto-save 服务（独立名，不撞宿主已注入的 save）暴露老版同名 API 面；
 *   宿主/store 变化经渲染层事件/订阅置脏位。
 *
 * 依赖：save（内核）、nodeStore/edgeStore（内核；订阅数据变化置脏）。
 */
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import type {
  SaveService,
  NodeStoreService,
  EdgeStoreService,
} from '@mini-canvas/canvas-core-v2'
import { createAutoSaveEngine, type AutoSaveEngine } from './autoSaveEngine'

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    save: SaveService
    nodeStore: NodeStoreService
    edgeStore: EdgeStoreService
  }
}

export const name = 'auto-save'
export const inject = ['save', 'nodeStore', 'edgeStore'] as string[]

/** auto-save 服务 API（对齐老版 AutoSaveAPI 里 v2 有意义的子集） */
export interface AutoSaveService {
  /** 当前是否启用定时保存 */
  isEnabled(): boolean
  /** 是否有未落盘的脏数据 */
  isDirty(): boolean
  /** 立即落盘（无论脏否） */
  saveNow(): Promise<void>
  /** 启用/停用定时保存 */
  setEnabled(v: boolean): void
  /** 周期(ms) */
  readonly interval: number
}

export function apply(ctx: Context): void {
  const { save, nodeStore, edgeStore } = ctx
  const interval = 1000

  const engine: AutoSaveEngine = createAutoSaveEngine({
    interval,
    enabled: true,
    flush: () => save.flush(),
    isDirty: () => save.isDirty(),
  })

  // 画布数据变化 → 置脏（供下个周期落盘）。订阅 store（内核事件源，非 VueFlow）
  const offNodes = nodeStore.subscribe(() => engine.markDirty())
  const offEdges = edgeStore.subscribe(() => engine.markDirty())

  // 上架服务（插件 ctx.effect 自动回收；独立名不撞宿主 save）
  const service: AutoSaveService = {
    isEnabled: () => engine.isEnabled(),
    isDirty: () => engine.isDirty(),
    saveNow: () => engine.saveNow(),
    setEnabled: (v) => engine.setEnabled(v),
    get interval() {
      return interval
    },
  }
  ctx.inject('auto-save', service)

  // 卸载清理
  ctx.effect(() => {
    offNodes()
    offEdges()
    engine.dispose()
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const autoSavePlugin: PluginModule = { name, inject, apply }
