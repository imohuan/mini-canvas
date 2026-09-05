/**
 * themeRegistry —— 画布"外观/UI"注册表（纯逻辑，零 Vue 依赖，Node 可单测）。
 *
 * 定位：宿主把画布的"看得见的部分"抽成可被插件替换的槽位，插件(主题插件)经 registerThemeSlot
 * 把自写 vue 组件填进来顶替默认实现。本表只存 opaque 组件句柄，不 import Vue。
 *
 * 开放插槽语义（对齐 docs/goal/plugin-system-goal.md 目标 A）：
 * - 本表**基于 SlotRegistry**：一个槽(slot)可容纳多个 occupant，各带 { id, order, value }，
 *   order 决定"赢家/渲染序"（小在前）。宿主消费时：
 *     - 单格换肤点(nodeShell/edge/background/…) = single 语义 → 取 `winner(slot)`（order 最小者）。
 *     - 可并列叠加的装饰层 = 取 `occupants(slot)` 按 order 全量渲染。
 * - 热卸某插件只抽走它填的那个 occupant，其它 occupant 原位保留 → 顶替/回退自然成立：
 *   后装的更高优先级(order 更小)组件可一键顶替；默认实现被顶后热卸回退到下一个。
 * - 插件可声明新槽：槽名不限于内置 ThemeSlot 枚举，字符串即可（宿主按需渲染）。
 *
 * 兼容旧单值 API（register/get/unregister/set/has/slots）：
 * 它们读写"默认 occupant(id='default', order=0)"这一格，语义与旧版单格完全一致
 * （register 重复抛错防覆盖、set 覆盖式重设），存量插件/宿主/测试零改动可用。
 */
import { SlotRegistry } from './slotRegistry'
import type { SlotEntry } from './slotRegistry'

/** 内置外观槽位（插件也可声明任意字符串新槽） */
export type ThemeSlot =
  | 'nodeShell'
  | 'edge'
  | 'edgeDefaultType'
  | 'background'
  | 'connectionLine'
  | (string & {})

/** 主题定义：slot → 组件句柄(或字面值如 edgeDefaultType 是 string) */
export type ThemePresentation = Partial<Record<ThemeSlot, unknown>>

/** 放入一个主题槽的请求：value + 可选 id/order（见 SlotAddRequest） */
export interface ThemeOccupantRequest {
  id?: string
  order?: number
  value: unknown
}

/** 单格 API 使用的保留 occupant id */
const DEFAULT_ID = 'default'
const DEFAULT_ORDER = 0

/**
 * 主题/外观注册表（基于 SlotRegistry 的多 occupant 开放槽）。
 * 宿主(demo)与测试都读它决定渲染用哪套组件；插件注册、宿主消费；
 * 热卸插件时其 occupant 自动回退，不影响其它 occupant。
 */
export class ThemeRegistry {
  private reg = new SlotRegistry()

  /** 当前某槽全部 occupant，按 order 稳定排序（装饰层全量渲染用） */
  occupants(slot: ThemeSlot): SlotEntry[] {
    return this.reg.list(slot)
  }

  /** single 赢家：order 最小者（"当前渲染项"）；空槽 undefined */
  winner(slot: ThemeSlot): unknown {
    return this.reg.first(slot)?.value
  }

  /** 放入一个 occupant（多 occupant 语义）。同 id 已存在→替换该格；否则追加。返回 occupant id */
  addOccupant(slot: ThemeSlot, req: ThemeOccupantRequest): string {
    return this.reg.add(slot, { id: req.id ?? DEFAULT_ID, order: req.order ?? DEFAULT_ORDER, value: req.value })
  }

  /** 移除某槽的某个 occupant；不存在 no-op。返回是否真移除 */
  removeOccupant(slot: ThemeSlot, id: string): boolean {
    return this.reg.remove(slot, id)
  }

  /** 某槽已占的 occupant id 列表（诊断/热卸用） */
  occupantIds(slot: ThemeSlot): string[] {
    return this.reg.ids(slot)
  }

  /** 某槽是否存在任意 occupant */
  hasOccupant(slot: ThemeSlot): boolean {
    return this.reg.has(slot)
  }

  // ==================== 兼容单值 API（读写 default occupant） ====================

  /**
   * 注册某槽位的默认组件（occupant id='default'，order=0）。
   * 槽已有 default occupant 抛错（防覆盖，语义同旧版单格）；要多 occupant 请用 addOccupant。
   */
  register(slot: ThemeSlot, value: unknown): void {
    if (this.reg.get(slot, DEFAULT_ID)) {
      throw new Error(`[themeRegistry] theme slot "${slot}" already registered`)
    }
    this.addOccupant(slot, { value })
  }

  /** 取某槽位默认值；未注册返回 undefined（宿主回退默认） */
  get(slot: ThemeSlot): unknown {
    return this.winner(slot)
  }

  /** 注销某槽位默认 occupant；不存在 no-op。 */
  unregister(slot: ThemeSlot): void {
    this.removeOccupant(slot, DEFAULT_ID)
  }

  /** 覆盖式重设某槽位默认 occupant（宿主/主题升级）；未注册则新建 */
  set(slot: ThemeSlot, value: unknown): void {
    this.addOccupant(slot, { id: DEFAULT_ID, value })
  }

  /** 是否已注册某槽位（是否有 default occupant） */
  has(slot: ThemeSlot): boolean {
    return this.hasOccupant(slot)
  }

  /** 已注册的槽位名（任意含 occupant 的槽） */
  slots(): ThemeSlot[] {
    return this.reg.slots()
  }
}
