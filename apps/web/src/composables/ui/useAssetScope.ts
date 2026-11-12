import { computed, ref } from 'vue'
import {
  listAssets as apiListAssets,
  uploadAsset as apiUploadAsset,
  deleteAsset as apiDeleteAsset,
  renameAsset as apiRenameAsset,
  listAssetFolders as apiListAssetFolders,
  createAssetFolder as apiCreateAssetFolder,
  renameAssetFolder as apiRenameAssetFolder,
  moveAssetFolder as apiMoveAssetFolder,
  setAssetFolderIcon as apiSetAssetFolderIcon,
  deleteAssetFolder as apiDeleteAssetFolder,
  moveAssets as apiMoveAssets,
  setAssetTags as apiSetAssetTags,
  type AssetFolderSummary,
} from '../projectsApi'
import { toAssetItems, assetKindOf, type AssetItem } from '../assetModel'
import { applyRowClick } from '../assetSelection'
import { prefetchAssetVideoThumbs } from '../canvasTree'
import type { UiState } from './createUiState'
import type { UiHostScope } from './useUiHost'

/**
 * 资产、文件夹、标签与批量选择。
 *
 * 加载顺序、乐观更新、失败后的 loadAssets 收敛都保持原样；资产节点落画布相关动作
 * 仍留在 useCreateNodeScope（它依赖这里的 assetItems）。
 */
export function createAssetScope(state: UiState, host: UiHostScope) {
  const { hostCtx, showToast } = host


  // ===== 资产：所有**生成了产物**的历史记录（图片 / 视频 / 音频）=====
  // 用户口径：资产 = 所有生成过的列表 + 自己上传的资源。生成记录后台本来就有全量账本
  // （见 plugin-cloud-client 的 cloud-client:history 服务），这里直接复用它，不必再起一套「资产库」。
  // 只留有产物地址（urls 非空）的条目 —— 失败/无产物的记录不算资产。
  /**
   * 资产清单：来自后台 `/api/assets`（生成产物 + 自己上传，统一登记）。
   * 与历史（historyItems）分开：历史是「生成账本」（含失败记录），资产是「真的有产物的东西」。
   */
  const assetItems = ref<AssetItem[]>([])
  async function loadAssets(): Promise<void> {
    try {
      assetItems.value = toAssetItems(await apiListAssets())
    } catch {
      assetItems.value = []
    }
    void prefetchAssetThumbs()
  }
  /**
   * 资产里的视频缩略图：统一走 video 服务（一个视频一张图、存资源库、全站复用）。
   *
   * 取到新图后把 assetItems 重新赋一次（同内容新数组）—— 依赖它的 assetRows /
   * filteredAssets 会重算，行上的 <img> 就从 <video> 首帧换成统一缩略图。
   * 取不到就保持 <video> 首帧兜底，不阻塞列表渲染。
   */
  async function prefetchAssetThumbs(): Promise<void> {
    let videoSvc: { thumb?(url: string | undefined): Promise<string | null> } | undefined
    try {
      videoSvc = hostCtx()?.get<{ thumb?(url: string | undefined): Promise<string | null> }>('video')
    } catch {
      videoSvc = undefined
    }
    if (!videoSvc || typeof videoSvc.thumb !== 'function') return
    const thumb = videoSvc.thumb.bind(videoSvc)
    const items = assetItems.value
      .filter((a) => a.kind === 'video' && a.url)
      .map((a) => ({ id: a.id, url: a.url as string }))
    if (items.length === 0) return
    const touched = await prefetchAssetVideoThumbs(items, thumb)
    if (touched) assetItems.value = [...assetItems.value]
  }
  /**
   * 资产 tab 的搜索 / 筛选（用户报的「点了没效果」）。
   * 搜索按名字匹配；类型筛选按 图片/视频/音频/其他 —— 都是纯前端过滤，不打后台。
   */
  const filteredAssets = computed<AssetItem[]>(() => {
    const q = (state.assetSearchQuery || '').trim().toLowerCase()
    const kindWanted = state.assetFilterKind
    return assetItems.value.filter((a) => {
      if (q && !a.name.toLowerCase().includes(q)) return false
      if (kindWanted !== '全部') {
        // 中文筛选标签 → 后台的英文 kind
        const want = kindWanted === '图片' ? 'image' : kindWanted === '视频' ? 'video' : kindWanted === '音频' ? 'audio' : 'other'
        if (a.kind !== want) return false
      }
      return true
    })
  })
  /** 上传资产：选择文件后直传后台，成功即刷新清单（新增项会出现在列表最前） */
  async function uploadAssets(files: FileList | File[]): Promise<void> {
    const list = Array.from(files)
    for (const f of list) {
      try {
        await apiUploadAsset(f.name, f)
      } catch (err) {
        console.warn('[ui] 资产上传失败: ' + f.name, err)
      }
    }
    await loadAssets()
  }
  /** 带位置的上传（上传弹窗用）：逐个字节直传后台并登记进 folderId */
  async function uploadAssetsTo(files: FileList | File[], folderId?: string): Promise<void> {
    for (const f of Array.from(files)) {
      try {
        await apiUploadAsset(f.name, f, folderId)
      } catch (err) {
        console.warn('[ui] 资产上传失败: ' + f.name, err)
      }
    }
    await loadAssets()
  }
  /**
   * 从**画布上已有的图**上传（节点右键 / 多选「加入资产库」用）：
   * 先把地址取成字节，再走与本地文件同一条 API —— 用户口径「和左侧侧边栏点击一样」。
   */
  async function uploadAssetsFromUrls(items: { url: string; name: string }[], folderId?: string): Promise<void> {
    for (const it of items) {
      try {
        const bytes = await fetch(it.url).then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status)
          return r.blob()
        })
        await apiUploadAsset(it.name, bytes, folderId)
      } catch (err) {
        console.warn('[ui] 画布图入库失败: ' + it.name, err)
      }
    }
    await loadAssets()
  }
  /** 删除资产：调后台 DELETE 后本地摘掉该项（不用整表重拉，删一条已知 id） */
  async function deleteAssetById(id: string): Promise<void> {
    try {
      await apiDeleteAsset(id)
      assetItems.value = assetItems.value.filter((a) => a.id !== id)
    } catch (err) {
      // 删失败不能悄悄吞掉（用户 2026-10-13 报「点了删除没效果、刷新数据还在」）。
      // showToast 在成品壳里是空实现，所以这里只留下 console.warn —— 真正的兜底是下面那句
      // loadAssets：它把画面收敛回服务器真值，删没删掉一眼看得出来。
      console.warn('[ui] 资产删除失败: ' + id, err)
    }
    // 收敛到服务器真值：批量删多条时，某一条失败也能如实反映出来（本地摘除只是乐观更新）。
    await loadAssets()
  }
  /** 资产改名 */
  async function renameAssetById(id: string, name: string): Promise<void> {
    try {
      await apiRenameAsset(id, name)
      await loadAssets()
    } catch (err) {
      console.warn('[ui] 资产改名失败: ' + id, err)
    }
  }

  // ===== 资产文件夹（树形）+ 批量选择 + 标签 =====
  const assetFolders = ref<AssetFolderSummary[]>([])
  async function loadAssetFolders(): Promise<void> {
    try {
      assetFolders.value = await apiListAssetFolders()
    } catch {
      assetFolders.value = []
    }
  }
  /** 建文件夹（parentId 空 = 根目录）；成功后刷新文件夹清单 */
  /**
   * 新建资产文件夹。**返回新文件夹的 id**（拿不到 → undefined）。
   *
   * 为什么要回 id：节点包「收藏到资产库」需要"把包存进「节点库」这个文件夹，
   * 没有就现建一个"（用户口径 2026-10-14）—— 不回 id 就得建完再按名字去清单里翻，
   * 而同名文件夹可能有多个，翻出来的未必是刚建的那个。
   */
  async function newAssetFolder(name: string, parentId?: string): Promise<string | undefined> {
    try {
      const made = await apiCreateAssetFolder(name, parentId)
      await loadAssetFolders()
      return made?.id
    } catch (err) {
      console.warn('[ui] 新建文件夹失败: ' + name, err)
      return undefined
    }
  }
  async function renameAssetFolderById(id: string, name: string): Promise<void> {
    try {
      await apiRenameAssetFolder(id, name)
      await loadAssetFolders()
    } catch (err) {
      console.warn('[ui] 文件夹改名失败: ' + id, err)
    }
  }
  async function setAssetFolderIcon(id: string, icon: string): Promise<void> {
    try {
      await apiSetAssetFolderIcon(id, icon)
      await loadAssetFolders()
    } catch (err) {
      console.warn('[ui] 设置文件夹图标失败: ' + id, err)
    }
  }
  async function removeAssetFolder(id: string): Promise<void> {
    try {
      await apiDeleteAssetFolder(id)
      await Promise.all([loadAssetFolders(), loadAssets()])
    } catch (err) {
      console.warn('[ui] 删文件夹失败: ' + id, err)
    }
  }
  /** 文件夹移动（拖拽嵌套 / 「移动到」二级菜单共用）：target 空 = 回根 */
  async function moveAssetFolderTo(id: string, parentId?: string): Promise<void> {
    try {
      await apiMoveAssetFolder(id, parentId)
      await loadAssetFolders()
    } catch (err) {
      console.warn('[ui] 移动文件夹失败: ' + id, err)
    }
  }
  /**
   * 批量移动（「移动到」= 真挪；「添加到」= 也落归属，后台同一字段）。
   *
   * 成功给一句 toast（用户报过「移动到没生效」：其实挪成了，但列表里没明显变化、
   * 也没有任何反馈，看着像没反应）。loadAssets 之后 assetFolderTree 的 count 也会跟着重算。
   *
   * 传进来的 id 一律是**资产 id**（勾文件夹只会把它里面的文件放进已选，见 assetSelection
   * 的文件头说明），所以这里不需要分辨文件夹。
   */
  async function moveSelectedAssets(folderId?: string, idList?: string[]): Promise<void> {
    const ids = idList ?? [...state.assetSelectedIds]
    if (!ids.length) return
    try {
      await apiMoveAssets(ids, folderId)
      await loadAssets()
      const target = folderId ? assetFolders.value.find((f) => f.id === folderId)?.name : ''
      showToast('已移动 ' + ids.length + ' 项到「' + (target || '个人资产库') + '」')
    } catch (err) {
      console.warn('[ui] 批量移动失败', err)
    }
  }
  /** 单资产挪文件夹（上传弹窗按位置归档用） */
  async function moveAssetTo(id: string, folderId?: string): Promise<void> {
    try {
      await apiMoveAssets([id], folderId)
      await loadAssets()
    } catch (err) {
      console.warn('[ui] 移动资产失败: ' + id, err)
    }
  }
  /** 给单个资产覆盖标签 */
  async function tagsForAsset(id: string, tags: string[]): Promise<void> {
    try {
      await apiSetAssetTags(id, tags)
      await loadAssets()
    } catch (err) {
      console.warn('[ui] 设置标签失败: ' + id, err)
    }
  }
  /** 批量选择开关：退出时清空已选 */
  function toggleAssetBatch(on?: boolean): void {
    state.assetBatchOn = on ?? !state.assetBatchOn
    if (!state.assetBatchOn) {
      state.assetSelectedIds = []
      state.assetSelectAnchorId = null
    }
  }
  /**
   * 勾选一行（勾选框 / 资产行点击共用）：文件夹连带**直属**资产、Shift 划区间，
   * 判定在 composables/assetSelection.ts（纯函数，有单测）。
   *
   * 这里只喂两样东西：行列表（决定区间与层级）与资产清单（决定文件夹直属内容），
   * 所以抽屉与弹窗两处宿主的行为天然一致。
   */
  function toggleAssetSelected(
    id: string,
    opts?: { rows?: { kind: 'folder' | 'asset'; id: string; parentId?: string }[]; shift?: boolean },
  ): void {
    const next = applyRowClick({
      rows: opts?.rows ?? [],
      assets: assetItems.value,
      selected: state.assetSelectedIds,
      anchorId: state.assetSelectAnchorId,
      id,
      shift: Boolean(opts?.shift),
    })
    state.assetSelectedIds = next.selected
    state.assetSelectAnchorId = next.anchorId
  }

  /** 资产文件夹树（含每层下的资产数量，供行尾角标） */
  const assetFolderTree = computed(() => {
    type FolderNode = AssetFolderSummary & { children: FolderNode[]; count: number }
    const byId = new Map<string, FolderNode>()
    for (const f of assetFolders.value) byId.set(f.id, { ...f, children: [], count: 0 })
    const roots: FolderNode[] = []
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    // 数量 = 直接挂在文件夹下的资产数（不含子文件夹，直观对应「这个文件夹里有几张」）
    for (const a of assetItems.value) {
      const key = a.folderId ?? ''
      const node = byId.get(key)
      if (node) node.count++
    }
    const sortRec = (list: FolderNode[]) => {
      list.sort((x, y) => x.name.localeCompare(y.name, 'zh'))
      for (const n of list) sortRec(n.children)
    }
    sortRec(roots)
    return roots
  })

  // ===== 「加入资产库」上传弹窗的共享输入（节点右键 / 多选两条入口的宿主用）=====
  /** 平铺的文件夹行（上传弹窗「保存位置」下拉用；与左侧那个弹窗同一份数据） */
  const flatFoldersForUpload = computed(() => {
    const out: { id: string; name: string; depth: number }[] = []
    const walk = (list: typeof assetFolderTree.value, depth: number): void => {
      for (const f of list) {
        out.push({ id: f.id, name: f.name, depth })
        walk(f.children, depth + 1)
      }
    }
    walk(assetFolderTree.value, 0)
    return out
  })
  /**
   * 标签固定清单（上传弹窗「设置标签」用；与 LeftDrawer 的 ASSET_TAGS 同一份口径）。
   *
   * 「节点」是 2026-10-13 为节点包加的：收藏进来的包默认打这个标签，
   * 筛起来一眼能找到"哪些是可复用的节点"。
   */
  const assetTagOptions = computed(() => ['角色', '场景', '物品', '风格', '音效', '节点'])

  return {
    assetItems, filteredAssets, loadAssets, uploadAssets, uploadAssetsTo, uploadAssetsFromUrls,
    deleteAssetById, renameAssetById, assetFolders, loadAssetFolders, newAssetFolder,
    renameAssetFolderById, setAssetFolderIcon, removeAssetFolder, moveAssetFolderTo,
    moveSelectedAssets, moveAssetTo, tagsForAsset, toggleAssetBatch, toggleAssetSelected,
    assetFolderTree, flatFoldersForUpload, assetTagOptions,
  }
}

export type AssetScope = ReturnType<typeof createAssetScope>

