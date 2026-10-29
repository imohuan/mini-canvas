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
import { publishPositions, toPixelRect, unitCells } from './gridSplit'

/** 画布默认格宽：与图片节点默认卡片宽一致（320），视觉上就是"一排小图" */
const PUBLISH_CELL_W = 320
/** 发布组的画布间距 */
const PUBLISH_GAP = 12
/** 发布到画布时第一格与源图之间的最小间距（与图片裁剪同一套：右缘 + 100） */
const PUBLISH_SOURCE_GAP = 100

/** 宿主需要提供的服务形状（按名取，不 import 具体实现） */
interface PublishDeps {
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
}

/** 从 ctx 组装发布依赖（服务缺失时各调用方自己兜底） */
export function publishDepsOf(ctx: Context): PublishDeps | null {
  const doc = ctx.tryGet<{
    getNode(id: string): { data?: Record<string, unknown> } | undefined
    transaction<T>(reason: string, fn: (tx: { createNode(type: string, p: { x: number; y: number }, d?: Record<string, unknown>): string }) => T): T
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
    // 建图节点：保持原行列位置，空格留空。第一格的位置交给 media 入口统一算（源图右侧空位），
    // 后续格子以它为基点按行列偏移 —— 不再把第一格硬放在 (0,0)（大图会叠到别的节点、跑出视口）。
    const positions = publishPositions(rows, cols, [...sliced.keys()], PUBLISH_CELL_W, PUBLISH_CELL_W, PUBLISH_GAP)
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

  // storyboard：建分镜组节点（槽位数 = 行×列），切片按格子索引写进槽
  const slots: Array<string | null> = new Array(rows * cols).fill(null)
  for (const [index, cell] of sliced) slots[index] = cell.ref
  const boardId = deps.createNode('storyboard', { x: 0, y: 0 }, {
    rows,
    cols,
    slots,
    slotRefs: slots,
  })
  if (!boardId) {
    return { ok: false, count: 0, reason: '建分镜组失败（插件未装或宿主不支持）' }
  }
  return { ok: true, count: sliced.size, containerId: boardId }
}
