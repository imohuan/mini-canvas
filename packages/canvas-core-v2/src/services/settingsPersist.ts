/**
 * settingsPersist —— 配置持久化桥：把 SettingsStore(分组配置单一数据源) 接入 SaveService(config 域)。
 *
 * 解决的问题（全量审查 P1-5）：SettingsStore 只存内存、改了不落盘，刷新/换宿主后设置丢失。
 * 注：P1-4（配置 key 全局平面命名、插件间裸 key 互相覆盖）不在此解决——key 冲突治理属内核
 * SettingsStore/Context 的命名空间设计范畴，本桥只负责持久化。
 *
 * 本桥的策略：
 * - 持久化以"保存值快照"形式整体存取（裸 key = 'settings'，type = 'config'）：
 *   启动 restore() 把上次保存的值注入 SettingsStore.setSavedSnapshot —— 先于/晚于插件 define 都生效；
 * - 运行期任一配置变更（onChange 全局订阅）自动并入快照并 save.set 整份（SaveService 自带微任务防抖落盘）；
 * - 这样配置持久化对插件透明：插件仍只管 define/set，桥负责恢复与保存，不做全局重建。
 *
 * 零 Vue、纯逻辑、Node 可单测。
 */
import type { SaveService } from './storage/types'
import type { SettingsStore } from '../core/settingsStore'
import type { Disposable } from '../core/types'

/** 配置持久化的裸 key（type='config' 下的物理 key 由 SaveService 加前缀） */
export const SETTINGS_SAVE_KEY = 'settings'

/** 桥的只读接口（宿主 ctx.get('settingsPersist') 可拿；插件一般不需要） */
export interface SettingsPersistService {
  /** 从 save 读上次保存值并注入 SettingsStore（启动恢复；未保存过则 no-op） */
  restore(): Promise<void>
  /** 把当前全部设置值落盘为保存快照（用户"恢复默认"/手动保存时调用） */
  persistNow(): Promise<void>
  /** 让某 key 回到 schema.default 并从保存快照删除（"恢复该项默认"）；返回是否清理到 */
  resetKey(key: string): boolean
  /** 释放订阅（宿主 stop 时调用，防泄漏） */
  dispose(): void
}

/**
 * 建一个配置持久化桥。
 * @param store SettingsStore 实例（ctx.get('settings')）
 * @param save SaveService 实例（ctx.get('save')）
 * @returns SettingsPersistService
 */
export function createSettingsPersist(store: SettingsStore, save: SaveService): SettingsPersistService {
  let disposed = false
  let off: Disposable | null = null
  /** 持久化值快照（桥内副本；改动即 save.set，flush 由 SaveService 防抖负责） */
  let snapshot: Record<string, string | number | boolean> = {}

  /** 订阅运行期任何配置变更：并入快照并写 save（type=config）。热装插件 define 时 restore 已把 saved 值作为初值，
   *  不重复覆盖；此订阅只捕获真正 set/clear 的变化。 */
  function watch(): void {
    if (off) return
    off = store.onChange((key, value) => {
      if (disposed) return
      snapshot[key] = value as string | number | boolean
      save.set(SETTINGS_SAVE_KEY, snapshot, 'config')
    })
  }

  return {
    async restore(): Promise<void> {
      if (disposed) return
      const saved = await save.get<Record<string, string | number | boolean>>(SETTINGS_SAVE_KEY, 'config')
      snapshot = saved && typeof saved === 'object' ? { ...saved } : {}
      // 注入 store：已声明项立即覆盖；未声明项留给后续 define（define 命中快照作初值）
      store.setSavedSnapshot(snapshot)
      watch() // restore 后开始追踪变更（避免恢复本身被当成用户改动重复写回）
    },
    async persistNow(): Promise<void> {
      if (disposed) return
      snapshot = store.entries()
      await save.set(SETTINGS_SAVE_KEY, snapshot, 'config')
      await save.flush()
    },
    resetKey(key: string): boolean {
      if (disposed) return false
      const existed = key in snapshot
      store.clearSavedKeys([key]) // 已声明项回 default；未声明只清快照
      delete snapshot[key]
      if (existed) save.set(SETTINGS_SAVE_KEY, snapshot, 'config')
      return existed
    },
    dispose(): void {
      disposed = true
      off?.dispose()
      off = null
    },
  }
}



