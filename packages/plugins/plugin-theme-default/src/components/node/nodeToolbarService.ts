/**
 * nodeToolbarService —— 节点「功能模式」注册表 + 会话（主题插件的基础设施服务）。
 *
 * 用户口径（2026-10-29）：
 * 「你应该把这个 nodeToolbar 服务功能给默认主题插件，而不是 bottom-bar 来实现。
 *   在这里分为默认模式和一些特殊模式，你注册按钮或者自定义实现这个槽位都可以。
 *   每一套模式都有自己的顶部或底部状态栏。
 *   底部状态栏插件只是注册组件到默认模式下的底部状态栏中。」
 *
 * 职责边界（重构后的正确分工）：
 * - 本服务（theme-default）：模式的**注册表 + 会话**。模式 = 一套顶栏/底栏组件（可选其一）。
 *   进入模式 → 该节点的顶栏与底栏**整体**切换成该模式的内容（没有第二套栏叠加）。
 * - bottom-bar：**默认模式**的底栏贡献者 —— 它注册的动作列表 / panel 只在默认模式下渲染。
 * - 节点插件（image 等）：声明自己的模式（裁剪/扩展…），进入/退出由自己的入口按钮驱动。
 *
 * 为什么放主题插件：模式决定"节点上下两根栏长什么样"，这属于**默认皮的一部分** ——
 * 换主题时模式系统跟着换；bottom-bar 只是默认皮里"默认模式底栏"的一个实现者。
 *
 * 会话是纯 UI 状态：不写节点 data、不进撤销栈（与 cropSession 同一条规矩）。
 */
import { reactive } from 'vue'

/** 一个模式的声明（注册方提供；顶/底栏组件都可选） */
export interface NodeToolbarMode {
  /** 唯一 id（跨插件约定：插件名/模式名） */
  id: string
  /** 适用于哪些节点类型；缺省 = 全部 */
  types?: string[]
  /** 显示名（诊断/未来 UI 用） */
  title?: string
  /** 模式专属**顶栏**组件（收 { id, data } props）；不提供 = 顶栏保持默认 */
  topBar?: unknown
  /** 模式专属**底栏**组件（收 { id, data } props）；不提供 = 底栏保持默认（bottom-bar 的默认内容） */
  bottomBar?: unknown
  /** 排序（小者在先；仅诊断/未来列表用） */
  order?: number
}

/** 当前会话：哪个节点在哪个模式里（单实例 reactive，服务唯一） */
interface NodeToolbarSession {
  nodeId: string
  modeId: string
}

/**
 * NodeToolbarService —— 按服务名 'nodeToolbar' 上架（ctx.provide）。
 * 组件/插件一律 ctx.get('nodeToolbar') / ctx.tryGet('nodeToolbar') 取，不 import 具体实现。
 */
export class NodeToolbarService {
  /** 模式注册表：id → 声明（同 id 重复注册 = 替换，热更友好） */
  private readonly modes = new Map<string, NodeToolbarMode>()
  /** 当前会话（全局单会话：同一时刻只有一个节点处于某个模式 —— 两根栏只有一套） */
  private readonly session = reactive<NodeToolbarSession>({ nodeId: '', modeId: '' })

  /** 注册一套模式（同 id 替换）。由节点插件 / 任意插件在自己的 apply 里调用 */
  registerMode(mode: NodeToolbarMode): void {
    this.modes.set(mode.id, mode)
  }

  /** 移除一套模式（插件卸载时由 scope 清理；一般不用手调） */
  unregisterMode(id: string): void {
    this.modes.delete(id)
    // 会话正停在这套模式上 → 一并退出（注册方没了，模式不能悬空）
    if (this.session.modeId === id) this.exit(this.session.nodeId)
  }

  /** 某节点当前处于哪个模式（不在任何模式 = undefined） */
  modeOf(nodeId: string): NodeToolbarMode | undefined {
    if (!this.session.nodeId || this.session.nodeId !== nodeId) return undefined
    return this.modes.get(this.session.modeId)
  }

  /** 某节点是否在某个模式里（布尔便捷口） */
  inMode(nodeId: string): boolean {
    return this.session.nodeId === nodeId && this.session.modeId !== ''
  }

  /** 列出适用于某节点类型的模式（诊断 / 未来入口列表用） */
  listModes(filter?: { type?: string }): NodeToolbarMode[] {
    const all = [...this.modes.values()]
    return filter?.type ? all.filter((m) => !m.types || m.types.includes(filter.type!)) : all
  }

  /** 进入模式（幂等：已在同一模式则不动；换模式 = 先出再进） */
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
}
