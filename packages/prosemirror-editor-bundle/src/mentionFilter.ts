/**
 * mentionFilter —— @ 菜单的候选过滤（纯函数，零 DOM，可单测）。
 *
 * 用户口径（2026-10-05）：输入 @ 后接着打的字就是**搜索词**，列表要跟着筛，
 * 且**优先显示搜索结果的前 5 项** —— 候选项多时只摆最相关的前几条，菜单不糊一大片。
 *
 * 没有搜索词（刚打出 @）= 浏览全部，不截断（那时是靠分组慢慢看）。
 */

/** 搜索态下最多显示几条 */
export const MAX_MENTION_RESULTS = 5

/** 过滤需要的最小形状（ResourceItem 的子集，避免为它引一个 Vue 类型） */
export interface MentionCandidate {
  name: string
}

/**
 * 按搜索词过滤 + 截断。
 *
 * @param all   全部候选（保持调用方给的顺序 —— 顺序本身就是「相关度」，前面更相关）
 * @param query 搜索词（空串 = 浏览态）
 */
export function filterMentionItems<T extends MentionCandidate>(all: readonly T[], query: string): T[] {
  if (!query) return [...all]
  const q = query.toLowerCase()
  return all.filter((item) => item.name.toLowerCase().includes(q)).slice(0, MAX_MENTION_RESULTS)
}
