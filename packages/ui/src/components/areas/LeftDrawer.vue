<script setup lang="ts">
// 左侧抽屉：头部（复用 ProjectCluster）+ 画布/资产 tab + 列表/宫格双模式树 + 底部收起条 + 拖宽手柄。
// 图标用 LibIcon（照 LibTV 官网 SVG 原样复刻），交互行为照目标实测。
import { ref, computed, isRef, nextTick, h, defineComponent, onMounted, onBeforeUnmount, reactive, watch, markRaw } from 'vue'
import { ArrowLeftToLine as ArrowLeftToLineIcon, Folder as FolderIcon, Video as VideoIcon, Type as TypeIcon, Image as ImageIcon, Music as AudioIcon, Download as DownloadIcon, Trash2 as Trash2Icon, Plus as PlusIcon, FolderPlus as FolderPlusIcon, Upload as UploadIcon, Check as CheckIcon, ChevronRight as ChevronIcon, MoreHorizontal as MoreIcon, Palette as PaletteIcon, Pencil as PencilIconLucide, ArrowRightFromLine as AddCanvasIcon, Wand2 as AgentIcon, Cloud as CloudIcon, Aperture as ApertureIcon, Car as CarIcon, BookUser as BookUserIcon, CircleDot as CircleDotIcon, Plane as PlaneIcon, Film as FilmIcon, Cookie as CookieIcon, Flame as FlameIcon, Wrench as WrenchIcon, Paintbrush as PaintbrushIcon, Shapes as ShapesIcon, Candy as CandyIcon, Monitor as MonitorIcon, Landmark as LandmarkIcon, Book as BookIcon, Camera as CameraIcon, Ghost as GhostIcon, Briefcase as BriefcaseIcon } from 'lucide-vue-next'
import folderImg from '../../assets/folder.png'
import { AnimatePresence, motion } from 'motion-v'
import AxDropdown from '../AxDropdown.vue'
import AxMenu from '../AxMenu.vue'
import AxMenuItem from '../AxMenuItem.vue'
import AxScrollArea from '../AxScrollArea.vue'
import LibIcon from '../LibIcon.vue'
import ProjectCluster from '../ProjectCluster.vue'
import AssetBatchBar from '../AssetBatchBar.vue'
import AssetUploadDialog from '../AssetUploadDialog.vue'
import AssetTree, { type AssetTreeRow } from '../AssetTree.vue'
import CanvasRowMenu from '../CanvasRowMenu.vue'
import AxDialog from '../AxDialog.vue'
import { useUi, type TreeNode } from '../../composables/ui'
import { checkedRowIds } from '../../composables/assetSelection'
import { canvasTreeBlocks } from '../../composables/canvasTree'
import { assetKindOf } from '../../composables/assetModel'
import { folderIconComponent } from '../../composables/folderIcons'
import { openAssetManager, openAssetPreviewFromAsset } from '../../composables/assetUiBus'
import { siblingPreview } from '../../composables/assetSiblings'
import { useCanvasContext, SlotAnchor, SlotComposer } from '@mini-canvas/canvas-render'
import SlotButton from './SlotButtons.vue'
import {
  DRAWER_TAB_ASSETS,
  DRAWER_TAB_CANVAS,
  fallbackDrawerTab,
  resolveDrawerTabs,
  type DrawerHost,
} from '../../composables/drawerTabs'

const ui = useUi()
const s = ui.state

// ===== 插件页签（第三个及之后的页签）=====
//
// 这是“左侧抽屉里多出来的一页”，不是路由/设置页。宿主负责高亮、切换、开合；
// 插件只交按钮 + meta.panel。槽变化、插件装卸都要重读。
const { ctx } = useCanvasContext()
const slotTick = ref(0)
const bumpSlots = (): void => { slotTick.value += 1 }
const slotRegistry = ctx.get<{ subscribe(cb: () => void): () => void }>('slots')
const slotOff = slotRegistry?.subscribe?.(bumpSlots)
const offInstalled = ctx.on('ctx:plugin-installed', bumpSlots)
const offUninstalled = ctx.on('ctx:plugin-uninstalled', bumpSlots)

const pluginTabsResult = computed(() => {
  void slotTick.value
  return resolveDrawerTabs(ctx.slots.occupants('shell.drawer.tabs'), {
    reserved: [DRAWER_TAB_CANVAS, DRAWER_TAB_ASSETS],
  })
})

const pluginTabs = computed(() =>
  pluginTabsResult.value.tabs.map((t) => ({
    ...t,
    button: markRaw(t.button as object),
    panel: markRaw(t.panel as object),
  })),
)

const activePluginTab = computed(() =>
  pluginTabs.value.find((t) => t.id === s.leftTab),
)

// 插件卸载后当前页签可能消失：自动回画布，避免留一个空白正文。
watch(
  pluginTabs,
  (tabs) => {
    const next = fallbackDrawerTab(s.leftTab, tabs.map((t) => t.id))
    if (next !== s.leftTab) s.leftTab = next
  },
  { immediate: true },
)

const drawerHost: DrawerHost = {
  get activeTab() { return s.leftTab },
  get width() { return s.drawerWidth },
  get collapsed() { return s.leftCollapsed },
  openTab: (id: string) => ui.openDrawerTab(id),
  close: () => { s.drawer = null },
  toggleCollapsed: () => ui.toggleLeftCollapsed(),
}

/** 下发给插件页签的共享 props：默认页签按钮 + 抽屉函数 */
const slotShared = {
  coreButton: SlotButton,
  buttonTone: 'tab',
  openDrawerTab: (id: string) => ui.openDrawerTab(id),
  closeDrawer: () => { s.drawer = null },
}

/** 插件页签按钮的宿主数据：active / onSelect / host（与之前逐个 <component> 下发的一致） */
function drawerTabProps(entry: { id: string }): Record<string, unknown> {
  return {
    active: s.leftTab === entry.id,
    onSelect: () => ui.openDrawerTab(entry.id),
    host: drawerHost,
  }
}

// 非法页签只提示一次：热装期间短暂缺面板是正常现象，不该刷屏。
const warnedInvalid = new Set<string>()
watch(
  () => pluginTabsResult.value.invalid,
  (list) => {
    for (const item of list) {
      const key = item.id + ':' + item.reason
      if (warnedInvalid.has(key)) continue
      warnedInvalid.add(key)
      console.warn('[left-drawer] 忽略页签 ' + item.id + '：' + item.reason)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  slotOff?.()
  offInstalled.dispose()
  offUninstalled.dispose()
})
/** 展示模式：list（树行）/ grid（宫格卡片），照目标「展示设置」下拉 */
const viewMode = ref<'list' | 'grid'>('grid')
const menuOpen = ref(false)
/** 搜索框 DOM 引用：进入搜索态后自动聚焦 */
const searchInput = ref<HTMLInputElement | null>(null)
async function openSearch(): Promise<void> {
  s.searchOpen = true
  await nextTick()
  searchInput.value?.focus()
}
function closeSearch(): void {
  s.searchOpen = false
  s.searchQuery = ''
}

const lucideOf = (icon: string) =>
  icon === 'video' ? VideoIcon
    : icon === 'text' ? TypeIcon
      : icon === 'group' ? FolderIcon
        : icon === 'audio' ? AudioIcon
          : ImageIcon

// ===== 资产 tab 交互（用户报「搜索/筛选/添加都没反应」——这里逐个接上真实行为）=====
/** 搜索框引用：点放大镜进入搜索态后自动聚焦（与画布 tab 的搜索同款交互） */
const assetSearchInput = ref<HTMLInputElement | null>(null)
async function openAssetSearch(): Promise<void> {
  assetSearchActive.value = true
  s.assetSearchQuery = ''
  await nextTick()
  assetSearchInput.value?.focus()
}
function closeAssetSearch(): void {
  assetSearchActive.value = false
  s.assetSearchQuery = ''
}
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
// 资产管理大弹窗的开关住在 composables/assetUiBus.ts（图 2/3）——
// 因为 Agent 对话里的**文件夹引用标签**也要开它，那两处共用同一份状态；
// 弹窗本体现在挂在常驻的 <AssetUiSlot> 上（画布子树内；抽屉关着也还能被引用标签打开）。
/**
 * 文件夹图标：选择器住在菜单组件里（AssetRowMenu 的「更改图标」二级面板），
 * 这里只提供两件事 —— 「某文件夹当前显示什么图标」与「图标名 → 组件」。
 * 抽屉侧不再持草稿：点「应用」就直接落后台（弹窗与抽屉同一条路径）。
 */
function folderIconNameOf(id: string): string {
  return ui.assetFolders.value.find((x) => x.id === id)?.icon ?? ''
}
/** 图标名 → lucide 组件（缩略角标用）—— 映射唯一一份在 composables/folderIcons.ts */
const folderIconCmp = (name: string): unknown => folderIconComponent(name)
function pickUpload(): void {
  uploadInput.value?.click()
}
/** 「+」→ 新建文件夹：调后台建（名字先用默认，建完进入改名态让用户直接敲名字） */
async function addFolder(parentId?: string): Promise<void> {
  await ui.newAssetFolder('新建文件夹', parentId)
  // 建完拿到真 id：刷新后最后一个同名 folder 就是它 —— 改用「进入改名态」由模板渲染 input
  const made = [...ui.assetFolders.value].pop()
  if (made) startRename(made.id, made.name)
}
/**
 * 内联重命名（文件夹与资产共用一条）：把该行换成输入框，聚焦并全选，回车/失焦提交、Esc 取消。
 * 与「新建文件夹」完全同一种形式（用户要求：重命名参考新建文件夹的做法，不要弹窗）。
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
async function confirmRenameFolder(): Promise<void> {
  const id = renamingFolderId.value
  const name = renamingValue.value.trim()
  renamingFolderId.value = null
  if (id && name) await ui.renameAssetFolderById(id, name)
}
/** 提交资产重命名（同一套内联输入） */
async function confirmRenameAsset(): Promise<void> {
  const id = renamingFolderId.value
  const name = renamingValue.value.trim()
  renamingFolderId.value = null
  if (id && name) await ui.renameAssetById(id, name)
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
/** 当前是不是画布 tab（模板里多次比较 s.leftTab 会被 TS 逐次收窄，用独立只读判断避开） */
const isCanvasTab = computed(() => s.leftTab === 'canvas')
/** 全部可见资产（根级 + 各层文件夹内），带缩进深度 —— 抽屉里用一个扁平列表渲染 */
/** 批量条要的平铺文件夹行（带深度） */
/**
 * 资产列表的**有序扁平行**（文件夹 + 资产混排，带层级深度）。
 * 抽屉与资产管理弹窗共用同一种「树 = 一维有序行」的表达：渲染只有一个循环，
 * 不会再出现「资产行落在错误容器里」这类结构错位。折叠的文件夹不展开其子项。
 *
 * 渲染交给共用组件 <AssetTree>（用户口径 2026-10-07：抽屉与弹窗里的资源树抽成一个通用组件，
 * 并支持把文件夹/文件拖进目录）—— 这里只负责「算出这一版行」。
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

/** 共用树要的「移动到 / 添加到」目标（平铺 + 缩进；排除自身由调用点给的行决定） */
function treeMoveTargets(row: AssetTreeRow): { id: string; name: string; depth: number }[] {
  return flatFolders.value.filter((x) => x.id !== row.id)
}

/** 「⋯」/ 右键菜单动作：抽屉这一侧的行为（与重构前逐条一致） */
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
  //
  // 带上**同层文件**清单（用户口径 2026-10-14：「全局预览都提供一个列表，可以通过左右快捷键
  // 来回切换。比如在文件夹里，它只处理同一级别的文件夹中的文件预览」）。
  // 清单来自树当前可见的行（assetRows）：折叠/筛选之后左右键走的范围与眼睛看到的一致。
  openAsset(
    { id: row.id, name: row.name, url: row.url ?? '', assetKind: row.assetKind },
    siblingPreview(assetRows.value, row),
  )
}

/**
 * 勾选框点击（共用树抛上来的是「行 id + 这一下有没有按 Shift」）。
 *
 * 行为口径（用户 2026-10-13）：勾文件夹连带它的**直属**资产；Shift 以最后一次点的那项为起点
 * 划区间，跨文件夹不划（退化成普通点击）。判定全在 composables/assetSelection.ts。
 */
function onTreeToggleSelect(id: string, shift?: boolean): void {
  ui.toggleAssetSelected(id, { rows: assetRows.value, shift: Boolean(shift) })
}

/**
 * 喂给共用树的「哪些行显示成勾上」。
 *
 * 已选表里只有资产 id，所以文件夹的勾选态要从它的内容算出来（勾了里面每一个文件 →
 * 这个文件夹看起来就是勾上的）。算法在 composables/assetSelection.ts（有单测）。
 * 注意必须走 `[...assetRows.value]`：判定函数只读 kind/id/parentId 三个字段，
 * 行对象上多出来的 url/tags 它不碰。
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

// ===== 把资源拖到画布 = 在落点建节点（用户口径 2026-10-07）=====
// 资产行拖出列表、落在画布上时，在**指针所在处**建一个对应类型的节点（图片/视频/音频都支持）。
//
// 实测踩过的三个坑（都留在这里，省得下次重踩）：
//   ① 必须在 **document 捕获阶段**监听 dragover/drop：画布的 VueFlow 在冒泡路径上会拦掉 dragover，
//      收不到就没法 preventDefault，浏览器随即禁止 drop（现象：drop 事件根本不触发）。
//   ② dragstart 之后、drop 之前**读不出自定义 MIME**（浏览器规定），所以"正在拖哪个资产"用会话变量记，
//      dataTransfer 里的 id 只在 drop 那一刻做兜底。
//   ③ dataTransfer 里存的是 JSON（{ id }）不是裸 id —— 直接当 id 用会查不到资产（静默什么都不做）。
const ASSET_DRAG_MIME = 'application/x-mini-canvas-asset'
/** 拖拽中的资产 id（dataTransfer 在 dragover 阶段读不出自定义数据，用这个变量做会话内的兜底） */
let draggingAssetId: string | null = null
function assetOfDrag(e: DragEvent): { id: string; name: string; url: string; assetKind: string } | null {
  // dataTransfer 里存的是 JSON（{ id }）；dragstart 之后、drop 之前浏览器**不允许读自定义 MIME**，
  // 所以优先用会话变量（draggingAssetId），drop 那一刻才用 dataTransfer 兜底。
  let id = draggingAssetId
  if (!id) {
    const raw = e.dataTransfer?.getData(ASSET_DRAG_MIME) ?? ''
    if (raw) {
      try {
        id = (JSON.parse(raw) as { id?: string }).id ?? raw
      } catch {
        id = raw
      }
    }
  }
  if (!id) return null
  const item = ui.assetItems.value.find((a) => a.id === id)
  if (!item) return null
  return { id: item.id, name: item.name, url: item.url, assetKind: assetKindOf(item) }
}
/** 画布区域：落点必须落在画布上才算「拖到画布」（抽屉/弹窗自己的区域不算） */
function overCanvas(e: DragEvent): boolean {
  const el = e.target as HTMLElement | null
  return Boolean(el?.closest?.('.vue-flow'))
}
/** 拖过画布：告诉浏览器「这里可以放下」（不给 preventDefault 的话浏览器会禁止 drop） */
function onCanvasDragOver(e: DragEvent): void {
  if (!draggingAssetId && !e.dataTransfer?.types.includes('Files')) return
  if (!overCanvas(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}
/** 落在画布上：建节点（图片/视频/音频都支持；未知类型给明确反馈） */
function onCanvasDrop(e: DragEvent): void {
  if (!overCanvas(e)) return

  // ★ 从**文件系统**拖进来的东西：先把节点包(.mcnode)抽出来单独走导入，剩下的交给 file-drop。
  //   为什么要在这拦一道：file-drop 只认图片/视频/文本，包会被它当成"不支持的文件"直接丢掉；
  //   而包这条路的落点完全不同（写脚本 + 还原节点，见 ui.importPackFile）。
  const dropped = Array.from(e.dataTransfer?.files ?? [])
  const packs = dropped.filter((f) => f.name.toLowerCase().endsWith('.mcnode'))
  if (packs.length) {
    e.preventDefault()
    e.stopPropagation()
    const rest = dropped.filter((f) => !packs.includes(f))
    // 落点 = 指针位置（与拖媒体文件、拖资产完全同一条口径）：
    //   用户口径「拖拽之后和直接从文件夹中拖拽进来的效果是一样的」——
    //   所以这里也把指针换算成 flow 坐标传下去，别再让包落到级联默认位。
    const atFlow = ui.screenToFlow(e.clientX, e.clientY) ?? undefined
    void (async () => {
      for (const p of packs) await ui.importPackFile(p, atFlow)
      if (rest.length) await ui.addFilesToCanvas(rest)
    })()
    return
  }

  const asset = assetOfDrag(e)
  if (!asset) return
  e.preventDefault()
  e.stopPropagation()
  const created = ui.dropAssetToCanvas({ name: asset.name, url: asset.url, assetKind: asset.assetKind }, { x: e.clientX, y: e.clientY })
  if (created) ui.showToast('已添加节点：' + asset.name)
  draggingAssetId = null
}
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
/** ===== 文件夹「…」菜单动作（照图 2/3/4 逐项实现）===== */
/** 添加到 Agent：把文件夹名以 @ 引用塞进 Agent 输入（复用 locateNode 同款语义，走 toast 语义占位由宿主接） */
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
/** 上传弹窗保存：直传后台（带 folderId —— projectsApi.uploadAsset 支持），再补标签 */
async function onUploadSave(payload: { files: File[]; folderId?: string; tags: string[] }): Promise<void> {
  uploadOpen.value = false
  await ui.uploadAssetsTo(payload.files, payload.folderId)
  if (payload.tags.length) {
    await ui.loadAssets()
    // 刚传的这几条：按名字对回清单（同一批重名也能覆盖到）
    const names = new Set(payload.files.map((f) => f.name))
    for (const a of ui.assetItems.value) if (names.has(a.name)) await ui.tagsForAsset(a.id, payload.tags)
  }
}
function onUploadChange(e: Event): void {
  const input = e.target as HTMLInputElement
  if (input.files?.length) void ui.uploadAssets(input.files)
  input.value = ''
}
/**
 * 预览：点资产行看大图/播放。浮层本体在常驻的 <AssetUiSlot> 上（与 Agent 对话里点资产标签
 * 是同一只 MediaViewer，只有一份实例）—— 这里只把「要看哪一份」写进总线。
 * 类型经 assetKindOf 取（列表行是 assetKind、AssetItem 是 kind）—— 单一来源，别再各读各的。
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

/**
 * 把「拖出资源树的资产」记进会话变量。
 *
 * 为什么不能只靠 dataTransfer：dragstart 之后、drop 之前，浏览器**不允许**读取自定义 MIME
 * （规定如此，防跨站偷数据）；dragover 阶段 getData 恒返回空串。所以落点判定用这个会话变量，
 * dataTransfer 里的 id 只作为 drop 那一刻的兜底（同一页内两条路都通）。
 * 监听挂在 document 捕获阶段：事件从行上冒泡出来时先一步记下，之后再判断落点是不是画布。
 */
function onDocDragStart(e: DragEvent): void {
  const el = e.target as HTMLElement | null
  const row = el?.closest?.('[data-asset-row][data-row-kind=asset]') as HTMLElement | null
  if (!row) { draggingAssetId = null; return }
  draggingAssetId = row.dataset.rowId ?? null
}
function onDocDragEnd(): void {
  draggingAssetId = null
}
onMounted(() => {
  // 全部挂**捕获**阶段：画布（VueFlow 的 pane）在冒泡路径上会拦掉 dragover ——
  // 冒泡阶段收不到，就没法 preventDefault，浏览器随即禁止 drop（实测：drop 不触发）。
  document.addEventListener('dragstart', onDocDragStart, true)
  document.addEventListener('dragover', onCanvasDragOver, true)
  document.addEventListener('drop', onCanvasDrop, true)
  document.addEventListener('dragend', onDocDragEnd, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('dragstart', onDocDragStart, true)
  document.removeEventListener('dragover', onCanvasDragOver, true)
  document.removeEventListener('drop', onCanvasDrop, true)
  document.removeEventListener('dragend', onDocDragEnd, true)
})

function expandAll(): void {
  const walk = (list: TreeNode[]): void => { for (const n of list) { if (n.children) { ui.collapsed[n.id] = false; walk(n.children) } } }
  walk(ui.tree)
  ui.showToast('已展开全部分组')
}
function collapseAll(): void {
  const walk = (list: TreeNode[]): void => { for (const n of list) { if (n.children) { ui.collapsed[n.id] = true; walk(n.children) } } }
  walk(ui.tree)
  ui.showToast('已收起全部分组')
}
/** 搜索过滤后的树：computed 必须放在顶层，模板才会自动解包 .value（ui.filteredTree 嵌在普通对象里不会解包） */
const visibleTree = computed<TreeNode[]>(() => {
  const t = ui.filteredTree
  return isRef(t) ? t.value : t
})

/**
 * 画布 tab 的**行块序列**（分组头 + 同层节点段，任意层嵌套）。
 *
 * 模板一个循环画完：分组头自己缩进，其下节点段再缩进 —— 以前是模板里写死两层
 * （根分组 + 它的一层孩子），嵌套分组的第二层整棵子树直接不显示（用户报的"没实现第二层"）。
 * 拍平逻辑抽在 canvasTree.canvasTreeBlocks（纯函数、可单测）。
 */
const canvasBlocks = computed(() => canvasTreeBlocks(visibleTree.value, (id) => ui.collapsed[id] === true))

// ===== 画布 tab 的行内改名（用户口径 2026-10-08：照资产树的效果，不要浏览器弹框）=====
/** 正在改名的节点 id（画布节点/分组共用一条） */
const renamingNodeId = ref<string | null>(null)
/** 输入的草稿（受控：值只在这里，输入即更新，提交时一次性写回画布数据） */
const renamingNodeName = ref('')
/** 进入改名态：聚焦 + 全选，直接敲名字 */
function startRenameNode(id: string, name: string): void {
  renamingNodeId.value = id
  renamingNodeName.value = name
  nextTick(() => {
    const el = document.querySelector<HTMLInputElement>('input[data-canvas-rename]')
    el?.focus()
    el?.select()
  })
}
function cancelRenameNode(): void {
  renamingNodeId.value = null
}
/** 提交：写画布数据（ui.renameNode 是唯一写口），再退改名态 */
function commitRenameNode(): void {
  const id = renamingNodeId.value
  if (!id) return
  renamingNodeId.value = null
  const name = renamingNodeName.value.trim()
  if (name) ui.renameNode(id, name)
}

// ===== 画布树的行操作菜单（用户口径 2026-10-08：画布也要右键菜单）=====
//
// 机制与资产树完全同一套：每行挂一个 CanvasRowMenu，把它的 openAt 收进这张表；
// 行上 @contextmenu 时按行 id 取出来、在**鼠标点**打开同一份菜单。
// 「⋯」按钮与行右键因此走的是同一个浮层实例 —— 不会出现两套定位/互斥/关闭规则。
//
// 为什么表key用行 id 而不是像资产树那样用 row.id：画布树的 id 在一个画布内唯一（节点 id），
// 但分组头块与节点段是两种块、同一个节点不会同时出现在两处，所以单键足够。
const canvasMenuRefs = reactive<Record<string, { openAt: (x: number, y: number) => void } | null>>({})
function bindCanvasMenu(rowId: string, el: unknown): void {
  const api = (el as { openAt?: (x: number, y: number) => void } | null) ?? null
  canvasMenuRefs[rowId] = api && typeof api.openAt === 'function' ? { openAt: api.openAt } : null
}
/** 行右键：在鼠标点打开该行的操作菜单 */
function openCanvasMenu(_kind: 'group' | 'node', rowId: string, e: MouseEvent): void {
  e.preventDefault()
  canvasMenuRefs[rowId]?.openAt(e.clientX, e.clientY)
}
</script>

<template>
  <AnimatePresence>
    <motion.aside v-if="s.drawer === 'left'"
      class="left-drawer fixed bottom-0 left-0 top-0 z-[70] flex flex-col bg-panel-soft backdrop-blur-xl"
      :style="{ width: s.drawerWidth + 'px' }" aria-label="资产管理" :initial="{ x: -s.drawerWidth, opacity: 0 }"
      :animate="{ x: 0, opacity: 1 }" :exit="{ x: -s.drawerWidth, opacity: 0 }"
      :transition="{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }" @pointerdown.stop>
      <!-- 头部：与左上角同一个 ProjectCluster（同一时刻只显示一个） -->
      <div class="flex h-12 flex-none items-center gap-0.5 p-2">
        <ProjectCluster :canvas="ui.canvasNameOf(ui.currentCanvasId.value)" :canvas-id="ui.currentCanvasId.value"
          :canvas-items="ui.canvasOptions.value" :menu-open="s.canvasMenuOpen"
          @update:menu-open="s.canvasMenuOpen = $event" @new-canvas="ui.newCanvas()"
          @pick-canvas="ui.openCanvas($event)" @open-canvas-window="ui.openCanvasInNewWindow($event)"
          @rename-canvas-item="ui.renameCanvasById($event)" @duplicate-canvas="ui.duplicateCanvas($event)"
          @delete-canvas="ui.deleteCanvas($event)" @open-menu="ui.showToast('项目菜单')"
          @rename-canvas="ui.renameCanvas($event)" />
      </div>
      <!-- 标签栏 -->
      <!-- 可排序页签行：内置“画布/资产”是 SlotAnchor，插件页签来自 shell.drawer.tabs。
           插件写 before/after 时指向条目 id（host/canvas-tab 这种），不是槽名。 -->
      <SlotComposer slot="shell.drawer.tabs"
        class="flex h-[50px] flex-none items-center gap-1 border-y border-line px-2" role="tablist"
        :item-props="drawerTabProps" :shared-props="slotShared">
        <SlotAnchor id="host/canvas-tab" :order="100">
          <button class="h-7 rounded-[10px] px-3 text-[13px] transition-colors"
            :class="s.leftTab === DRAWER_TAB_CANVAS ? 'bg-hover-strong text-ink' : 'text-ink/90 hover:bg-hover'"
            role="tab" :aria-selected="s.leftTab === DRAWER_TAB_CANVAS"
            @click="ui.openDrawerTab(DRAWER_TAB_CANVAS)">画布</button>
        </SlotAnchor>
        <SlotAnchor id="host/assets-tab" :order="200">
          <button class="h-7 rounded-[10px] px-3 text-[13px] transition-colors"
            :class="s.leftTab === DRAWER_TAB_ASSETS ? 'bg-hover-strong text-ink' : 'text-ink/90 hover:bg-hover'"
            role="tab" :aria-selected="s.leftTab === DRAWER_TAB_ASSETS"
            @click="ui.openDrawerTab(DRAWER_TAB_ASSETS)">资产</button>
        </SlotAnchor>
      </SlotComposer>

      <!-- ===== 画布 tab 工具行：普通态 ⇄ 搜索态（点放大镜展开输入框，筛选/关闭在右侧） ===== -->
      <div v-if="s.leftTab === 'canvas'" class="relative flex h-12 flex-none items-center gap-1 p-2">
        <!-- 搜索态：绝对定位悬浮层，从放大镜位置向右展开；收起时悬浮收缩，不挤压下面一行按钮 -->
        <div class="pointer-events-none absolute inset-y-0 left-2 right-2 z-10 flex items-center">
          <AnimatePresence>
            <motion.div v-if="s.searchOpen" class="pointer-events-auto flex h-9 w-full items-center gap-1"
              :initial="{ width: 36, opacity: 0 }" :animate="{ width: '100%', opacity: 1 }"
              :exit="{ width: 36, opacity: 0 }" :transition="{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }">
              <div class="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-[10px] bg-chip px-2.5">
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" class="flex-none text-ink-dim"
                  aria-hidden="true">
                  <path
                    d="M11 2.25a8.75 8.75 0 0 1 6.7 14.38l3.83 3.84a.75.75 0 1 1-1.06 1.06l-3.84-3.84A8.75 8.75 0 1 1 11 2.25m0 1.5a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5"
                    fill="currentColor" fill-rule="evenodd" />
                </svg>
                <input ref="searchInput" :value="s.searchQuery"
                  class="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-dim focus:outline-none"
                  placeholder="搜索节点" aria-label="搜索节点"
                  @input="s.searchQuery = ($event.target as HTMLInputElement).value" @keydown.esc="closeSearch()" />
              </div>
              <AxDropdown v-model="s.filterTypeOpen" placement="bottom-start">
                <template #trigger><button
                    class="grid size-8 flex-none place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover"
                    aria-label="筛选：全部"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M3 5h18M7 12h10M10.5 19h3" stroke="currentColor" stroke-width="1.8"
                        stroke-linecap="round" />
                    </svg></button></template>
                <template #default="{ close }">
                  <AxMenu>
                    <AxMenuItem v-for="t in ['全部', '图片', '视频', '音频', '文本', '分组']" :key="t"
                      @click="s.filterType = t; close()">{{ t }}</AxMenuItem>
                  </AxMenu>
                </template>
              </AxDropdown>
              <button
                class="grid size-8 flex-none place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover"
                aria-label="关闭搜索" @click="closeSearch()">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3.5 3.5l9 9m0-9-9 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                </svg>
              </button>
            </motion.div>
          </AnimatePresence>
        </div>

        <!-- 普通态 -->
        <template v-if="!s.searchOpen">
          <button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover"
            aria-label="搜索节点" @click="openSearch">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                :d="'M11 2.25a8.75 8.75 0 0 1 6.7 14.38l3.83 3.84a.75.75 0 1 1-1.06 1.06l-3.84-3.84A8.75 8.75 0 1 1 11 2.25m0 1.5a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5'"
                fill="currentColor" fill-rule="evenodd" />
            </svg>
          </button>
          <AxDropdown v-model="s.filterTypeOpen" placement="bottom-start">
            <template #trigger><button
                class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover"
                aria-label="筛选：全部"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 5h18M7 12h10M10.5 19h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg></button></template>
            <template #default="{ close }">
              <AxMenu>
                <AxMenuItem v-for="t in ['全部', '图片', '视频', '音频', '文本', '分组']" :key="t"
                  @click="s.filterType = t; close()">{{
                    t }}</AxMenuItem>
              </AxMenu>
            </template>
          </AxDropdown>
          <span class="flex-1"></span>
          <!-- 展示设置：列表/宫格/展开/收起（照图 2，带勾选态） -->
          <AxDropdown v-model="menuOpen" placement="bottom-end" :offset="4" menu-width="180px">
            <template #trigger>
              <button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover"
                aria-label="展示设置" :aria-expanded="menuOpen">
                <LibIcon name="display-grid" :size="16" />
              </button>
            </template>
            <template #default="{ close }">
              <AxMenu>
                <AxMenuItem :active="viewMode === 'list'" @click="viewMode = 'list'; close()">
                  <LibIcon name="list-view" :size="16" /> 列表展示 <svg v-if="viewMode === 'list'" class="ml-auto"
                    width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M13.8 4.2a.7.7 0 0 1 0 1L6.6 12.4a.7.7 0 0 1-1 0L2.2 9a.7.7 0 0 1 1-1l2.9 2.9 6.7-6.7a.7.7 0 0 1 1 0z"
                      fill="currentColor" />
                  </svg>
                </AxMenuItem>
                <AxMenuItem :active="viewMode === 'grid'" @click="viewMode = 'grid'; close()">
                  <LibIcon name="display-grid" :size="16" /> 宫格展示 <svg v-if="viewMode === 'grid'" class="ml-auto"
                    width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M13.8 4.2a.7.7 0 0 1 0 1L6.6 12.4a.7.7 0 0 1-1 0L2.2 9a.7.7 0 0 1 1-1l2.9 2.9 6.7-6.7a.7.7 0 0 1 1 0z"
                      fill="currentColor" />
                  </svg>
                </AxMenuItem>
                <div class="my-1 h-px bg-line"></div>
                <AxMenuItem @click="expandAll(); close()">
                  <LibIcon name="expand-groups" :size="16" /> 展开全部分组
                </AxMenuItem>
                <AxMenuItem @click="collapseAll(); close()">
                  <LibIcon name="collapse-groups" :size="16" /> 收起全部分组
                </AxMenuItem>
              </AxMenu>
            </template>
          </AxDropdown>
        </template>
      </div>

      <!-- ===== 资产 tab 工具行 ===== -->
      <div v-if="s.leftTab === 'assets'" class="relative flex h-12 flex-none items-center gap-1 p-2">
        <!-- 搜索态：**与画布 tab 同款**——绝对定位悬浮层从放大镜位置向右展开（AnimatePresence），不挤压工具行 -->
        <div class="pointer-events-none absolute inset-y-0 left-2 right-2 z-10 flex items-center">
          <AnimatePresence>
            <motion.div v-if="assetSearchActive" class="pointer-events-auto flex h-9 w-full items-center gap-1"
              :initial="{ width: 36, opacity: 0 }" :animate="{ width: '100%', opacity: 1 }"
              :exit="{ width: 36, opacity: 0 }" :transition="{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }">
              <div class="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-[10px] bg-chip px-2.5">
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" class="flex-none text-ink-dim"
                  aria-hidden="true">
                  <path
                    d="M11 2.25a8.75 8.75 0 0 1 6.7 14.38l3.83 3.84a.75.75 0 1 1-1.06 1.06l-3.84-3.84A8.75 8.75 0 1 1 11 2.25m0 1.5a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5"
                    fill="currentColor" fill-rule="evenodd" />
                </svg>
                <input ref="assetSearchInput" v-model="s.assetSearchQuery"
                  class="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-dim focus:outline-none"
                  placeholder="搜索资产" aria-label="搜索资产" @keydown.esc.stop="closeAssetSearch()" />
              </div>
              <button
                class="grid size-8 flex-none place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover"
                aria-label="关闭搜索" @click="closeAssetSearch()">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3.5 3.5l9 9m0-9-9 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                </svg>
              </button>
            </motion.div>
          </AnimatePresence>
        </div>
        <!-- 普通态：搜索 / 批量 / 类型筛选 / 上传 -->
        <template v-if="!assetSearchActive">
          <button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover"
            aria-label="搜索" @click="openAssetSearch()"><svg width="16" height="16" viewBox="0 0 20 20" fill="none"
              aria-hidden="true">
              <path
                d="M11 2.25a8.75 8.75 0 0 1 6.7 14.38l3.83 3.84a.75.75 0 1 1-1.06 1.06l-3.84-3.84A8.75 8.75 0 1 1 11 2.25m0 1.5a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5"
                fill="currentColor" fill-rule="evenodd" />
            </svg></button>
          <button class="grid size-8 place-items-center rounded-lg transition-colors hover:bg-hover"
            :class="s.assetBatchOn ? 'bg-brand/15 text-brand' : 'text-ink/85'" aria-label="批量操作"
            :aria-pressed="s.assetBatchOn" @click="ui.toggleAssetBatch()"><svg width="15" height="15"
              viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5" />
              <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5" />
              <path d="M5.5 11.5v3a2 2 0 0 0 2 2h1M14.5 8.5v-3a2 2 0 0 0-2-2h-1" stroke="currentColor"
                stroke-width="1.5" stroke-linecap="round" />
            </svg></button>
          <AxDropdown placement="bottom-start" :offset="4">
            <template #trigger>
              <button class="grid size-8 place-items-center rounded-lg transition-colors hover:bg-hover"
                :class="s.assetFilterKind !== '全部' ? 'text-brand' : 'text-ink/85'" aria-label="筛选"><svg width="15"
                  height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 5h18M7 12h10M10.5 19h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg></button>
            </template>
            <template #default="{ close }">
              <AxMenu>
                <AxMenuItem v-for="k in ASSET_KINDS" :key="k" :active="s.assetFilterKind === k"
                  @click="pickAssetKind(k); close()">{{ k }}</AxMenuItem>
              </AxMenu>
            </template>
          </AxDropdown>
          <span class="flex-1"></span>
          <!-- 加号下拉：新建文件夹 / 上传资产（照图 4） -->
          <AxDropdown v-model="plusOpen" placement="bottom-end" :offset="4">
            <template #trigger>
              <button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover"
                aria-label="新建或上传" :aria-expanded="plusOpen">
                <PlusIcon :size="16" />
              </button>
            </template>
            <template #default="{ close }">
              <AxMenu>
                <AxMenuItem @click="close(); addFolder()">
                  <FolderPlusIcon :size="14" class="text-ink-dim" /> 新建文件夹
                </AxMenuItem>
                <AxMenuItem @click="close(); uploadOpen = true">
                  <UploadIcon :size="14" class="text-ink-dim" /> 上传资产
                </AxMenuItem>
              </AxMenu>
            </template>
          </AxDropdown>
          <button class="h-8 rounded-lg bg-chip px-2.5 text-[13px] text-ink transition-colors hover:bg-hover-strong"
            aria-label="资产管理" @click="openAssetManager(undefined, { fromRef: false })">资产管理</button>
        </template>
        <!-- 隐藏的文件选择器：上传入口（支持多选） -->
        <input ref="uploadInput" type="file" multiple class="hidden" aria-hidden="true" @change="onUploadChange" />
      </div>

      <!-- ===== 资产 tab：文件夹树 + 根级资产（后台结构与此显示一致）===== -->
      <AxScrollArea v-if="s.leftTab === 'assets'" class="min-h-0 flex-1" direction="y" body-class="px-2 pb-2">
        <!-- 空态：没有任何资产也没有文件夹 -->
        <div v-if="!rootFolders.length && !ui.filteredAssets.value.length"
          class="flex flex-col items-center justify-center gap-2.5 p-8">
          <div class="grid size-16 place-items-center rounded-2xl bg-veil text-ink-mute">
            <FolderIcon :size="30" />
          </div>
          <p class="max-w-[220px] mb-1 text-center text-xs leading-relaxed text-ink-mute">还没有资产。生成图片 / 视频 /
            音频之后，产物会自动出现在这里。
          </p>
          <button
            class="flex h-8 min-w-[176px] items-center justify-center gap-1.5 rounded-lg border border-line bg-veil text-xs text-ink transition-colors hover:bg-hover"
            aria-label="打开生成历史" @click="ui.toggleHistory()">查看生成历史</button>
        </div>

        <!-- 拖拽：行内拖到文件夹行 = 放进去；拖到列表空白 = 放到根目录（共用组件 AssetTree 内自管） -->
        <AssetTree v-else variant="drawer" :rows="assetRows" :batch-on="s.assetBatchOn" :selected-ids="checkedIds"
          :collapsed-ids="collapsedFolderIds" :renaming-id="renamingFolderId" :rename-value="renamingValue"
          :folder-icon-name="folderIconNameOf" :icon-of="folderIconCmp" :move-targets="treeMoveTargets"
          :tag-options="[...ASSET_TAGS]" @toggle-expand="toggleFolderExpand" @open-asset="onTreeOpenAsset"
          @open-thumb="onTreeOpenAsset" @toggle-select="onTreeToggleSelect" @rename-input="renamingValue = $event"
          @rename-commit="onTreeRenameCommit" @rename-cancel="renamingFolderId = null"
          @start-rename="startRename($event.id, $event.name)" @drop-on="onTreeDrop" @add-agent="onTreeAddAgent"
          @add-canvas="onTreeAddCanvas" @child-folder="onTreeChildFolder" @move-to="onTreeMoveTo"
          @set-icon="onTreeSetIcon" @set-tags="onTreeSetTags" @download="onTreeDownload" @remove="onTreeRemove" />
      </AxScrollArea>

      <!-- 批量操作悬浮条（图 1 底部）：抽屉内绝对定位贴底居中 -->
      <div v-if="s.leftTab === 'assets' && s.assetBatchOn"
        class="pointer-events-none absolute inset-x-0 bottom-[64px] z-30 flex justify-center px-3">
        <AssetBatchBar compact :count="s.assetSelectedIds.length" :folders="flatFolders" :tag-options="[...ASSET_TAGS]"
          @exit="ui.toggleAssetBatch(false)" @add-to="onBatchAdd" @move-to="onBatchMove" @set-tags="onBatchTags"
          @download="onBatchDownload" @remove="onBatchRemove" />
      </div>

      <!-- 上传资产弹窗（图 6/7） -->
      <AssetUploadDialog v-if="uploadOpen" :folders="flatFolders" :tag-options="[...ASSET_TAGS]"
        @close="uploadOpen = false" @save="onUploadSave" />

      <!-- 文件夹「添加到画布」确认（数量 > 10 时出现；用户口径：一下添加太多会卡死） -->
      <AxDialog :model-value="!!folderConfirm" width="380px" @update:model-value="onFolderConfirmCancel">
        <div v-if="folderConfirm" class="flex flex-col gap-4 p-5">
          <p class="text-sm font-medium text-ink">把「{{ folderConfirm.name }}」添加到画布？</p>
          <p class="text-[13px] leading-relaxed text-ink-dim">
            这个文件夹里有 <span class="font-medium text-ink">{{ folderConfirm.count }}</span> 项内容，
            一次全部添加可能会卡顿。确定要继续吗？
          </p>
          <div class="flex items-center justify-end gap-2">
            <button
              class="h-8 rounded-lg border border-line px-3.5 text-[13px] text-ink transition-colors hover:bg-hover"
              aria-label="取消添加" @click="onFolderConfirmCancel">取消</button>
            <button
              class="h-8 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand/85"
              aria-label="确认添加" @click="onFolderConfirmOk">继续添加</button>
          </div>
        </div>
      </AxDialog>


      <!-- ===== 画布 tab 主体：列表 / 宫格 双模式（照图 1）===== -->
      <AxScrollArea v-if="isCanvasTab" class="min-h-0 flex-1" direction="y" body-class="px-2 pb-2">
        <template v-for="block in canvasBlocks" :key="block.key">
          <!-- 分组行（任意层）：depth 决定缩进；行内改名与资产树同款（用户口径 2026-10-08） -->
          <div v-if="block.kind === 'group'"
            class="group/grow relative flex h-11 w-full items-center gap-0.5 rounded-[10px] py-1 pr-1 transition-colors hover:bg-hover"
            :style="{ paddingLeft: block.depth * 24 + 'px' }" @contextmenu="openCanvasMenu('group', block.id, $event)">
            <button class="grid size-6 flex-none place-items-center rounded-lg text-ink/85"
              :aria-label="(block.collapsed ? '展开 ' : '折叠 ') + block.name" :aria-expanded="!block.collapsed"
              @click="ui.collapsed[block.id] = !ui.collapsed[block.id]">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" :class="block.collapsed ? '-rotate-90' : ''"
                class="transition-transform" aria-hidden="true">
                <path
                  d="M6.2.12a.4.4 0 0 1 .56 0l.43.42a.4.4 0 0 1 0 .57L4.15 4.15a.7.7 0 0 1-1 0L.13 1.1a.4.4 0 0 1 0-.57L.54.12a.4.4 0 0 1 .57 0l2.54 2.54z"
                  fill="currentColor" transform="translate(3.4 5.8)" />
              </svg>
            </button>
            <button class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg text-left"
              :aria-label="(block.collapsed ? '展开 ' : '折叠 ') + block.name" :aria-expanded="!block.collapsed"
              @click="ui.collapsed[block.id] = !ui.collapsed[block.id]">
              <img :src="folderImg" alt="" class="h-[30px] w-[33px] flex-none object-contain" draggable="false" />
              <!-- 行内改名（与资产树同一套口径：受控输入框 / 回车或失焦提交 / Esc 只退改名不关抽屉） -->
              <input v-if="renamingNodeId === block.id" v-model="renamingNodeName" data-canvas-rename
                class="h-7 min-w-0 flex-1 rounded-md border border-brand/60 bg-chip px-1.5 text-[13px] text-ink focus:outline-none"
                aria-label="分组名称" @click.stop @keydown.enter="commitRenameNode()" @keydown.esc.stop="cancelRenameNode()"
                @blur="commitRenameNode()" />
              <span v-else class="min-w-0 flex-1 truncate pr-0.5 text-sm leading-[22px]">{{ block.name }}</span>
            </button>
            <span
              class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/grow:opacity-100 group-hover/grow:opacity-100">
              <!-- 「⋯」与行右键打开的是**同一份**菜单（外壳见 RowMenuShell） -->
              <CanvasRowMenu :ref="(el: unknown) => bindCanvasMenu(block.id, el)" kind="group" :name="block.name"
                @rename="startRenameNode(block.id, block.name)" @locate="ui.locateNode(block.id)"
                @ungroup="ui.ungroupNode(block.id)" @remove="ui.removeNode(block.id)" />
              <button
                class="grid size-6 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink"
                :aria-label="'定位到分组 ' + block.name" @click="ui.locateNode(block.id)">
                <LibIcon name="locate" :size="14" />
              </button>
            </span>
          </div>

          <!-- 同层节点段（任意层）：列表 = 缩进行；宫格 = 一个三列网格（每层各自成网格，缩进不打架） -->
          <template v-else>
            <template v-if="viewMode === 'list'">
              <div v-for="child in block.nodes" :key="child.id"
                class="group/row relative flex h-11 w-full items-center gap-0.5 rounded-[10px] py-1 pr-1 transition-colors hover:bg-hover"
                :style="{ paddingLeft: block.depth * 24 + 'px' }"
                @contextmenu="openCanvasMenu('node', child.id, $event)">
                <span class="size-6 flex-none" aria-hidden="true"></span>
                <button class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg text-left"
                  :aria-label="'定位到节点 ' + child.name" @click="ui.locateNode(child.id)">
                  <span
                    class="relative grid size-9 flex-none place-items-center overflow-hidden rounded-lg bg-thumb text-ink-mute">
                    <img v-if="child.thumb" :src="child.thumb" alt="" class="h-full w-full object-cover" />
                    <template v-else-if="child.video">
                      <video :src="child.video" class="h-full w-full object-cover" muted playsinline preload="metadata"
                        aria-hidden="true"></video>
                      <span
                        class="absolute grid size-5 place-items-center rounded-full bg-[var(--ui-scrim)] text-[var(--ui-tip-ink)]"
                        aria-hidden="true"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="7,4 19,12 7,20" />
                        </svg></span>
                    </template>
                    <component v-else :is="lucideOf(child.icon)" :size="16" />
                  </span>
                  <input v-if="renamingNodeId === child.id" v-model="renamingNodeName" data-canvas-rename
                    class="h-7 min-w-0 flex-1 rounded-md border border-brand/60 bg-chip px-1.5 text-[13px] text-ink focus:outline-none"
                    aria-label="节点名称" @click.stop @keydown.enter="commitRenameNode()"
                    @keydown.esc.stop="cancelRenameNode()" @blur="commitRenameNode()" />
                  <span v-else class="min-w-0 flex-1 truncate text-sm leading-[22px]">{{ child.name }}</span>
                </button>
                <span
                  class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
                  <CanvasRowMenu :ref="(el: unknown) => bindCanvasMenu(child.id, el)" kind="node" :name="child.name"
                    @rename="startRenameNode(child.id, child.name)" @locate="ui.locateNode(child.id)"
                    @duplicate="ui.duplicateNode(child.id)" @add-agent="ui.referenceNodeToAgent(child.id)"
                    @remove="ui.removeNode(child.id)" />
                  <button
                    class="grid size-6 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink"
                    :aria-label="'定位到节点 ' + child.name" @click="ui.locateNode(child.id)">
                    <LibIcon name="locate" :size="14" />
                  </button>
                </span>
              </div>
            </template>

            <!-- 宫格模式：3 列卡片（照图 1：卡片 120 宽 圆角16 缩略图方形圆角12 名字 13px 在下方） -->
            <div v-else class="grid grid-cols-3 gap-0.5 pt-0.5" :style="{ paddingLeft: block.depth * 24 + 'px' }">
              <div v-for="child in block.nodes" :key="child.id"
                class="group/cell relative flex min-w-0 flex-col gap-2 rounded-[16px] p-1 pb-3 transition-colors hover:bg-hover-soft"
                @contextmenu="openCanvasMenu('node', child.id, $event)">
                <!-- 改名中收起整卡点击层，输入框才接得到鼠标 -->
                <button v-if="renamingNodeId !== child.id" class="absolute inset-0 z-10 rounded-[16px]"
                  :aria-label="'定位到节点 ' + child.name" @click="ui.locateNode(child.id)"></button>
                <div
                  class="relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-thumb-soft transition-opacity">
                  <img v-if="child.thumb" :src="child.thumb" alt="" class="h-full w-full object-cover" />
                  <!-- 视频没有海报图：<video> 出首帧；出不来出视频图标（不拿 mp4 塞 <img> 裂图） -->
                  <video v-else-if="child.video" :src="child.video" class="h-full w-full object-cover" muted playsinline
                    preload="metadata" aria-hidden="true"></video>
                  <span
                    class="absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl text-ink-mute">
                    <span v-if="!child.thumb" class="flex w-[26%] shrink-0 items-center justify-center">
                      <component :is="child.video ? VideoIcon : lucideOf(child.icon)" :size="29" :stroke-width="1" />
                    </span>
                  </span>
                  <span v-if="child.video"
                    class="absolute left-1/2 top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--ui-scrim)] text-[var(--ui-tip-ink)] backdrop-blur-sm"
                    aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="7,4 19,12 7,20" />
                    </svg></span>
                </div>
                <input v-if="renamingNodeId === child.id" v-model="renamingNodeName" data-canvas-rename
                  class="h-7 min-w-0 rounded-md border border-brand/60 bg-chip px-1.5 text-[13px] text-ink focus:outline-none"
                  aria-label="节点名称" @click.stop @keydown.enter="commitRenameNode()"
                  @keydown.esc.stop="cancelRenameNode()" @blur="commitRenameNode()" />
                <span v-else class="truncate px-0.5 text-[13px] leading-none text-ink">{{ child.name }}</span>
                <span
                  class="absolute right-1 top-1 z-20 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/cell:opacity-100 group-hover/cell:opacity-100">
                  <CanvasRowMenu :ref="(el: unknown) => bindCanvasMenu(child.id, el)" kind="node" :name="child.name"
                    @rename="startRenameNode(child.id, child.name)" @locate="ui.locateNode(child.id)"
                    @duplicate="ui.duplicateNode(child.id)" @add-agent="ui.referenceNodeToAgent(child.id)"
                    @remove="ui.removeNode(child.id)" />
                  <!-- <button
                    class="grid size-6 place-items-center rounded-lg bg-panel/90 text-ink-dim transition-colors hover:bg-hover hover:text-ink"
                    :aria-label="'定位到节点 ' + child.name" @click="ui.locateNode(child.id)">
                    <LibIcon name="locate" :size="14" />
                  </button> -->
                </span>
              </div>
            </div>
          </template>
        </template>

      </AxScrollArea>

      <!-- 插件页签正文：只在当前选中的是插件页签时渲染（画布/资产树走各自的 v-if） -->
      <AxScrollArea v-if="activePluginTab" class="min-h-0 flex-1" direction="y" body-class="p-2">
        <component :is="activePluginTab.panel" :host="drawerHost" />
      </AxScrollArea>

      <!-- 底部状态条 -->
      <div class="flex h-[53px] flex-none items-center justify-between border-t border-line px-3 pb-3 pt-2">
        <button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover"
          :aria-label="s.leftCollapsed ? '展开节点侧栏' : '收起节点侧栏'" @click="ui.toggleLeftCollapsed()">
          <ArrowLeftToLineIcon :size="16" />
        </button>
        <span class="text-xs text-ink-dim">共 {{ ui.treeTotal }} 节点</span>
      </div>
      <div
        class="absolute -right-1 bottom-0 top-0 z-[2] w-3 cursor-col-resize touch-none hover:bg-gradient-to-r hover:from-transparent hover:to-white/[0.14]"
        role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical"
        @pointerdown.prevent="ui.startDrawerResize($event)">
      </div>
    </motion.aside>
  </AnimatePresence>
</template>

<script lang="ts">
// 小图标（菜单行内）：直接内联函数式组件，避免多余文件
const mk = (d: string) => defineComponent({ render: () => h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, [h('path', { d, stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })]) })
export const PencilIcon = mk('M11.3 2.5a1.6 1.6 0 0 1 2.3 2.3L5 13.4l-3 .8.8-3zM12.5 3.6l-1-1')
export const TrashIcon = mk('M2.5 4h11M6.5 4V2.8c0-.4.4-.8.8-.8h1.4c.4 0 .8.4.8.8V4M4 4l.6 8.6c0 .8.6 1.4 1.4 1.4h4c.8 0 1.4-.6 1.4-1.4L12 4M6.5 7v4M9.5 7v4')
export const CopyIcon = mk('M5.5 5.5V3.4c0-.5.4-.9.9-.9h6.2c.5 0 .9.4.9.9v6.2c0 .5-.4.9-.9.9h-2.1M3.4 5.5h6.2c.5 0 .9.4.9.9v6.2c0 .5-.4.9-.9.9H3.4a.9.9 0 0 1-.9-.9V6.4c0-.5.4-.9.9-.9z')
export const WandIcon = mk('M9.5 2.5v2M9.5 9.5v2M2.5 9.5h2M6.5 6.5 3 3M13.5 13.5 9.8 9.8M13 3l-8.5 8.5a1 1 0 0 0 1.4 1.4L14.4 4.4A1 1 0 0 0 13 3z')
</script>


<style>
.left-drawer {
  border: 1px solid var(--ui-shell-line, var(--ui-line, #e2e5ea));
  border-radius: 0;
  border-width: 0 1px 0 0;
  border-color: var(--ui-line, #e2e5ea);
  background: var(--ui-overlay-solid, var(--ui-panel, #fff));
  box-shadow: none;
}
</style>