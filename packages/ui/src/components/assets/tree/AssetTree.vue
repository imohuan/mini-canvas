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
import { computed, reactive, type Component } from 'vue'
import { Folder as FolderIcon } from 'lucide-vue-next'
import { peekPack } from '../../../composables/nodePack'
import type { AssetTreeRow, AssetTreeTarget } from './types'
import AssetTreeRowView from './AssetTreeRow.vue'
import { useAssetTreeDrag } from './useAssetTreeDrag'

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

const isCollapsed = (id: string): boolean => props.collapsedIds.includes(id)
const isSelected = (id: string): boolean => props.selectedIds.includes(id)
const iconCmpOf = (name: string): unknown => (props.iconOf ? props.iconOf(name) : FolderIcon)
const targetsOf = (row: AssetTreeRow): AssetTreeTarget[] => props.moveTargets?.(row) ?? []

/** 每行的菜单组件实例（右键时按行 id 取） */
const rowMenuRefs = reactive<Record<string, { openAt: (x: number, y: number) => void } | null>>({})
function bindRowMenu(rowId: string, el: unknown): void {
  const api = (el as { openAt?: (x: number, y: number) => void } | null) ?? null
  rowMenuRefs[rowId] = api && typeof api.openAt === 'function' ? { openAt: api.openAt } : null
}

function contextMenuFor(rowId: string, e: MouseEvent): void {
  e.preventDefault()
  const api = rowMenuRefs[rowId]
  api?.openAt(e.clientX, e.clientY)
}

const { draggingId, dragOverId, startDrag, onDragOver, onDragLeave, onDrop, onDropRoot, onDragEnd } = useAssetTreeDrag(
  props,
  (event, payload) => emit(event, payload),
)

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
    <AssetTreeRowView
      v-for="row in rows" :key="row.kind + row.id"
      :row="row"
      :variant="variant"
      :batch-on="batchOn"
      :selected="isSelected(row.id)"
      :collapsed="isCollapsed(row.id)"
      :renaming-id="renamingId"
      :rename-value="renameValue"
      :rename-data-attr="renameDataAttr"
      :folder-icon-name="folderIconName(row.id)"
      :folder-icon="iconCmpOf(folderIconName(row.id))"
      :targets="targetsOf(row)"
      :tag-options="tagOptions"
      :show-enter="showEnter"
      :folder-click="folderClick"
      :tip-id="tipId"
      :tip-text="tipText"
      :dragging="Boolean(draggingId)"
      :drag-over="dragOverId === row.id"
      :pack-html="packHtmlOf(row.url)"
      :register-row="registerAssetRow"
      :register-menu="bindRowMenu"
      :start-drag="startDrag"
      :on-drag-over="onDragOver"
      :on-drag-leave="onDragLeave"
      :on-drop="onDrop"
      :on-context-menu="contextMenuFor"
      @toggle-expand="emit('toggleExpand', $event)"
      @open-folder="emit('openFolder', $event)"
      @open-asset="(row: AssetTreeRow, e?: MouseEvent) => emit('openAsset', row, e)"
      @open-thumb="(row: AssetTreeRow, e?: MouseEvent) => emit('openThumb', row, e)"
      @start-rename="emit('startRename', $event)"
      @rename-input="emit('renameInput', $event)"
      @rename-commit="emit('renameCommit', $event)"
      @rename-cancel="emit('renameCancel')"
      @toggle-select="(id: string, shift: boolean) => emit('toggleSelect', id, shift)"
      @add-agent="emit('addAgent', $event)"
      @add-canvas="emit('addCanvas', $event)"
      @child-folder="emit('childFolder', $event)"
      @move-to="emit('moveTo', $event)"
      @set-icon="emit('setIcon', $event)"
      @set-tags="emit('setTags', $event)"
      @download="emit('download', $event)"
      @remove="emit('remove', $event)"
      @tip-dismiss="emit('tipDismiss')"
    />

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
