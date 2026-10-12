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
 * 把产物地址**收进本画布资源目录**，返回可写进节点的地址。
 *
 * ## 为什么必须有（2026-10-12 用户实测报的问题）
 *
 * provider 回的产物是**另一个服务**的地址（如 `http://localhost:8033/...`）。直接写进节点
 * 会带来三个后果：换机器/换端口就打不开；跨源、受对方服务可用性影响；画布数据里混着两套地址。
 * 用户口径：「应该把这些 URL 统统转为自己的 URL」。
 *
 * 做法与后台的 `taskManager.writeMediaFields` 同一套：取字节 → 交给资源服务 → 拿回本画布地址。
 *
 * **拿不到就回落原地址**：保住产物是底线，宁可留个外链也不要让用户看到空白。
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
): Promise<string> {
  // 已经是本画布地址就不用再落一次（否则每写一次多存一份字节）
  if (/^\/api\/canvases\/[^/]+\/resources\//.test(url) || /^res-/.test(url)) return url
  const res = deps.resources
  if (!res || typeof res.put !== 'function') return url
  try {
    const bytes = deps.fetchBytes ? await deps.fetchBytes(url) : await (await fetch(url)).blob()
    const ref = await res.put(bytes, { kind: deps.kind ?? 'video' })
    const resolved = await res.resolve(ref)
    return resolved || url
  } catch {
    return url
  }
}

/**
 * 视频：把产物落进本画布资源目录，再写 data.videoUrl。
 *
 * 落地是 async 的，所以这里返回 Promise —— 调用方（底栏的写入器契约）本来就 await 它。
 */
export async function writeVideoResult(
  doc: DocLike,
  nodeId: string,
  result: ToolResultLike,
  deps: { resources?: Parameters<typeof localizeUrl>[1]['resources']; fetchBytes?: (u: string) => Promise<Blob> } = {},
): Promise<void> {
  const url = result.urls?.[0]
  if (!url) return
  const local = await localizeUrl(url, { resources: deps.resources, ...(deps.fetchBytes ? { fetchBytes: deps.fetchBytes } : {}), kind: 'video' })
  doc.updateNode?.(nodeId, { data: { videoUrl: local } })
}

/** 音频：同上，写 data.audioUrl（顺带记个文件名，播放器/下载用得上） */
export async function writeAudioResult(
  doc: DocLike,
  nodeId: string,
  result: ToolResultLike,
  deps: { resources?: Parameters<typeof localizeUrl>[1]['resources']; fetchBytes?: (u: string) => Promise<Blob> } = {},
): Promise<void> {
  const url = result.urls?.[0]
  if (!url) return
  const local = await localizeUrl(url, { resources: deps.resources, ...(deps.fetchBytes ? { fetchBytes: deps.fetchBytes } : {}), kind: 'audio' })
  const name = local.split('/').pop() ?? ''
  doc.updateNode?.(nodeId, { data: { audioUrl: local, ...(name ? { audioName: name } : {}) } })
}
