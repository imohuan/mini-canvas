/**
 * CloudResourceAdapter —— 云端资源后端：把资源二进制存进**画布文件夹**。
 *
 * 它是 **StorageAdapter 的"资源形式"孔位**（put/resolve/removeResource）。云插件安装时
 * `save.useAdapter('resource', cloudResourceAdapter)` 一换，上传/生成的图片就落到
 * `canvases/<画布id>/resources/<内容哈希>.png`，节点里存 `res:<哈希>` 相对引用。
 *
 * 两条不变量（与本地后端同一套契约）：
 * 1. **只回 ref、不回 URL** —— 节点里绝不存地址；
 * 2. **显示地址现算**：云端 ref 是内容哈希，resolve 直接拼服务器地址（不必下载字节）。
 *
 * 零 import / 零 Vue：本插件要打成自包含单文件（见 vite.config.ts 的说明）。
 */
import type { ResourceAdapter, StorageAdapterCapability, ResourcePutOptions } from './shims.js'
import type { CloudApi } from './api.js'
import { CANVAS_ID, RESOURCE_REF_PREFIX } from './keys.js'

/** `res:<hash>` → 服务器可请求地址（与 resourceRef.ts 的 resolveRef 同口径） */
function refToUrl(ref: string, canvasId: string): string | undefined {
  if (!ref.startsWith(RESOURCE_REF_PREFIX)) return undefined
  const name = ref.slice(RESOURCE_REF_PREFIX.length)
  return '/api/canvases/' + canvasId + '/resources/' + name
}

export function createCloudResourceAdapter(api: CloudApi, canvasId: string = CANVAS_ID): ResourceAdapter {
  const capability: StorageAdapterCapability = { list: false, transactional: false, offline: false }
  return {
    id: 'cloud-resource',
    capability,

    /** 传字节 → 服务端按内容哈希落文件 → 回 `res:<哈希>` 引用 */
    async putResource(blob: Blob, opts: ResourcePutOptions = {}): Promise<string> {
      const name = opts.name ?? (opts.kind ? opts.kind + '.bin' : 'asset.bin')
      const uploaded = await api.uploadResource(canvasId, blob, name)
      return uploaded.ref
    },

    /** 引用 → 服务器地址（内容寻址，稳定，不必下载） */
    async resolveResource(ref: string): Promise<string | undefined> {
      return refToUrl(ref, canvasId)
    },

    /**
     * 删资源：暂时 no-op。
     *
     * 服务端资源按内容哈希去重（多张画布/多个节点可能指向同一个文件），
     * 单方面删除会把别处的引用删坏。留待后续做引用计数清扫，此处先不动。
     */
    async removeResource() {},
  }
}
