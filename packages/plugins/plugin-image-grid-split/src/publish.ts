/**
 * publish —— 宫格切分的落库层：切片字节 → 资源库 → 图片节点 / 分镜组。
 *
 * 与 videoOps.persist 同一条路（不退回 base64 / objectURL 写进 data）：
 * 每格 canvas.toBlob 后经 resources.put 拿持久引用，再按用途建目标：
 * - canvas：直接建图片节点，再 group.createGroup 打包；
 * - storyboard：建一个分镜组节点（storyboard 类型，槽位数 = 行×列），
 *   切片按槽位号写进槽（槽位号 = 格子索引）。
 *
 * 纯 DOM/服务编排，不碰会话状态（publishing 锁由调用方管）。
 */
import type { Context } from '@mini-canvas/canvas-base'
import { mediaCapabilityOf } from '@mini-canvas/canvas-render'
import { uniformGridPositions, toPixelRect, unitCells } from './gridSplit'
import { DEFAULT_IMAGE_LIMITS, fitCardSize, fitImageLimits, type ImageFitLimitsLike } from './imageFitBridge'
import { placeStoryboardAt, readStoryboardLayout, slotRects, storyboardContentSize } from './storyboard'
import { centerInsideSlot, fitInsideSlot } from './storyboardDrag'

/** 图片节点宽高比（先看原图分辨率，再看节点尺寸，最后 4:3） */
function aspectOfNode(node: { size?: { w: number; h: number }; data?: Record<string, unknown> }): number {
  const d = node.data ?? {}
  const iw = typeof d.imageWidth === 'number' ? d.imageWidth : 0
  const ih = typeof d.imageHeight === 'number' ? d.imageHeight : 0
  if (iw > 0 && ih > 0) return iw / ih
  const w = node.size?.w ?? 0
  const h = node.size?.h ?? 0
  if (w > 0 && h > 0) return w / h
  return 4 / 3
}

/** 画布默认格宽：与图片节点默认卡片宽一致（320），视觉上就是"一排小图" */
const PUBLISH_CELL_W = 320
/** 发布组的画布间距 */
const PUBLISH_GAP = 12
/** 发布到画布时第一格与源图之间的最小间距（与图片裁剪同一套：右缘 + 100） */
const PUBLISH_SOURCE_GAP = 100

/** 宿主需要提供的服务形状（按名取，不 import 具体实现） */
interface PublishDeps {
  /** 宿主上下文（分镜组落点用：doc / nodeLayout / viewport 按名取） */
  ctx: Context
  /** 读节点 data */
  getNodeData(id: string): Record<string, unknown> | undefined
  /** 读节点画布绝对矩形（含尺寸） */
  getNodeRect(id: string): { x: number; y: number; w: number; h: number } | undefined
  /** 存资源字节 → 持久引用 */
  putBlob(blob: Blob, name: string): Promise<string | undefined>
  /** 持久引用 → 可显示地址（失败时建节点的兜底显示） */
  resolveRef(ref: string): Promise<string | undefined>
  /** 按引用建图片节点；两条入口都不可用返回 null */
  addImageNodeFromResource(position: { x: number; y: number }, ref: string, meta?: { name?: string; width?: number; height?: number; sourceNodeId?: string; gap?: number }): string | null
  /** 打组（全部或空返回 null） */
  createGroup(ids: string[]): string | null
  /** 建任意类型节点（分镜组用）；失败返回 null */
  createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string | null
  /** 写节点尺寸（uniformGridPositions 的行/列宽高要与实际卡片一致） */
  setNodeSize(id: string, size: { w: number; h: number }): void
  /**
   * 连一条边（源 → 新节点）。**每个新建的图片节点都要连**（用户口径 2026-10-30：
   * "点击按钮后，不管创建了多少个新节点，都需要把它们连接到我当前的这个节点"）。
   *
   * 为什么单独开一条而不是只靠 addImageNodeFromResource 的 sourceNodeId：
   * 那条只在**第一次建节点**时用来算落点，后续格子走的是相对偏移（origin + pos），
   * 拿不到 sourceNodeId 就不会连边 —— 之前只有第一张图有连线正是这个原因。
   * 重复连线由 connectEdge 自己幂等（status = duplicate），不必在这里判重。
   */
  connectEdge(sourceId: string, targetId: string): void
}

/** 从 ctx 组装发布依赖（服务缺失时各调用方自己兜底） */
export function publishDepsOf(ctx: Context): PublishDeps | null {
  const doc = ctx.tryGet<{
    getNode(id: string): { data?: Record<string, unknown> } | undefined
    transaction<T>(reason: string, fn: (tx: { createNode(type: string, p: { x: number; y: number }, d?: Record<string, unknown>): string }) => T): T
    updateNode?(id: string, patch: Record<string, unknown>): unknown
    connectEdge?(input: { source: string; target: string; sourceHandle?: string; targetHandle?: string }): { status?: string } | undefined
  } | undefined>('doc')
  const layout = ctx.tryGet<{ getNodeRect(id: string): { x: number; y: number; w: number; h: number } | undefined } | undefined>('nodeLayout')
  const resources = ctx.tryGet<{ put(b: Blob, o?: { kind?: string; name?: string }): Promise<string>; resolve(r: string): Promise<string | undefined> } | undefined>('resources')
  if (!doc) return null

  const imageService = () =>
    ctx.tryGet<{
      addImageNodeFromResource?(position: { x: number; y: number }, resourceId: string, meta?: { name?: string; width?: number; height?: number }): string
    }>('image')
  /**
   * media 是能力（registryOf('capability')），不是服务 —— `tryGet('media')` 永远 undefined。
   * 以前这里取不到就会掉到 image 服务的旧入口，统一落点与连线都不会生效。
   */
  const media = () => mediaCapabilityOf(ctx as never)
  const group = () =>
    ctx.tryGet<{ createGroup?(ids: string[]): string | null }>('group')

  return {
    ctx: ctx as Context,
    getNodeData: (id) => doc.getNode(id)?.data,
    getNodeRect: (id) => {
      const rect = layout?.getNodeRect(id)
      if (rect && rect.w > 0 && rect.h > 0) return rect
      return undefined
    },
    putBlob: async (blob, name) => {
      if (!resources) return undefined
      try {
        return await resources.put(blob, { kind: 'image', name })
      } catch {
        return undefined
      }
    },
    resolveRef: async (ref) => {
      if (!resources) return undefined
      try {
        return await resources.resolve(ref)
      } catch {
        return undefined
      }
    },
    addImageNodeFromResource: (position, ref, meta) => {
      // 与 videoOps 同一条双入口：media 能力优先，image 服务回退，两个都试过才判失败
      const capability = media()
      if (typeof capability?.addNode === 'function') {
        try {
          const id = capability.addNode('image', ref, position, {
            nodeType: 'image',
            meta,
            ...(meta?.sourceNodeId ? { sourceNodeId: meta.sourceNodeId } : {}),
            ...(meta?.gap !== undefined ? { gap: meta.gap } : {}),
          })
          if (id) return id
        } catch {
          // 能力不可用时继续试服务入口
        }
      }
      const svc = imageService()
      if (typeof svc?.addImageNodeFromResource !== 'function') return null
      try {
        return svc.addImageNodeFromResource(position, ref, meta) || null
      } catch {
        return null
      }
    },
    createGroup: (ids) => {
      const g = group()
      return typeof g?.createGroup === 'function' ? g.createGroup(ids) : null
    },
    createNode: (type, position, data) => {
      try {
        return doc.transaction('grid-split-create-node', (tx) => tx.createNode(type, position, data)) || null
      } catch {
        return null
      }
    },
    setNodeSize: (id, size) => {
      try {
        doc.updateNode?.(id, { size: { w: size.w, h: size.h } })
      } catch {
        // 尺寸写不上（节点刚被并发删掉等）：布局仍按计划值走，不影响其它格子
      }
    },
    connectEdge: (sourceId, targetId) => {
      try {
        // 走内核唯一加边入口：类型/容量/重复都在里面判，重复连线返回 duplicate 不算错
        doc.connectEdge?.({ source: sourceId, target: targetId, sourceHandle: 'source', targetHandle: 'target' })
      } catch {
        // 连不上（类型不符/容量满）：图仍然保留，用户能手动拖线
      }
    },
  }
}

/**
 * 切一格：从原图元素裁出 [sx, sy, sw, sh]，按目标尺寸 toBlob。
 * 源矩形用**原始图片像素**（data.imageWidth/Height 是图片的真实分辨率），
 * 不经过卡片尺寸或视口缩放 —— 切出来的是无损的原图切片。
 */
function sliceCell(
  source: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  targetW: number,
  targetH: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return resolve(null)
    ctx2d.drawImage(source, sx, sy, sw, sh, 0, 0, targetW, targetH)
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

/** 把当前文档里的图片加载成 HTMLImageElement（失败给 null） */
async function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return null
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** 发布结果（给调用方提示用） */
export interface PublishResult {
  ok: boolean
  /** 成功发布的格子数 */
  count: number
  /** 创建的组/分镜组节点 id（创建失败时为 undefined） */
  containerId?: string
  /** 失败原因（用户可读；给 tip 用） */
  reason?: string
}

/** 解析原图地址：resourceId → resources.resolve，迁移期回退 imageUrl */
async function resolveSourceUrl(deps: PublishDeps, data: Record<string, unknown> | undefined): Promise<string> {
  const resourceId = typeof data?.resourceId === 'string' ? data.resourceId : ''
  const legacyUrl = typeof data?.imageUrl === 'string' ? data.imageUrl : ''
  if (!resourceId) return legacyUrl
  const resolved = await deps.resolveRef(resourceId)
  return resolved || legacyUrl
}

/**
 * 切片并上传选中格子；返回按格子索引对齐的资源引用表（失败格缺项）。
 * 公共步骤：canvas/canvas 与 storyboard 共用，不重复加载原图。
 */
async function sliceAndUpload(
  deps: PublishDeps,
  img: HTMLImageElement,
  rows: number,
  cols: number,
  selected: number[],
): Promise<Map<number, { ref: string; width: number; height: number }>> {
  const cells = unitCells(rows, cols)
  const out = new Map<number, { ref: string; width: number; height: number }>()
  for (const index of selected) {
    const cell = cells[index]
    if (!cell) continue
    const px = toPixelRect(cell, img.naturalWidth, img.naturalHeight)
    if (!px) continue
    const blob = await sliceCell(img, px.x, px.y, px.width, px.height, px.width, px.height)
    if (!blob) continue
    const ref = await deps.putBlob(blob, '宫格-' + (index + 1) + '.png')
    if (!ref) continue
    out.set(index, { ref, width: px.width, height: px.height })
  }
  return out
}

/**
 * 发布选中格子：kind = 'canvas' 建图节点并打组；kind = 'storyboard' 建分镜组节点。
 */
export async function publishCells(
  deps: PublishDeps,
  nodeId: string,
  rows: number,
  cols: number,
  selected: number[],
  kind: 'canvas' | 'storyboard',
): Promise<PublishResult> {
  if (selected.length === 0) {
    return { ok: false, count: 0, reason: '先勾选要发布的格子' }
  }

  const data = deps.getNodeData(nodeId)
  const imageW = typeof data?.imageWidth === 'number' ? data.imageWidth : 0
  const imageH = typeof data?.imageHeight === 'number' ? data.imageHeight : 0
  if (imageW <= 0 || imageH <= 0) {
    return { ok: false, count: 0, reason: '图片尺寸未知（还没加载完）' }
  }
  const src = await resolveSourceUrl(deps, data)
  if (!src) {
    return { ok: false, count: 0, reason: '找不到原图地址' }
  }
  const img = await loadImage(src)
  if (!img || !img.naturalWidth) {
    return { ok: false, count: 0, reason: '原图加载失败' }
  }

  // 公共切片上传步骤
  const sliced = await sliceAndUpload(deps, img, rows, cols, selected)
  if (sliced.size === 0) {
    return { ok: false, count: 0, reason: '切片没存上（资源库不可用？）' }
  }

  if (kind === 'canvas') {
    /**
     * 均匀网格布局（用户口径 2026-10-30：图片不重叠、间隔均匀，行列可配）：
     * 1. 每格节点的卡片尺寸走**图片节点自己的规则**（最短边最小/最长边最大，与设置里「最短边最小」一致）；
     * 2. 行高 = 该行最大高、列宽 = 该列最大宽 → 均匀分布，互不重叠；
     * 3. 第一格位置交给 media 入口统一算（源图右侧空位），后续以它为基点偏移。
     */
    const limits: ImageFitLimitsLike = fitImageLimits(deps.ctx) || DEFAULT_IMAGE_LIMITS
    const sizes = new Map<number, { w: number; h: number }>()
    for (const [index, cell] of sliced) {
      const fit = fitCardSize(cell.width, cell.height, limits)
      sizes.set(index, fit ? { w: fit.width, h: fit.height } : { w: PUBLISH_CELL_W, h: PUBLISH_CELL_W })
    }
    const gap = Math.max(4, readStoryboardLayout(deps.ctx).rowGap)
    const positions = uniformGridPositions(rows, cols, [...sliced.keys()], sizes, gap)
    const createdIds: string[] = []
    let origin: { x: number; y: number } | undefined
    for (const pos of positions) {
      const cell = sliced.get(pos.index)
      if (!cell) continue
      const at = origin ? { x: origin.x + pos.x, y: origin.y + pos.y } : { x: pos.x, y: pos.y }
      const id = deps.addImageNodeFromResource(
        at,
        cell.ref,
        {
          name: '宫格-' + (pos.index + 1) + '.png',
          width: cell.width,
          height: cell.height,
          ...(origin ? {} : { sourceNodeId: nodeId, gap: PUBLISH_SOURCE_GAP }),
        },
      )
      if (id) {
        // 落槽位算好的尺寸：media 入口按 imageWidth/Height 自算（会走最短边规则），可能与
        // uniformGridPositions 用的值不同 → 显式写 size 对齐（唯一写入口，进同一条历史路径）。
        const want = sizes.get(pos.index)
        if (want) deps.setNodeSize(id, want)
        // 每一格都连回源节点（用户口径 2026-10-30）。第一格由 media 入口顺手连过，
        // 这里再连一次是 duplicate，内核自己会忽略。
        deps.connectEdge(nodeId, id)
        createdIds.push(id)
        if (!origin) {
          const first = deps.getNodeRect(id)
          origin = first ? { x: first.x, y: first.y } : at
        }
      }
    }
    if (createdIds.length === 0) {
      return { ok: false, count: 0, reason: '建图片节点失败（图片插件不可用）' }
    }
    // 打组：失败不回滚（图已在画布上，用户能手动 Ctrl+G）
    let groupId: string | undefined
    if (createdIds.length >= 2) {
      const gid = deps.createGroup(createdIds)
      if (gid) groupId = gid
    }
    return {
      ok: true,
      count: createdIds.length,
      containerId: groupId,
      reason: createdIds.length < sliced.size ? '部分格子没发布成功' : undefined,
    }
  }

  /**
   * storyboard：分镜组是**容器节点**（用户口径 2026-10-30）——
   * 槽位里放的是真正的图片节点 id，不是资源引用。
   *
   * 顺序：
   *  1. 先按格子索引建好每张切片图片节点（自由状态）；
   *  2. 建分镜组节点（slots 全空）；
   *  3. 把每张图「吸附」进对应槽位（父级 + 槽位坐标 + 按高度铺满的尺寸）。
   * 这样落库的图形与用户手动拖进去完全一致，撤销/保存/拖动都走同一套节点机制。
   */
  /**
   * 分镜组外框 = 内容网格的实际占用（用户口径 2026-10-30：分镜组与分组一样，
   * 大小是所有图片宫格排布后计算的最佳宽高，不是固定 480×360）：
   * 每格图片先按「最短边最小 / 最长边最大」规则算出卡片尺寸，
   * 再按行列取行高/列宽最大值，加内边距与行列间距反推外框。
   */
  const limits = fitImageLimits(deps.ctx)
  const contentSizes = new Map<number, { w: number; h: number }>()
  for (const [index, cell] of sliced) {
    const fit = fitCardSize(cell.width, cell.height, limits)
    if (fit) contentSizes.set(index, { w: fit.width, h: fit.height })
  }
  const layout = readStoryboardLayout(deps.ctx)
  const boardSize = storyboardContentSize(rows, cols, contentSizes, layout)
  const emptySlots: Array<string | null> = new Array(rows * cols).fill(null)
  const boardAt = placeStoryboardAt({ ctx: deps.ctx, sourceId: nodeId, size: boardSize })
  const boardId = deps.createNode('storyboard', boardAt, { rows, cols, slots: emptySlots })
  if (!boardId) {
    return { ok: false, count: 0, reason: '建分镜组失败（插件未装或宿主不支持）' }
  }
  // 建节点入口不带 size → 显式写内容外框（槽位几何用 boardNode.size 反推，必须先写对）
  deps.setNodeSize(boardId, boardSize)

  // 1) 先建图片节点（落在分镜组内部附近，随后被吸附对齐；用户看不到中间态）
  const cellIds = new Map<number, string>()
  for (const [index, cell] of sliced) {
    const id = deps.addImageNodeFromResource(
      { x: boardAt.x, y: boardAt.y },
      cell.ref,
      { name: '宫格图片 ' + (Math.floor(index / cols) + 1) + '-' + ((index % cols) + 1) + '.png', width: cell.width, height: cell.height },
    )
    if (id) {
      cellIds.set(index, id)
      // 分镜组这条路径同样每张都连回源节点（以前完全没连，用户只看到一堆孤立图片）
      deps.connectEdge(nodeId, id)
    }
  }
  if (cellIds.size === 0) {
    return { ok: false, count: 0, reason: '建图片节点失败（图片插件不可用）' }
  }

  // 2) 吸附进槽位（与手动拖拽同一条计算：parentId + 槽位坐标 + 等比缩放）
  const placed = snapIntoBoard(deps.ctx, boardId, cellIds, rows, cols)
  if (!placed) {
    return { ok: false, count: 0, reason: '分镜组吸附失败' }
  }
  return { ok: true, count: cellIds.size, containerId: boardId }
}

/**
 * 把一批图片节点按格子索引吸附进分镜组。
 * 复用 storyboardDrag 的 fitInsideSlot / centerInsideSlot，保证"自动创建"和"手动拖入"看起来一致。
 */
function snapIntoBoard(
  ctx: Context,
  boardId: string,
  cellIds: Map<number, string>,
  rows: number,
  cols: number,
): boolean {
  const doc = ctx.tryGet<{
    getNode(id: string): { position?: { x: number; y: number }; size?: { w: number; h: number }; data?: Record<string, unknown>; type?: string } | undefined
    updateNode(id: string, patch: Record<string, unknown>): unknown
    updateNodes?(entries: Array<{ id: string; patch: Record<string, unknown> }>): unknown
  } | undefined>('doc')
  if (!doc) return false
  const boardNode = doc.getNode(boardId)
  if (!boardNode) return false
  const size = boardNode.size ?? { w: 480, h: 360 }
  const rects = slotRects(size.w, size.h, rows, cols, readStoryboardLayout(ctx))
  if (rects.length === 0) return false

  const slots: Array<string | null> = new Array(rows * cols).fill(null)
  for (const [index, id] of cellIds) {
    const slot = rects[index]
    if (!slot) continue
    slots[index] = id
    const node = doc.getNode(id)
    if (!node) continue
    const aspect = aspectOfNode(node)
    const fitted = fitInsideSlot({ w: slot.w, h: slot.h }, aspect, fitImageLimits(ctx))
    const inside = centerInsideSlot({ w: slot.w, h: slot.h }, fitted)
    doc.updateNode(id, {
      parentId: boardId,
      position: { x: slot.x + inside.dx, y: slot.y + inside.dy },
      size: { w: fitted.w, h: fitted.h },
      data: { _storyboardSize: { w: 320, h: 240 }, _storyboardSlot: index },
    })
  }
  doc.updateNode(boardId, { data: { slots } })
  return true
}
