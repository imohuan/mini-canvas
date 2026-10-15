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

/**
 * 派生资源（固定名）的约定地址：`/api/canvases/<画布id>/resources/slot-<裸引用>.webp`。
 *
 * 字符集与服务端的槽位校验一致（`[A-Za-z0-9_-]`）：名字里带点号之类会被拒，
 * 所以这里先收窄、拼不出就返回 undefined（调用方按"没有缓存"处理）。
 */
export function slotUrlOf(canvasId: string, ref: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(ref)) return undefined
  return '/api/canvases/' + canvasId + '/resources/slot-' + ref + '.webp'
}

export function createCloudResourceAdapter(api: CloudApi, canvasId: string = CANVAS_ID): ResourceAdapter {
  const capability: StorageAdapterCapability = { list: false, transactional: false, offline: false }
  return {
    id: 'cloud-resource',
    capability,

    /** 传字节 → 服务端按内容哈希落文件 → 回同源 URL（写进节点的就是它） */
    async putResource(blob: Blob, opts: ResourcePutOptions = {}): Promise<string> {
      const name = opts.name ?? (opts.kind ? opts.kind + '.bin' : 'asset.bin')
      /**
       * 调用方指定了 ref → 落成**固定名**（服务端的"槽位"上传口）。
       *
       * 为什么需要：名字可推算的资源（缩略图/帧图）要能"先查有没有、没有才生成"，
       * 而内容哈希寻址做不到这一点 —— 要算哈希就得先把图造出来，白忙一场。
       * 槽位名固定、原地覆盖，于是 `resolve(ref)` 能直接命中已存在的那份。
       * 代价（服务端注释里有）：同址内容会变 → 这类资源的缓存策略是禁缓存。
       */
      const uploaded = opts.ref
        ? await api.uploadResourceToSlot(canvasId, blob, opts.ref, name)
        : await api.uploadResource(canvasId, blob, name)
      // 指定了固定名 → 返回**裸引用**（`opts.ref`）而不是完整 URL：
      // 这样 resolve(ref) 能认出"这是派生资源"、去服务端确认存在性（见 resolveResource）。
      // 返回 URL 的话，resolve 会走"已是 URL 原样返回"那条 —— 存在性永远不查，
      // 于是调用方每次都以为没缓存、白等一次生成（2026-10-15 实测踩到）。
      return opts.ref ? opts.ref : uploaded.url
    },

    /**
     * 引用 → 可显示地址。**幂等**：
     * - 已是 URL（http(s) 或 `/api/` 开头）→ 原样返回；
     * - 其它（blob: / data: / 空）→ undefined（不猜）。
     */
    async resolveResource(ref: string): Promise<string | undefined> {
      if (ref === '') return undefined
      if (isRequestableUrl(ref)) return ref
      /**
       * **裸引用**（不带 URL 形状）= 调用方指定的"固定名"派生资源
       * （缩略图 / 视频帧图这类，见 putResource 里 opts.ref 那条路）。
       *
       * 这类资源的存在性**必须真去问服务端**：地址由"槽位名 + .webp"拼出来，
       * 但文件在不在只有服务器知道。不查的后果很隐蔽 ——
       * 调用方以为"命中缓存"，其实每次都白等一次生成，重算的钱照付。
       * 查一次（HEAD）换来之后一直命中：ResourceStore 会把结果记进内存表。
       */
      const candidate = slotUrlOf(canvasId, ref)
      if (!candidate) return undefined
      const exists = await api.resourceExists(candidate).catch(() => false)
      return exists ? candidate : undefined
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
