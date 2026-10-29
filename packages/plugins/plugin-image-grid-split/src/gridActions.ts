/**
 * gridActions —— 宫格切分的“落图”动作（切片、建节点、创建分镜组）。
 *
 * 与 gridLogic 的分工：本文件只做**有副作用**的编排（读写 store / 资源库 / 媒体创建器），
 * 几何与槽位计算全部在 gridLogic。这样纯逻辑可以在 Node 里单测，浏览器相关部分可替换注入。
 *
 * 数据铁律：切片字节先经 resources.put → 拿 resourceId；图片节点只写 resourceId，
 * 分镜组槽位也只存 resourceId，绝不把 blob:/data: 地址写进节点长期字段。
 */
import type { DocService } from '@mini-canvas/canvas-data'
import type { MediaKindCreator } from '@mini-canvas/canvas-render'
import {
  publishLayout,
  readStoryboardSlots,
  storyboardLayout,
  STORYBOARD_NODE_TYPE,
  slotResourceIds,
  type GridCell,
  type StoryboardSlot,
} from './gridLogic'

/** 依赖注入：组件/命令侧传生产实现，单测传假实现 */
export interface GridActionDeps {
  doc: Pick<DocService, 'getNode' | 'getNodes' | 'transaction' | 'createNode' | 'updateNode' | 'removeNodes'>
  /** 资源库：存字节 → 持久引用；缺省 = 当前宿主没有资源库，切片无法保存 */
  resources?: {
    put(blob: Blob, opts?: { kind?: string; name?: string }): Promise<string>
  }
  /** 媒体创建器（image → 图片插件） */
  mediaCreator?: Pick<MediaKindCreator, 'addNode'>
  /** 切片实现：默认浏览器 canvas；单测注入假切片 */
  sliceImage?: (source: string, cell: GridCell) => Promise<{ blob: Blob; width: number; height: number } | null>
  /** 读取源图真实尺寸：不从 image 节点卡片的显示尺寸猜 */
  measureImage?: (source: string) => Promise<{ width: number; height: number } | null>
  /** 显示给用户的失败原因（组件可接到主题 toast；缺省 console.warn） */
  notify?: (message: string, level?: 'error' | 'info') => void
}

export interface SliceFailure {
  cell: GridCell
  reason: string
}

export interface PublishResult {
  imageNodeIds: string[]
  groupId: string
  failures: SliceFailure[]
}

export interface StoryboardCreateResult {
  nodeId: string
  written: number
  failures: SliceFailure[]
}

function report(deps: GridActionDeps, message: string, level: 'error' | 'info' = 'error'): void {
  if (deps.notify) deps.notify(message, level)
  else if (typeof console !== 'undefined') console.warn('[image-grid-split] ' + message)
}

/**
 * 用浏览器 canvas 切一格；像素坐标已经是原图像素（gridLogic 会保证边界相接）。
 * 跨域图片需要宿主/资源库给同源地址；这里不偷偷改 CORS 策略。
 */
export async function canvasSlice(
  source: string,
  cell: GridCell,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null
  if (cell.width <= 0 || cell.height <= 0) return null
  const img = await loadImage(source)
  if (!img) return null
  const canvas = document.createElement('canvas')
  canvas.width = cell.width
  canvas.height = cell.height
  const c2d = canvas.getContext('2d')
  if (!c2d) return null
  try {
    c2d.drawImage(img.element, cell.x, cell.y, cell.width, cell.height, 0, 0, cell.width, cell.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob || blob.size === 0) return null
    return { blob, width: cell.width, height: cell.height }
  } finally {
    img.release()
  }
}

/** 默认量源图：优先 naturalWidth/naturalHeight（原图像素数） */
export async function measureImage(source: string): Promise<{ width: number; height: number } | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null
  const img = await loadImage(source)
  if (!img) return null
  try {
    const width = img.element.naturalWidth || img.element.width
    const height = img.element.naturalHeight || img.element.height
    return width > 0 && height > 0 ? { width, height } : null
  } finally {
    img.release()
  }
}

interface LoadedImage {
  element: HTMLImageElement
  release(): void
}

function loadImage(source: string): Promise<LoadedImage | null> {
  return new Promise((resolve) => {
    const img = new Image()
    // 资源库给的是同源 objectURL / 受控路由；跨域外链仍需要服务器放 CORS，不在插件里绕过
    img.decoding = 'async'
    img.onload = () => resolve({ element: img, release: () => { img.onload = null; img.onerror = null; img.src = '' } })
    img.onerror = () => resolve(null)
    img.src = source
  })
}

/** 把一组格子切成资源（保持顺序），失败项逐条记录，不伪装成成功 */
export async function sliceCells(
  deps: GridActionDeps,
  source: string,
  cells: readonly GridCell[],
  namePrefix: string,
): Promise<{
  slices: Array<{ cell: GridCell; resourceId: string; width: number; height: number; name: string }>
  failures: SliceFailure[]
}> {
  const slices: Array<{ cell: GridCell; resourceId: string; width: number; height: number; name: string }> = []
  const failures: SliceFailure[] = []
  if (!deps.resources) {
    for (const cell of cells) failures.push({ cell, reason: '当前画布没有资源库，切图无法保存' })
    return { slices, failures }
  }
  const slice = deps.sliceImage ?? canvasSlice
  for (const cell of cells) {
    const made = await slice(source, cell)
    if (!made) {
      failures.push({ cell, reason: '这一格切片失败（图片地址不可读或浏览器不支持）' })
      continue
    }
    try {
      const resourceId = await deps.resources.put(made.blob, { kind: 'image', name: `${namePrefix} ${cell.row + 1}-${cell.col + 1}.png` })
      slices.push({ cell, resourceId, width: made.width, height: made.height, name: `${namePrefix} ${cell.row + 1}-${cell.col + 1}` })
    } catch (err) {
      failures.push({ cell, reason: '切片已生成但保存失败：' + errorText(err) })
    }
  }
  return { slices, failures }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 发布到画布：切片 → 图片节点 → 普通分组。
 *
 * 所有节点一次事务插入，于是 Ctrl+Z 一次退掉整次发布；资源保存发生在事务前
 * （资源库不是图数据的一部分，无法纳入撤销）。若事务失败，切片资源由资源回收在落盘时处理。
 */
export async function publishGrid(
  deps: GridActionDeps,
  input: {
    source: string
    cells: readonly GridCell[]
    selected: ReadonlySet<string>
    origin: { x: number; y: number }
    namePrefix?: string
  },
): Promise<PublishResult> {
  const layout = publishLayout(input.cells, input.selected, input.origin, { namePrefix: input.namePrefix })
  if (layout.length === 0) return { imageNodeIds: [], groupId: '', failures: [] }
  const { slices, failures } = await sliceCells(deps, input.source, layout.map((l) => l.cell), input.namePrefix ?? '宫格图片')
  if (slices.length === 0) {
    report(deps, '没有生成任何图片，无法发布到画布')
    return { imageNodeIds: [], groupId: '', failures }
  }
  if (!deps.mediaCreator) {
    report(deps, '图片插件没有提供创建器，无法在画布上建图片节点')
    return { imageNodeIds: [], groupId: '', failures }
  }
  const byCell = new Map(slices.map((s) => [`${s.cell.row}:${s.cell.col}`, s]))
  const imageNodeIds: string[] = []
  deps.doc.transaction('grid-split-publish', (tx) => {
    // 先把图建出来（通过媒体创建器 → 图片插件自己写 resourceId/尺寸，调用方不拼内部字段）
    for (const item of layout) {
      const s = byCell.get(`${item.cell.row}:${item.cell.col}`)
      if (!s) continue
      const id = deps.mediaCreator!.addNode?.({
        kind: 'image',
        resourceId: s.resourceId,
        position: { x: item.x, y: item.y },
        nodeType: 'image',
        meta: { name: item.name, width: item.width, height: item.height },
      })
      if (typeof id === 'string' && id) imageNodeIds.push(id)
    }
    void tx
  })
  return { imageNodeIds, groupId: '', failures }
}

/** 图片节点 + 普通分组的组合动作：创建顺序必须是图片落图后，group 服务才能算包围盒 */
export async function publishGridAndGroup(
  deps: GridActionDeps,
  input: {
    source: string
    cells: readonly GridCell[]
    selected: ReadonlySet<string>
    origin: { x: number; y: number }
    namePrefix?: string
    groupOf: (ids: string[]) => string | null
  },
): Promise<PublishResult> {
  const result = await publishGrid(deps, input)
  if (result.imageNodeIds.length < 2) return result
  const groupId = input.groupOf(result.imageNodeIds)
  return { ...result, groupId: groupId ?? '' }
}

/**
 * 创建分镜组：一次事务内建容器 + 把所有槽位图切成资源。
 * 图片先保存成资源，再由容器统一持有 slots 与隐藏的 resourceId 引用清单。
 */
export async function createStoryboard(
  deps: GridActionDeps,
  input: {
    source: string
    cells: readonly GridCell[]
    selected: ReadonlySet<string>
    rows: number
    cols: number
    origin: { x: number; y: number }
    namePrefix?: string
    cellWidth?: number
    cellHeight?: number
  },
): Promise<StoryboardCreateResult> {
  const cells = input.cells.filter((c) => input.selected.has(`${c.row}:${c.col}`))
  if (cells.length === 0) return { nodeId: '', written: 0, failures: [] }
  const { slices, failures } = await sliceCells(deps, input.source, cells, input.namePrefix ?? '宫格分镜')
  if (slices.length === 0) {
    report(deps, '没有生成任何分镜图片，无法创建分镜组')
    return { nodeId: '', written: 0, failures }
  }
  const layout = storyboardLayout(input.rows, input.cols, input.cellWidth ?? 320, input.cellHeight ?? 240)
  const slots: (StoryboardSlot | null)[] = Array.from({ length: input.rows * input.cols }, () => null)
  for (const s of slices) {
    const idx = s.cell.row * input.cols + s.cell.col
    if (idx < 0 || idx >= slots.length) continue
    slots[idx] = {
      resourceId: s.resourceId,
      name: s.name,
      width: s.width,
      height: s.height,
    }
  }
  const nodeId = deps.doc.transaction('grid-split-storyboard', (tx) =>
    tx.createNode(STORYBOARD_NODE_TYPE, input.origin, {
      rows: input.rows,
      cols: input.cols,
      slots,
      // 隐藏引用清单：宿主资源回收只认几个固定 data 字段，槽位数组里的引用必须登记到这里。
      // 见 docs 里 ImageGridSplit 的说明；不要把它当 UI 字段读。
      storyboardResourceIds: slotResourceIds(slots),
      gridCellWidth: layout.cellWidth,
      gridCellHeight: layout.cellHeight,
    }),
  )
  return { nodeId, written: slices.length, failures }
}

/** 让分镜组的资源引用清单跟随槽位变化（只存槽位图 id，不伪造主图字段） */
export function storyboardPatchWithSlots(
  slots: readonly (StoryboardSlot | null)[],
): Record<string, unknown> {
  return {
    slots: [...slots],
    storyboardResourceIds: slotResourceIds(slots),
  }
}

/** 读分镜组槽位（节点 data 容错；长度按 rows×cols 补齐） */
export function storyboardSlotsOf(data: Record<string, unknown> | undefined): (StoryboardSlot | null)[] {
  const rows = typeof data?.rows === 'number' ? data.rows : 0
  const cols = typeof data?.cols === 'number' ? data.cols : 0
  return readStoryboardSlots(data?.slots, Math.max(0, rows * cols))
}

