/**
 * shortcutRemapEngine —— 快捷键重映射持久化引擎（纯逻辑、零 Vue/DOM，可单测）。
 *
 * v2 分工：命令注册表的 keys 字段是唯一数据源；重映射走内核 CommandRegistry.remapKeys/resetKeys
 * （此前审查 G 项补的内核能力）。本引擎只补"持久化"一段：
 * - 保存 remap 表（commandId → keys[]）到 SaveService（type='shortcut'）；
 * - 恢复（插件装配时读回并批量 remapKeys）；
 * - remap/reset 单条命令并同步保存。
 */

/** remap 表：commandId → 覆盖的 keys（空数组 = 清空快捷键） */
export type ShortcutRemapMap = Record<string, string[]>

/** SaveService 的 shortcut 域裸 key */
export const SHORTCUT_SAVE_KEY = 'keys'

/** 命令注册表的最小接口（CommandRegistry 子集；消费方注入真实实例） */
export interface RemapableCommandRegistry {
  has(id: string): boolean
  list(): Array<{ id: string; keys?: string[] }>
  remapKeys(id: string, keys: string[]): string[]
  resetKeys(id: string): string[] | undefined
  isRemapped(id: string): boolean
}

/** SaveService 最小接口（ctx.get('save') 子集） */
export interface RemapSaveService {
  get<T>(key: string, type?: string): Promise<T | undefined>
  set(key: string, value: unknown, type?: string): void
}

/**
 * 建重映射持久化引擎。
 * @param registry 命令注册表（ctx.get('command')）
 * @param save SaveService（ctx.get('save')；可选——无 save 时仅内存 remap 不持久化）
 */
export function createShortcutRemapEngine(
  registry: RemapableCommandRegistry,
  save?: RemapSaveService,
) {
  /** 当前 remap 表（内存态；restore 后与持久化一致） */
  let map: ShortcutRemapMap = {}

  /** 命令当前是否被 remap（备份存在）——已 remap 的 resetKeys 才恢复原键 */
  const isRemapped = (id: string): boolean => registry.isRemapped(id)

  return {
    /** 从 save 读 remap 表并对现网命令批量应用（插件装配时调用；无 save/无记录则 no-op） */
    async restore(): Promise<void> {
      if (!save) return
      const saved = await save.get<ShortcutRemapMap>(SHORTCUT_SAVE_KEY, 'shortcut')
      map = saved && typeof saved === 'object' ? { ...saved } : {}
      for (const [id, keys] of Object.entries(map)) {
        if (registry.has(id)) registry.remapKeys(id, keys)
      }
    },

    /** 重映射某命令并持久化；返回该命令当前 keys。命令不存在抛错。 */
    remap(id: string, keys: string[]): string[] {
      if (!registry.has(id)) throw new Error(`[shortcut] unknown command "${id}"`)
      const out = registry.remapKeys(id, keys)
      map[id] = [...keys]
      if (save) save.set(SHORTCUT_SAVE_KEY, map, 'shortcut')
      return out
    },

    /** 恢复某命令原始键并从持久化表移除；返回恢复后的 keys */
    reset(id: string): string[] | undefined {
      if (!registry.has(id)) return undefined
      const out = registry.resetKeys(id)
      delete map[id]
      if (save) save.set(SHORTCUT_SAVE_KEY, map, 'shortcut')
      return out
    },

    /** 当前 remap 表（诊断/UI 展示用） */
    snapshot(): ShortcutRemapMap {
      return { ...map }
    },

    /** 命令是否处于 remap 态 */
    isRemapped,
  }
}

