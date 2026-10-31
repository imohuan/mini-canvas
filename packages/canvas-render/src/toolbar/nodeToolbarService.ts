/**
 * nodeToolbarService —— 节点上下两根状态栏的「注册表 + 会话」（渲染层基础设施服务）。
 *
 * 用户口径（2026-10-29）：
 * 「这里分为默认模式和一些特殊模式，你注册按钮或者自定义实现这个槽位都可以。
 *   每一套模式都有自己的顶部或底部状态栏。而这个底部状态栏插件只是注册组件到默认模式下的底部状态栏中。」
 *
 * 一句话模型：**卡片上下各有一个固定插槽位，谁往里注册内容、就显示谁的内容。**
 * - 位置（离卡片多远、居中、反缩放）由主题的槽位宿主负责，带主题的偏移配置；
 * - 内容（这一格显示什么面板）由本服务的注册表决定。
 *
 * 三种「模式」没有地位差别：
 * - 默认模式（id = 'default'）：bottom-bar / 节点插件往里注册平时显示的面板；
 * - 功能模式（id = 'image/crop' 等）：裁剪/扩展这种临时接管；
 * - 同一个 id 可以注册**多份**，用 types 区分适用节点类型，用 order 决定谁赢（小者赢）。
 *
 * 关键细节：**顶栏与底栏分开裁决**。图片插件可能只注册 topBar、bottom-bar 只注册 bottomBar，
 * 两份都叫 'default' —— 若按整份注册裁决，后者的「没声明顶栏」会把前者的顶栏顶掉。
 * 所以每一格只在「声明了这一格的注册」之间比 order。
 *
 * 会话是纯 UI 状态：不写节点 data、不进撤销栈（与 cropSession 同一条规矩）。
 */
import { reactive } from 'vue'

/**
 * 一根状态栏的内容声明。三种取值，语义完全不同：
 * - 组件：直接渲染它（收 { id, data } props）；
 * - `null`：这一格**不显示**（模式自己要把某根栏清空时用）；
 * - 字符串：引用**另一个模式 id** 的那一根（如 'default' = 保持默认面板）。
 *
 * 缺省（undefined）= 不接管，沿用默认模式那一格。
 */
export type NodeToolbarBar = unknown | null | string

/** 一份模式注册（注册方提供） */
export interface NodeToolbarMode {
  /** 模式 id。同 id 可注册多份（用 types 区分、order 裁决） */
  id: string
  /** 适用于哪些节点类型；缺省 = 全部 */
  types?: string[]
  /** 显示名（诊断/未来列表用） */
  title?: string
  /** 说明（诊断用） */
  description?: string
  /** 顶栏内容：组件 | null（不显示）| 字符串（引用别的模式 id）| 缺省（沿用 default） */
  topBar?: NodeToolbarBar
  /** 底栏内容：同上 */
  bottomBar?: NodeToolbarBar
  /** 同一 id 内多份注册的裁决：order 小者赢（与主题槽、插槽排序同一套约定） */
  order?: number
}

/** 已解析出来的一格内容：组件 / 不显示 / 没注册 */
export type ResolvedBar =
  | { kind: 'component'; component: unknown }
  | { kind: 'none' }
  | { kind: 'inherit' }

type Side = 'top' | 'bottom'

interface NodeToolbarSession {
  nodeId: string
  modeId: string
}

/** 引用链最多解这么多层（防止 A→B→A 这种注册把自己绕死） */
const MAX_REF_DEPTH = 8

/**
 * NodeToolbarService —— 按服务名 'nodeToolbar' 上架（ctx.provide）。
 * 插件一律 ctx.get('nodeToolbar') / ctx.tryGet('nodeToolbar') 取，不 import 具体实现。
 */
export class NodeToolbarService {
  /** 模式注册表：id → 该 id 下的多份注册（数组顺序 = 注册顺序，裁决时才看 order） */
  private readonly modes = new Map<string, NodeToolbarMode[]>()
  /** 当前会话（同一时刻只有一个节点处于某个模式：两根栏只有一套） */
  private readonly session = reactive<NodeToolbarSession>({ nodeId: '', modeId: '' })

  /**
  /**
   * 注册一份模式。同 id 可多次调用 —— 每次都是一份独立注册，
   * 最终由 (types 是否匹配, order 最小) 裁决；order 相同时后注册者胜（热更友好）。
   *
   * 刻意**不做同 id 去重**：两个不同插件可能都注册 'default'、order 也相同，
   * 它们各自只声明了自己那一根栏（一个只给 topBar、一个只给 bottomBar），
   * 去重会误把其中一份吞掉。顶栏底栏本来就分开裁决（见 declaredOf）。
   */
  registerMode(mode: NodeToolbarMode): void {
    const list = this.modes.get(mode.id)
    if (!list) {
      this.modes.set(mode.id, [mode])
      return
    }
    list.push(mode)
  }

  /** 移除某个 id 的全部注册（插件卸载时由 scope 清理；一般不用手调） */
  unregisterMode(id: string): void {
    this.modes.delete(id)
    if (this.session.modeId === id) this.exit(this.session.nodeId)
  }

  /** 某节点当前处于哪个模式（不在任何模式 = undefined；多份注册时给 order 最小的那份） */
  modeOf(nodeId: string): NodeToolbarMode | undefined {
    if (!this.session.nodeId || this.session.nodeId !== nodeId) return undefined
    return this.pickAny(this.session.modeId, this.typeOf(nodeId))
  }

  /** 某节点是否在某个功能模式里（有会话即 true；默认模式不算「在模式里」） */
  inMode(nodeId: string): boolean {
    return this.session.nodeId === nodeId && this.session.modeId !== ''
  }

  /** 会话上的模式 id（诊断用；不在模式里 = 空串） */
  activeModeId(nodeId: string): string {
    return this.session.nodeId === nodeId ? this.session.modeId : ''
  }

  /**
   * 解析「某个节点、某一根栏」最终该渲染什么。
   *
   * 规则（用户确认的顺序）：
   * 1. 会话里指定的模式若**声明了这一格**（组件 / null / 字符串引用）→ 用它；
   * 2. 没声明（undefined）或根本没进模式 → 回退到 'default' 注册里、同样**声明了这一格**的那份；
   * 3. 还是没有 → inherit（渲染宿主自己的默认内容，兼容老的段注册）。
   */
  resolveBar(nodeId: string, side: Side, type?: string): ResolvedBar {
    const nodeType = type ?? this.typeOf(nodeId)
    const modeId = this.activeModeId(nodeId)
    if (modeId && modeId !== 'default') {
      const declared = this.declaredOf(modeId, nodeType, side)
      if (declared !== undefined) {
        const resolved = this.follow(declared, nodeType, side, 0)
        // undefined = 字符串引用链断了（指向的模式没有这一格）→ 继续往 default 兜底
        if (resolved) return resolved
      }
    }
    const fallback = this.declaredOf('default', nodeType, side)
    if (fallback !== undefined) {
      const resolved = this.follow(fallback, nodeType, side, 0)
      if (resolved) return resolved
    }
    return { kind: 'inherit' }
  }

  /** 列出适用于某节点类型的模式（诊断 / 入口列表用） */
  listModes(filter?: { type?: string }): NodeToolbarMode[] {
    const out: NodeToolbarMode[] = []
    for (const id of this.modes.keys()) {
      const hit = this.pickAny(id, filter?.type)
      if (hit) out.push(hit)
    }
    return out
  }

  /** 进入模式（幂等：已在同一模式则不动） */
  enter(nodeId: string, modeId: string): void {
    if (!nodeId || !this.modes.has(modeId)) return
    if (this.session.nodeId === nodeId && this.session.modeId === modeId) return
    this.session.nodeId = nodeId
    this.session.modeId = modeId
  }

  /** 退出模式（幂等；nodeId 不匹配时忽略 —— 防止误清别的节点的会话） */
  exit(nodeId: string): void {
    if (!this.session.nodeId || (nodeId && this.session.nodeId !== nodeId)) return
    this.session.nodeId = ''
    this.session.modeId = ''
  }

  // —— 内部 ——

  /**
  /**
   * 某 id 下、某节点类型、某一根栏的胜出声明（types 过滤 + order 最小者赢）。
   * **只看声明了这一格的注册** —— 顶栏与底栏互不覆盖。
   * order 相同时后注册者胜（= 热更/后装插件覆盖前一份）。
   */
  private declaredOf(id: string, type: string | undefined, side: Side): NodeToolbarBar | undefined {
    const list = this.modes.get(id)
    if (!list || list.length === 0) return undefined
    let best: NodeToolbarMode | undefined
    for (const m of list) {
      if (type && m.types && !m.types.includes(type)) continue
      if ((side === 'top' ? m.topBar : m.bottomBar) === undefined) continue
      if (!best || (m.order ?? 0) <= (best.order ?? 0)) best = m
    }
    return best ? (side === 'top' ? best.topBar : best.bottomBar) : undefined
  }

  /** 某 id 下、某节点类型 order 最小的那份（诊断/列表用；相同 order 取后注册的） */
  private pickAny(id: string, type: string | undefined): NodeToolbarMode | undefined {
    const list = this.modes.get(id)
    if (!list || list.length === 0) return undefined
    let best: NodeToolbarMode | undefined
    for (const m of list) {
      if (type && m.types && !m.types.includes(type)) continue
      if (!best || (m.order ?? 0) <= (best.order ?? 0)) best = m
    }
    return best
  }

  /**
  /**
   * 解析一格声明：null = 不显示；字符串 = 跟随另一个模式 id 的同一格；其它 = 组件。
   * 返回 undefined = 引用链断掉（调用方继续往 default 兜底）。
   */
  private follow(
    decl: NodeToolbarBar,
    type: string | undefined,
    side: Side,
    depth: number,
  ): ResolvedBar | undefined {
    if (decl === null) return { kind: 'none' }
    if (typeof decl !== 'string') return { kind: 'component', component: decl }
    if (depth >= MAX_REF_DEPTH) return { kind: 'inherit' }
    const nested = this.declaredOf(decl, type, side)
    if (nested === undefined) return undefined
    return this.follow(nested, type, side, depth + 1)
  }

  /** 节点类型：向 doc 现取（不缓存，节点类型变更也跟得上） */
  private typeOf(nodeId: string): string | undefined {
    return this.docPeek?.getNode?.(nodeId)?.type
  }

  /**
   * 取 doc 的读口（apply 里注入）。
   *
   * 为什么是可变字段而不是构造参数：服务由主题插件 new 出来，而单测/组件可能构造裸服务 ——
   * 给一个可注入的读口，单测不必搭整套内核；组件也可以直接传 type 跳过它。
   */
  docPeek: { getNode?(id: string): { type?: string } | undefined } | undefined
}

/** 两份注册的 types 是否等价（同 order 热更覆盖时用） */
function sameTypes(a?: string[], b?: string[]): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((t, i) => t === b[i])
}


