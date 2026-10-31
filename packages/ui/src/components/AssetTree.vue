<script setup lang="ts">
/**
 * AssetTree —— **侧边栏资产 tab 与「资产管理」弹窗共用的资源树**。
 *
 * 为什么要抽成一个组件（用户口径 2026-10-07）：
 *   「这边有一个文件夹列表和资源显示列表… 另外，这边还有一个资源管理面板，它是一个弹窗，
 *     里面的 UI 其实和左侧的 tree 资源树是一样的。我认为应该把它们抽象成一个通用组件，
 *     并且让它们支持拖拽。比如，文件夹和文件都可以拖拽到目录里面。」
 *   此前两处各写一遍同样的行结构（文件夹行 + 资产行 + 「⋯」菜单 + 内联改名 + 批量勾选），
 *   改一处漏一处（历史上就漏过：缩略图、预览、菜单动作各漂移过）。
 *
 * 契约（e2e 依赖，见 packages/ui/e2e/asset-tree-shared-check.mjs）：
 *   - 根：class="asset-tree" + data-variant="drawer" | "dialog"
 *   - 行：[data-asset-row] + data-row-kind="folder|asset" + data-row-id
 *   - 拖拽悬停：目标行加 class is-drop-over（视觉 = **只有背景**，无阴影 / 无边框 —— 用户口径）
 *   - 行「⋯」菜单与**右键**打开的是同一个菜单（复用 AssetRowMenu）
 *   - 资产行可拖到**画布**：dragstart 里写 application/x-mini-canvas-asset（宿主在 document 捕获阶段接住，
 *     在落点建对应类型的节点 —— 见 LeftDrawer 的 onCanvasDrop）
 *
 * 数据不在这里取：宿主（抽屉 / 弹窗）把「行列表」和「可移动目标」传进来，动作以事件抛出去
 * —— 组件只管「怎么显示、怎么拖」，不管「从哪来、往哪存」。这样两个宿主共用一份 DOM 与交互。
 */
import { computed, reactive, ref, type Component } from 'vue'
import {
  Folder as FolderIcon, Video as VideoIcon, Image as ImageIcon, Music as MusicIcon,
  Check as CheckIcon, ChevronRight as ChevronIcon, CornerDownRight as CornerDownRightIcon,
} from 'lucide-vue-next'
import folderImg from '../assets/folder.png'
import AssetRowMenu from './AssetRowMenu.vue'
import { isAssetUsable } from '../composables/assetModel'
import { peekPack } from '../composables/nodePack'
import { peekAssetVideoThumb } from '../composables/canvasTree'

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

const props = withDefaults(
  defineProps<{
    /** 行列表（宿主算好顺序与深度） */
    rows: AssetTreeRow[]
    /** 变体：drawer（窄侧栏）/ dialog（宽弹窗）—— 只影响 class 与空态文案宽度 */
    variant?: 'drawer' | 'dialog'
    /** 是否处于批量选择模式（勾选框常显、拖拽禁用） */
    batchOn?: boolean
    /** 已选 id */
    selectedIds?: string[]
    /** 收起（不展开）的文件夹 id */
    collapsedIds?: string[]
    /** 正在内联改名的行 id（null = 没有） */
    renamingId?: string | null
    /** 改名输入缓冲 */
    renameValue?: string
    /** 文件夹图标：id → 图标名（空 = 无角标）；草稿优先由宿主在函数里处理 */
    folderIconName?: (id: string) => string
    /** 图标名 → 组件（宿主注入，避免两个宿主各存一份映射） */
    iconOf?: (name: string) => Component | unknown
    /** 「移动到」菜单的目标文件夹（宿主按行计算；已排除自身） */
    moveTargets?: (row: AssetTreeRow) => AssetTreeTarget[]
    /** 资产菜单的标签清单 */
    tagOptions?: string[]
    /** 空态文案 */
    emptyText?: string
    /**
     * 点文件夹**名字**的行为：
     *   'expand'（默认）= 展开/折叠 —— 抽屉与「资产管理」弹窗都用它
     *     （用户口径 2026-10-08：弹窗里点文件夹行也要有折叠效果，与左侧栏一致）；
     *   'open' = 进到该文件夹（有面包屑导航语义的宿主可选用；当前两处宿主都没用它）。
     * 行结构与拖拽/菜单始终共用一份。
     *
     * 为什么不用双击当"进入"入口（实测过、已回退）：第一下单击先把文件夹折叠掉，
     * 子行消失、下面的行整体上移 —— 第二下落点已经换了行，dblclick 打到了别的行上
     * （探针实测：展开的父行双击，最终进入的是另一行）。单击语义保持唯一、可预期。
     */
    folderClick?: 'expand' | 'open'
    /** 改名输入框的 data 属性名（两处宿主的历史锚点不同：抽屉 data-row-rename / 弹窗 data-manage-rename） */
    renameDataAttr?: string
    /** 占位高度提示（空态用；抽屉与弹窗的空态排版略有差异） */
    emptyCompact?: boolean
    /**
     * 文件夹行尾部是否显示**显式「进入」按钮**（默认关；只有「资产管理」弹窗打开）。
     *
     * 为什么需要它（用户口径 2026-10-08 的连带影响）：弹窗里点文件夹行 = 展开/折叠之后，
     * 「面包屑 / 新建落点 = 进到某一层」就没了入口。双击行试过、实测不可靠 ——
     * 第一下单击先把文件夹折叠/展开，子行增减会让下面的行整体位移，第二下已经点到**别的行**
     * （探针实测 dblclick 打到了非目标行）。所以改成一个显式按钮：出现位置固定，不会点错。
     * 抽屉不打开这个开关（抽屉没有"当前层"概念，整棵树就在眼前）。
     */
    showEnter?: boolean
    /**
     * 引导提示挂在哪一行（行 id；空 = 不显示）。
     *
     * 场景（用户口径 2026-10-08）：从 Agent 对话里的**文件夹引用标签**进资产管理时，
     * 树被折起来、只展开选中那条链 —— 不给提示用户看不出自己被带到哪了。
     * 计时（3 秒）与点掉由宿主负责，这里只管画。
     */
    tipId?: string
    /** 提示文案 */
    tipText?: string
  }>(),
  {
    variant: 'drawer',
    batchOn: false,
    selectedIds: () => [],
    collapsedIds: () => [],
    renamingId: null,
    renameValue: '',
    folderIconName: () => '',
    iconOf: undefined,
    moveTargets: undefined,
    tagOptions: () => [],
    emptyText: '这里还没有内容',
    folderClick: 'expand',
    renameDataAttr: 'data-row-rename',
    emptyCompact: true,
    showEnter: false,
    tipId: '',
    tipText: '',
  },
)

const emit = defineEmits<{
  /** 文件夹行：展开/折叠 */
  toggleExpand: [id: string]
  /** 文件夹行：进入该文件夹（folderClick='open' 时单击整行发；showEnter 时由行尾「进入」按钮发） */
  openFolder: [id: string]
  /**
   * 资产行：点击（宿主决定 = 预览 / 勾选）。
   * 带上原始事件：批量模式下点整行也是勾选，Shift 划区间要读 shiftKey
   * （只用勾选框选的话，用户想按住 Shift 点整行会落空）。
   */
  openAsset: [row: AssetTreeRow, e?: MouseEvent]
  /** 内联改名：开始 */
  startRename: [payload: { id: string; name: string }]
  /** 内联改名：输入变化 */
  renameInput: [value: string]
  /** 内联改名：提交（回车 / 失焦） */
  renameCommit: [payload: { kind: 'folder' | 'asset'; id: string; name: string }]
  /** 内联改名：取消（Esc） */
  renameCancel: []
  /**
   * 批量勾选切换。
   *
   * 宿主收到的是「哪一行被点了」+「这一下按住 Shift 没有」，而不是一个孤零零的 id ——
   * 因为「文件夹连带直属资产」与「Shift 划区间」都要看**行列表**（层级、顺序、同层两端），
   * 组件这一侧有现成的 rows，推给宿主比让宿主再算一份可靠（判定见 composables/assetSelection.ts）。
   */
  toggleSelect: [id: string, shift: boolean]
  /**
   * 点**缩略图**（行左端的图片标识）：用户口径 2026-10-14
   * 「弹出框里左侧的图片 logo，就是文件左侧的图片 logo。点击它没有预览效果，请修复」。
   *
   * 为什么单独开一条事件而不是复用 openAsset：右侧的名字/整行点击在**两个宿主里语义不同**
   * （抽屉 = 预览，弹窗 = 不预览，见 AssetManageDialog.onOpenAsset 的说明）；
   * 而缩略图这一处的期望是**两边一致**的 —— 它就是「我想看看这张图」，点了就该开预览。
   */
  openThumb: [row: AssetTreeRow, e?: MouseEvent]
  /** 拖拽落下：from 行拖到 to 行（to = null 表示拖到列表空白 = 根目录） */
  dropOn: [payload: { from: AssetTreeRow; to: AssetTreeRow | null }]
  /** 「⋯」/ 右键菜单动作（原样转发，宿主执行） */
  addAgent: [row: AssetTreeRow]
  addCanvas: [row: AssetTreeRow]
  childFolder: [row: AssetTreeRow]
  moveTo: [payload: { row: AssetTreeRow; targetFolderId?: string }]
  setIcon: [payload: { row: AssetTreeRow; icon: string }]
  setTags: [payload: { row: AssetTreeRow; tags: string[] }]
  download: [row: AssetTreeRow]
  remove: [row: AssetTreeRow]
  /** 点掉引导提示（宿主清 tipId） */
  tipDismiss: []
}>()

/** 拖拽会话（组件自管：只影响视觉与 drop 派发） */
const draggingId = ref<string | null>(null)
const draggingKind = ref<'folder' | 'asset' | null>(null)
/** 当前悬停的目标行 id（高亮用） */
const dragOverId = ref<string | null>(null)

const isCollapsed = (id: string): boolean => props.collapsedIds.includes(id)
const isSelected = (id: string): boolean => props.selectedIds.includes(id)
/**
 * 视频行的统一缩略图（用户 2026-10-30）：一个视频一张图，由 video 服务生成并存在资源库，
 * 左侧抽屉 / 资产管理 / 底栏 / 视频节点复用同一张。还没预热到 → 空串，模板回退 <video> 首帧。
 */
const videoThumbOf = (row: AssetTreeRow): string => peekAssetVideoThumb(row.id) ?? ''
const assetIconOf = (kind: string) =>
  kind === 'video' ? VideoIcon : kind === 'audio' ? MusicIcon : ImageIcon
/** 行缩进：起点 + 层级（两处宿主共用同一条口径）。
 * 起点 4px：折叠箭头（13px 图标居中于 size-5 按钮）视觉左缘 = 4 + 3.5 ≈ 8px、
 * 图标中心 ≈ 15.5px，与工具行搜索图标（16px 居中于 size-8，左缘 16px）对齐
 * （用户口径 2026-10-07：「文件夹左侧的折叠按钮，与上面的搜索框左侧对齐」）。
 * 勾选框只在批量模式渲染，不再常驻挤位。 */
const padLeft = (row: AssetTreeRow): string => (4 + row.depth * 20) + 'px'

const iconCmpOf = (name: string): unknown => (props.iconOf ? props.iconOf(name) : FolderIcon)
const targetsOf = (row: AssetTreeRow): AssetTreeTarget[] => props.moveTargets?.(row) ?? []

function startDrag(row: AssetTreeRow, e: DragEvent): void {
  if (props.batchOn || props.renamingId === row.id) { e.preventDefault(); return }
  draggingId.value = row.id
  draggingKind.value = row.kind
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', row.id)
    // 资产：额外带一条「这是从资源树拖出去的资产」的标记。
    // 画布侧的 file-drop 插件只认拖进来的**文件**；资源树里的资产是"已经在服务器上的引用"，
    // 拖到画布该建节点、而不是再上传一份，所以由宿主（抽屉/弹窗）自己接 drop（见 onCanvasDrop）。
    if (row.kind === 'asset') {
      try {
        e.dataTransfer.setData('application/x-mini-canvas-asset', JSON.stringify({ id: row.id }))
      } catch {
        /* 某些环境不允许自定义 MIME：宿主仍能靠 text/plain 的 id 兜底 */
      }
    }
  }
}

/**
 * 这一行能不能接住当前拖拽物。
 * 规则：只有文件夹能收；不能拖到自己身上；文件夹也不能拖进「自己的子孙」——
 * 后台会拒绝成环，但**悬停时就不该高亮**（高亮了却落不下去 = 用户报过的"看着能放、放了没反应"）。
 */
function canDropOn(row: AssetTreeRow): boolean {
  const from = draggingId.value
  if (!from) return false
  if (row.kind !== 'folder') return false
  if (row.id === from) return false
  if (draggingKind.value === 'folder') {
    // 拖到「自己当前的父级」= 原地不动，不提示
    if ((row.id === draggingParentOf(from))) return false
    // 拖到自己的子孙里 = 成环，不提示
    if (isDescendant(row.id, from)) return false
  } else if (draggingKind.value === 'asset') {
    // 资产已经在目标文件夹里 = 原地不动，不提示
    if (draggingParentOf(from) === row.id) return false
  }
  return true
}

/** 某行当前所在的文件夹 id（文件夹与资产都用 parentId；资产老字段 folderId 已在宿主侧归一到 parentId） */
function draggingParentOf(id: string): string | undefined {
  return props.rows.find((r) => r.id === id)?.parentId
}
/** 顺着 folderId/parentId 往上找，targetAncestorId 是不是 id 的祖先（或等于它） */
function isDescendant(id: string, targetAncestorId: string): boolean {
  const folders = props.rows.filter((r) => r.kind === 'folder')
  let cur: string | undefined = id
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    if (cur === targetAncestorId) return true
    seen.add(cur)
    cur = folders.find((f) => f.id === cur)?.parentId
  }
  return false
}

function onDragOver(row: AssetTreeRow, e: DragEvent): void {
  if (!canDropOn(row)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverId.value = row.id
}
function onDragLeave(row: AssetTreeRow): void {
  if (dragOverId.value === row.id) dragOverId.value = null
}
function onDrop(row: AssetTreeRow, e: DragEvent): void {
  if (!canDropOn(row)) return
  e.preventDefault()
  const from = props.rows.find((r) => r.id === draggingId.value)
  endDrag()
  if (from) emit('dropOn', { from, to: row })
}
/**
 * 拖到列表空白 = **取消本次拖拽**（不再当作“移到根目录”）。
 *
 * 审查发现的误触（用户容易丢东西）：只有落在**文件夹行**上才算“移进去”；拖到行与行的空隙、
 * 资产行、或任何非目标行上松手，以前会被容器的 drop 冒泡接住、按“拖到根目录”处理 ——
 * 嵌套的文件夹/资产会被**静默移到根**，没有任何提示，用户以为东西丢了。
 *
 * 现在语义收紧：只有显式拖到某个文件夹行上才移动；拖到别处一律原地不动。
 * “移回根目录”仍保留入口 —— 行菜单里的「移动到 →（根目录）个人资产库」。
 */
function onDropRoot(): void {
  endDrag()
}

function onDragEnd(): void {
  endDrag()
}
function endDrag(): void {
  draggingId.value = null
  draggingKind.value = null
  dragOverId.value = null
}

/** 右键行的行号 → 由 AssetRowMenu 的 openByContextMenu 打开 */
function contextMenuFor(rowId: string, e: MouseEvent): void {
  e.preventDefault()
  const api = rowMenuRefs[rowId]
  api?.openAt(e.clientX, e.clientY)
}
/** 每行的菜单组件实例（右键时按行 id 取） */
const rowMenuRefs = reactive<Record<string, { openAt: (x: number, y: number) => void } | null>>({})
function bindRowMenu(rowId: string, el: unknown): void {
  const api = (el as { openAt?: (x: number, y: number) => void } | null) ?? null
  rowMenuRefs[rowId] = api && typeof api.openAt === 'function' ? { openAt: api.openAt } : null
}

/**
 * 改名输入框的**受控**值：一律读宿主的 renameValue（唯一真源）。
 *
 * 为什么不在组件里留草稿：原来有一份 renameDraft 兜底，于是「上一次改名留下的草稿」会在
 * 下一次改名时被优先显示 —— 实测表现为「点资产的重命名，输入框里却是上一个文件夹的名字」。
 * 用户要的是「重命名 = 把当前名字变成可编辑」。所以：输入即上报，显示只认宿主那一个值；
 * 宿主切换 renaming-id 时必须同时把 renameValue 换成新行的名字（见两处宿主的 startRename）。
 */
const renameVal = computed({
  get: () => props.renameValue,
  set: (v: string) => emit('renameInput', v),
})

/**
 * 行点击是否该被吃掉：**这一行正在内联改名**时。
 *
 * 为什么必须有（用户报的现场 2026-10-14）：「在重命名文件时，我点空格会触发全屏预览效果」。
 * 真机实测的事件链：`keydown(空格) → keyup(空格) → click 落在「预览 <名字>」按钮上`。
 * 根因是**改名输入框被套在行按钮内部**：空格在按钮的子元素上按下再抬起，浏览器就按
 * 「激活这个按钮」处理（原生 button 的键盘激活语义），于是打开全屏预览。
 *
 * 两道防线（都要，缺一不可）：
 *   ① 输入框自己 `@keyup.space.stop.prevent` —— 从源头掐掉那次激活（结构性修法）；
 *   ② 就是这个状态守卫 —— 万一还有别的路径合成出点击（或将来把输入框换成 contenteditable），
 *      改名态下整行的点击一律不派发。
 *
 * 注意不会误伤「点别处提交改名」：点行上别的地方会先让输入框失焦（宿主收到 blur 就把
 * renamingId 清空），等 click 派发时这里已经是 false 了。所以守卫只拦得住「改名中、焦点还在
 * 输入框里」的那些合成点击 —— 正是要拦的那一批。
 */
function rowClickBlocked(row: AssetTreeRow): boolean {
  return props.renamingId === row.id
}
/** 资产行整行点击：改名中吃掉，否则照旧派发（宿主决定 = 预览 / 勾选） */
function onAssetRowClick(row: AssetTreeRow, e: MouseEvent): void {
  if (rowClickBlocked(row)) return
  emit('openAsset', row, e)
}
/** 文件夹行整行点击：改名中吃掉，否则按 folderClick 语义展开/折叠或进入 */
function onFolderRowClick(row: AssetTreeRow): void {
  if (rowClickBlocked(row)) return
  if (props.folderClick === 'open') emit('openFolder', row.id)
  else emit('toggleExpand', row.id)
}
/**
 * 点缩略图：等价于「预览这份资产」。
 *
 * 为什么不是直接调 onAssetRowClick：右边那个整行按钮的语义由宿主定（弹窗刻意不预览），
 * 而缩略图的期望是两边一致（见 openThumb 的说明）。所以这一处单独派发，
 * 但仍然走同一个改名态守卫（改名中点它不该开预览）。
 */
function onThumbClick(row: AssetTreeRow, e: MouseEvent): void {
  if (rowClickBlocked(row)) return
  emit('openThumb', row, e)
}

/**
 * 节点包（.mcnode）的**迷你窗口缩略图**（用户 2026-10-28 定的"省事路线"）：
 * 卡片里放一个小 iframe（320px，缩到 32px 高的窗口里），把包里的界面缩着显示出来。
 * 内容来自后台 /api/node-packages/read 解出的 ui.html —— 不在前端再写一份解压。
 * 缓存一份（url → html）：同一个包重复渲染不重复取；列表里通常只有几个包，够用。
 */
// 必须是**响应式集合**：取包是异步的，包回来那一刻要触发模板重算
//（普通 Map 改了不会重渲染 —— 第一版就是这么写的，取到了也画不出来）。
const packThumbs = reactive(new Map<string, string>())
const packHtmlOf = (url?: string): string => (url && packThumbs.get(url)) || ''
async function loadPackThumb(url?: string): Promise<void> {
  if (!url || packThumbs.has(url)) return
  try {
    const pack = await peekPack(url)
    packThumbs.set(url, pack.html)
  } catch {
    /* 取不到就维持图标兜底，不打扰 */
  }
}

/**
 * 行挂载钩子：节点包行出现时触发取包（loadPackThumb），拿到 html 后版本号 +1 重渲染。
 * 图片/视频行不需要它（它们有地址就能直接画）。
 */
function registerAssetRow(row: AssetTreeRow, el: unknown): void {
  if (row.kind === 'asset' && (row.assetKind ?? '') === 'node-package' && row.url && !packThumbs.has(row.url)) {
    void loadPackThumb(row.url)
  }
}
</script>

<template>
  <!--
    容器上的 @drop 只负责**取消**（onDropRoot 不再派发“移到根”）：
    行上的 drop 没接住的（拖到空隙/资产行/非目标行）到这里一律原地不动。
    @dragover 不再 prevent —— 只有文件夹行自己 prevent（onDragOver）才允许放下。
  -->
  <div class="asset-tree min-h-full" :data-variant="variant" @drop.prevent="onDropRoot" @dragend="onDragEnd">
    <div
      v-for="row in rows" :key="row.kind + row.id"
      class="asset-tree-row group/row relative flex h-10 w-full items-center gap-2 rounded-lg transition-colors hover:bg-hover"
      :class="[
        variant === 'dialog' ? 'px-2' : 'pr-1',
        batchOn ? 'pr-8' : '',
        dragOverId === row.id ? 'is-drop-over' : '',
      ]"
      :data-dragging="draggingId ? '1' : undefined"
      :style="{ paddingLeft: padLeft(row) }"
      :data-asset-row="''"
      :data-row-kind="row.kind"
      :data-row-id="row.id"
      :draggable="!batchOn && renamingId !== row.id"
      @dragstart="startDrag(row, $event)"
      @dragover="onDragOver(row, $event)"
      @dragleave="onDragLeave(row)"
      @drop="onDrop(row, $event)"
      @contextmenu="contextMenuFor(row.id, $event)"
    >
      <!-- 批量勾选框：放行尾（flex 顺序里最后一个元素，绝对定位不占位）。
           口径 2026-10-07：①「左侧空余的空间挪掉，折叠按钮与搜索框左侧对齐」——
           此前勾选框以 size-4 常驻占位，把折叠箭头从行首挤出 24px；
           ② 参考图定稿：勾选框放**右侧**（行尾 absolute right-2，与图 1 一致）。 -->
      <button
        v-if="batchOn"
        class="absolute right-2 top-1/2 z-[1] grid size-4 -translate-y-1/2 place-items-center rounded-[4px] border transition-opacity"
        :class="isSelected(row.id) ? 'border-transparent bg-ink text-panel' : 'border-line hover:border-ink-dim'"
        role="checkbox" :aria-checked="isSelected(row.id)" :aria-label="'选中 ' + row.name"
        @click="emit('toggleSelect', row.id, $event.shiftKey)"
      ><CheckIcon v-if="isSelected(row.id)" :size="10" /></button>

      <!-- 文件夹行 -->
      <template v-if="row.kind === 'folder'">
        <button class="grid size-5 flex-none place-items-center text-ink-dim" :aria-label="(isCollapsed(row.id) ? '展开 ' : '折叠 ') + row.name" :aria-expanded="!isCollapsed(row.id)" @click="emit('toggleExpand', row.id)">
          <ChevronIcon :size="13" class="transition-transform" :class="isCollapsed(row.id) ? '' : 'rotate-90'" />
        </button>
        <button
          class="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
          @click="onFolderRowClick(row)"
        >
          <span class="relative grid size-8 flex-none place-items-center">
            <img :src="folderImg" alt="" class="size-8 object-contain" draggable="false" />
            <span v-if="folderIconName(row.id)" class="absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-panel text-ink-dim"><component :is="iconCmpOf(folderIconName(row.id))" :size="9" /></span>
          </span>
          <input
            v-if="renamingId === row.id"
            v-model="renameVal"
            :data-manage-rename="renameDataAttr !== 'data-row-rename' ? '' : undefined"
            :data-row-rename="renameDataAttr === 'data-row-rename' ? '' : undefined"
            class="h-7 min-w-0 flex-1 rounded-md border border-brand/60 bg-chip px-1.5 text-[13px] text-ink focus:outline-none"
            aria-label="文件夹名称"
            @keydown.enter="emit('renameCommit', { kind: 'folder', id: row.id, name: renameVal })"
            @keydown.esc.stop="emit('renameCancel')"
            @keyup.space.stop.prevent
            @blur="emit('renameCommit', { kind: 'folder', id: row.id, name: renameVal })"
            @click.stop
          />
          <!--
            名字 + 引导提示**同一格**：提示要**紧跟名字**（不跟计数角标一起被挤到行尾）。
            提示是 span 不是 button —— 它在文件夹按钮里面，再嵌一个真 <button> 会撞读屏
            （ui-style-guide §5 第 2 条）；@click.stop 把这次点击留在提示上（不连带折叠该文件夹）。
          -->
          <span v-else class="flex min-w-0 flex-1 items-center gap-1.5">
            <span class="min-w-0 truncate text-[13px] text-ink">{{ row.name }}</span>
            <span
              v-if="tipId === row.id"
              class="asset-tree-tip"
              role="button"
              tabindex="0"
              :aria-label="tipText || '提示'"
              @click.stop="emit('tipDismiss')"
              @keydown.enter.stop.prevent="emit('tipDismiss')"
            >{{ tipText }}</span>
          </span>
          <span v-if="row.count" class="flex-none text-[11px] text-ink-dim">{{ row.count }}</span>
        </button>
        <AssetRowMenu
          v-if="!batchOn"
          :ref="(el: unknown) => bindRowMenu(row.id, el)"
          kind="folder" :id="row.id" :name="row.name" :icon="folderIconName(row.id)"
          :folders="targetsOf(row)"
          :current-folder-id="row.parentId"
          @add-agent="emit('addAgent', row)"
          @add-canvas="emit('addCanvas', row)"
          @child-folder="emit('childFolder', row)"
          @move-to="(t?: string) => emit('moveTo', { row, targetFolderId: t })"
          @set-icon="(ic: string) => emit('setIcon', { row, icon: ic })"
          @rename="emit('startRename', { id: row.id, name: row.name })"
          @download="emit('download', row)"
          @remove="emit('remove', row)"
        />
        <!-- 显式「进入」（弹窗侧开启 showEnter；悬停可见，与「⋯」同一种显隐口径）。
             位置固定、标签明确，不会像双击那样被"第一下折叠导致换行"带跑。 -->
        <button
          v-if="showEnter && !batchOn"
          class="grid size-6 flex-none place-items-center rounded-lg text-ink-dim opacity-0 transition-opacity hover:bg-hover hover:text-ink group-hover/row:opacity-100 focus-visible:opacity-100"
          :aria-label="'进入 ' + row.name"
          @click="emit('openFolder', row.id)"
        ><CornerDownRightIcon :size="14" /></button>

      </template>

      <!-- 资产行（同款骨架） -->
      <template v-else>
        <!--
          与文件夹图标**左对齐**（用户口径 2026-10-07）：
          文件夹行的图标左缘 = 折叠按钮(20px) + gap(8px)；资产行没有折叠按钮，
          补一个等宽的空占位，缩略图就能落到文件夹图标的正下方。
        -->
        <span class="size-5 flex-none" aria-hidden="true"></span>
        <button class="flex h-full min-w-0 flex-1 items-center gap-2 text-left" :aria-label="'预览 ' + row.name" @click="onAssetRowClick(row, $event)">
          <!--
            缩略图（用户口径 2026-10-14：「弹出框里左侧的图片 logo…点击它没有预览效果，请修复」）：
            它就是「我想看看这张图」，两处宿主都该开预览 —— 所以自己 @click.stop 派发 openThumb，
            不再依赖右侧那个「整行」按钮的宿主语义（弹窗那侧刻意不预览）。
            @click.stop 也顺手把这次点击留在缩略图上，不连带触发整行的动作（勾选 / 展开）。
          -->
          <!--
            节点包单独一支：它要先"取包"才有内容，所以容器带 ref 钩子（挂载即触发取包）。
            与下面普通缩略图共用同一套外观，不另立尺寸。
          -->
          <span
            v-if="row.kind === 'asset' && (row.assetKind ?? '') === 'node-package' && row.url"
            :ref="(el) => registerAssetRow(row, el)"
            class="relative grid size-8 flex-none place-items-center overflow-hidden rounded-lg bg-thumb-soft text-ink-mute"
            :title="'预览 ' + row.name"
            @click.stop="onThumbClick(row, $event)"
          >
            <iframe
              v-if="packHtmlOf(row.url)"
              :srcdoc="packHtmlOf(row.url)"
              sandbox=""
              class="pack-thumb-frame"
              title="节点包缩略图"
              tabindex="-1"
              aria-hidden="true"
            ></iframe>
            <ImageIcon v-else :size="15" />
          </span>
          <span
            v-else
            class="grid size-8 flex-none place-items-center overflow-hidden rounded-lg bg-thumb-soft text-ink-mute"
            :title="'预览 ' + row.name"
            @click.stop="onThumbClick(row, $event)"
          >
            <img v-if="(row.assetKind ?? 'other') === 'image' && row.url" :src="row.url" alt="" class="h-full w-full object-cover" />
            <!--
              视频缩略图（用户 2026-10-30）：优先用**统一缩略图**（video 服务生成、
              存资源库、全站复用同一张，重启也在）。还没就绪时回退 <video preload=metadata>
              出首帧，保证任何时刻都有画面可看；两者都出不来才落到类型图标。
              中央播放圆点照旧，用来与图片一眼区分。
            -->
            <img
              v-else-if="(row.assetKind ?? 'other') === 'video' && videoThumbOf(row)"
              :src="videoThumbOf(row)"
              alt=""
              class="h-full w-full object-cover"
            />
            <video
              v-else-if="(row.assetKind ?? 'other') === 'video' && row.url"
              :src="row.url"
              class="h-full w-full object-cover"
              preload="metadata"
              muted
              playsinline
              aria-hidden="true"
            ></video>
            <component v-else :is="assetIconOf(row.assetKind ?? 'other')" :size="15" />
            <span
              v-if="(row.assetKind ?? 'other') === 'video' && row.url"
              class="absolute grid size-4 place-items-center rounded-full bg-[var(--ui-scrim)] text-[var(--ui-tip-ink)]"
              aria-hidden="true"
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 19,12 7,20" /></svg>
            </span>
          </span>
          <input
            v-if="renamingId === row.id"
            v-model="renameVal"
            :data-manage-rename="renameDataAttr !== 'data-row-rename' ? '' : undefined"
            :data-row-rename="renameDataAttr === 'data-row-rename' ? '' : undefined"
            class="h-7 min-w-0 flex-1 rounded-md border border-brand/60 bg-chip px-1.5 text-[13px] text-ink focus:outline-none"
            aria-label="资产名称"
            @keydown.enter="emit('renameCommit', { kind: 'asset', id: row.id, name: renameVal })"
            @keydown.esc.stop="emit('renameCancel')"
            @keyup.space.stop.prevent
            @blur="emit('renameCommit', { kind: 'asset', id: row.id, name: renameVal })"
            @click.stop
          />
          <span v-else class="min-w-0 flex-1 truncate text-[13px] text-ink">{{ row.name }}</span>
        </button>
        <AssetRowMenu
          v-if="!batchOn"
          :ref="(el: unknown) => bindRowMenu(row.id, el)"
          kind="asset" :id="row.id" :name="row.name"
          :folders="targetsOf(row)"
          :current-folder-id="row.kind === 'asset' ? (row.parentId ?? undefined) : undefined"
          :usable="isAssetUsable(row)"
          :tag-options="tagOptions" :tags="row.tags ?? []"
          @add-agent="emit('addAgent', row)"
          @add-canvas="emit('addCanvas', row)"
          @move-to="(t?: string) => emit('moveTo', { row, targetFolderId: t })"
          @set-tags="(tags: string[]) => emit('setTags', { row, tags })"
          @rename="emit('startRename', { id: row.id, name: row.name })"
          @download="emit('download', row)"
          @remove="emit('remove', row)"
        />
      </template>
    </div>

    <!-- 空态 -->
    <div v-if="!rows.length" class="flex flex-col items-center justify-center gap-2 text-ink-mute" :class="emptyCompact ? 'py-10' : 'h-full'">
      <FolderIcon :size="emptyCompact ? 26 : 34" :stroke-width="1" />
      <p class="text-xs" :class="emptyCompact ? '' : 'max-w-[220px] text-center leading-relaxed'">{{ emptyText }}</p>
    </div>
  </div>
</template>

<style>
/* 非 scoped：两处宿主都要命中；类名是 e2e 契约的一部分（asset-tree 系列的 data-* 亦然）。 */
/*
 * 拖拽悬停视觉（用户口径 2026-10-07）：
 *   第一版：「拖拽到其他目录时，不要提供边框，只给一个 over 的背景，一个灰色阴影就行」；
 *   第二版（用户实测 2026-10-07）：「拖拽上去有那种灰色的背景…我感觉你好像设置了什么阴影，
 *   把这个阴影给去掉」→ 定稿 = **只有背景**，不要阴影、不要边框。
 */
.asset-tree .asset-tree-row.is-drop-over {
  /* 拖拽中的反馈要立刻出现：这条规则不参与过渡（transition-colors 的 0.15s 在原生拖拽期间
     会被浏览器冻结在起始帧 —— 实测背景色读出来还是透明，看着像"没高亮"）。 */
  transition: none;
  background: var(--ui-hover-strong, rgb(0 0 0 / 0.1));
}

/*
 * 引导提示（从 Agent 的文件夹引用标签跳进来时出现，见 tipId 的说明）。
 * 位置：**跟在文件夹名后面**（行内流式）—— 出屏与遮挡都不用自己管，也不会压到下一行；
 * 弹窗与抽屉共用这一条（两边的树行结构本来就一样）。
 * 视觉按 ui-style-guide：强调色浅底 + 强调色文字（唯一允许的「可交互/当前」色），
 * 圆角 8、12px/600、150ms 淡入（只动 opacity/transform，规范 §2.7）。
 */
.asset-tree-tip {
  flex: none;
  margin-left: 6px;
  padding: 2px 6px;
  border-radius: 8px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.14));
  color: var(--ui-accent, #0891b2);
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  cursor: pointer;
  animation: asset-tree-tip-in 0.15s ease-out both;
}
.asset-tree-tip:focus-visible { outline: 2px solid var(--ui-accent, #0891b2); outline-offset: 1px; }
@keyframes asset-tree-tip-in {
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .asset-tree-tip { animation: none; }
}

/*
 * 节点包的迷你窗口缩略图：iframe 原尺寸 320px 宽，缩到 32×32 的卡片里（transform 缩放
 * 不改 iframe 内部布局，只是显示变小 —— 与生成历史缩略墙同一套做法）。
 * pointer-events: none：它只是"画面"，点击要落到整行/缩略图按钮上（不抢交互）。
 *
 * ★ 必须绝对定位 + 原点在左上角（2026-10-28 实测修）：320px 的盒子放在 32px 的
 * grid 容器里会先被"居中"，缩放中心又在盒子正中，缩完整体偏到父容器右下 144px 处
 *（实测 iframe 在 204,534，容器在 60,390）—— 用户看到的就是"一小块蓝色跑到了行外"。
 * 绝对定位到 (0,0)、原点 0 0 之后，缩完正好铺满 32×32。
 */
.asset-tree .pack-thumb-frame {
  position: absolute;
  left: 0;
  top: 0;
  width: 320px;
  height: 320px;
  border: 0;
  transform: scale(0.1);
  transform-origin: 0 0;
  pointer-events: none;
  background: var(--ui-overlay-solid, #fff);
}
</style>
