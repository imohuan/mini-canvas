// assetSelection —— 资源树「批量勾选」的判定逻辑（纯函数，Node 可单测）。
//
// 抽出来的原因（与 assetModel 同一条思路）：勾选语义要在**两处宿主**（左侧抽屉 / 资产管理弹窗）
// 一模一样，而这两个宿主各自拿到的树数据形状只差一个字段名（folderId / parentId）。
// 判定放在这里，两处只负责「把行数据喂进来、把结果写回状态」。
//
// 用户口径（2026-10-13）：
//   ① 勾文件夹 = 连带它**直属**的资产一起勾上（子文件夹不动：「选择文件夹的时候，不带上子文件夹」）；
//   ② 支持 Shift 区间选择，以最后一次点选的那项为起点；**不支持跨文件夹**
//      （跨层时退化成普通点击，不划区间）；
//   ③「删除的时候需要将里面所有的文件也同步选择，如果你不想删除它们，可以取消选择」
//      —— 所以「已选」里放的一律是**资产 id**，文件夹行只是这些资产的勾选入口；
//      文件夹自己的勾选态由内容**推导**（见 checkedRowIds），从不作为一个待操作的项混进来。
//      好处：批量移动 / 加标签 / 下载 / 删除拿到的永远是纯粹的资产清单，不用再去分辨哪个是文件夹
//      （「已选择 N 项」的 N 也就是真的会被操作的条目数）。
//
// 宿主喂进来的是**完整**资产清单（不带搜索 / 类型筛选）：勾文件夹 = 这个文件夹里的全部直属文件，
// 与用户当时搜没搜、筛没筛无关。为什么选这一条：勾文件夹的用途就是「这个文件夹的东西整体处理掉」，
// 跟着筛选走的话，同一个文件夹在不同筛选下勾出来的东西不一样，批量条上的计数也没法解释。
// 代价：搜索时点文件夹会选中一些当前没显示成行的文件 —— 计数（已选择 N 项）会如实报出来，
// 不想要就点开文件夹里那一项单独取消。
// 「文件夹折起来了」不算不可见（折叠只是收起画面，用户点的还是那个文件夹这个动作本身）。
//
// 还有一个未变的老口径：勾选模式是**累加**的（点第二项把第一项也选上，不是替换）。
// 「清空」靠再点一次已勾上的项，或退出批量模式（两处宿主退出时都清空已选）。

/** 行的最小形状：文件夹 / 资产混排，带所在父级 */
export interface SelectableRow {
  kind: 'folder' | 'asset'
  id: string
  /** 所在文件夹（空 = 根目录） */
  parentId?: string
}

/** 资产的归属（与 AssetItem 一致：folderId 空 = 根目录） */
export interface SelectableAsset {
  id: string
  folderId?: string
}

/** 某个文件夹**直属**的资产 id（不含子文件夹里的 —— 用户口径 2026-10-13） */
export function folderContentIds(folderId: string, assets: SelectableAsset[]): string[] {
  return assets.filter((a) => (a.folderId ?? '') === folderId).map((a) => a.id)
}

/** 行所属的层：资产与文件夹都用 parentId（空串 = 根目录，便于比较） */
const layerOf = (row: SelectableRow | undefined): string => (row ? (row.parentId ?? '') : '')

// Shift 区间：a 到 b（含两端）在**行列表顺序**上的一段，只认**同一层**。
//
// 为什么按行列表而不是按树：树上「同层」的可见行正是列表里连续的这一段，
// 用列表顺序直接切最贴近用户眼睛看到的东西（折叠起来的子行不在列表里，自然不会进区间）。
// 跨层（两端 parentId 不同）→ 返回空数组，调用方据此退化成普通点击。
export function rangeRowIds(rows: SelectableRow[], aId: string, bId: string): string[] {
  const i = rows.findIndex((r) => r.id === aId)
  const j = rows.findIndex((r) => r.id === bId)
  if (i < 0 || j < 0) return []
  if (layerOf(rows[i]) !== layerOf(rows[j])) return []
  const [from, to] = i <= j ? [i, j] : [j, i]
  return rows.slice(from, to + 1).map((r) => r.id)
}

/** 一组行 id → 真正写进「已选」的资产 id：文件夹行换成它的直属资产（保持顺序、去掉重复） */
export function expandIds(rows: SelectableRow[], ids: string[], assets: SelectableAsset[]): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: string[] = []
  const seen = new Set<string>()
  const push = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
  }
  for (const id of ids) {
    // 文件夹行：换成它的直属资产（它自己不进去 —— 见文件头 ③）
    if (byId.get(id)?.kind === 'folder') for (const a of folderContentIds(id, assets)) push(a)
    else push(id)
  }
  return out
}

/**
 * 界面上该显示成「已勾上」的行 id。
 *
 * 资产行 = 它在已选里；文件夹行 = 它的直属资产**非空且全部**在已选里。
 * 为什么要有这一步：下拉/树只认一个 id 列表，而文件夹的勾选态是内容算出来的
 * （勾了它里面每一个文件 → 这个文件夹看起来就是勾上的）。
 * 空文件夹永远不勾（没有可操作的条目）。
 */
export function checkedRowIds(rows: SelectableRow[], selected: string[], assets: SelectableAsset[]): string[] {
  const got = new Set(selected)
  const out: string[] = []
  for (const row of rows) {
    if (row.kind === 'asset') {
      if (got.has(row.id)) out.push(row.id)
      continue
    }
    const content = folderContentIds(row.id, assets)
    if (content.length && content.every((id) => got.has(id))) out.push(row.id)
  }
  return out
}

export interface RowClickInput {
  /** 树的行列表（与 AssetTree 收到的一致：有序扁平） */
  rows: SelectableRow[]
  /** 资产清单（判定文件夹直属内容用） */
  assets: SelectableAsset[]
  /** 当前已选 id */
  selected: string[]
  /** 最后一次点选的项（Shift 区间的起点；空 = 还没有） */
  anchorId: string | null
  /** 这次点的行 id */
  id: string
  /** 这次点击是否按住 Shift */
  shift: boolean
}

// 一次勾选 → 新的已选集合与新的锚点。
//
// 规则：
//   普通点击：勾上 = 该行（文件夹则连带直属资产），整组已勾上则整组取消；锚点更新为这一行；
//     没被点到的行一律不动（累加式勾选，见文件头的说明）；
//   Shift 点击（有锚点且同层）：区间内**全部已选**时取消这个区间，否则把区间补全；锚点不动
//     —— 不动的意思是「下次 Shift 还从同一项算区间」，这样按住 Shift 连点几下是在同一段里增减。
export function applyRowClick(input: RowClickInput): { selected: string[]; anchorId: string } {
  const { rows, assets, selected, anchorId, id, shift } = input
  const current = new Set(selected)

  if (shift && anchorId) {
    const range = rangeRowIds(rows, anchorId, id)
    if (range.length) {
      const group = expandIds(rows, range, assets)
      const allSelected = group.every((x) => current.has(x))
      if (allSelected) for (const x of group) current.delete(x)
      else for (const x of group) current.add(x)
      return { selected: [...current], anchorId }
    }
    // 跨文件夹：不划区间，退化成下面的普通点击
  }

  const group = expandIds(rows, [id], assets)
  // 判定「要不要取消」看整组：文件夹得看它里面是不是**全**都勾着
  // （空文件夹 group 为空 → 当作没勾上，点一下什么也不发生，但仍会成为新的锚点）
  if (group.length && group.every((x) => current.has(x))) for (const x of group) current.delete(x)
  else for (const x of group) current.add(x)
  return { selected: [...current], anchorId: id }
}
