/**
 * slotKinds —— 参考格「收什么」的唯一类型表。
 *
 * 用户口径（2026-10-28）：槽位有图片 / 视频 / 音频 / 文本四种。
 * 拖拽时**每经过一个格子都按这里的规则实时判断**：匹配才高亮、才允许放下；
 * 不匹配必须当场给提示，不能等松手才报错、更不能放错格。
 *
 * 为什么单独一张表：判定同时被「上传本地文件」「Ctrl 拖节点」「拖拽悬停提示」三条路径使用。
 * 分散写就会出现同一种格子三套说法（以前 refSlots 就只认三种媒体，文本根本没有槽）。
 */

/** 参考格种类；av = 音视频混合格 */
export type SlotKind = 'image' | 'video' | 'audio' | 'text' | 'av'

/** 能放进参考格的内容类型（文本是一等公民） */
export type SlotMedia = 'image' | 'video' | 'audio' | 'text'

/** 每种格子的中文名与本地文件选择器 accept */
export const SLOT_KIND_META: Record<SlotKind, { label: string; accept: string }> = {
  image: { label: '图片', accept: 'image/*' },
  video: { label: '视频', accept: 'video/*' },
  audio: { label: '音频', accept: 'audio/*' },
  text: { label: '文本', accept: 'text/plain,.txt,.md,.markdown' },
  av: { label: '音视频', accept: 'video/*,audio/*' },
}

/** 这个格子收不收这种内容 */
export function slotAccepts(kind: SlotKind, media: SlotMedia | null): boolean {
  if (!media) return false
  if (kind === 'av') return media === 'video' || media === 'audio'
  return kind === media
}

/** 格子收什么的完整说法（音视频要写成「视频或音频」，不能直接念表名） */
export function slotAcceptsLabel(kind: SlotKind): string {
  return kind === 'av' ? '视频或音频' : SLOT_KIND_META[kind].label
}

/** 格子的完整说法（提示里用）：「这个槽位只收图片」 */
export function slotOnlyAcceptsLabel(kind: SlotKind): string {
  return SLOT_KIND_META[kind].label
}

/**
 * 拖来源的说法：「图片 1」/「文本 2」。
 * 提示要能被 8 岁小孩直接读懂，所以用中文名而不是内部 kind。
 */
export function mediaLabel(media: SlotMedia): string {
  return SLOT_KIND_META[media].label
}

/** 不匹配时的完整提示 */
export function slotMismatchHint(kind: SlotKind, media: SlotMedia): string {
  return '这个槽位只收' + slotAcceptsLabel(kind) + '，你拖的是' + mediaLabel(media)
}

