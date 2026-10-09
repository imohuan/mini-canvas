<script setup lang="ts">
// AssetManageDialog —— 资产管理大弹窗（照图 1/4）：
// 左：库列表（个人资产库 / 可灵主体库）；右：面包屑 + 工具行（搜索/批量/筛选/新建）+ **树形列表**。
// 列表一行一个文件夹或资产（不再是宫格），行 hover 出「…」菜单与「多选」控件；
// 文件夹可展开递归显示子树（与侧边栏同一种树形态）。菜单复用 AssetRowMenu —— 与侧边栏行为完全一致。
// 2026-10-08 用户口径：① 点文件夹行 = 展开/折叠（与左侧栏一致，不再有"点名字下钻"；
//    深层新建走行菜单「新建子文件夹」，深层上传在上传弹窗里选保存位置）；
// ② 右上角「新建」= 加号下拉（新建文件夹 / 上传资产），与左侧抽屉的加号同款。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Folder as FolderIcon, Search as SearchIcon, ListFilter as BatchIcon, Filter as FilterIcon,
  Plus as PlusIcon, FolderPlus as FolderPlusIcon, Upload as UploadIcon,
  X as XIcon, ChevronRight as ChevronIcon, Library as LibIcon,
  FileImage as FileImageIcon, Film as FilmIcon, Music as MusicIcon, Check as CheckIcon,
} from 'lucide-vue-next'
import folderImg from '../assets/folder.png'
import AxDropdown from './AxDropdown.vue'
import AxMenu from './AxMenu.vue'
import AxMenuItem from './AxMenuItem.vue'
import AssetBatchBar from './AssetBatchBar.vue'
import AssetTree, { type AssetTreeRow } from './AssetTree.vue'
import AssetUploadDialog from './AssetUploadDialog.vue'
import { useUi } from '../composables/ui'
import { assetKindOf } from '../composables/assetModel'
import { folderIconComponent } from '../composables/folderIcons'

const ui = useUi()
const s = ui.state
const emit = defineEmits<{ close: [] }>()

/**
 * 打开时的落点（用户口径 2026-10-08：「进这个页面时先把所有文件夹折叠，只展开选中的那个」）。
 *
 * 入口：Agent 对话里点**文件夹**引用标签（见 composables/assetUiBus.ts 的 openAssetManager）。
 * 不传 = 根目录：同样把全部文件夹折叠（老行为是「默认全展开」，树一长就看不出层级）。
 * focusToken 每请求一次就变 —— 同一个文件夹连点两次也要重新折叠 + 重新给提示
 *（只看 folderId 的话第二次点「没变化」，用户以为功能坏了）。
 *
 * fromRef = 「从引用标签跳进来」：只有它为 true 才折叠 + 给提示。
 * 从左侧抽屉点「资产管理」进来是 false —— 那时用户是来干活的，保持原本的全展开。
 */
const props = withDefaults(
  defineProps<{ initialFolderId?: string; focusToken?: number; fromRef?: boolean }>(),
  { initialFolderId: undefined, focusToken: 0, fromRef: false },
)

/** 上传资产弹窗（与左侧抽屉同一个组件）是否打开 */
const uploadOpen = ref(false)

// ui-style-guide §3.1：浮层 z-index 统一 100000；Esc 必须能关（挂 document，随组件回收）
/**
 * Esc 两级联动：上传弹窗开着时**让位**（return，不关资产管理）。
 * 它自己也有 Esc 监听、且注册更晚（后挂载）—— 同挂 document 冒泡阶段按时序执行：
 * 本监听先跑（让位），它后跑（关上传）；第二次 Esc 时它已卸载 → 这里才关资产管理。
 * 保持冒泡阶段而不是 capture：行内改名输入框的 esc.stop 要把这次按键留在输入框里（不关弹窗）。
 * 另外 stopPropagation 吃掉这次 Esc：App 的 window 级监听会把整个抽屉一起关掉 ——
 * 一次 Esc 只关一层，抽屉留给下一次。
 */
function onEscKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  if (uploadOpen.value) return
  emit('close')
}
onMounted(() => document.addEventListener('keydown', onEscKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onEscKey))

const ASSET_TAGS = ['角色', '场景', '物品', '风格', '音效'] as const
const ASSET_KINDS = ['全部', '图片', '视频', '音频', '其他'] as const
/** 当前浏览的文件夹（空 = 根=个人资产库） */
const currentFolderId = ref<string | undefined>(undefined)
const kindOpen = ref(false)
/** 「新建」下拉（新建文件夹 / 上传资产）是否打开 */
const plusOpen = ref(false)
const batchOn = ref(false)
const selectedIds = ref<string[]>([])
const searchQuery = ref('')
const renamingId = ref<string | null>(null)
const renameValue = ref('')
/**
 * 展开的文件夹（默认全展开，与侧边栏一致）。
 *
 * 从外部（Agent 对话的文件夹标签）进来时由 applyFocus() 重算成「只展开选中那条链」。
 */
const collapsed = ref<Record<string, boolean>>({})

/**
 * 折叠状态：把整棵树收起来，只留「目标文件夹 + 它的祖先链」展开。
 *
 * 用户口径（2026-10-08）：从引用标签进弹窗时「先把所有文件夹折叠起来，然后只展开选中的文件夹」。
 * 只有这条入口会调它（`fromRef` 由 AssetUiSlot 按「是不是从引用标签来的」传进来）：
 * 从左侧抽屉点「资产管理」进来时**保持原来的全展开** —— 那时用户是来干活的，把树折起来反而更麻烦。
 */
function applyFocus(folderId: string | undefined): void {
  if (!props.fromRef) return // 不是「从引用标签跳进来」：维持默认的全展开
  const next: Record<string, boolean> = {}
  for (const f of ui.assetFolders.value) next[f.id] = true
  if (folderId) {
    const byId = new Map(ui.assetFolders.value.map((f) => [f.id, f]))
    // 只展开目标自己与它的祖先（不是展开子树 —— 用户要的是「看得见这条」，不是「全摊开」）
    let cur = byId.get(folderId)
    while (cur) {
      delete next[cur.id]
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
  }
  collapsed.value = next
}

/**
 * 引导提示："已为你展开到「X」" 挂在目标行上，点一下或 3 秒后自己消失。
 *
 * 为什么要有它：进弹窗时树是折着的，只有一条链展开 —— 不给提示的话用户看到的
 * 是「和刚才不一样的一坨树」，看不出自己被带到哪了（用户明确要求这个引导效果）。
 */
const focusTipId = ref<string>('')
let focusTipTimer: ReturnType<typeof setTimeout> | null = null
function clearFocusTip(): void {
  if (focusTipTimer) { clearTimeout(focusTipTimer); focusTipTimer = null }
  focusTipId.value = ''
}
function showFocusTip(folderId: string | undefined): void {
  clearFocusTip()
  if (!folderId || !props.fromRef) return
  focusTipId.value = folderId
  focusTipTimer = setTimeout(() => { focusTipId.value = ''; focusTipTimer = null }, 3000)
}

// 首次挂载就落到「选中那一层」（不是等 watch：watch 非 immediate，挂载前设的初值它收不到）
applyFocus(props.initialFolderId)
// 面包屑高亮也只在「从引用标签跳进来」时改（抽屉入口的默认落点就是根目录）
if (props.fromRef) currentFolderId.value = props.initialFolderId
onMounted(() => nextTick(() => showFocusTip(props.initialFolderId)))
onBeforeUnmount(clearFocusTip)

// 同一个文件夹连点两次也要重新折叠 + 重新提示 —— 所以依赖 focusToken（每次请求都 +1）
watch(() => props.focusToken, () => {
  applyFocus(props.initialFolderId)
  if (props.fromRef) currentFolderId.value = props.initialFolderId
  void nextTick(() => showFocusTip(props.initialFolderId))
})

/**
 * 文件夹清单是**异步**到的：挂载那一刻它可能还是空的（applyFocus 就没东西可折）。
 * 等它第一次到位时补一次折叠 —— 只补这一次，之后的新建文件夹不会再触发（否则
 * 用户建个子文件夹，整棵树又被折回去）。
 */
let focusAppliedWithData = false
watch(
  () => ui.assetFolders.value.length,
  (n) => {
    if (focusAppliedWithData || !n) return
    focusAppliedWithData = true
    applyFocus(props.initialFolderId)
    void nextTick(() => showFocusTip(props.initialFolderId))
  },
)

const currentFolder = computed(() => ui.assetFolders.value.find((f) => f.id === currentFolderId.value))
/** 面包屑：从根一路到当前文件夹 */
const breadcrumb = computed(() => {
  const chain: { id?: string; name: string }[] = []
  let cur = currentFolder.value
  const byId = new Map(ui.assetFolders.value.map((f) => [f.id, f]))
  while (cur) {
    chain.unshift({ id: cur.id, name: cur.name })
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return [{ name: '个人资产库' }, ...chain]
})
/** 当前层的直接子文件夹（树的一层；展开再往下一层） */
const subFolders = computed(() => ui.assetFolders.value.filter((f) => (f.parentId ?? undefined) === currentFolderId.value))
const assetsHere = computed(() => ui.filteredAssets.value.filter((a) => (a.folderId ?? undefined) === currentFolderId.value))
/** 弹窗内独立搜索（本地 query 叠加全局类型筛选） */
const assetsShown = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return q ? assetsHere.value.filter((a) => a.name.toLowerCase().includes(q)) : assetsHere.value
})
/** 树形展示用的行（文件夹一层层往下，含已在搜索里命中的资产） */
const rows = computed<AssetTreeRow[]>(() => {
  const out: AssetTreeRow[] = []
  const foldersHere = ui.assetFolders.value
  const assets = ui.assetItems.value
  const q = searchQuery.value.trim().toLowerCase()
  const walk = (parent: string | undefined, depth: number): void => {
    for (const f of foldersHere.filter((x) => (x.parentId ?? undefined) === parent)) {
      const count = assets.filter((a) => a.folderId === f.id).length
      out.push({ kind: 'folder', id: f.id, name: f.name, depth, count, ...(parent ? { parentId: parent } : {}) })
      if (!collapsed.value[f.id]) walk(f.id, depth + 1)
    }
    for (const a of assets.filter((x) => (x.folderId ?? undefined) === parent)) {
      if (q && !a.name.toLowerCase().includes(q)) continue
      if (s.assetFilterKind !== '全部') {
        const want = s.assetFilterKind === '图片' ? 'image' : s.assetFilterKind === '视频' ? 'video' : s.assetFilterKind === '音频' ? 'audio' : 'other'
        if (a.kind !== want) continue
      }
      out.push({ kind: 'asset', id: a.id, name: a.name, depth, url: a.url, assetKind: a.kind, tags: a.tags, ...(a.path ? { path: a.path } : {}), ...(parent ? { parentId: parent } : {}) })
    }
  }
  walk(undefined, 0)
  return out
})
/** 喂给共用树的两个只读派生：收起列表（它不持状态）与「移动到」目标 */
const collapsedIds = computed(() => Object.keys(collapsed.value).filter((id) => collapsed.value[id]))
const flatFolders = computed(() => {
  const out: { id: string; name: string; depth: number }[] = []
  const walk = (list: typeof ui.assetFolderTree.value, depth: number): void => {
    for (const f of list) { out.push({ id: f.id, name: f.name, depth }); walk(f.children, depth + 1) }
  }
  walk(ui.assetFolderTree.value, 0)
  return out
})

const iconCmp = (n: string): unknown => folderIconComponent(n)
const folderIconNameOf = (id: string): string => ui.assetFolders.value.find((f) => f.id === id)?.icon ?? ''

function toggleSelected(id: string): void {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else selectedIds.value.push(id)
}
function exitBatch(): void {
  batchOn.value = false
  selectedIds.value = []
}
function toggleExpand(id: string): void {
  collapsed.value = { ...collapsed.value, [id]: !collapsed.value[id] }
}
/** 展开某个文件夹（保证"看得见"）：面包屑进某层 / 新建落点都用它。折叠状态只有 collapsed 一个真源，这里只删不增。 */
function expandFolder(id: string): void {
  if (!collapsed.value[id]) return
  const next = { ...collapsed.value }
  delete next[id]
  collapsed.value = next
}
/**
 * 进到某一层（currentFolderId 决定「新建文件夹 / 上传资产」的落点与面包屑高亮）。
 * 入口：① 行尾「进入」按钮（show-enter，见 AssetTree 的注释：双击实测不可靠）；
 * ② 点面包屑往上层走。行点击本身只做展开/折叠（用户口径 2026-10-08，与左侧栏一致）。
 *
 * 为什么要沿祖先链展开：弹窗的树是整棵展示的，列表不按 currentFolderId 过滤 ——
 * 只改 currentFolderId 时画面可能毫无变化（那一层碰巧已展开），会把「跳转」做成"点了没反应"。
 * 展开是最小的可见动作（折叠状态只有 collapsed 一个真源，这里只删不增）。
 */
function goToFolder(id?: string): void {
  currentFolderId.value = id
  if (!id) return
  const byId = new Map(ui.assetFolders.value.map((f) => [f.id, f]))
  let cur = byId.get(id)
  while (cur) {
    expandFolder(cur.id)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
}
/**
 * 新建文件夹：parentId = 目标层（缺省 = 当前所在层）。
 * 两种入口：工具行下拉「新建文件夹」（当前层）/ 树行菜单「新建子文件夹」（那一行下面，与抽屉一致）。
 * 目标层若被折叠，新行不会渲染、改名态点不到 —— 先展开。
 */
async function addFolderIn(parentId?: string): Promise<void> {
  if (parentId) expandFolder(parentId)
  await ui.newAssetFolder('新建文件夹', parentId)
  const made = [...ui.assetFolders.value].pop()
  if (made) startRename(made.id, made.name)
}
/**
 * 上传弹窗保存：与左侧抽屉同一条口径（带 folderId 直传，再按文件名对回清单补标签）。
 * 弹窗内「保存位置」默认预选当前所在层（模板里 :initial-folder-id），用户仍可改。
 */
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
function startRename(id: string, name: string): void {
  renamingId.value = id
  renameValue.value = name
  nextTick(() => {
    const el = document.querySelector<HTMLInputElement>('input[data-manage-rename]')
    el?.focus()
    el?.select()
  })
}
function downloadAsset(url: string, name: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
}
function downloadFolder(id: string): void {
  for (const a of ui.assetItems.value.filter((x) => x.folderId === id)) downloadAsset(a.url, a.name)
}
function onBatchTags(tags: string[]): void {
  for (const id of selectedIds.value) void ui.tagsForAsset(id, tags)
}
function onBatchRemove(): void {
  for (const id of [...selectedIds.value]) void ui.deleteAssetById(id)
  exitBatch()
}

/** ===== 共用树（AssetTree）的事件处理：弹窗这一侧的行为（与重构前逐条一致）===== */
/** 勾选：未进入批量模式时，点一下即进入批量并要求「这次点击就是选中它」 */
function onTreeToggleSelect(id: string): void {
  if (!batchOn.value) batchOn.value = true
  toggleSelected(id)
}
/** 「移动到 / 添加到」目标（排除自身所在行） */
function dialogMoveTargets(row: AssetTreeRow): { id: string; name: string; depth: number }[] {
  return flatFolders.value.filter((x) => x.id !== row.id)
}
/**
 * 点资产行：弹窗这一侧**不做预览**（原行为：只有多选/菜单）。
 * 保持一致（用户口径：弹窗里对文件的操作与侧边栏一样 —— 预览仍走侧边栏 / 底栏素材卡）。
 */
function onOpenAsset(): void {
  /* no-op：保留插槽语义 */
}
async function onTreeRenameCommit(payload: { kind: 'folder' | 'asset'; id: string; name: string }): Promise<void> {
  renamingId.value = null
  if (!payload.name.trim()) return
  if (payload.kind === 'folder') await ui.renameAssetFolderById(payload.id, payload.name.trim())
  else await ui.renameAssetById(payload.id, payload.name.trim())
}
function onTreeAddAgent(row: AssetTreeRow): void {
  if (row.kind === 'folder') ui.addFolderToAgent({ id: row.id, name: row.name })
  // folderId 带上（= 这行所在文件夹）：Agent 里点这颗标签要能打开资产管理并展开到该层
  else ui.addAssetToAgent({ name: row.name, url: row.url ?? '', ...(row.path ? { path: row.path } : {}), ...(row.parentId ? { folderId: row.parentId } : {}) })
}
function onTreeAddCanvas(row: AssetTreeRow): void {
  if (row.kind === 'folder') void folderAddToCanvas(row)
  else ui.addAssetToCanvas({ name: row.name, url: row.url ?? '', assetKind: row.assetKind })
}
/**
 * 文件夹「添加到画布」：与左侧抽屉同一条服务（ui.addFolderAssetsToCanvas）——
 * 全部内容按类型建节点、超过 10 个先弹确认、建完一次性多选。
 * 确认弹窗状态机也照搬抽屉那份（assetUploadHost 之外这里也用得到）。
 */
const folderConfirm = ref<{ folderId: string; name: string; count: number } | null>(null)
let folderConfirmResolve: ((ok: boolean) => void) | null = null
function confirmAddFolder(row: AssetTreeRow): Promise<boolean> {
  return new Promise((resolve) => {
    // 关掉可能还开着的上一个确认（并 resolve false），避免旧 Promise 永久挂起
    onFolderConfirmCancel()
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
  folderConfirm.value = null
}
function onFolderConfirmCancel(): void {
  folderConfirmResolve?.(false)
  folderConfirmResolve = null
  folderConfirm.value = null
}
function onTreeMoveTo(payload: { row: AssetTreeRow; targetFolderId?: string }): void {
  if (payload.row.kind === 'folder') void ui.moveAssetFolderTo(payload.row.id, payload.targetFolderId)
  else void ui.moveSelectedAssets(payload.targetFolderId, [payload.row.id])
}
function onTreeSetIcon(payload: { row: AssetTreeRow; icon: string }): void {
  void ui.setAssetFolderIcon(payload.row.id, payload.icon)
}
function onTreeSetTags(payload: { row: AssetTreeRow; tags: string[] }): void {
  void ui.tagsForAsset(payload.row.id, payload.tags)
}
function onTreeDownload(row: AssetTreeRow): void {
  if (row.kind === 'folder') downloadFolder(row.id)
  else downloadAsset(row.url ?? '', row.name)
}
function onTreeRemove(row: AssetTreeRow): void {
  if (row.kind === 'folder') void ui.removeAssetFolder(row.id)
  else void ui.deleteAssetById(row.id)
}
/** 拖拽落下：文件夹 → 嵌套进目标；资产 → 挪进目标（to = null = 根目录） */
async function onTreeDrop(payload: { from: AssetTreeRow; to: AssetTreeRow | null }): Promise<void> {
  const targetId = payload.to?.id
  if (payload.from.kind === 'folder') await ui.moveAssetFolderTo(payload.from.id, targetId)
  else await ui.moveSelectedAssets(targetId, [payload.from.id])
}
function onBatchDownload(): void {
  for (const id of selectedIds.value) {
    const a = ui.assetItems.value.find((x) => x.id === id)
    if (a) downloadAsset(a.url, a.name)
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[100000] flex items-center justify-center">
      <div class="absolute inset-0 bg-veil" aria-hidden="true" @click="emit('close')"></div>
      <div
        class="relative flex h-[min(760px,calc(100vh-64px))] w-[min(1560px,calc(100vw-64px))] flex-col overflow-hidden rounded-2xl border border-line bg-panel text-ink shadow-[var(--ui-shadow-md)]"
        role="dialog" aria-modal="true" aria-label="资产管理"
      >
        <!-- 标题行 -->
        <div class="flex h-12 flex-none items-center justify-between border-b border-line px-5">
          <span class="text-sm font-medium">资产管理</span>
          <button class="grid size-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink" aria-label="关闭" @click="emit('close')"><XIcon :size="16" /></button>
        </div>

        <div class="flex min-h-0 flex-1">
          <!-- 左：库列表 -->
          <aside class="flex w-[210px] flex-none flex-col gap-0.5 border-r border-line p-2">
            <button class="flex h-9 items-center gap-2 rounded-lg bg-hover px-2.5 text-left text-[13px] text-ink" :aria-current="true">
              <LibIcon :size="15" class="text-ink-dim" /> 个人资产库
            </button>
            <button class="flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-ink-dim transition-colors hover:bg-hover" aria-label="可灵主体库">
              <span class="grid size-4 place-items-center rounded-full border border-line text-[9px]">K</span> 可灵主体库
            </button>
          </aside>

          <!-- 右：内容区 -->
          <div class="flex min-w-0 flex-1 flex-col">
            <!-- 工具行：面包屑 + 搜索/批量/筛选/新建 -->
            <div class="flex h-12 flex-none items-center gap-1 px-4">
              <template v-for="(b, i) in breadcrumb" :key="b.name">
                <button
                  class="flex h-7 items-center rounded-lg px-1.5 text-[13px] transition-colors"
                  :class="i === breadcrumb.length - 1 ? 'font-medium text-ink' : 'text-ink-dim hover:bg-hover'"
                  :aria-current="i === breadcrumb.length - 1"
                  @click="goToFolder(b.id)"
                >{{ b.name }}</button>
                <ChevronIcon v-if="i < breadcrumb.length - 1" :size="13" class="text-ink-dim" />
              </template>
              <span class="flex-1"></span>
              <AxDropdown placement="bottom-end" :offset="4">
                <template #trigger><button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" aria-label="搜索"><SearchIcon :size="15" /></button></template>
                <template #default="{ close }">
                  <div class="p-1.5">
                    <input
                      v-model="searchQuery"
                      class="h-8 w-48 rounded-lg bg-chip px-2.5 text-[13px] text-ink placeholder:text-ink-dim focus:outline-none"
                      placeholder="搜索资产"
                      aria-label="搜索资产"
                      @keydown.esc="close()"
                    />
                  </div>
                </template>
              </AxDropdown>
              <button class="grid size-8 place-items-center rounded-lg transition-colors hover:bg-hover" :class="batchOn ? 'bg-brand/15 text-brand' : 'text-ink/85'" aria-label="批量操作" :aria-pressed="batchOn" @click="batchOn ? exitBatch() : batchOn = true"><BatchIcon :size="15" /></button>
              <AxDropdown v-model="kindOpen" placement="bottom-end" :offset="4">
                <template #trigger><button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" aria-label="筛选" :aria-expanded="kindOpen"><FilterIcon :size="15" /></button></template>
                <template #default="{ close }">
                  <AxMenu>
                    <AxMenuItem v-for="k in ASSET_KINDS" :key="k" :active="s.assetFilterKind === k" @click="s.assetFilterKind = k; close()">{{ k }}</AxMenuItem>
                  </AxMenu>
                </template>
              </AxDropdown>
              <!-- 加号下拉：新建文件夹 / 上传资产（照左侧抽屉的加号；用户口径 2026-10-08） -->
              <AxDropdown v-model="plusOpen" placement="bottom-end" :offset="4">
                <template #trigger>
                  <button class="ml-2 grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" aria-label="新建或上传" :aria-expanded="plusOpen"><PlusIcon :size="15" /></button>
                </template>
                <template #default="{ close }">
                  <AxMenu>
                    <AxMenuItem @click="close(); addFolderIn(currentFolderId)"><FolderPlusIcon :size="14" class="text-ink-dim" /> 新建文件夹</AxMenuItem>
                    <AxMenuItem @click="close(); uploadOpen = true"><UploadIcon :size="14" class="text-ink-dim" /> 上传资产</AxMenuItem>
                  </AxMenu>
                </template>
              </AxDropdown>
            </div>

            <!-- 内容：**树形列表**（与侧边栏同一个共用组件；右键 / 拖拽 / 菜单行为完全一致） -->
            <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <AssetTree
                variant="dialog"
                show-enter
                :rows="rows"
                :batch-on="batchOn"
                :selected-ids="selectedIds"
                :collapsed-ids="collapsedIds"
                :renaming-id="renamingId"
                :rename-value="renameValue"
                :tip-id="focusTipId"
                :folder-icon-name="folderIconNameOf"
                :icon-of="iconCmp"
                :move-targets="dialogMoveTargets"
                :tag-options="[...ASSET_TAGS]"
                rename-data-attr="data-manage-rename"
                :empty-compact="false"
                tip-text="已展开到这一层"
                @tip-dismiss="clearFocusTip()"
                @toggle-expand="toggleExpand"
                @open-folder="goToFolder($event)"
                @open-asset="onOpenAsset"
                @toggle-select="onTreeToggleSelect"
                @rename-input="renameValue = $event"
                @rename-commit="onTreeRenameCommit"
                @rename-cancel="renamingId = null"
                @start-rename="startRename($event.id, $event.name)"
                @drop-on="onTreeDrop"
                @add-agent="onTreeAddAgent"
                @add-canvas="onTreeAddCanvas"
                @child-folder="addFolderIn($event.id)"
                @move-to="onTreeMoveTo"
                @set-icon="onTreeSetIcon"
                @set-tags="onTreeSetTags"
                @download="onTreeDownload"
                @remove="onTreeRemove"
              />
            </div>
          </div>
        </div>

        <!-- 底部批量条（宽容器 = 完整文字版） -->
        <div v-if="batchOn" class="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
          <AssetBatchBar
            :count="selectedIds.length"
            :folders="flatFolders"
            :tag-options="[...ASSET_TAGS]"
            @exit="exitBatch"
            @add-to="ui.moveSelectedAssets($event, [...selectedIds]); exitBatch()"
            @move-to="ui.moveSelectedAssets($event || undefined, [...selectedIds]); exitBatch()"
            @set-tags="onBatchTags"
            @download="onBatchDownload"
            @remove="onBatchRemove"
          />
        </div>
      </div>
    </div>

    <!-- 文件夹「添加到画布」确认（数量 > 10 时出现；与左侧抽屉同一个服务，用户口径：一次加太多会卡死） -->
    <div v-if="folderConfirm" class="fixed inset-0 z-[100001] grid place-items-center" @pointerdown.self="onFolderConfirmCancel">
      <div class="absolute inset-0 bg-veil" aria-hidden="true" @click="onFolderConfirmCancel"></div>
      <div class="relative flex w-[380px] flex-col gap-4 rounded-2xl border border-line bg-panel p-5 text-ink shadow-[var(--ui-shadow-md)]" role="dialog" aria-modal="true" aria-label="确认添加到画布">
        <p class="text-sm font-medium">把「{{ folderConfirm.name }}」添加到画布？</p>
        <p class="text-[13px] leading-relaxed text-ink-dim">
          这个文件夹里有 <span class="font-medium text-ink">{{ folderConfirm.count }}</span> 项内容，
          一次全部添加可能会卡顿。确定要继续吗？
        </p>
        <div class="flex items-center justify-end gap-2">
          <button class="h-8 rounded-lg border border-line px-3.5 text-[13px] transition-colors hover:bg-hover" aria-label="取消添加" @click="onFolderConfirmCancel">取消</button>
          <button class="h-8 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand/85" aria-label="确认添加" @click="onFolderConfirmOk">继续添加</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!--
    上传资产弹窗（与左侧抽屉同一个组件、同一条保存口径；保存位置默认 = 当前所在层）。
    层级：两个浮层都是 z-[100000]；本组件在源码里排在资产管理面板之后，同挂 body 时
    渲染在上层 —— 上传弹窗不会被资产管理盖住（反过来也不会盖住它的子浮层）。
    Esc 联动见上面的 onEscKey（上传开着时让位 + stopPropagation，一次 Esc 只关一层）。
  -->
  <AssetUploadDialog
    v-if="uploadOpen"
    :folders="flatFolders"
    :tag-options="[...ASSET_TAGS]"
    :initial-folder-id="currentFolderId"
    @close="uploadOpen = false"
    @save="onUploadSave"
  />
</template>
