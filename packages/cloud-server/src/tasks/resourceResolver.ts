/**
 * 参考图解析 —— 把节点里的「资源地址」翻成 provider 能直接取的 data URL。
 *
 * 两种来源都认：画布自己的资源（`/api/canvases/<id>/resources/<hash>`）与资产库的
 * （`/api/assets/files/<hash>.jpeg`）。以前只认前者，资产地址被原样发给 web2api ——
 * 它当成自己 uploads 目录下的相对路径去找，报「图片不存在」（用户实测）。
 *
 * 交给 provider 的必须是 **data URL**（内嵌字节），不是地址：cloud-server 与 web2api 是两个
 * 独立服务（可能不在同一台机器），给地址它可能根本取不到（见 TaskDeps.resolveResourceUrl）。
 */
import { parseAssetNameFromUrl } from '../store/assetStore.js'
import { parseResourceNameFromUrl, type CanvasResourceStore } from '../store/canvasResources.js'
import { mimeFromName, sniffMimeFromHead } from '../store/mime.js'

export interface ResourceResolverDeps {
  /**
   * 画布资源（`/api/canvases/<id>/resources/<hash>` 走它）。
   *
   * 只声明 read，不要 readHead：这条路上字节本来就要整份读出来内嵌，嗅探直接看手里这份的**前 16 字节**
   * 即可，再开一次文件纯属多一次 IO（readHead 的价值在资源列表那条**不该整读**的路上）。
   */
  canvasResources: Pick<CanvasResourceStore, 'read'>
  /** 上传资产的字节；名字不合法 / 不存在 → undefined */
  readAssetBytes(name: string): Promise<Uint8Array | undefined>
}

/**
 * 造一个「引用 → data URL」的解析函数（纯依赖注入，便于单测给假货）。
 *
 * 两种形态都认：① `/api/canvases/<id>/resources/<hash>`；② `/api/assets/files/<hash>`
 * （都可带 origin）。认不出 / 读不到就**原样返回** —— 让 provider 自己的报错暴露问题，
 * 而不是在这里悄悄换成一个更假的地址。
 */
export function makeResolveResourceUrl(
  deps: ResourceResolverDeps,
): (canvasId: string, ref: string) => Promise<string> {
  return async (canvasId, ref) => {
    const resourceName = parseResourceNameFromUrl(ref, canvasId)
    if (resourceName) {
      const bytes = await deps.canvasResources.read(canvasId, resourceName)
      return bytes ? toDataUrl(bytes, resourceName) : ref
    }
    const assetName = parseAssetNameFromUrl(ref)
    if (assetName) {
      const bytes = await deps.readAssetBytes(assetName)
      return bytes ? toDataUrl(bytes, assetName) : ref
    }
    return ref
  }
}

/**
 * 字节 → data URL。
 *
 * mime 先按名字（有扩展名就够）；名字给不出类型（octet-stream = 没扩展名）时补一次
 * **头部嗅探** —— 画布资源按内容哈希落盘、很多没扩展名，不嗅探的话音频会被当成二进制流发出去。
 */
function toDataUrl(bytes: Uint8Array, name: string): string {
  let mime = mimeFromName(name)
  if (mime === 'application/octet-stream') {
    const sniffed = sniffMimeFromHead(bytes.subarray(0, 16))
    if (sniffed) mime = sniffed
  }
  return 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64')
}
