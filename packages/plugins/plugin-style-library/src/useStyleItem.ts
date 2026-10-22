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
 * 现在：取字节 → `resources.put()` 落进**本画布资源目录** → 拿 `resourceId` →
 * 与 `imageUrl`（显示地址）**一次写入**节点，历史只有一条。
 *
 * ## 为什么要 `resolve` 再写 imageUrl
 *
 * 迁移期旧的渲染路径 / 导出仍读 `imageUrl`（见 plugin-node-image 的 imageSourceFields）。
 * resolve 不出来（极简宿主没有资源服务）→ 不建节点，退化成调用方给的回退动作，
 * 而不是写一个只有本机才有效的临时地址。
 */

export interface StyleItemSource {
  /** 源地址（风格库 / 特效库的 file 路由） */
  url: string
  /** 节点标题（风格名，多图时带序号） */
  label: string
}

/** 资源服务的最小形状（宿主可能没装 —— 那些字段都可选） */
export interface StyleItemResources {
  put(blob: Blob, opts?: { kind?: string; name?: string }): Promise<string>
  resolve(ref: string): Promise<string | undefined>
}

/** doc 门面里只用到的那一个方法 */
export interface StyleItemDoc {
  createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string
}

export interface UseStyleItemDeps {
  doc: StyleItemDoc | undefined
  resources: StyleItemResources | undefined
  /** 取字节（浏览器 fetch；测试注入假货） */
  fetchBlob(url: string): Promise<Blob>
  onError?(msg: string, err?: unknown): void
}

export type UseStyleItemResult =
  | { ok: true; nodeId: string; resourceId: string; url: string }
  | { ok: false; reason: 'no-doc' | 'no-resources' | 'fetch-failed' | 'put-failed' | 'resolve-failed' }

/**
 * 把一条素材存进资源库并在 `position` 建图片节点。
 *
 * 失败原因分得细一点：调用方据此决定是「退回到直接写地址」还是「提示用户」。
 * 不抛异常 —— 一个素材打不开不该把整个面板带崩。
 */
export async function useStyleItem(
  deps: UseStyleItemDeps,
  item: StyleItemSource,
  position: { x: number; y: number },
): Promise<UseStyleItemResult> {
  const { doc, resources } = deps
  if (!doc) return { ok: false, reason: 'no-doc' }
  // 没有资源服务：不写临时地址（那正是这次要摆脱的形态）
  if (!resources) return { ok: false, reason: 'no-resources' }

  const name = fileNameOf(item.url) || 'style-item'
  let blob: Blob
  try {
    blob = await deps.fetchBlob(item.url)
    if (!blob || blob.size === 0) throw new Error('取到空字节')
  } catch (err) {
    deps.onError?.('[style-library] 素材取字节失败：' + item.url, err)
    return { ok: false, reason: 'fetch-failed' }
  }

  let resourceId: string
  try {
    resourceId = await resources.put(blob, { kind: 'image', name })
    if (!resourceId) throw new Error('资源库没有返回引用')
  } catch (err) {
    deps.onError?.('[style-library] 素材存进资源库失败：' + item.url, err)
    return { ok: false, reason: 'put-failed' }
  }

  let url: string | undefined
  try {
    url = await resources.resolve(resourceId)
  } catch (err) {
    deps.onError?.('[style-library] 资源引用解析地址失败：' + resourceId, err)
  }
  if (!url) return { ok: false, reason: 'resolve-failed' }

  try {
    const nodeId = doc.createNode('image', position, { resourceId, imageUrl: url, label: item.label })
    return { ok: true, nodeId, resourceId, url }
  } catch (err) {
    deps.onError?.('[style-library] 建节点失败', err)
    return { ok: false, reason: 'no-doc' }
  }
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
