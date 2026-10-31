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
import type { SaveService, DocService, AutoSaveService } from '@mini-canvas/canvas-data'
import { createAutoSaveEngine, type AutoSaveEngine } from '@mini-canvas/canvas-data'

export const name = 'auto-save'
export const inject = ['save', 'doc'] as string[]

export type { AutoSaveService }

export function apply(ctx: Context): void {
  const save = ctx.get('save')
  const doc = ctx.get('doc')
  const interval = 1000

  const engine: AutoSaveEngine = createAutoSaveEngine({
    interval,
    enabled: true,
    flush: () => save.flush(),
    isDirty: () => save.isDirty(),
  })

  // 画布数据变化 → 置脏（供下个周期落盘）。订阅 doc（一次覆盖节点 + 边两桶；内核事件源，非 VueFlow）
  // doc.subscribe 一次订阅覆盖节点 + 边两桶（与分别订 nodeStore/edgeStore 等价）
  const offDirty = doc.subscribe(() => engine.markDirty())

  // 挂到 save 子对象（新入口），并保留旧服务名做兼容别名。
  const service: AutoSaveService = {
    isEnabled: () => engine.isEnabled(),
    isDirty: () => engine.isDirty(),
    saveNow: () => engine.saveNow(),
    setEnabled: (v) => engine.setEnabled(v),
    get interval() {
      return interval
    },
  }
  ;(save as SaveService & { autoSave?: AutoSaveService }).autoSave = service
  ctx.inject('auto-save', service)

  // 卸载清理：effect 的 fn 立即执行、返回值才是清理函数（此前误把清理写进 fn 导致订阅一建即退）
  ctx.effect(() => () => {
    offDirty()
    engine.dispose()
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const autoSavePlugin: PluginModule = { name, inject, apply }
