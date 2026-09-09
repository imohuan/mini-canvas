/**
 * v2ShortcutManager —— 把 v1 ShortcutManager 的「查询/重映射/导入导出」API 面复刻到 v2 命令注册表。
 *
 * v1 帮助面板/重映射面板依赖 ShortcutManager 单例（getHelpList/getConflicts/remap/checkRemapConflict/
 * getDefaultKey/resetToDefault/resetDefaults/exportKeymap/loadKeymap）。v2 铁律：无独立 shortcut 注册表，
 * 命令 keys 是唯一数据源（宿主 CanvasHost 统一分发）。本适配器把 v1 API 面映射到：
 *   - 帮助列表/冲突：从 ctx.get('command').list() 现算（带 keys 的命令即帮助条目）；
 *   - remap/reset：走内核 CommandRegistry.remapKeys/resetKeys（keyComboMatches 立即生效）；
 *   - 持久化：委托 shortcutRemapEngine（save type='shortcut' 的 remap 表）。
 *
 * 纯逻辑、零 Vue（.vue 面板经 ctx.get('shortcut-manager') 拿到本实例调用）；可单测。
 */
import type { CommandService } from '@mini-canvas/canvas-core-v2'

/** 帮助列表一条（v1 ShortcutHelpItem 形状：command/keys/group/priority；多 keys 命令拆成多条） */
export interface V2ShortcutHelpItem {
  /** 稳定 id：`{commandId}:{combo}`（同一命令多键位各自成行） */
  id: string
  /** 命令 id（remap/reset 定位用） */
  commandId: string
  /** 展示名 = 命令 title */
  command: string
  /** 当前键位字符串（如 'ctrl+z'） */
  keys: string
  /** 分组：v1 五组语义 */
  group: 'system' | 'edit' | 'canvas' | 'view' | 'plugin'
  /** 命令 order（组内排序用） */
  priority: number
}

export interface V2ShortcutConflict {
  shortcut: string
  entries: V2ShortcutHelpItem[]
  /** 优先级不同（存在胜出方）→ true；v1 中同 priority 冲突未决。v2 全部同构命令按注册序先到先得 */
  resolved: boolean
}

export type V2RemapResult =
  | { ok: true }
  | { ok: false; conflict: V2ShortcutConflict }
  | { ok: false; notFound: true }

/** 键位映射 JSON（导出/导入）：commandId → 键位字符串（v1 KeymapData 语义，单键） */
export type V2KeymapData = Record<string, string>

/** 命令分组：编辑 / 画布 / 视图 / 插件 / 系统 */
export function v2GroupOf(cmd: { id: string; title?: string; group?: string; areas?: string[] }): V2ShortcutHelpItem['group'] {
  const t = (cmd.title ?? cmd.id).toLowerCase()
  const g = (cmd.group ?? '').toLowerCase()
  const areas = cmd.areas ?? []
  // 视图/聚焦/查找/小地图类 → view
  if (
    t.includes('搜索') || t.includes('聚焦') || t.includes('适应') || t.includes('小地图') || t.includes('切换网格') || t.includes('切换辅助线') || t.includes('全屏')
    || areas.includes('view')
  ) return 'view'
  // 撤销/重做/复制/粘贴/剪切/删除/全选/分组编辑 → edit
  if (
    t.includes('撤销') || t.includes('重做') || t.includes('删除') || t.includes('复制') || t.includes('粘贴') || t.includes('剪切') || t.includes('全选') || t.includes('重命名')
    || g === 'edit'
  ) return 'edit'
  // 画布布局/对齐/缩放/导出/命令帮助类 → canvas
  if (
    t.includes('布局') || t.includes('对齐') || t.includes('排列') || t.includes('缩放') || t.includes('放大') || t.includes('缩小') || t.includes('导出') || t.includes('快捷键')
    || g === 'canvas'
  ) return 'canvas'
  return 'plugin'
}

/** 把命令拆成帮助条目（带 keys 才收；一条命令多个 keys 拆多条，id 带 combo 区分） */
export function buildV2HelpList(commands: Array<{ id: string; title?: string; keys?: string[]; group?: string; areas?: string[]; order?: number }>): V2ShortcutHelpItem[] {
  const out: V2ShortcutHelpItem[] = []
  for (const c of commands) {
    if (!c.keys || c.keys.length === 0) continue
    const priority = c.order ?? 100
    const group = v2GroupOf(c)
    for (const combo of c.keys) {
      out.push({ id: c.id + ':' + combo, commandId: c.id, command: c.title ?? c.id, keys: combo, group, priority })
    }
  }
  return out
}

/** 按 v1 分组顺序：system → edit → canvas → view → plugin */
export function groupV2HelpList(items: V2ShortcutHelpItem[]): Array<{ group: V2ShortcutHelpItem['group']; items: V2ShortcutHelpItem[] }> {
  const order: V2ShortcutHelpItem['group'][] = ['system', 'edit', 'canvas', 'view', 'plugin']
  const map = new Map<V2ShortcutHelpItem['group'], V2ShortcutHelpItem[]>()
  for (const it of items) {
    const arr = map.get(it.group) ?? []
    arr.push(it)
    map.set(it.group, arr)
  }
  const result: Array<{ group: V2ShortcutHelpItem['group']; items: V2ShortcutHelpItem[] }> = []
  for (const g of order) {
    const arr = map.get(g)
    if (arr && arr.length) {
      arr.sort((a, b) => a.priority - b.priority || a.command.localeCompare(b.command))
      result.push({ group: g, items: arr })
    }
  }
  return result
}

/** 规范化键位（小写去空格）——与 v1 normalizeKeys 同语义 */
export function normalizeCombo(keys: string): string {
  return keys.toLowerCase().replace(/\s+/g, '')
}

/** 收集冲突：同键位被 ≥2 条帮助条目占用 */
export function findV2Conflicts(items: V2ShortcutHelpItem[]): V2ShortcutConflict[] {
  const byKeys = new Map<string, V2ShortcutHelpItem[]>()
  for (const it of items) {
    const k = normalizeCombo(it.keys)
    const arr = byKeys.get(k) ?? []
    arr.push(it)
    byKeys.set(k, arr)
  }
  const out: V2ShortcutConflict[] = []
  for (const [shortcut, entries] of byKeys) {
    if (entries.length < 2) continue
    entries.sort((a, b) => a.priority - b.priority)
    out.push({ shortcut, entries, resolved: entries[0].priority !== entries[1].priority })
  }
  return out
}

/** 命令注册表最小接口（注入真实 CommandService） */
export interface V2CommandSource {
  list(): Array<{ id: string; title?: string; keys?: string[]; group?: string; areas?: string[]; order?: number }>
  remapKeys(id: string, keys: string[]): string[]
  resetKeys(id: string): string[] | undefined
  originalKeys(id: string): string[] | undefined
  isRemapped(id: string): boolean
  has(id: string): boolean
}

/** 新建适配器：给定命令源 + 可选持久化 remap 引擎（来自 shortcutRemapEngine） */
export function createV2ShortcutManager(
  command: V2CommandSource,
  persist?: {
    remap(id: string, keys: string[]): string[]
    reset(id: string): string[] | undefined
    snapshot(): Record<string, string[]>
  },
) {
  /** 命令 id 的默认（未 remap）键位缓存：首次见到时记录，供"重置默认"预览 */
  const defaults = new Map<string, string[]>()
  function captureDefaults(): void {
    for (const c of command.list()) {
      if (c.keys && c.keys.length && !defaults.has(c.id)) defaults.set(c.id, [...c.keys])
    }
  }
  captureDefaults()

  function itemsNow(): V2ShortcutHelpItem[] {
    captureDefaults()
    return buildV2HelpList(command.list())
  }

  function groupItemsOf(id: string, combo: string): V2ShortcutHelpItem | undefined {
    return itemsNow().find((it) => it.commandId === id && normalizeCombo(it.keys) === normalizeCombo(combo))
  }

  /** 目标键位是否已被"其它命令"占用（重映射目标唯一性检查；同命令自身多键不算冲突） */
  function occupiedByOther(exceptId: string, combo: string): V2ShortcutHelpItem | undefined {
    return itemsNow().find((it) => it.commandId !== exceptId && normalizeCombo(it.keys) === normalizeCombo(combo))
  }

  function conflictOf(exceptId: string, combo: string): V2ShortcutConflict | undefined {
    const occupant = occupiedByOther(exceptId, combo)
    if (!occupant) return undefined
    // 组织成 v1 形状的冲突（占用者 vs 自己）
    const self = itemsNow().find((it) => it.commandId === exceptId && normalizeCombo(it.keys) === normalizeCombo(combo))
    const entries = self ? [occupant, self].sort((a, b) => a.priority - b.priority) : [occupant]
    return { shortcut: combo, entries, resolved: entries.length > 1 && entries[0].priority !== entries[1].priority }
  }

  return {
    /** v1 帮助面板数据源：分组帮助列表（含带 keys 命令；多键拆行） */
    getHelpList() {
      return groupV2HelpList(itemsNow())
    },
    /** 全部冲突 */
    getConflicts(): V2ShortcutConflict[] {
      return findV2Conflicts(itemsNow())
    },
    /** 某命令当前是否 remap 过 */
    isRemapped(id: string): boolean {
      return command.isRemapped(id)
    },
    /** 只读预检：把某命令某条键位改成 newCombo 是否会与其它命令冲突（不写） */
    checkRemapConflict(commandId: string, newCombo: string): V2RemapResult {
      if (!command.has(commandId)) return { ok: false, notFound: true }
      if (conflictOf(commandId, newCombo)) {
        return { ok: false, conflict: conflictOf(commandId, newCombo)! }
      }
      return { ok: true }
    },
    /** 重映射：把 commandId 当前 keys 里的某条 combo 替换为新键（其余保留）；实际改键并持久化 */
    remapCombo(commandId: string, oldCombo: string, newCombo: string): V2RemapResult {
      if (!command.has(commandId)) return { ok: false, notFound: true }
      const cur = command.list().find((c) => c.id === commandId)?.keys ?? []
      const conflict = conflictOf(commandId, newCombo)
      if (conflict) return { ok: false, conflict }
      const next = cur.filter((k) => normalizeCombo(k) !== normalizeCombo(oldCombo))
      if (!next.some((k) => normalizeCombo(k) === normalizeCombo(newCombo))) next.push(newCombo)
      if (persist) persist.remap(commandId, next)
      else command.remapKeys(commandId, next)
      return { ok: true }
    },
    /** 恢复某命令某条键位到默认（默认即注册 keys 中匹配 combo 的原键；该 combo 未 remap 过则 no-op） */
    resetComboToDefault(commandId: string, combo: string): V2RemapResult {
      if (!command.has(commandId)) return { ok: false, notFound: true }
      const defaultKeys = defaults.get(commandId)
      if (!defaultKeys || defaultKeys.length === 0) return { ok: true }
      const cur = command.list().find((c) => c.id === commandId)?.keys ?? []
      const target = defaultKeys.find((k) => normalizeCombo(k) === normalizeCombo(combo))
      if (!target) return { ok: true }
      if (cur.some((k) => normalizeCombo(k) === normalizeCombo(target))) {
        // 已存在该默认键 → 若该行当前即默认则无事；否则说明重复，去重
        return { ok: true }
      }
      const next = [...cur, target]
      if (persist) persist.remap(commandId, next)
      else command.remapKeys(commandId, next)
      return { ok: true }
    },
    /** 全部恢复默认（遍历命令：isRemapped 才 reset；未 remap 跳过） */
    resetDefaults(): void {
      for (const c of command.list()) {
        if (command.isRemapped(c.id)) {
          if (persist) persist.reset(c.id)
          else command.resetKeys(c.id)
        }
      }
    },
    /** 导出脏映射：仅含与默认不同的命令（commandId → 单键串；多键取首个与默认不同者） */
    exportKeymap(): V2KeymapData {
      const out: V2KeymapData = {}
      for (const c of command.list()) {
        const def = defaults.get(c.id)
        const cur = c.keys ?? []
        if (def && def.length && cur.length && JSON.stringify(def) !== JSON.stringify(cur)) {
          out[c.id] = cur[0]
        } else if (!def && cur.length) {
          out[c.id] = cur[0]
        }
      }
      return out
    },
    /** 导入键位映射：commandId → 键位串/数组；冲突项静默跳过（与 v1 loadKeymap 一致） */
    loadKeymap(map: V2KeymapData | Record<string, string[]>): void {
      for (const [id, val] of Object.entries(map)) {
        if (!command.has(id)) continue
        const keys = typeof val === 'string' ? [val] : (val as string[])
        if (conflictOf(id, keys[0] ?? '')) continue
        if (persist) persist.remap(id, [...keys])
        else command.remapKeys(id, [...keys])
      }
    },
  }
}

export type V2ShortcutManager = ReturnType<typeof createV2ShortcutManager>
