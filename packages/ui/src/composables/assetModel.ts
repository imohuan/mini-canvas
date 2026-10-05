/**
 * assetModel —— 资产的**纯形状映射**（Node 可单测，不碰网络）。
 *
 * 后端 `/api/assets` 的形状 → 抽屉要的 { id, name, kind, url, source }。
 * 单独抽出来是为了：① 形状一处理错就单测抓得住；② ui.ts 只负责取数。
 */
import type { AssetSummary } from './projectsApi'

export interface AssetItem {
  id: string
  name: string
  kind: string
  url: string
  source: string
}

export function toAssetItems(list: AssetSummary[]): AssetItem[] {
  return (list ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind, url: a.url, source: a.source }))
}

/** 资产按类型计数（喂给资产页小统计） */
export function countByKind(list: AssetItem[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of list) out[a.kind] = (out[a.kind] ?? 0) + 1
  return out
}
