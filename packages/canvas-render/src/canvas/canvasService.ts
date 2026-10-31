/**
 * CanvasService —— 画布动作的唯一门面（服务名 canvas）。
 *
 * 只做「取服务 → 校验 → 转发」，不缓存任何数据；建节点只有一条路径，
 * 选中/取景/模式/打组/提示/跑底栏动作都收在这里，插件不必各自拼服务。
 *
 * 可缺能力（group / nodeToolbar / nodeTask 属业务插件）一律安静返回
 * undefined / false / null；只有 runBarAction 缺执行器时明确 reject，
 * 因为那是一次用户已经触发的动作，不能假装成功。
 */
import type { Context } from '@mini-canvas/kernel'
import type {
  CanvasActions,
  DocService,
  FitToOptions,
  FocusTarget,
  NodeFactoryService,
  SelectionService,
  ViewContract,
} from '@mini-canvas/canvas-data'
import { createNotifyService, type NotifyOptions, type NotifyService } from './notifyService'
import { canvasRuntime, commandRuntime, type CommandRuntime } from '@mini-canvas/canvas-data'

export type SelectMode = 'replace' | 'add' | 'toggle'

export interface CreateNodeOptions {
  data?: Record<string, unknown>
  sourceNodeId?: string
  gap?: number
}

/** 可选服务的最小形状（缺失时不抛，返回空结果） */
interface GroupLike {
  createGroup(nodeIds: string[]): string | null
  ungroup(groupId: string): void
}

interface NodeToolbarLike {
  enter(nodeId: string, modeId: string): void
  exit(nodeId?: string): void
  activeModeId(nodeId: string): string
}

interface NodeTaskLike {
  run(nodeId: string, actionId: string, input?: unknown): Promise<unknown>
  cancel(nodeId: string): void
}

export class CanvasService {
  /** 通知队列与 canvas 同一生命周期（TipLayer 与面板读同一份） */
  readonly notifications: NotifyService

  constructor(private ctx: Context) {
    this.notifications = createNotifyService()
  }

  private get doc(): DocService | undefined {
    return this.ctx.tryGet<DocService>('doc')
  }

  private get selection(): SelectionService | undefined {
    return this.ctx.tryGet<SelectionService>('selection')
  }

  private get view(): ViewContract | undefined {
    return this.ctx.tryGet<ViewContract>('view')
  }

  /**
   * 建节点：唯一路径。类型未注册 / 服务缺失 → undefined，不抛。
   * sourceNodeId + gap 透传给插件 creator（媒体插件据此放在源节点旁边）。
   */
  createNode(type: string, at: { x: number; y: number }, opts?: CreateNodeOptions): string | undefined {
    const factory = canvasRuntime()?.nodeFactory ?? this.ctx.tryGet<NodeFactoryService>('nodeFactory')
    if (!factory) return undefined
    if (!factory.creatableTypes().includes(type)) return undefined
    const extra = opts ? { ...opts } : undefined
    try {
      return factory.create(type, at, extra)
    } catch {
      return undefined
    }
  }

  /** 可建节点类型清单（菜单枚举用）；缺工厂返回空数组 */
  creatableTypes(): string[] {
    return (canvasRuntime()?.nodeFactory ?? this.ctx.tryGet<NodeFactoryService>('nodeFactory'))?.creatableTypes() ?? []
  }

  /** 选中节点；replace = 整体替换，add = 追加，toggle = 已选则移除 */
  select(ids: string[], mode: SelectMode = 'replace'): void {
    const selection = this.selection
    if (!selection) return
    if (mode === 'replace') selection.set(ids)
    else if (mode === 'toggle') {
      for (const id of ids) {
        if (selection.has(id)) selection.remove(id)
        else selection.add(id)
      }
    } else {
      for (const id of ids) selection.add(id)
    }
  }

  /**
   * 取景：'selection' 先解析当前选中集再交给 view.fitTo；
   * opts.select = true 时先选中目标（fitTo 自己不碰选中，Spec D6）。
   */
  focus(target: FocusTarget, opts?: FitToOptions): boolean {
    const view = this.view
    if (!view) return false
    let resolved: FocusTarget = target
    if (target === 'selection') resolved = [...(this.selection?.ids ?? [])]
    if (opts?.select && Array.isArray(resolved)) this.selection?.set(resolved)
    return view.fitTo(resolved, opts)
  }

  enterMode(nodeId: string, modeId: string): boolean {
    const toolbar = this.ctx.tryGet<NodeToolbarLike>('nodeToolbar')
    if (!toolbar) return false
    try {
      toolbar.enter(nodeId, modeId)
      return true
    } catch {
      return false
    }
  }

  exitMode(nodeId?: string): void {
    this.ctx.tryGet<NodeToolbarLike>('nodeToolbar')?.exit(nodeId)
  }

  activeMode(nodeId: string): string | undefined {
    return this.ctx.tryGet<NodeToolbarLike>('nodeToolbar')?.activeModeId(nodeId) || undefined
  }

  /** 打组；缺 group 服务返回 null */
  group(nodeIds: string[]): string | null {
    const group = this.ctx.tryGet<GroupLike>('group')
    if (!group) return null
    try {
      return group.createGroup(nodeIds)
    } catch {
      return null
    }
  }

  ungroup(groupId: string): void {
    this.ctx.tryGet<GroupLike>('group')?.ungroup(groupId)
  }

  /** 提示：返回撤回函数；空串只清自己的 source */
  notify(message: string, opts?: NotifyOptions): () => void {
    return this.notifications.notify(message, opts)
  }

  /** 跑底栏动作；缺执行器明确 reject（用户动作不能静默成功） */
  async runBarAction(nodeId: string, actionId: string, input?: unknown): Promise<unknown> {
    const task = this.ctx.tryGet<NodeTaskLike>('nodeTask')
    if (!task) throw new Error('[canvas] nodeTask 未安装')
    return task.run(nodeId, actionId, input)
  }

  /** 取消某节点正在跑的动作；缺执行器安静返回 */
  cancelBarAction(nodeId: string): void {
    this.ctx.tryGet<NodeTaskLike>('nodeTask')?.cancel(nodeId)
  }

  // —— 命令（执行入口并入 canvas；command 服务名迁移期保留，Task 9 删） ——

  private get command(): CommandRuntime | undefined {
    return commandRuntime() ?? (canvasRuntime()?.command as CommandRuntime | undefined)
  }

  runCommand(id: string, ...payload: unknown[]): unknown {
    return this.command?.execute(id, ...payload)
  }

  listCommands(): ReturnType<CanvasActions['listCommands']> {
    return this.command?.list() ?? []
  }

  hasCommand(id: string): boolean {
    return this.command?.has(id) ?? false
  }

  remapCommandKeys(id: string, keys: string[]): string[] {
    return this.command?.remapKeys(id, keys) ?? keys
  }

  resetCommandKeys(id: string): string[] | undefined {
    return this.command?.resetKeys(id)
  }

  originalCommandKeys(id: string): string[] | undefined {
    return this.command?.originalKeys(id)
  }

  isCommandRemapped(id: string): boolean {
    return this.command?.isRemapped(id) ?? false
  }
}
