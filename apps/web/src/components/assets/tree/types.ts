/** 树的一行（文件夹 / 资产混排，带层级深度）—— 与两处宿主原来的行结构逐字对齐 */
export interface AssetTreeRow {
  kind: 'folder' | 'asset'
  id: string
  name: string
  depth: number
  /** 文件夹：直属资产数（0 不显示角标） */
  count?: number
  /** 文件夹：当前所在父文件夹（空 = 根） */
  parentId?: string
  /** 资产：缩略图地址 */
  url?: string
  /** 资产：本机绝对路径（空 = 字节不在本机 → 不给「添加到 Agent / 添加到画布」） */
  path?: string
  /** 资产：类型（image / video / audio / other）—— 行里字段名是 assetKind（见 assetModel.assetKindOf） */
  assetKind?: string
  /** 资产：标签 */
  tags?: string[]
}

/** 「移动到」菜单的一项目标（平铺、带缩进） */
export interface AssetTreeTarget {
  id: string
  name: string
  depth: number
}
