/**
 * 历史弹窗的「筛选签名」与配套的小缓存工具（纯函数，零 Vue / 零 DOM，可单测）。
 *
 * 为什么签名要单独抽出来：ui.ts（拉数据、决定哪份缓存能用）与 ModalsArea.vue
 * （决定哪面墙能复用）各要拼一次同一个 key。两边各写一份，迟早漂移成
 * 「数据换了、墙没换」或者反过来。这里只定义一次，两边都来取。
 */

/** 「本画布」这个范围的中文值（与 state.histScopes 一致） */
export const HIST_SCOPE_THIS_CANVAS = '本画布'

export interface HistoryFilterKey {
  scope: string
  type: string
  rating: string
  sortDesc: boolean
  pageSize: number
}

/**
 * 一套筛选条件 → 一个字符串 key。
 *
 * **「本画布」必须带上画布 id**：ui 状态是模块级单例，切画布只重建路由组件、不重载模块，
 * 缓存与页码都活着。key 里不带画布 id，切到 B 画布打开历史会先把 A 画布的缓存整表贴出来，
 * 而后台同步只「插新卡、不删旧卡」，A 的记录就会一直赖在 B 的画布页里。
 */
export function historySignatureOf(f: HistoryFilterKey, canvasId: string): string {
  const base = [f.scope, f.type, f.rating, f.sortDesc, f.pageSize].join('|')
  return f.scope === HIST_SCOPE_THIS_CANVAS ? base + '|' + canvasId : base
}

/**
 * 内存缓存条数上限：每套筛选存一整份历史列表（含已翻过的所有页）。
 * 画布一多（「本画布」的 key 里带画布 id），不设上限就是随浏览历史无限增长。
 */
export const HIST_DATA_CACHE_LIMIT = 8

/**
 * 插入前按上限逐出最旧的条目（Map 的迭代序 = 插入序，最旧在前）。
 * 与 ModalsArea 的 wallCache（6 面墙）同一套 LRU 口径：够「来回切」用，多出来的丢弃。
 */
export function trimMapToLimit<K, V>(map: Map<K, V>, limit: number): void {
  while (map.size >= limit) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}
