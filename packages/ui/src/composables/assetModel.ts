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
  /** 本机绝对路径（引用到本机 Agent 用；空 = 字节不在本机） */
  path?: string
  /** 所属文件夹（空 = 根目录「个人资产库」） */
  folderId?: string
  tags: string[]
  source: string
}

export function toAssetItems(list: AssetSummary[]): AssetItem[] {
  return (list ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    url: a.url,
    ...(a.path ? { path: a.path } : {}),
    ...(a.folderId ? { folderId: a.folderId } : {}),
    tags: a.tags ?? [],
    source: a.source,
  }))
}

/** 资产按类型计数（喂给资产页小统计） */
/**
 * 该资产能否被「添加到 Agent / 添加到画布」。
 *
 * 用户口径：**没有本机绝对路径的资产不给这两个入口**（菜单按钮直接不出现）——
 * 它的字节不在本机（例如已下线生成服务留下的死链），引用出去对方也取不到，
 * 给了按钮只会让人白点一次。
 */
export function isAssetUsable(a: { path?: string } | null | undefined): boolean {
  return !!a?.path
}

export function countByKind(list: AssetItem[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of list) out[a.kind] = (out[a.kind] ?? 0) + 1
  return out
}

/**
 * 取一份资产的类型（**单一来源**）。
 *
 * 为什么要有这个函数：资产对象在不同地方字段名不一样 ——
 * 后端/AssetItem 用 `kind`，而列表行（抽屉/弹窗的 assetRows）用 `assetKind`。
 * 各处自己写 `x.kind` 就会漏（实测踩过两次：预览打不开、添加到画布没反应）。
 * 统一从这里取，谁都不许再直接读字段。
 */
export function assetKindOf(a: { kind?: string; assetKind?: string } | null | undefined): string {
  if (!a) return 'other'
  return a.assetKind ?? a.kind ?? 'other'
}
