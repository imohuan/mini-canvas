/**
 * assetSiblings —— 「同一个文件夹里的文件，按可见顺序排成一列」（纯函数，Node 可单测）。
 *
 * 用户口径（2026-10-14）：「这两个区域的全局预览都提供一个列表，就是可以通过左右快捷键
 * 来回切换的那种效果。比如在文件夹里，它只处理同一级别的文件夹中的文件预览」。
 *
 * 两句话拆开就是本文件的两条规则：
 *   ① **只同级**：跟着**当前这一行所在的文件夹**走 —— 不跨文件夹、不带子文件夹里的东西，
 *      也不带根目录里那些没归文件夹的文件（它们在另一层）。
 *   ② **按可见顺序**：用的是宿主交给树的 `rows`（有序扁平行）里**同一层的资产行**顺序。
 *      不另按名称或时间重排 —— 眼睛看到的顺序就是左右键走的顺序，所见即所得。
 *
 * 为什么吃 `rows` 而不是自己过滤 `assets`：树的行列表已经是「文件夹 + 资产混排、带着层级」
 * 的唯一真相（抽屉与弹窗各自算好喂给 <AssetTree>）。从它里面挑同一层的资产行，
 * 就不会出现「筛选/折叠之后列表和画面对不上」的问题 ——
 * 折叠起来的文件夹里的文件本来就不在 rows 里，自然也不会被左右键翻出来。
 *
 * 已知取舍（记下来免得以后当成 bug）：带着搜索/类型筛选时，rows 里剩下的就是筛过的那些，
 * 于是左右键也只在筛过的范围里走。这与「所见即所得」是同一条规则，不做特例。
 */

/** 最小形状：只需要「是不是资产行 + 在哪一层 + 能不能预览」 */
export interface SiblingRow {
  kind: 'folder' | 'asset'
  id: string
  name: string
  /** 所在文件夹（空 = 根目录） */
  parentId?: string
  /** 资产：可加载的地址（空 = 预览不了，跳过） */
  url?: string
  /**
   * 资产类型（image / video / audio / node-package / other）。
   * 切张时按它选渲染分支（2026-10-28 修「切到节点包显示视频加载失败」）。
   */
  assetKind?: string
}

/** 一层用「空串」表示根目录，便于直接比较（与 assetSelection.layerOf 同一口径） */
const layerOf = (row: { parentId?: string }): string => row.parentId ?? ''

/**
 * 与 `row` **同层、且能预览**的资产行（保持 rows 里的原顺序）。
 *
 * 「能预览」= 行上有 url。没有 url 的行（还没登记地址的老资产）跳过 ——
 * 否则左右键会切到一张空白页，看起来像预览坏了。
 */
export function siblingAssets<T extends SiblingRow>(rows: T[], row: SiblingRow): T[] {
  return rows.filter((r) => r.kind === 'asset' && !!r.url && layerOf(r) === layerOf(row))
}

/**
 * 预览请求要带的那三样：地址列、名字列、当前下标。
 *
 * `index` 在**找不到**当前行时回 0（列表非空就一定有个合法起点，预览不该白开）。
 * `list` 为空时（这一层一个能预览的都没有，理论上不该发生 —— 用户点的那行总该有 url）
 * 调用方应退回「不带列表」的单张预览。
 */
export function siblingPreview<T extends SiblingRow>(
  rows: T[],
  row: SiblingRow,
): { list: string[]; names: string[]; kinds: string[]; index: number } {
  const group = siblingAssets(rows, row)
  const list = group.map((r) => r.url ?? '')
  const names = group.map((r) => r.name)
  const kinds = group.map((r) => r.assetKind ?? 'other')
  const i = group.findIndex((r) => r.id === row.id)
  return { list, names, kinds, index: i < 0 ? 0 : i }
}
