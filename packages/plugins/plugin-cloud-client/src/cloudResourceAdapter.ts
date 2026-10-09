/**
 * CloudResourceAdapter —— 云端资源后端：把资源二进制存进**画布文件夹**。
 *
 * 它是 **StorageAdapter 的"资源形式"孔位**（put/resolve/removeResource）。云插件安装时
 * `save.useAdapter('resource', cloudResourceAdapter)` 一换，上传/生成的图片就落到
 * `canvases/<画布id>/resources/<内容哈希>.png`，节点里存**同源 URL**
 * `/api/canvases/<画布id>/resources/<哈希>`。
 *
 * 两条不变量（与本地后端同一套契约）：
 * 1. **回的就是持久引用** —— 云端引用本身是个稳定地址（内容哈希寻址），节点里直接存 URL；
 * 2. **resolve 幂等**：URL 原样返回（可直接塞进 `<img src>`），认不出的给 undefined。
 *
 * 零 import / 零 Vue：本插件要打成自包含单文件（见 vite.config.ts 的说明）。
 */
import type { ResourceAdapter, StorageAdapterCapability, ResourcePutOptions } from './shims.js'
import type { CloudApi } from './api.js'
import { CANVAS_ID } from './keys.js'

/** 已是可请求地址：绝对 http(s)，或同源 `/api/` 路径 */
function isRequestableUrl(ref: string): boolean {
  return /^https?:\/\//i.test(ref) || ref.startsWith('/api/')
}

export function createCloudResourceAdapter(api: CloudApi, canvasId: string = CANVAS_ID): ResourceAdapter {
  const capability: StorageAdapterCapability = { list: false, transactional: false, offline: false }
  return {
    id: 'cloud-resource',
    capability,

    /** 传字节 → 服务端按内容哈希落文件 → 回同源 URL（写进节点的就是它） */
    async putResource(blob: Blob, opts: ResourcePutOptions = {}): Promise<string> {
      const name = opts.name ?? (opts.kind ? opts.kind + '.bin' : 'asset.bin')
      const uploaded = await api.uploadResource(canvasId, blob, name)
      return uploaded.url
    },

    /**
     * 引用 → 可显示地址。**幂等**：
     * - 已是 URL（http(s) 或 `/api/` 开头）→ 原样返回；
     * - 其它（blob: / data: / 空）→ undefined（不猜）。
     */
    async resolveResource(ref: string): Promise<string | undefined> {
      if (ref === '') return undefined
      return isRequestableUrl(ref) ? ref : undefined
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
