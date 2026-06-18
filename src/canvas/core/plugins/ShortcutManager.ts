// ============================================================================
// ShortcutManager — 集中式快捷键管理系统
// ============================================================================

export type ShortcutGroup = 'system' | 'edit' | 'canvas' | 'view' | 'plugin'

/** 快捷键注册条目 */
export interface ShortcutEntry {
  /** 稳定 ID，如 'history.undo' */
  id: string
  /** 人类可读命令名，如 '撤销' */
  command: string
  /** 默认键位，如 'ctrl+z'（小写，统一格式） */
  keys: string
  /** 快捷键触发时的处理函数，支持单个或数组。数组按顺序执行，任一返回 true 则后续跳过。返回 false/void 继续下一个 */
  handler: (() => void | boolean) | (() => void | boolean)[]
  /** 优先级 0-99，越小越高。0=系统, 10=编辑, 20=画布, 30=插件 */
  priority: number
  /** 所属插件 ID */
  pluginId: string
  /** 分组 */
  group: ShortcutGroup
  /** true = 由 VueFlow 等外部系统驱动，ShortcutManager 不执行 handler */
  isSystemManaged?: boolean
}

/** 快捷键帮助列表项（不含 handler，用于 UI 展示） */
export interface ShortcutHelpItem {
  id: string
  command: string
  keys: string
  group: ShortcutGroup
  pluginId: string
  isSystemManaged?: boolean
  priority: number
}

/** 快捷键冲突描述 */
export interface ShortcutConflict {
  /** 冲突的键位字符串 */
  shortcut: string
  /** 冲突的多个 entry */
  entries: ShortcutEntry[]
  /** 是否有高优先级自动胜出（优先级不同则为 true） */
  resolved: boolean
}

/** register() 返回值 */
export type RegisterResult =
  | { ok: true }
  | { ok: false; conflict: ShortcutConflict }

/** remap() 返回值 */
export type RemapResult =
  | { ok: true }
  | { ok: false; conflict: ShortcutConflict }
  | { ok: false; notFound: true }

/** loadKeymap / exportKeymap 使用的 JSON 格式 */
export interface KeymapData {
  [id: string]: string
}

// ============================================================================
// ShortcutManager
// ============================================================================

/**
 * 集中式快捷键管理器（单例）
 *
 * 统一管理所有插件的快捷键注册、冲突检测、键位重映射和导出。
 * 不依赖 Vue，可在任意环境独立使用。
 *
 * @example
 * ```typescript
 * const mgr = ShortcutManager.getInstance()
 * const result = mgr.register({
 *   id: 'history.undo',
 *   command: '撤销',
 *   keys: 'ctrl+z',
 *   handler: () => undo(),
 *   priority: 10,
 *   pluginId: 'history',
 *   group: 'edit',
 * })
 * ```
 */
export class ShortcutManager {
  // ================================================================
  // Singleton
  // ================================================================

  private static _instance: ShortcutManager | null = null

  /** 获取单例实例 */
  static getInstance(): ShortcutManager {
    if (!ShortcutManager._instance) {
      ShortcutManager._instance = new ShortcutManager()
    }
    return ShortcutManager._instance
  }

  /** 重置单例（仅用于测试） */
  static resetInstance(): void {
    ShortcutManager._instance = null
  }

  // ================================================================
  // Internal state
  // ================================================================

  /** entry.id → ShortcutEntry */
  private registry = new Map<string, ShortcutEntry>()

  /** keys → entry.id 快速反向查找 */
  private reverseKeyMap = new Map<string, string>()

  /** entry.id → 注册时的原始 keys（用于 exportKeymap 判断脏映射） */
  private defaultKeys = new Map<string, string>()

  /** 单一 document keydown 监听函数（全局唯一） */
  private listener: ((e: KeyboardEvent) => void) | null = null

  private constructor() { }

  // ================================================================
  // Register / Unregister
  // ================================================================

  /**
   * 注册快捷键
   *
   * - 同 id → 静默覆盖旧注册（键位可能变化）
   * - 同 keys 不同 id → 返回冲突信息，注册失败
   * - 无冲突 → 写入 registry 与 reverseKeyMap
   *
   * @param entry - 快捷键注册条目
   * @returns 注册结果
   */
  register(entry: ShortcutEntry): RegisterResult {
    // Validate input
    if (!entry.id || typeof entry.id !== 'string') {
      throw new Error('ShortcutManager.register: id must be a non-empty string')
    }
    if (!entry.keys || typeof entry.keys !== 'string') {
      throw new Error('ShortcutManager.register: keys must be a non-empty string')
    }
    if (entry.priority < 0 || entry.priority > 99) {
      throw new Error('ShortcutManager.register: priority must be 0-99')
    }

    // Normalize keys
    entry.keys = this.normalizeKeys(entry.keys)

    // 同 id → 静默覆盖
    if (this.registry.has(entry.id)) {
      return this.overwriteEntry(entry)
    }

    // 同 keys 不同 id → 冲突
    if (this.reverseKeyMap.has(entry.keys)) {
      const existingId = this.reverseKeyMap.get(entry.keys)!
      const existing = this.registry.get(existingId)!
      return {
        ok: false,
        conflict: this.buildConflict(entry.keys, existing, entry),
      }
    }

    // 无冲突 → 注册
    this.insertEntry(entry)
    return { ok: true }
  }

  /**
   * 注销快捷键
   *
   * 从 registry 和 reverseKeyMap 中移除，并清理默认键位记录。
   *
   * @param id - 快捷键 ID
   */
  unregister(id: string): void {
    const entry = this.registry.get(id)
    if (!entry) return

    this.reverseKeyMap.delete(entry.keys)
    this.registry.delete(id)
    this.defaultKeys.delete(id)

    if (this.registry.size === 0) {
      this.stopListening()
    }
  }

  // ================================================================
  // Remap
  // ================================================================

  /**
   * 重映射快捷键键位
   *
   * - 新 keys 被其他 entry 占用 → 返回冲突，不生效
   * - 无冲突 → 更新 reverseKeyMap 和 entry.keys
   *
   * @param id - 快捷键 ID
   * @param newKeys - 新的键位字符串
   * @returns 重映射结果
   */
  remap(id: string, newKeys: string): RemapResult {
    const entry = this.registry.get(id)
    if (!entry) {
      return { ok: false, notFound: true }
    }

    // Normalize keys
    newKeys = this.normalizeKeys(newKeys)

    // keys 未变化 → 空操作
    if (entry.keys === newKeys) {
      return { ok: true }
    }

    // 新 keys 被其他 entry 占用 → 冲突
    if (this.reverseKeyMap.has(newKeys)) {
      const existingId = this.reverseKeyMap.get(newKeys)!
      if (existingId !== id) {
        const existing = this.registry.get(existingId)!
        return {
          ok: false,
          conflict: this.buildConflict(newKeys, existing, entry),
        }
      }
    }

    // 更新映射
    this.reverseKeyMap.delete(entry.keys)
    entry.keys = newKeys
    this.reverseKeyMap.set(newKeys, id)
    return { ok: true }
  }

  // ================================================================
  // Import / Export
  // ================================================================

  /**
   * 从 JSON 对象加载键位映射
   *
   * 格式：`{ [id]: keys }`，如 `{ "history.undo": "ctrl+z" }`。
   * 对每个 id，调用 remap() 将其键位更新为指定值。
   * remap 遇到冲突时会静默跳过该项。
   *
   * @param map - 键位映射数据
   */
  loadKeymap(map: KeymapData): void {
    for (const [id, keys] of Object.entries(map)) {
      this.remap(id, keys)
    }
  }

  /**
   * 导出当前键位映射
   *
   * 仅返回与默认键位不同的映射（脏映射）。
   * 返回格式：`{ [id]: keys }`。
   *
   * @returns 被修改过的键位映射
   */
  exportKeymap(): KeymapData {
    const data: KeymapData = {}
    for (const [id, entry] of this.registry) {
      const defaultKey = this.defaultKeys.get(id)
      if (defaultKey !== undefined && entry.keys !== defaultKey) {
        data[id] = entry.keys
      }
    }
    return data
  }

  // ================================================================
  // Defaults
  // ================================================================

  /**
   * 恢复所有快捷键的默认键位
   *
   * 将每个 entry 的 keys 重置为注册时的原始值，
   * 并重新构建 reverseKeyMap。
   */
  resetDefaults(): void {
    // 清空旧映射
    this.reverseKeyMap.clear()

    // 恢复每个 entry 的默认 keys 并重建反向映射
    for (const [id, entry] of this.registry) {
      const defaultKey = this.defaultKeys.get(id)
      if (defaultKey !== undefined) {
        entry.keys = defaultKey
        this.reverseKeyMap.set(defaultKey, id)
      }
    }
  }

  // ================================================================
  // Queries
  // ================================================================

  /**
   * 获取所有快捷键冲突
   *
   * 遍历 registry，找出所有共用同一键位的 entry 组。
   *
   * @returns 冲突列表
   */
  getConflicts(): ShortcutConflict[] {
    // 按 keys 分组收集 entry ids
    const keysToIds = new Map<string, string[]>()
    for (const [id, entry] of this.registry) {
      const ids = keysToIds.get(entry.keys)
      if (ids) {
        ids.push(id)
      } else {
        keysToIds.set(entry.keys, [id])
      }
    }

    // 找出拥有多个 entry 的 keys 组
    const conflicts: ShortcutConflict[] = []
    for (const [keys, ids] of keysToIds) {
      if (ids.length < 2) continue

      const entries = ids
        .map((id) => this.registry.get(id)!)
        .sort((a, b) => a.priority - b.priority)

      const resolved = entries[0].priority !== entries[1].priority

      conflicts.push({
        shortcut: keys,
        entries,
        resolved,
      })
    }

    return conflicts
  }

  /**
   * 获取按分组排列的快捷键帮助列表
   *
   * 每个分组内的 items 按 priority 升序排列（优先级高的在前）。
   * 分组顺序：system → edit → canvas → view → plugin
   *
   * @returns 分组帮助列表
   */
  getHelpList(): { group: ShortcutGroup; items: ShortcutHelpItem[] }[] {
    const groupOrder: ShortcutGroup[] = [
      'system',
      'edit',
      'canvas',
      'view',
      'plugin',
    ]

    const groups = new Map<ShortcutGroup, ShortcutHelpItem[]>()

    for (const [, entry] of this.registry) {
      const items = groups.get(entry.group)
      const helpItem: ShortcutHelpItem = {
        id: entry.id,
        command: entry.command,
        keys: entry.keys,
        group: entry.group,
        pluginId: entry.pluginId,
        isSystemManaged: entry.isSystemManaged,
        priority: entry.priority,
      }
      if (items) {
        items.push(helpItem)
      } else {
        groups.set(entry.group, [helpItem])
      }
    }

    // 在每个分组内按 priority 排序
    for (const [, items] of groups) {
      items.sort((a, b) => a.priority - b.priority)
    }

    // 按 groupOrder 输出
    const result: { group: ShortcutGroup; items: ShortcutHelpItem[] }[] = []
    for (const g of groupOrder) {
      const items = groups.get(g)
      if (items && items.length > 0) {
        result.push({ group: g, items })
      }
    }

    return result
  }

  /**
   * 获取当前注册的快捷键总数
   *
   * @returns registry.size
   */
  getEntryCount(): number {
    return this.registry.size
  }

  /**
   * 销毁管理器，停止监听并清空所有注册数据
   *
   * 用于插件系统卸载时完全清理。
   */
  destroy(): void {
    this.stopListening()
    this.registry.clear()
    this.reverseKeyMap.clear()
    this.defaultKeys.clear()
  }

  // ================================================================
  // Internal helpers
  // ================================================================

  /**
   * 将 entry 写入 registry 和 reverseKeyMap，记录默认键位
   */
  private insertEntry(entry: ShortcutEntry): void {
    this.registry.set(entry.id, entry)
    this.reverseKeyMap.set(entry.keys, entry.id)
    this.defaultKeys.set(entry.id, entry.keys)
    this.startListening()
  }

  /**
   * 静默覆盖已存在的同 id entry
   *
   * 移除旧键位的反向映射，按新 entry 重新写入。
   */
  private overwriteEntry(entry: ShortcutEntry): RegisterResult {
    const old = this.registry.get(entry.id)!

    // 清除旧 keys 的反向映射
    if (old.keys !== entry.keys) {
      this.reverseKeyMap.delete(old.keys)

      // 检查新 keys 是否被其他 entry 占用
      if (this.reverseKeyMap.has(entry.keys)) {
        const existingId = this.reverseKeyMap.get(entry.keys)!
        if (existingId !== entry.id) {
          const existing = this.registry.get(existingId)!
          // Restore old reverse mapping before returning conflict
          this.reverseKeyMap.set(old.keys, entry.id)
          return {
            ok: false,
            conflict: this.buildConflict(entry.keys, existing, entry),
          }
        }
      }
    }

    this.registry.set(entry.id, entry)
    this.reverseKeyMap.set(entry.keys, entry.id)
    // Only set defaultKeys if not already set for this id
    if (!this.defaultKeys.has(entry.id)) {
      this.defaultKeys.set(entry.id, entry.keys)
    }
    return { ok: true }
  }

  /**
   * 构建 ShortcutConflict 对象
   *
   * resolved 为 true 表示两个 entry 的优先级不同（存在明确的胜出方）。
   */
  private buildConflict(
    shortcut: string,
    existing: ShortcutEntry,
    incoming: ShortcutEntry,
  ): ShortcutConflict {
    return {
      shortcut,
      entries: [existing, incoming],
      resolved: existing.priority !== incoming.priority,
    }
  }

  /**
   * 规范化快捷键键位字符串
   *
   * 转小写并移除所有空白字符，确保 "ctrl+z" 和 "ctrl+Z"、"ctrl + z" 等变体统一处理。
   */
  private normalizeKeys(keys: string): string {
    return keys.toLowerCase().replace(/\s+/g, '')
  }

  // ================================================================
  // Keydown listener
  // ================================================================

  /**
   * 键盘事件键名映射表
   *
   * 将用户友好的键名（如 'escape'、'arrowup'）映射到 KeyboardEvent.key 值。
   */
  private static readonly keyEventMap: Record<string, string> = {
    ctrl: 'Control',
    shift: 'Shift',
    alt: 'Alt',
    meta: 'Meta',
    enter: 'Enter',
    escape: 'Escape',
    space: ' ',
    backspace: 'Backspace',
    delete: 'Delete',
    tab: 'Tab',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    plus: '+',
    minus: '-',
    equal: '=',
  }

  /**
   * 将快捷键字符串解析为 KeyboardEvent 匹配条件
   *
   * 支持格式：
   * - 单键：'a', 'enter', 'escape'
   * - 组合键：'ctrl+s', 'ctrl+shift+z', 'cmd+k'（macOS meta）
   * - 含 + 的按键：'ctrl+plus'（Ctrl 加 + 号）
   *
   * 注意：调用方需确保 keys 已经过 normalizeKeys() 处理（小写+去空格）。
   *
   * @param keys - 已 normalization 的快捷键字符串
   * @returns KeyboardEvent 修饰键与按键匹配条件
   */
  private parseShortcut(keys: string): {
    ctrlKey: boolean
    shiftKey: boolean
    altKey: boolean
    metaKey: boolean
    key: string
  } {
    const normalized = keys.replace(/\bcmd\b/g, 'meta')
    const parts = normalized.split('+')
    const modifierSet = new Set(['ctrl', 'shift', 'alt', 'meta'])
    const modifierParts = parts.filter(p => modifierSet.has(p))
    const keyParts = parts.filter(p => !modifierSet.has(p))
    const ctrlKey = modifierParts.includes('ctrl')
    const shiftKey = modifierParts.includes('shift')
    const altKey = modifierParts.includes('alt')
    const metaKey = modifierParts.includes('meta')

    const keyPart = keyParts.join('+') || parts[parts.length - 1]
    const resolvedKey = ShortcutManager.keyEventMap[keyPart] ?? keyPart

    return {
      ctrlKey,
      shiftKey,
      altKey,
      metaKey,
      key: resolvedKey.length === 1 ? resolvedKey : resolvedKey.toLowerCase(),
    }
  }

  /**
   * 启动全局 keydown 监听
   *
   * 当 registry 非空且 listener 不存在时创建。
   * 遍历所有已注册快捷键，匹配按键后执行 handler。
   * 输入框内不触发，handler 异常不影响其他快捷键。
   */
  private startListening(): void {
    if (this.registry.size === 0 || this.listener) return

    this.listener = (e: KeyboardEvent) => {
      // 跳过输入框
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // 遍历所有已注册快捷键
      for (const [keys, id] of this.reverseKeyMap) {
        const parsed = this.parseShortcut(keys)

        const keyMatches = e.key.toLowerCase() === parsed.key.toLowerCase()
        if (
          keyMatches &&
          e.ctrlKey === parsed.ctrlKey &&
          e.shiftKey === parsed.shiftKey &&
          e.altKey === parsed.altKey &&
          e.metaKey === parsed.metaKey
        ) {
          const entry = this.registry.get(id)
          if (entry && !entry.isSystemManaged) {
            let handled = false
            const handlers = Array.isArray(entry.handler) ? entry.handler : [entry.handler]
            for (const h of handlers) {
              try {
                const result = h()
                if (result === true) { handled = true; break }
              } catch (err) {
                console.error(`ShortcutManager: handler error for "${keys}" (${id}):`, err)
                handled = true; break
              }
            }
            if (handled) {
              e.preventDefault()
              e.stopPropagation()
            }
          }

          // 只触发第一个匹配的快捷键
          break
        }
      }
    }

    document.addEventListener('keydown', this.listener)
  }

  /**
   * 停止全局 keydown 监听并清理 listener
   */
  private stopListening(): void {
    if (!this.listener) return

    document.removeEventListener('keydown', this.listener)
    this.listener = null
  }
}
