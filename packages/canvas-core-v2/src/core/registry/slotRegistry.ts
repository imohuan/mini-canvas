/**
 * SlotRegistry —— 画布"多 occupant UI 槽"容器（纯逻辑，零 Vue，Node 可单测）。
 *
 * 目的（见 docs/goal/plugin-system-goal.md 目标 1）：把 themeRegistry/nodeRegistry 从"单格 map、一个槽只能
 * 填一个组件、重复抛错"升级成"一个槽可容纳多个 occupant、按 order 排序、按 id 增量添加或显式替换"。
 *
 * 语义（对齐 dsh slots 的 subset，不做全套 cardinality）：
 * - 每个槽(slot)可挂多个 occupant。
 * - occupant 带 { id, order, value }：id 决定"同一槽内唯一身份"，order 决定渲染顺序（小在前）。
 * - 三种放入方式：
 *   - `add`    同槽加一个新的 occupant（默认叠加多个）。
 *   - `replace`同槽内复用已占的 id = 替换该 occupant（显式换皮/升级）。
 *   - `single` 槽语义 = 该槽只保留 order 最小的一个（宿主按需取，用于 nodeShell/edge 这类"单赢家"换肤点）。
 *   注：是否按 single 只取赢家，由消费方(渲染层)决定；本容器一律可多存，只是暴露 single() 便捷取法。
 * - 移除一个 occupant 不影响同槽其它 occupant（热卸某插件只抽走它填的那份）。
 *
 * scope 回收：返回的 revoke 应由调用方登记进插件 scope（registerThemeSlot 那套既有模式复用）。
 */

/** 一个 occupant：id 槽内唯一、order 控制排序、value 为 opaque 组件句柄或字面值 */
export interface SlotEntry {
  id: string
  order: number
  value: unknown
}

/** 放入同 slot 的请求：若带 id 且已存在 → 替换；否则追加（同 order 按放入先后稳定） */
export interface SlotAddRequest {
  id?: string
  order?: number
  value: unknown
}

/** 槽名 = 字符串；主题/节点槽名沿用现有 ThemeSlot / NodeSegment 的语义字符串，不强制枚举 */
export type SlotName = string

/**
 * 多 occupant 槽容器。纯逻辑、零 Vue。可按需由主题/节点注册表持有，也可独立使用。
 * 提供三种读取视图：
 * - list(slot)        全部 occupant（按 order 稳定排好）
 * - first(slot)       single 语义的"赢家"（order 最小者；空槽 undefined）
 * - get(slot, id)     按 id 精确取（replace/查找用）
 */
export class SlotRegistry {
  /** slot -> Map<id, entry>，保序用数组辅助排序 */
  private bySlot = new Map<SlotName, Map<string, SlotEntry>>()

  /**
   * 放入一个 occupant。
   * - 未给 id：自动分配一个稳定 id（槽内唯一，形如 `${slot}#${n}`）。
   * - 给了 id 且槽内已存在：替换该 id 的 occupant（不新增）。
   * - 否则追加。
   * @returns 该 occupant 的 id（供 remove 用）
   */
  add(slot: SlotName, req: SlotAddRequest): string {
    const entries = this.ensure(slot)
    const id = req.id ?? this.genId(slot)
    const order = req.order ?? entries.size
    // 复用已占 id → 替换；否则新建
    const existed = entries.get(id)
    entries.set(id, existed ? { ...existed, order, value: req.value } : { id, order, value: req.value })
    return id
  }

  /** 移除某槽的某个 occupant；不存在 no-op。返回是否真移除。 */
  remove(slot: SlotName, id: string): boolean {
    const entries = this.bySlot.get(slot)
    if (!entries) return false
    const ok = entries.delete(id)
    if (entries.size === 0) this.bySlot.delete(slot) // 槽空则回收
    return ok
  }

  /** 某槽全部 occupant，按 order 稳定排序（同 order 保放入序） */
  list(slot: SlotName): SlotEntry[] {
    const entries = this.bySlot.get(slot)
    if (!entries) return []
    return [...entries.values()].sort((a, b) => a.order - b.order)
  }

  /** single 语义：order 最小者（"替换/单赢家"槽的当前渲染项）；空槽 undefined */
  first(slot: SlotName): SlotEntry | undefined {
    const l = this.list(slot)
    return l[0]
  }

  /** 按 id 精确取某 occupant；不存在 undefined */
  get(slot: SlotName, id: string): SlotEntry | undefined {
    return this.bySlot.get(slot)?.get(id)
  }

  /** 某槽是否存在任意 occupant */
  has(slot: SlotName): boolean {
    return this.bySlot.has(slot) && (this.bySlot.get(slot)?.size ?? 0) > 0
  }

  /** 当前所有槽名 */
  slots(): SlotName[] {
    return [...this.bySlot.keys()]
  }

  /** 清空某槽全部 occupant */
  clear(slot: SlotName): void {
    this.bySlot.delete(slot)
  }

  /** 槽内已占 id 集合（诊断/列表用） */
  ids(slot: SlotName): string[] {
    return [...(this.bySlot.get(slot)?.keys() ?? [])]
  }

  private ensure(slot: SlotName): Map<string, SlotEntry> {
    let m = this.bySlot.get(slot)
    if (!m) {
      m = new Map()
      this.bySlot.set(slot, m)
    }
    return m
  }

  private genId(slot: SlotName): string {
    // 槽内自增序号，保证唯一且稳定（连续 remove/add 不撞）
    let n = (this.bySlot.get(slot)?.size ?? 0)
    let id = `${slot}#${n}`
    while (this.bySlot.get(slot)?.has(id)) {
      n++
      id = `${slot}#${n}`
    }
    return id
  }
}
