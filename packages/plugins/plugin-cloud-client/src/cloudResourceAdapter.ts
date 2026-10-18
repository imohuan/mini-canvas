/**
 * CloudResourceAdapter —— 云端资源后端：把资源二进制存进**画布文件夹**。
 *
 * 它是 **StorageAdapter 的"资源形式"孔位**（put/resolve/removeResource）。云插件安装时
 * `save.useAdapter('resource', cloudResourceAdapter)` 一换，上传/生成的图片就落到
 * `canvases/<画布id>/resources/<内容哈希>.png`。
 *
 * 两条不变量（与本地后端同一套契约）：
 * 1. **put 只回逻辑 ID**：形如 `<canvasId>/<hashName>`（例 `default/0123456789abcdef.png`）。
 *    节点、存档、剪贴板里只保存这个 ID，**不保存 URL**；
 * 2. **resolve 负责 ID → 地址**：按 ID 里的画布作用域拼出
 *    `/api/canvases/<canvasId>/resources/<hashName>`，并确认它可请求。
 *    迁移期同时认旧的同源 URL（原样返回）与旧的 `res-`（云端认不出 → undefined）。
 *
 * 为什么 ID 里要带画布：复制画布时节点会被原样复制一份到新画布，若 ID 只含 hashName，
 * 副本会指回原画布的资源（原画布一删，副本全裂）。带上作用域后，「复制」只要把 ID 前缀
 * 换成新画布 id 即可，不依赖 URL 字符串替换。
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

/** 内容寻址名：16 位十六进制 + 可选扩展名（与 cloud-server 的 isSafeResourceName 同口径） */
const CONTENT_NAME_RE = /^[0-9a-f]{16}(\.[a-z0-9]+)?$/i
/** 覆盖槽位名：slot-<槽位 id> + 可选扩展名 */
const SLOT_NAME_RE = /^slot-[A-Za-z0-9_-]{1,64}(\.[a-z0-9]+)?$/
/** 画布 id：与 canvasPaths 的白名单一致 */
const CANVAS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** 逻辑 ID → `<canvasId>/<hashName>`（不含 URL 形状，复制画布也能认出作用域） */
export function cloudResourceId(canvasId: string, hashName: string): string {
  return canvasId + '/' + hashName
}

/**
 * 拆逻辑 ID。认不出返回 undefined（调用方按"不是资源引用"处理）。
 *
 * 只认白名单形态：画布 id 一段、资源名一段。任何带 `://`、`blob:`、`data:`、
 * 或第二段不是内容哈希/槽位名的字符串都不算 ID —— 这样外部链接不会被误当成引用。
 */
export function parseCloudResourceId(ref: string): { canvasId: string; hashName: string } | undefined {
  const i = ref.indexOf('/')
  if (i <= 0 || i !== ref.lastIndexOf('/')) return undefined
  const canvasId = ref.slice(0, i)
  const hashName = ref.slice(i + 1)
  if (!CANVAS_ID_RE.test(canvasId)) return undefined
  if (!CONTENT_NAME_RE.test(hashName) && !SLOT_NAME_RE.test(hashName)) return undefined
  return { canvasId, hashName }
}

/** 逻辑 ID 对应的资源路由（与 cloud-server 的 toResourceUrl 同形） */
export function cloudResourceUrl(canvasId: string, hashName: string): string {
  return '/api/canvases/' + canvasId + '/resources/' + hashName
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

    /** 传字节 → 服务端按内容哈希落文件 → 回**逻辑 ID** `<canvasId>/<hashName>` */
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
      if (opts.ref) return opts.ref
      // 常规资源：只回逻辑 ID。节点里不再出现 URL —— 地址由 resolve 现拼。
      return cloudResourceId(canvasId, uploaded.hashName)
    },

    /**
     * 引用 → 可显示地址。三种输入：
     * - **新逻辑 ID**（`<canvasId>/<hashName>`）→ 拼资源路由，HEAD 确认可请求；
     * - **旧同源 URL**（迁移期存档里的 `/api/...` 或绝对 http(s)）→ 原样返回；
     * - **旧 `res-`**（本地资源库的取件码）→ undefined（云端没有这份字节）。
     *
     * 其它（blob: / data: / 空 / 认不出的字符串）→ undefined（不猜）。
     */
    async resolveResource(ref: string): Promise<string | undefined> {
      if (ref === '') return undefined
      if (isRequestableUrl(ref)) return ref
      // 本地资源库的取件码：云端不认识，绝不能原样当地址返回（会得到破图）。
      if (/^res-/.test(ref)) return undefined

      const parsed = parseCloudResourceId(ref)
      if (parsed) {
        const url = cloudResourceUrl(parsed.canvasId, parsed.hashName)
        // 拼得出来不等于文件还在（复制/清理/删画布之后都可能没了）。
        // HEAD 一次；网络异常一律当"不可用"，由调用方显示空态。
        const exists = await api.resourceExists(url).catch(() => false)
        return exists ? url : undefined
      }
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
