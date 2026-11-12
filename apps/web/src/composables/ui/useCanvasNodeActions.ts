import type { UiHostScope } from './useUiHost'
import type { CanvasTreeScope } from './useCanvasTreeScope'
import type { ViewportLike, ViewportScope } from './useViewportControls'
import type { TreeNode } from './types'

/**
 * 画布树行操作：改名、定位、删除、复制、引用到 Agent、解散分组。
 *
 * 全部走已有服务/命令（doc.setNodeLabel / doc.removeNodes / canvas.runCommand / group.ungroup），
 * 不另写一份数据逻辑。
 */
export function createCanvasNodeActionsScope(
  host: UiHostScope,
  canvasTree: CanvasTreeScope,
  viewport: ViewportScope,
) {
  const { hostCtx, runCommand, showToast } = host
  const { tree } = canvasTree
  const { viewportSvc } = viewport

  function renameNode(id: string, name: string): void {
    const next = name.trim()
    const doc = hostCtx()?.get<{ setNodeLabel?(id: string, label: string | undefined): void }>('doc')
    // 清空 = 恢复类型默认名（与画布标题条双击清空同一语义）；宿主没就绪时无操作。
    doc?.setNodeLabel?.(id, next || undefined)
    // 本地树先跟上，避免落盘/订阅链路的延迟让输入框关掉后名字闪一下旧值
    const walk = (list: TreeNode[]): boolean => {
      for (const n of list) {
        if (n.id === id) { if (next) n.name = next; return true }
        if (n.children && walk(n.children)) return true
      }
      return false
    }
    walk(tree)
  }
  /**
   * 定位到某个节点：把它在画布上居中显示（左侧树点击时用）。
   *
   * 为什么用 view.fitTo 而不是自己改视口：那是渲染层取景的唯一入口，
   * 与缩放 / 适配屏幕走同一条路（缓存与边界面一致）。拿不到坐标（旧节点）就只选中、不移动。
   */
  function locateNode(id: string): void {
    const ctx = hostCtx()
    // 选中节点（居中后给出视觉落点，与「F 聚焦」是同一套取景）。
    // select 服务是渲染层给插件/命令用的选中入口（见 canvas-data selection.ts）；宿主没就绪就跳过。
    const sel = ctx?.get<{ set(ids: string[]): void }>('selection')
    try {
      sel?.set([id])
    } catch {
      /* 选中失败不影响聚焦 */
    }
    const vp = viewportSvc() as
      | (ViewportLike & {
          setCenter?(x: number, y: number, zoom?: number): void
          fitView?(padding?: number, opts?: { nodes?: Array<{ id: string }> }): void
        })
      | undefined
    if (!vp) return
    // 优先「保持当前缩放、只平移」到节点矩形（与搜索/Agent 同一套取景）。
    const view = ctx?.get<{
      fitTo(target: string[], opts?: { keepZoom?: boolean; select?: boolean; padding?: number }): boolean
      getNodeRect?(id: string): { x: number; y: number; w: number; h: number } | null
    }>('view')
    if (!view) return
    const rect = view.getNodeRect?.(id)
    if (view.fitTo([id], { keepZoom: true, select: true })) return
    // 退路只在“没有节点矩形”时走（旧实现同款 padding 0.45）。
    // fitTo 返回 false 也可能是“已经在视口中心、无需移动”；那种情况不能把 zoom 改掉。
    if (!rect) view.fitTo([id], { padding: 0.45 })
  }

  /**
   * 删除一个节点（左侧画布树的行菜单用）。
   *
   * 走 doc.removeNodes：级联清相连边、清子节点父引用、清选中态，并自动进历史 + 落盘
   * （见 canvas-data 的 graphDocument.removeNodes）—— 不自己拼删除步骤。
   */
  function removeNode(id: string): void {
    hostCtx()?.get<{ removeNodes(ids: string[]): number }>('doc')?.removeNodes([id])
  }

  /**
   * 复制一份某个节点（左侧画布树的行菜单用）。
   *
   * 为什么先选中再走 clipboard 命令：复制语义是「复制**选中集**」，命令本身不带节点参数
   * （见 plugin-clipboard 的 duplicate()：它读 selection）。只选中这一个再执行，
   * 结果就是「复制这一份」—— 不重复实现一份复制逻辑（重映射 id / 偏移 / 内外连边那套）。
   *
   * 插件没装时（拿不到 clipboard 服务）静默无操作：菜单项该由**能力是否存在**决定，
   * 但命令是活注册的，这里按「插件没装就没有这件事」处理，与其它可选插件调用一致。
   */
  function duplicateNode(id: string): void {
    const ctx = hostCtx()
    if (!ctx) return
    ctx.get<{ set(ids: Iterable<string>): void }>('selection')?.set([id])
    runCommand('clipboard:duplicate')
  }

  /**
   * 把某个画布节点引用到 Agent 输入框（左侧画布树的行菜单用）。
   *
   * 走 agent 插件已有的 `agent:reference-node` 命令（areas:['node'] 的那条，节点右键菜单同款）：
   * 命令内部只记待插入的节点 id + 打开面板，标签由输入框组件现造 —— 这里不重复那套。
   */
  function referenceNodeToAgent(id: string): void {
    hostCtx()?.get<{ runCommand(id: string, payload?: unknown): unknown }>('canvas')?.runCommand('agent:reference-node', { nodeId: id })
  }

  /** 解散一个分组（左侧画布树的分组行菜单用）：走 group 服务（它自己包历史 + 还原子节点绝对坐标） */
  function ungroupNode(id: string): void {
    const svc = hostCtx()?.get<{ ungroup?(groupId: string): void } | undefined>('group')
    if (!svc?.ungroup) {
      showToast('分组插件未启用')
      return
    }
    svc.ungroup(id)
  }
  return {
    renameNode, locateNode, removeNode, duplicateNode, referenceNodeToAgent, ungroupNode,
  }
}

export type CanvasNodeActionsScope = ReturnType<typeof createCanvasNodeActionsScope>

