/**
 * 从素材库「使用」一条素材 → 在画布上建一个图片节点。
 *
 * ## 为什么要先把字节存进资源库（2026-10-22 用户口径）
 *
 * 早先这里把**风格库的地址**（`/api/style-library/file?name=…`）直接写进节点的 `imageUrl`。
 * 那样有三个问题：
 *   1. 素材库目录一改（设置里换目录 / 换机器），画布上的图全裂；
 *   2. 素材库插件没装 / 后台半没起，历史画布也裂；
 *   3. 与项目既定的「节点只保存持久资源引用」不符 —— 图片节点本来就读 `resourceId`。
 *
 * ## 为什么走 media 能力、而不是自己写节点字段
 *
 * 规范（`docs/插件开发规范.md` §2.1 / §3.1 / §3.3）要求：
 *   字节 → `media.put` → 持久 ID → `media.addNode('image', id, pos)` → 图片插件自己落笔。
 * 节点 data 的字段归**节点类型插件**所有；素材库不是 image 节点的作者，手写 `resourceId` /
 * `imageUrl` 等于绕过它的尺寸、缩略图与字段规则（§3.3 明确禁止 `createNode` 直接塞 URL）。
 *
 * 另外：**resolve 出来的地址绝不写回节点**（§2.2：用完即弃）。显示地址由图片组件自己
 * `resolve(resourceId)` 现取 —— 这里写一份只会变成刷新后失效的旧地址。
 *
 * 失败一律**不建节点**：半成品节点比没有节点更难查。失败原因交给调用方做可见提示
 * （§1.2：只在控制台 warn 不算降级）。
 */

export interface StyleItemSource {
  /** 源地址（风格库 / 特效库的 file 路由） */
  url: string
  /** 节点标题（风格名，多图时带序号） */
  label: string
}

/**
 * media 能力的最小形状（`canvas-render` 的公开出口；宿主默认已注册）。
 *
 * `addNode` 由**图片插件**注册的创建器实现：它自己决定写哪些字段（resourceId / 名称 / 宽高）。
 * 返回 undefined = 本宿主没装 image 创建器（图片节点插件没启用）。
 */
export interface StyleItemMedia {
  put(blob: Blob, opts?: { kind?: string; name?: string }): Promise<string>
  addNode(
    kind: 'image',
    resourceId: string,
    position: { x: number; y: number },
    opts?: { nodeType?: string; meta?: Record<string, unknown> },
  ): string | undefined
}

export interface UseStyleItemDeps {
  /** media 能力；宿主没装 / 能力未注册时是 undefined */
  media: StyleItemMedia | undefined
  /** 设节点标题（宿主公开入口 `ctx.nodes.setLabel`；缺了就不设标题，不加假字段） */
  setLabel?(nodeId: string, label: string): void
  /** 取字节（默认全局 fetch；测试注入假货） */
  fetchBlob?(url: string): Promise<Blob>
  onError?(msg: string, err?: unknown): void
}

export type UseStyleItemResult =
  | { ok: true; nodeId: string; resourceId: string }
  | {
      ok: false
      reason: 'no-media' | 'fetch-failed' | 'put-failed' | 'add-node-failed'
      /** 给用户看的一句话（调用方显示在面板里） */
      message: string
    }

/**
 * 把一条素材存进资源库并在 `position` 建图片节点。
 *
 * 失败时带一句能显示给用户的话（`message`），并且**一律不建节点**
 * —— 半成品节点比没有节点更难查，而且会把 resolve 出来的临时地址固化进存档。
 * 不抛异常：一个素材打不开不该把整个面板带崩。
 */
export async function useStyleItem(
  deps: UseStyleItemDeps,
  item: StyleItemSource,
  position: { x: number; y: number },
): Promise<UseStyleItemResult> {
  const { media } = deps
  // 没有 media：不退回"直接写素材库地址"（那正是这次要摆脱的形态）
  if (!media) {
    return { ok: false, reason: 'no-media', message: '当前画布没有资源服务，无法把素材加入画布' }
  }

  const name = fileNameOf(item.url) || 'style-item'
  let blob: Blob
  try {
    blob = await (deps.fetchBlob ?? defaultFetchBlob)(item.url)
    if (!blob || blob.size === 0) throw new Error('取到空字节')
  } catch (err) {
    deps.onError?.('[style-library] 素材取字节失败：' + item.url, err)
    return { ok: false, reason: 'fetch-failed', message: '素材取不到（文件可能已被移动或删除）' }
  }

  let resourceId: string
  try {
    resourceId = await media.put(blob, { kind: 'image', name })
    if (!resourceId) throw new Error('资源库没有返回引用')
  } catch (err) {
    deps.onError?.('[style-library] 素材存进资源库失败：' + item.url, err)
    return { ok: false, reason: 'put-failed', message: '保存素材到资源库失败' }
  }

  try {
    // 字段由图片插件自己写：这里只给资源引用与文件名（不传任何地址）
    const nodeId = media.addNode('image', resourceId, position, { meta: { name } })
    if (!nodeId) throw new Error('没有注册 image 创建器')
    // 标题走公开入口（节点 data 的 label 由 doc 管，不手拼字段）；失败不影响这次加入
    try {
      deps.setLabel?.(nodeId, item.label)
    } catch (err) {
      deps.onError?.('[style-library] 设置节点标题失败：' + nodeId, err)
    }
    return { ok: true, nodeId, resourceId }
  } catch (err) {
    deps.onError?.('[style-library] 建节点失败：' + resourceId, err)
    return {
      ok: false,
      reason: 'add-node-failed',
      message: '画布没有启用图片节点，无法加入素材',
    }
  }
}

/** 默认取字节（浏览器 fetch） */
async function defaultFetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.blob()
}

/** 从地址里取文件名（风格库是 `?name=…` 的查询串形态） */
export function fileNameOf(url: string): string {
  try {
    const u = new URL(url, 'http://x')
    const named = u.searchParams.get('name')
    if (named) return decodeURIComponent(named).split('/').pop() ?? ''
    return decodeURIComponent(u.pathname.split('/').pop() ?? '')
  } catch {
    return ''
  }
}
