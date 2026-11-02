import { computed, nextTick, ref } from 'vue'
import type { AssetTreeRow } from '../../AssetTree.vue'
import { useUi } from '../../../composables/ui'
import { checkedRowIds } from '../../../composables/assetSelection'
import { folderIconComponent } from '../../../composables/folderIcons'
import { openAssetPreviewFromAsset } from '../../../composables/assetUiBus'
import { siblingPreview } from '../../../composables/assetSiblings'

/**
 * LeftDrawer 资产页的树状态与动作。
 *
 * 从 LeftDrawer.vue 原样搬出：行顺序、折叠、改名、勾选、菜单、上传与批量动作都不改。
 * 搜索输入框的 DOM 引用仍由组件持有，这里只接收打开/关闭搜索的回调。
 */
export function useAssetTreeActions() {
  const ui = useUi()
  const s = ui.state

  /** 类型筛选：再点一次同一个 = 取消筛选（回到「全部」） */
  const ASSET_KINDS = ['全部', '图片', '视频', '音频', '其他'] as const
  /** 标签固定清单（用户口径：暂时就这几个） */
  // 「节点」= 节点包（.mcnode）用的标签；与 composables/ui.ts 的 assetTagOptions 同一份口径
  const ASSET_TAGS = ['角色', '场景', '物品', '风格', '音效', '节点'] as const
  function pickAssetKind(k: string): void {
    s.assetFilterKind = s.assetFilterKind === k ? '全部' : (k as typeof s.assetFilterKind)
  }

  /** 上传：点「创建」按钮触发文件选择（支持多选），选完直传后台 */
  const uploadInput = ref<HTMLInputElement | null>(null)
  /** 搜索态开关（普通态 ⇄ 搜索输入框） */
  const assetSearchActive = ref(false)
  /** 「+」下拉：新建文件夹 / 上传资产 */
  const plusOpen = ref(false)
  /** 正在内联改名的文件夹 id + 编辑缓冲 */
  const renamingFolderId = ref<string | null>(null)
  const renamingValue = ref('')
  /** 展开的文件夹（默认全展开） */
  const expandedFolders = ref<Record<string, boolean>>({})
  /** 上传弹窗 */
  const uploadOpen = ref(false)

  /**
   * 文件夹图标：选择器住在菜单组件里（AssetRowMenu 的「更改图标」二级面板），
   * 这里只提供两件事 —— 「某文件夹当前显示什么图标」与「图标名 → 组件」。
   */
  function folderIconNameOf(id: string): string {
    return ui.assetFolders.value.find((x) => x.id === id)?.icon ?? ''
  }
  /** 图标名 → lucide 组件（缩略角标用）—— 映射唯一一份在 composables/folderIcons.ts */
  const folderIconCmp = (name: string): unknown => folderIconComponent(name)

  /** 「+」→ 新建文件夹：调后台建（名字先用默认，建完进入改名态让用户直接敲名字） */
  async function addFolder(parentId?: string): Promise<void> {
    await ui.newAssetFolder('新建文件夹', parentId)
    // 建完拿到真 id：刷新后最后一个同名 folder 就是它 —— 改用「进入改名态」由模板渲染 input
    const made = [...ui.assetFolders.value].pop()
    if (made) startRename(made.id, made.name)
  }

  /**
   * 内联重命名（文件夹与资产共用一条）：把该行换成输入框，聚焦并全选，回车/失焦提交、Esc 取消。
   */
  function startRename(id: string, name: string): void {
    renamingFolderId.value = id
    renamingValue.value = name
    nextTick(() => {
      const el = document.querySelector<HTMLInputElement>('input[data-row-rename]')
      el?.focus()
      el?.select()
    })
  }
  function toggleFolderExpand(id: string): void {
    expandedFolders.value[id] = expandedFolders.value[id] === false
  }
  /** 是否折叠（默认展开 true → 未记录 = 展开） */
  function isCollapsed(id: string): boolean {
    return expandedFolders.value[id] === false
  }
  /** 某文件夹下的资产（含搜索/类型过滤后的） */
  function assetsIn(folderId?: string) {
    return ui.filteredAssets.value.filter((a) => (a.folderId ?? undefined) === folderId)
  }
  /** 根层文件夹（空态判定用） */
  const rootFolders = computed(() => ui.assetFolderTree.value)

  /**
   * 资产列表的**有序扁平行**（文件夹 + 资产混排，带层级深度）。
   * 渲染交给共用组件 <AssetTree>；这里只负责「算出这一版行」。
   */
  const assetRows = computed<AssetTreeRow[]>(() => {
    const out: AssetTreeRow[] = []
    const folders = ui.assetFolders.value
    const walk = (parentId: string | undefined, depth: number): void => {
      for (const f of folders.filter((x) => (x.parentId ?? undefined) === parentId)) {
        out.push({ kind: 'folder', id: f.id, name: f.name, depth, count: assetsIn(f.id).length, ...(parentId ? { parentId } : {}) })
        if (isCollapsed(f.id)) continue
        walk(f.id, depth + 1)
      }
      for (const a of assetsIn(parentId)) {
        out.push({ kind: 'asset', id: a.id, name: a.name, depth, url: a.url, tags: a.tags, assetKind: a.kind, ...(a.path ? { path: a.path } : {}), ...(parentId ? { parentId } : {}) })
      }
    }
    walk(undefined, 0)
    return out
  })
  /** 收起（不展开）的文件夹 id 列表：喂给共用树（它自己不持状态） */
  const collapsedFolderIds = computed(() => Object.keys(expandedFolders.value).filter((id) => expandedFolders.value[id] === false))

  const flatFolders = computed(() => {
    const out: { id: string; name: string; depth: number }[] = []
    const walk = (list: typeof ui.assetFolderTree.value, depth: number): void => {
      for (const f of list) {
        out.push({ id: f.id, name: f.name, depth })
        walk(f.children, depth + 1)
      }
    }
    walk(ui.assetFolderTree.value, 0)
    return out
  })

  /** 共用树要的「移动到 / 添加到」目标（平铺 + 缩进；排除自身由调用点给的行决定） */
  function treeMoveTargets(row: AssetTreeRow): { id: string; name: string; depth: number }[] {
    return flatFolders.value.filter((x) => x.id !== row.id)
  }

  /** 「⋯」/ 右键菜单动作：抽屉这一侧的行为 */
  function onTreeAddAgent(row: AssetTreeRow): void {
    if (row.kind === 'folder') ui.addFolderToAgent({ id: row.id, name: row.name })
    // folderId 带上（= 这行所在文件夹）：Agent 里点这颗标签要能打开资产管理并展开到该层
    else ui.addAssetToAgent({ name: row.name, url: row.url ?? '', ...(row.path ? { path: row.path } : {}), ...(row.parentId ? { folderId: row.parentId } : {}) })
  }
  function onTreeAddCanvas(row: AssetTreeRow): void {
    if (row.kind === 'folder') void folderAddToCanvas(row)
    else ui.addAssetToCanvas({ name: row.name, url: row.url ?? '', assetKind: row.assetKind })
  }

  /** 文件夹加到画布的确认弹窗状态（数量 > 10 时出现） */
  const folderConfirm = ref<{ folderId: string; name: string; count: number } | null>(null)
  let folderConfirmResolve: ((ok: boolean) => void) | null = null
  function confirmAddFolder(row: AssetTreeRow): Promise<boolean> {
    return new Promise((resolve) => {
      folderConfirm.value = { folderId: row.id, name: row.name, count: ui.assetItems.value.filter((a) => a.folderId === row.id).length }
      folderConfirmResolve = resolve
    })
  }
  async function folderAddToCanvas(row: AssetTreeRow): Promise<void> {
    const created = await ui.addFolderAssetsToCanvas(row.id, { confirm: confirmAddFolder.bind(null, row) })
    if (created) folderConfirm.value = null
  }
  function onFolderConfirmOk(): void {
    folderConfirmResolve?.(true)
    folderConfirmResolve = null
  }
  function onFolderConfirmCancel(): void {
    folderConfirmResolve?.(false)
    folderConfirmResolve = null
    folderConfirm.value = null
  }
  function onTreeChildFolder(row: AssetTreeRow): void {
    void folderAddChild(row.id)
  }
  function onTreeMoveTo(payload: { row: AssetTreeRow; targetFolderId?: string }): void {
    if (payload.row.kind === 'folder') void folderMoveTo(payload.row.id, payload.targetFolderId)
    else void ui.moveSelectedAssets(payload.targetFolderId, [payload.row.id])
  }
  function onTreeSetIcon(payload: { row: AssetTreeRow; icon: string }): void {
    void ui.setAssetFolderIcon(payload.row.id, payload.icon)
  }
  function onTreeSetTags(payload: { row: AssetTreeRow; tags: string[] }): void {
    void ui.tagsForAsset(payload.row.id, payload.tags)
  }
  function onTreeDownload(row: AssetTreeRow): void {
    if (row.kind === 'folder') folderDownload(row.id, row.name)
    else downloadAsset(row.url ?? '', row.name)
  }
  function onTreeRemove(row: AssetTreeRow): void {
    if (row.kind === 'folder') void folderRemove(row.id, row.name)
    else void ui.deleteAssetById(row.id)
  }

  /** 改名提交（文件夹 / 资产共用一条内联输入） */
  async function onTreeRenameCommit(payload: { kind: 'folder' | 'asset'; id: string; name: string }): Promise<void> {
    renamingFolderId.value = null
    const name = payload.name.trim()
    if (!name) return
    if (payload.kind === 'folder') await ui.renameAssetFolderById(payload.id, name)
    else await ui.renameAssetById(payload.id, name)
  }

  /** 资产行点击：批量模式下 = 勾选；否则预览 */
  function onTreeOpenAsset(row: AssetTreeRow, e?: MouseEvent): void {
    if (s.assetBatchOn) {
      // 点资产行本身也是勾选（Shift 划区间的判定与勾选框同一条路）
      ui.toggleAssetSelected(row.id, { rows: assetRows.value, shift: Boolean(e?.shiftKey) })
      return
    }
    // 带上**同层文件**清单：折叠/筛选之后左右键走的范围与眼睛看到的一致。
    openAsset(
      { id: row.id, name: row.name, url: row.url ?? '', assetKind: row.assetKind },
      siblingPreview(assetRows.value, row),
    )
  }

  /**
   * 勾选框点击（共用树抛上来的是「行 id + 这一下有没有按 Shift」）。
   */
  function onTreeToggleSelect(id: string, shift?: boolean): void {
    ui.toggleAssetSelected(id, { rows: assetRows.value, shift: Boolean(shift) })
  }

  /**
   * 喂给共用树的「哪些行显示成勾上」。
   */
  const checkedIds = computed(() =>
    checkedRowIds(assetRows.value, s.assetSelectedIds, ui.assetItems.value),
  )

  /** 拖拽落下：文件夹 → 嵌套进目标文件夹；资产 → 挪进目标文件夹（to = null 表示根目录） */
  async function onTreeDrop(payload: { from: AssetTreeRow; to: AssetTreeRow | null }): Promise<void> {
    const targetId = payload.to?.id
    if (payload.from.kind === 'folder') await ui.moveAssetFolderTo(payload.from.id, targetId)
    else await ui.moveSelectedAssets(targetId, [payload.from.id])
  }

  function onBatchAdd(folderId: string): void {
    void ui.moveSelectedAssets(folderId)
    ui.toggleAssetBatch(false)
  }
  function onBatchMove(folderId?: string): void {
    void ui.moveSelectedAssets(folderId)
    ui.toggleAssetBatch(false)
  }
  function onBatchTags(tags: string[]): void {
    for (const id of s.assetSelectedIds) void ui.tagsForAsset(id, tags)
  }
  function onBatchRemove(): void {
    for (const id of [...s.assetSelectedIds]) void ui.deleteAssetById(id)
    ui.toggleAssetBatch(false)
  }
  function onBatchDownload(): void {
    for (const id of s.assetSelectedIds) {
      const a = ui.assetItems.value.find((x) => x.id === id)
      if (!a) continue
      const link = document.createElement('a')
      link.href = a.url
      link.download = a.name
      link.click()
    }
  }
  /** 单个资产下载（列表行菜单用） */
  function downloadAsset(url: string, name: string): void {
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
  }
  /** 新建子文件夹 */
  async function folderAddChild(parentId: string): Promise<void> {
    await addFolder(parentId)
  }
  /** 移动到（二级菜单目标） */
  async function folderMoveTo(id: string, target: string | undefined): Promise<void> {
    await ui.moveAssetFolderTo(id, target)
  }
  /** 下载：文件夹内所有资产逐个下载 */
  function folderDownload(id: string, name: string): void {
    for (const a of assetsIn(id)) {
      const link = document.createElement('a')
      link.href = a.url
      link.download = a.name
      link.click()
    }
    ui.showToast('已下载文件夹：' + name)
  }
  /** 删除 */
  async function folderRemove(id: string, name: string): Promise<void> {
    await ui.removeAssetFolder(id)
    ui.showToast('已删除文件夹：' + name)
  }

  /**
   * 上传弹窗保存：本地文件直传；**画布媒体（urls）先取字节再直传**（与 AssetUploadHost 同一条口径）。
   */
  async function onUploadSave(payload: { files: File[]; folderId?: string; tags: string[]; urls: { url: string; name: string }[] }): Promise<void> {
    uploadOpen.value = false
    await ui.uploadAssetsTo(payload.files, payload.folderId)
    if (payload.urls.length) await ui.uploadAssetsFromUrls(payload.urls, payload.folderId)
    if (payload.tags.length) {
      await ui.loadAssets()
      // 刚传的这几条：按名字对回清单（同一批重名也能覆盖到）
      // 两路都要收名字：只收 files 的话，urls 那条传上来的资产永远补不上标签
      const names = new Set(payload.files.map((f) => f.name))
      for (const u of payload.urls) names.add(u.name)
      for (const a of ui.assetItems.value) if (names.has(a.name)) await ui.tagsForAsset(a.id, payload.tags)
    }
  }
  function onUploadChange(e: Event): void {
    const input = e.target as HTMLInputElement
    if (input.files?.length) void ui.uploadAssets(input.files)
    input.value = ''
  }

  /**
   * 预览：点资产行看大图/播放。浮层本体在常驻的 <AssetUiSlot> 上。
   */
  function openAsset(
    item: { id: string; name: string; url: string; kind?: string; assetKind?: string },
    /** 同层文件清单（只处理同一级文件夹里的文件，见 composables/assetSiblings.ts） */
    group?: { list: string[]; names: string[]; index: number },
  ): void {
    // 节点包没有可加载的媒体地址：它要先取回包、解出 HTML 再给 iframe 预览
    //（用户口径 2026-10-14：「我当前的节点无法进行预览」）—— 分流收在 assetUiBus 里。
    void openAssetPreviewFromAsset(item, group)
  }

  return {
    ASSET_TAGS,
    pickAssetKind,
    uploadInput,
    assetSearchActive,
    plusOpen,
    setPlusOpen: (value: boolean) => { plusOpen.value = value },
    setUploadOpen: (value: boolean) => { uploadOpen.value = value },
    setAssetSearchActive: (value: boolean) => { assetSearchActive.value = value },
    renamingFolderId,
    renamingValue,
    uploadOpen,
    folderIconNameOf,
    folderIconCmp,
    addFolder,
    startRename,
    toggleFolderExpand,
    rootFolders,
    assetRows,
    collapsedFolderIds,
    flatFolders,
    treeMoveTargets,
    onTreeAddAgent,
    onTreeAddCanvas,
    folderConfirm,
    onFolderConfirmOk,
    onFolderConfirmCancel,
    onTreeChildFolder,
    onTreeMoveTo,
    onTreeSetIcon,
    onTreeSetTags,
    onTreeDownload,
    onTreeRemove,
    onTreeRenameCommit,
    onTreeOpenAsset,
    onTreeToggleSelect,
    checkedIds,
    onTreeDrop,
    onBatchAdd,
    onBatchMove,
    onBatchTags,
    onBatchRemove,
    onBatchDownload,
    onUploadSave,
    onUploadChange,
  }
}

export type AssetTreeActions = ReturnType<typeof useAssetTreeActions>
