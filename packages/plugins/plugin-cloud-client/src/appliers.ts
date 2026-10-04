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

/** 视频：把产物地址写进 data.videoUrl */
export function writeVideoResult(doc: DocLike, nodeId: string, result: ToolResultLike): void {
  const url = result.urls?.[0]
  if (!url) return
  doc.updateNode?.(nodeId, { data: { videoUrl: url } })
}

/** 音频：写 data.audioUrl（顺带记个文件名，播放器/下载用得上） */
export function writeAudioResult(doc: DocLike, nodeId: string, result: ToolResultLike): void {
  const url = result.urls?.[0]
  if (!url) return
  const name = url.split('/').pop() ?? ''
  doc.updateNode?.(nodeId, { data: { audioUrl: url, ...(name ? { audioName: name } : {}) } })
}
