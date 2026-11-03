<script setup lang="ts">
// AssetManageDialog —— 资产管理大弹窗（照图 1/4）：
// 左：库列表（个人资产库 / 可灵主体库）；右：面包屑 + 工具行（搜索/批量/筛选/新建）+ **树形列表**。
// 列表一行一个文件夹或资产（不再是宫格），行 hover 出「…」菜单与「多选」控件；
// 文件夹可展开递归显示子树（与侧边栏同一种树形态）。菜单复用 AssetRowMenu —— 与侧边栏行为完全一致。
// 2026-10-08 用户口径：① 点文件夹行 = 展开/折叠（与左侧栏一致，不再有"点名字下钻"；
//    深层新建走行菜单「新建子文件夹」，深层上传在上传弹窗里选保存位置）；
// ② 右上角「新建」= 加号下拉（新建文件夹 / 上传资产），与左侧抽屉的加号同款。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X as XIcon } from 'lucide-vue-next'
import AssetBatchBar from '../../AssetBatchBar.vue'
import AssetTree, { type AssetTreeRow } from '../../AssetTree.vue'
import AssetUploadDialog from '../../AssetUploadDialog.vue'
import ManageDialogShell from './ManageDialogShell.vue'
import ManageDialogToolbar from './ManageDialogToolbar.vue'
import { useUi } from '../../../composables/ui'
import { checkedRowIds } from '../../../composables/assetSelection'
import { folderIconComponent } from '../../../composables/folderIcons'
import { useAssetTreeActions } from './useAssetTreeActions'

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

// 「节点」= 节点包（.mcnode）用的标签；与 LeftDrawer / composables/ui.ts 同一份口径
const ASSET_TAGS = ['角色', '场景', '物品', '风格', '音效', '节点'] as const
const ASSET_KINDS = ['全部', '图片', '视频', '音频', '其他'] as const
/** 当前浏览的文件夹（空 = 根=个人资产库） */
const currentFolderId = ref<string | undefined>(undefined)
const kindOpen = ref(false)
/** 「新建」下拉（新建文件夹 / 上传资产）是否打开 */
const plusOpen = ref(false)
const batchOn = ref(false)
const selectedIds = ref<string[]>([])
/**
 * Shift 区间的起点（最后一次普通点选的那一行）。
 *
 * 与抽屉的差异：抽屉那份住在共享状态（ui.state.assetSelectAnchorId）—— 两处宿主是同一个变量的
 * 两个窗口，抽屉必须共享；弹窗是独立浮层、自成一份勾选，所以自己持一份。
 * 判定逻辑两边共用（composables/assetSelection.ts），这里只存「从哪一项算区间」。
 */
const selectAnchorId = ref<string | null>(null)
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
/**
 * 哪些行显示成勾上：已选表里只有资产 id，文件夹的勾选态由它的内容推导
 * （勾了里面每一个文件 → 这个文件夹看起来就是勾上的；判定见 composables/assetSelection.ts）。
 */
const checkedIds = computed(() => checkedRowIds(rows.value, selectedIds.value, ui.assetItems.value))
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

function exitBatch(): void {
  batchOn.value = false
  selectedIds.value = []
  selectAnchorId.value = null
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
/**
 * 上传弹窗保存：本地文件直传；**画布媒体（urls）先取字节再直传**（与 AssetUploadHost 同一口径）。
 * 只读 files 的话，预填进来的画布图/视频会被静默丢掉（用户看到「点保存没反应」）。
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
function startRename(id: string, name: string): void {
  renamingId.value = id
  renameValue.value = name
  nextTick(() => {
    const el = document.querySelector<HTMLInputElement>('input[data-manage-rename]')
    el?.focus()
    el?.select()
  })
}
const {
  dialogMoveTargets,
  onTreeToggleSelect,
  onOpenAsset,
  onOpenThumb,
  onTreeRenameCommit,
  onTreeAddAgent,
  onTreeAddCanvas,
  folderConfirm,
  onFolderConfirmOk,
  onFolderConfirmCancel,
  onTreeMoveTo,
  onTreeSetIcon,
  onTreeSetTags,
  onTreeDownload,
  onTreeRemove,
  onTreeDrop,
  onBatchTags,
  onBatchRemove,
  onBatchDownload,
} = useAssetTreeActions({ rows, flatFolders, batchOn, selectedIds, selectAnchorId, renamingId, exitBatch })
</script>

<template>
  <Teleport to="body">
    <ManageDialogShell :breadcrumb="breadcrumb" :show-batch="batchOn" @close="emit('close')" @go-to-folder="goToFolder">
      <template #closeIcon><XIcon :size="16" /></template>
      <template #tools>
        <ManageDialogToolbar
          v-model:search-query="searchQuery"
          v-model:kind-open="kindOpen"
          v-model:plus-open="plusOpen"
          :batch-on="batchOn"
          :asset-kinds="ASSET_KINDS"
          :active-kind="s.assetFilterKind"
          @toggle-batch="batchOn ? exitBatch() : batchOn = true"
          @pick-kind="s.assetFilterKind = $event as typeof s.assetFilterKind"
          @add-folder="addFolderIn(currentFolderId)"
          @open-upload="uploadOpen = true"
        />
      </template>
      <template #tree>
        <AssetTree variant="dialog" show-enter :rows="rows" :batch-on="batchOn" :selected-ids="checkedIds"
          :collapsed-ids="collapsedIds" :renaming-id="renamingId" :rename-value="renameValue" :tip-id="focusTipId"
          :folder-icon-name="folderIconNameOf" :icon-of="iconCmp" :move-targets="dialogMoveTargets"
          :tag-options="[...ASSET_TAGS]" rename-data-attr="data-manage-rename" :empty-compact="false"
          tip-text="已展开到这一层" @tip-dismiss="clearFocusTip()" @toggle-expand="toggleExpand"
          @open-folder="goToFolder($event)" @open-asset="onOpenAsset" @open-thumb="onOpenThumb"
          @toggle-select="onTreeToggleSelect" @rename-input="renameValue = $event"
          @rename-commit="onTreeRenameCommit" @rename-cancel="renamingId = null"
          @start-rename="startRename($event.id, $event.name)" @drop-on="onTreeDrop" @add-agent="onTreeAddAgent"
          @add-canvas="onTreeAddCanvas" @child-folder="addFolderIn($event.id)" @move-to="onTreeMoveTo"
          @set-icon="onTreeSetIcon" @set-tags="onTreeSetTags" @download="onTreeDownload" @remove="onTreeRemove" />
      </template>
      <template #batch>
          <AssetBatchBar :count="selectedIds.length" :folders="flatFolders" :tag-options="[...ASSET_TAGS]"
            @exit="exitBatch" @add-to="ui.moveSelectedAssets($event, [...selectedIds]); exitBatch()"
            @move-to="ui.moveSelectedAssets($event || undefined, [...selectedIds]); exitBatch()" @set-tags="onBatchTags"
            @download="onBatchDownload" @remove="onBatchRemove" />
      </template>
    </ManageDialogShell>

    <!-- 文件夹「添加到画布」确认（数量 > 10 时出现；与左侧抽屉同一个服务，用户口径：一次加太多会卡死） -->
    <div v-if="folderConfirm" class="fixed inset-0 z-[100001] grid place-items-center"
      @pointerdown.self="onFolderConfirmCancel">
      <div class="absolute inset-0 bg-veil" aria-hidden="true" @click="onFolderConfirmCancel"></div>
      <div
        class="relative flex w-[380px] flex-col gap-4 rounded-2xl border border-line bg-panel p-5 text-ink shadow-[var(--ui-shadow-md)]"
        role="dialog" aria-modal="true" aria-label="确认添加到画布">
        <p class="text-sm font-medium">把「{{ folderConfirm.name }}」添加到画布？</p>
        <p class="text-[13px] leading-relaxed text-ink-dim">
          这个文件夹里有 <span class="font-medium text-ink">{{ folderConfirm.count }}</span> 项内容，
          一次全部添加可能会卡顿。确定要继续吗？
        </p>
        <div class="flex items-center justify-end gap-2">
          <button class="h-8 rounded-lg border border-line px-3.5 text-[13px] transition-colors hover:bg-hover"
            aria-label="取消添加" @click="onFolderConfirmCancel">取消</button>
          <button
              class="h-8 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand/85"
              aria-label="确认添加" @click="onFolderConfirmOk">继续添加</button>
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
  <AssetUploadDialog v-if="uploadOpen" :folders="flatFolders" :tag-options="[...ASSET_TAGS]"
    :initial-folder-id="currentFolderId" @close="uploadOpen = false" @save="onUploadSave" />
</template>
