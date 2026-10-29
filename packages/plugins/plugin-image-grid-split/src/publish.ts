/**
 * publish —— 宫格切分的落库层：切片字节 → 资源库 → 图片节点 → 分组。
 *
 * 与 videoOps.persist 同一条路（不退回 base64 / objectURL 写进 data）：
 * 每格 canvas.toBlob 后经 resources.put 拿持久引用，再经 image 服务（或
 * media 能力回退）按引用建节点，最后 group.createGroup 打包。
 * 纯 DOM/服务编排，不碰会话状态（publishing 锁由调用方管）。
 */
import type { Context } from '@mini-canvas/canvas-base'
import { publishPositions, toPixelRect, unitCells } from './gridSplit'

/** 画布默认格宽：与图片节点默认卡片宽一致（320），视觉上就是"一排小图" */
const PUBLISH_CELL_W = 320
/** 发布组的画布间距 */
const PUBLISH_GAP = 12

/** 宿主需要提供的服务形状（按名取，不 import 具体实现） */
interface PublishDeps {
  /** 读节点 data */
  getNodeData(id: string): Record<string, unknown> | undefined
  /** 读节点画布绝对矩形（含尺寸） */
  getNodeRect(id: string): { x: number; y: number; w: number; h: number } | undefined
  /** 读当前视口缩放（把屏幕像素换算回图上像素） */
  zoom(): number
  /** 存资源字节 → 持久引用 */
  putBlob(blob: Blob, name: string): Promise<string | undefined>
  /** 持久引用 → 可显示地址（失败时建节点的兜底显示） */
  resolveRef(ref: string): Promise<string | undefined>
  /** 按引用建图片节点；两条入口都不可用返回 null */
  addImageNodeFromResource(position: { x: number; y: number }, ref: string, meta?: { name?: string; width?: number; height?: number }): string | null
  /** 打组（全部或空返回 null） */
  createGroup(ids: string[]): string | null
}

/** 从 ctx 组装发布依赖（服务缺失时各调用方自己兜底） */
export function publishDepsOf(ctx: Context): PublishDeps | null {
  const doc = ctx.tryGet<{ getNode(id: string): { data?: Record<string, unknown> } | undefined } | undefined>('doc')
  const layout = ctx.tryGet<{ getNodeRect(id: string): { x: number; y: number; w: number; h: number } | undefined } | undefined>('nodeLayout')
  const viewport = ctx.tryGet<{ getViewport?(): { zoom: number } } | undefined>('viewport')
  const resources = ctx.tryGet<{ put(b: Blob, o?: { kind?: string; name?: string }): Promise<string>; resolve(r: string): Promise<string | undefined> } | undefined>('resources')
  if (!doc) return null

  const imageService = () =>
    ctx.tryGet<{
      addImageNodeFromResource?(position: { x: number; y: number }, resourceId: string, meta?: { name?: string; width?: number; height?: number }): string
    }>('image')
  const media = () =>
    ctx.tryGet<{ addNode?(kind: string, id: string, position: { x: number; y: number }, opts?: { nodeType?: string; meta?: Record<string, unknown> }): string | undefined }>('media')
  const group = () =>
    ctx.tryGet<{ createGroup?(ids: string[]): string | null }>('group')

  return {
    getNodeData: (id) => doc.getNode(id)?.data,
    getNodeRect: (id) => {
      const rect = layout?.getNodeRect(id)
      if (rect && rect.w > 0 && rect.h > 0) return rect
      return undefined
    },
    zoom: () => viewport?.getViewport?.().zoom ?? 1,
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
          const id = capability.addNode('image', ref, position, { nodeType: 'image', meta })
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
  }
}

/**
 * 切一格：从原图元素裁出 [sx, sy, sw, sh]，缩放到位图后 toBlob。
 *
 * 说明：源矩形直接用**原始图片像素**（data.imageWidth/Height 是图片的真实分辨率），
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

/** 把当前文档里的图片加载成 HTMLImageElement（crossOrigin 同源；失败给 null） */
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
  /** 创建的分组 id（打组失败时为 undefined） */
  groupId?: string
  /** 失败原因（用户可读；给 tip 用） */
  reason?: string
}

/**
 * 发布选中格子到画布。
 *
 * @param deps 发布依赖（publishDepsOf 组装）
 * @param nodeId 正在切分的图片节点
 * @param rows/cols 行列
 * @param selected 勾选的格子索引
 * @param kind 'canvas' = 只发布；'storyboard' = 发布后打组（占位实现，与 canvas 相同 + 组）
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

  // 1. 解析原图地址（resourceId → resources.resolve，迁移期回退 imageUrl）
  const resourceId = typeof data?.resourceId === 'string' ? data.resourceId : ''
  const legacyUrl = typeof data?.imageUrl === 'string' ? data.imageUrl : ''
  let src = legacyUrl
  if (resourceId) {
    const resolved = await deps.resolveRef(resourceId)
    if (resolved) src = resolved
  }
  if (!src) {
    return { ok: false, count: 0, reason: '找不到原图地址' }
  }

  // 2. 加载原图
  const img = await loadImage(src)
  if (!img || !img.naturalWidth) {
    return { ok: false, count: 0, reason: '原图加载失败' }
  }

  // 3. 每格切片 → 存资源 → 建节点
  const cells = unitCells(rows, cols)
  const positions = publishPositions(rows, cols, selected, PUBLISH_CELL_W, PUBLISH_CELL_W, PUBLISH_GAP)
  const createdIds: string[] = []
  let lastErr = ''

  for (const pos of positions) {
    const cell = cells[pos.index]
    if (!cell) continue
    const px = toPixelRect(cell, img.naturalWidth, img.naturalHeight)
    if (!px) {
      lastErr = '格子坐标计算失败'
      continue
    }
    // 切片目标尺寸 = 原图像素尺寸（无损切；节点卡片按比例显示）
    const blob = await sliceCell(img, px.x, px.y, px.width, px.height, px.width, px.height)
    if (!blob) {
      lastErr = '切片生成失败'
      continue
    }
    const name = '宫格-' + (pos.index + 1) + '.png'
    const ref = await deps.putBlob(blob, name)
    if (!ref) {
      lastErr = '资源库不可用（切片没存上）'
      continue
    }
    const id = deps.addImageNodeFromResource(
      { x: pos.x, y: pos.y },
      ref,
      { name, width: px.width, height: px.height },
    )
    if (!id) {
      lastErr = '建图片节点失败（图片插件不可用）'
      continue
    }
    createdIds.push(id)
  }

  if (createdIds.length === 0) {
    return { ok: false, count: 0, reason: lastErr || '没有格子发布成功' }
  }

  // 4. storyboard：把新节点打成分镜组；失败不回滚（图已在画布上，用户能手动打组）
  let groupId: string | undefined
  if (kind === 'storyboard' && createdIds.length >= 2) {
    const gid = deps.createGroup(createdIds)
    if (gid) groupId = gid
  }

  return {
    ok: true,
    count: createdIds.length,
    groupId,
    reason: createdIds.length < positions.length ? '部分格子没发布成功：' + (lastErr || '未知原因') : undefined,
  }
}
