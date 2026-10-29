/**
 * rotateCopy —— 顶栏「旋转与镜像」按钮的真正动作（用户口径 2026-10-30）。
 *
 * 点一下做三件事，原图始终不动：
 * 1. 复制当前图片节点（同一张图、同一尺寸，名字按类型序号重新取）；
 * 2. 原图 → 副本连一条线（源口 source → 目标口 target）；
 * 3. 选中副本，并让**副本**进入 node-rotate/mode。
 *
 * 为什么复制走 doc 事务而不是直接改 store：建节点 + 连边要成为**一次**历史记录，
 * 用户按一次 Ctrl+Z 就整体退回。
 *
 * 为什么进入模式要延迟一拍：新节点刚创建时 VueFlow 还没挂载它的视图，
 * 顶栏按「恰好选中本节点」渲染 —— 同步 enter 会发生在视图挂载前，面板不出现（Chrome 实测）。
 */
import type { Context } from '@mini-canvas/canvas-base'
import { ROTATE_MODE_ID, openRotateMode } from './rotateSession'

/** 副本与原图的横向间隔（原图右缘 + 100，与裁剪/扩展出图的摆法一致） */
const COPY_GAP = 100
/** 量不到原图宽度时的兜底（图片类型的默认宽） */
const FALLBACK_WIDTH = 320

interface NodeLike {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  parentId?: string
  size?: { w: number; h: number }
}

interface DocPort {
  getNode(id: string): NodeLike | undefined
  nextNodeId(): string
  nextTypeName(type: string): string
  transaction<T>(
    reason: string,
    fn: (tx: {
      addNodes(inputs: Array<{
        id: string
        type: string
        position: { x: number; y: number }
        data: Record<string, unknown>
        parentId?: string
        size?: { w: number; h: number }
      }>): number
      connectEdge(input: {
        source: string
        target: string
        sourceHandle?: string
        targetHandle?: string
      }): { status: string }
    }) => T,
  ): T
}

interface SelectionPort {
  set(ids: Iterable<string>): void
}

interface NodeToolbarPort {
  enter?(nodeId: string, modeId: string): void
}

/** 深拷贝节点 data（与剪贴板同一口径：只留普通数据，不与原节点共享引用） */
function cloneData(data: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(data)) as Record<string, unknown>
  } catch {
    return { ...data }
  }
}

/** 正有限数才认（尺寸可能来自脏存档） */
function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/** 原图宽度：正式尺寸 > data 镜像 > 类型默认值 */
function readWidth(node: NodeLike): number {
  return positive(node.size?.w) ?? positive(node.data.cardWidth) ?? FALLBACK_WIDTH
}

/** 进入旋转模式：选中副本 + 本插件会话 + nodeToolbar 会话（面板按两者同时成立才渲染） */
function enterRotateMode(ctx: Context, nodeId: string): void {
  ctx.tryGet<SelectionPort>('selection')?.set([nodeId])
  openRotateMode(nodeId)
  const toolbar = ctx.tryGet<NodeToolbarPort>('nodeToolbar')
  if (!toolbar?.enter) {
    ctx.tryGet<{ show?(text: string): void }>('tip')?.show?.('旋转与镜像：主题状态栏服务不可用')
    return
  }
  toolbar.enter(nodeId, ROTATE_MODE_ID)
}

export interface RotateCopyOptions {
  /** 延迟执行钩子（单测传同步实现；生产用默认的 300ms setTimeout） */
  schedule?: (fn: () => void) => void
}

/**
 * 复制图片节点 → 连到原图 → 副本进入旋转模式。
 *
 * @returns 副本节点 id；不是图片 / 节点不存在 / 事务失败返回 null（调用方提示）
 */
export function duplicateImageForRotate(
  ctx: Context,
  sourceId: string,
  options: RotateCopyOptions = {},
): string | null {
  const doc = ctx.tryGet<DocPort>('doc')
  const source = doc?.getNode(sourceId)
  if (!doc || !source || source.type !== 'image') return null

  const width = readWidth(source)
  const height = positive(source.size?.h) ?? positive(source.data.cardHeight)
  const data = cloneData(source.data)
  // 副本标题标出它是复制出来的（用户截图里的「图片 1-副本」同一心智）：
  // 一眼能分清清哪张是原图；原节点没有标题时才退回类型序号名。
  const label = typeof source.data.label === 'string' ? source.data.label.trim() : ''
  data.label = label ? `${label}-副本` : doc.nextTypeName(source.type)
  const copyId = doc.nextNodeId()
  const position = { x: source.position.x + width + COPY_GAP, y: source.position.y }

  try {
    doc.transaction('rotate-duplicate', (tx) => {
      tx.addNodes([
        {
          id: copyId,
          type: source.type,
          position,
          data,
          ...(source.parentId !== undefined ? { parentId: source.parentId } : {}),
          ...(source.size !== undefined ? { size: { w: source.size.w, h: source.size.h } } : {}),
        },
      ])
      // 原图是上游、副本是下游（与裁剪出图同方向）
      tx.connectEdge({
        source: source.id,
        target: copyId,
        sourceHandle: 'source',
        targetHandle: 'target',
      })
    })
  } catch {
    ctx.tryGet<{ show?(text: string): void }>('tip')?.show?.('旋转与镜像：复制节点失败')
    return null
  }

  // 先选中副本（用户马上看到新的那张）；模式等视图挂载后再进
  ctx.tryGet<SelectionPort>('selection')?.set([copyId])
  const schedule = options.schedule ?? ((fn: () => void) => void setTimeout(fn, 300))
  schedule(() => enterRotateMode(ctx, copyId))
  return copyId
}
