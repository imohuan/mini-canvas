/**
 * video / audio 的结果写入器 —— 「任务跑完了，产物落到节点」。
 *
 * 为什么这两个要本插件自带：image / text 的写入器住在各自的节点插件里
 * （image 那个还会量尺寸、清旧字段），但 **video / audio 的写入器原本只注册在
 * plugin-web2api-tools 里**。云模式下不装它 —— 于是视频/音频任务跑到 done
 * 却永远不落节点（取不到写入器，底栏的兜底写入也没提供）。
 *
 * 注意 registerApplier 对同一个 kind **重复注册会抛错**，所以：
 * - video / audio：本插件注册（云模式下 web2api 插件不在场）；
 * - image / text：由各自的节点插件提供，本插件**不要碰**。
 */

/** 写入器要用到的那点 doc 能力（结构化取，不 import 数据层类型） */
export interface DocLike {
  updateNode?(id: string, patch: { data: Record<string, unknown> }): void
  getNode?(id: string): { data?: Record<string, unknown> } | undefined
}

export interface ToolResultLike {
  urls?: string[]
  text?: string
}

/**
 * 落地结果：**逻辑 ID 是主字段**，地址只是迁移期的显示副本。
 *
 * 目标形态是节点里只有 resourceId；但当前 audio 等内容组件还在读 xxxUrl，
 * 所以这里允许同时给出 url。等各节点组件都改成「按 ID 现取」后，url 这段直接删掉。
 */
interface LocalizedResult {
  /** 写进节点 data.resourceId 的逻辑 ID（拿不到资源库时为空） */
  resourceId?: string
  /** 迁移期显示地址（调用方决定是否一并写进 xxxUrl） */
  url?: string
}

/**
 * 认旧的云端资源地址 `/api/canvases/<画布id>/resources/<名字>` → 逻辑 ID。
 *
 * 迁移期会把这种地址从老存档/后台产物里带回来；能认就顺手升级成 ID，
 * 免得每写一次都留一份 URL。
 */
function resourceIdFromUrl(url: string): string | undefined {
  const m = /^\/api\/canvases\/([A-Za-z0-9_-]{1,64})\/resources\/([^/?#]+)$/.exec(url)
  if (!m) return undefined
  return m[1] + '/' + m[2]
}

/** 已经是资源库引用（逻辑 ID `<canvasId>/<hashName>`，或本地 `res-…`） */
function isResourceRefLike(ref: string): boolean {
  if (/^res-/.test(ref)) return true
  // 逻辑 ID 只有一段斜杠，第二段是内容哈希 / 槽位名（与 cloudResourceAdapter 同口径）
  const i = ref.indexOf('/')
  if (i <= 0 || i !== ref.lastIndexOf('/')) return false
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(ref.slice(0, i))) return false
  return /^([0-9a-f]{16}(\.[a-z0-9]+)?|slot-[A-Za-z0-9_-]{1,64}(\.[a-z0-9]+)?)$/i.test(ref.slice(i + 1))
}

/**
 * 把产物地址**收进本画布资源目录**，返回要写进节点的那份数据（逻辑 ID + 迁移期地址）。
 *
 * ## 为什么必须有（2026-10-12 用户实测报的问题）
 *
 * provider 回的产物是**另一个服务**的地址（如 `http://localhost:8033/...`）。直接写进节点
 * 会带来三个后果：换机器/换端口就打不开；跨源、受对方服务可用性影响；画布数据里混着两套地址。
 * 用户口径：「应该把这些 URL 统统转为自己的 URL」。
 *
 * 做法与后台的 `taskManager.writeMediaFields` 同一套：取字节 → 交给资源服务 → 拿回本画布引用。
 *
 * **拿不到就回落原地址**：保住产物是底线，宁可留个外链也不要让用户看到空白。
 * 这条兜底只产生 `url`、不产生 `resourceId`，节点里就不会出现"指向空资源的 ID"。
 */
async function localizeUrl(
  url: string,
  deps: {
    /** 资源服务（put 收字节、resolve 换回可显示地址） */
    resources?: {
      put(blob: Blob, opts?: { kind?: string; name?: string }): Promise<string>
      resolve(ref: string): Promise<string | undefined>
    }
    /** 取字节（默认 fetch；测试注入假货） */
    fetchBytes?: (url: string) => Promise<Blob>
    kind?: string
  },
): Promise<LocalizedResult> {
  const res0 = deps.resources
  /**
   * `res-<n>` 是**资源库取件码**，不是能显示的地址（`<img src="res-7">` / `<video src="res-7">`
   * 谁都打不开）。它只能出现在节点的 `resourceId` 字段，**绝不能进 videoUrl/audioUrl**。
   *
   * 云端的逻辑 ID（`<canvasId>/<hashName>`）同样是引用，不是地址。
   * 两者都先解析；解析不出来就抛，由调用方按"这次没拿到可用地址"处理
   *（宁可保留原值，也不写一个打不开的引用）。
   *
   * 已经是**本画布资源地址**（迁移期旧格式）：地址可直接用，顺手拆出逻辑 ID。
   * 不再走 put（会多存一份字节），也不再 resolve（地址本身就是现成的）。
   */
  const legacyId = resourceIdFromUrl(url)
  if (legacyId) return { resourceId: legacyId, url }
  // 引用（本地 res- / 云端逻辑 ID）：必须先换成显示地址，引用本身不能进地址字段。
  if (isResourceRefLike(url)) {
    const resolved = await res0?.resolve?.(url)
    if (resolved && !isResourceRefLike(resolved)) return { resourceId: url, url: resolved }
    throw new Error('[appliers] 资源引用解析不出可用地址：' + url)
  }
  const res = deps.resources
  // 没有资源库（离线 / 极简宿主）：只能保留地址（迁移期兜底，节点里没有 resourceId）。
  if (!res || typeof res.put !== 'function') return { url }
  try {
    const bytes = deps.fetchBytes ? await deps.fetchBytes(url) : await (await fetch(url)).blob()
    const ref = await res.put(bytes, { kind: deps.kind ?? 'video' })
    const resolved = await res.resolve(ref)
    // 引用拿到了就算成功；地址解析不出来就不写地址字段（引用本身别塞进地址字段）。
    return resolved ? { resourceId: ref, url: resolved } : { resourceId: ref }
  } catch {
    return { url }
  }
}

/**
 * 视频：把产物落进本画布资源目录，再写 data.resourceId（地址作为迁移期副本一并写）。
 *
 * 落地是 async 的，所以这里返回 Promise —— 调用方（底栏的写入器契约）本来就 await 它。
 *
 * 写不进去（引用解析不出 / 取字节失败）→ **不写节点**（保留原值）。理由：与其写一个打不开的地址
 * 让用户看到空白，不如什么都不动、让上一张图/上一段视频继续显示。
 */
export async function writeVideoResult(
  doc: DocLike,
  nodeId: string,
  result: ToolResultLike,
  deps: { resources?: Parameters<typeof localizeUrl>[1]['resources']; fetchBytes?: (u: string) => Promise<Blob> } = {},
): Promise<void> {
  const url = result.urls?.[0]
  if (!url) return
  try {
    const local = await localizeUrl(url, { resources: deps.resources, ...(deps.fetchBytes ? { fetchBytes: deps.fetchBytes } : {}), kind: 'video' })
    const data: Record<string, unknown> = {}
    if (local.resourceId) data.resourceId = local.resourceId
    // 迁移期兼容：VideoContent 已优先按 resourceId 现取，但导出 / 预览等读取方还认地址。
    if (local.url) data.videoUrl = local.url
    if (Object.keys(data).length > 0) doc.updateNode?.(nodeId, { data })
  } catch (err) {
    console.warn('[cloud-client] 视频产物地址不可用，保留节点原值：', err)
  }
}

/** 音频：同上，写 data.resourceId + data.audioUrl（迁移期），顺带记文件名；写不进去同样不写节点 */
export async function writeAudioResult(
  doc: DocLike,
  nodeId: string,
  result: ToolResultLike,
  deps: { resources?: Parameters<typeof localizeUrl>[1]['resources']; fetchBytes?: (u: string) => Promise<Blob> } = {},
): Promise<void> {
  const url = result.urls?.[0]
  if (!url) return
  try {
    const local = await localizeUrl(url, { resources: deps.resources, ...(deps.fetchBytes ? { fetchBytes: deps.fetchBytes } : {}), kind: 'audio' })
    const data: Record<string, unknown> = {}
    if (local.resourceId) data.resourceId = local.resourceId
    // 迁移期兼容：AudioContent 目前仍只读 audioUrl。
    if (local.url) data.audioUrl = local.url
    const name = (local.url ?? '').split('/').pop() ?? ''
    if (name) data.audioName = name
    if (Object.keys(data).length > 0) doc.updateNode?.(nodeId, { data })
  } catch (err) {
    console.warn('[cloud-client] 音频产物地址不可用，保留节点原值：', err)
  }
}
