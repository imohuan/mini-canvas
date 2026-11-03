<script setup lang="ts">
import { computed } from 'vue'
import {
  Video as VideoIcon, Image as ImageIcon, Music as MusicIcon,
  Check as CheckIcon, ChevronRight as ChevronIcon, CornerDownRight as CornerDownRightIcon,
} from 'lucide-vue-next'
import folderImg from '../../../assets/folder.png'
import AssetRowMenu from '../../AssetRowMenu.vue'
import { isAssetUsable } from '../../../composables/assetModel'
import { peekAssetVideoThumb } from '../../../composables/canvasTree'
import type { AssetTreeRow, AssetTreeTarget } from './types'

const props = defineProps<{
  row: AssetTreeRow
  variant: 'drawer' | 'dialog'
  batchOn: boolean
  selected: boolean
  collapsed: boolean
  renamingId: string | null
  renameValue: string
  renameDataAttr: string
  folderIconName: string
  folderIcon: unknown
  targets: AssetTreeTarget[]
  tagOptions: string[]
  showEnter: boolean
  folderClick: 'expand' | 'open'
  tipId: string
  tipText: string
  dragging: boolean
  dragOver: boolean
  packHtml: string
  registerRow: (row: AssetTreeRow, el: unknown) => void
  startDrag: (row: AssetTreeRow, e: DragEvent) => void
  onDragOver: (row: AssetTreeRow, e: DragEvent) => void
  onDragLeave: (row: AssetTreeRow) => void
  onDrop: (row: AssetTreeRow, e: DragEvent) => void
  onContextMenu: (rowId: string, e: MouseEvent) => void
  registerMenu: (rowId: string, el: unknown) => void
}>()

const emit = defineEmits<{
  toggleExpand: [id: string]
  openFolder: [id: string]
  openAsset: [row: AssetTreeRow, e?: MouseEvent]
  startRename: [payload: { id: string; name: string }]
  renameInput: [value: string]
  renameCommit: [payload: { kind: 'folder' | 'asset'; id: string; name: string }]
  renameCancel: []
  toggleSelect: [id: string, shift: boolean]
  openThumb: [row: AssetTreeRow, e?: MouseEvent]
  addAgent: [row: AssetTreeRow]
  addCanvas: [row: AssetTreeRow]
  childFolder: [row: AssetTreeRow]
  moveTo: [payload: { row: AssetTreeRow; targetFolderId?: string }]
  setIcon: [payload: { row: AssetTreeRow; icon: string }]
  setTags: [payload: { row: AssetTreeRow; tags: string[] }]
  download: [row: AssetTreeRow]
  remove: [row: AssetTreeRow]
  tipDismiss: []
}>()

function bindRowMenu(el: unknown): void {
  props.registerMenu(props.row.id, el)
}

const videoThumbOf = (row: AssetTreeRow): string => peekAssetVideoThumb(row.id) ?? ''
const assetIconOf = (kind: string) =>
  kind === 'video' ? VideoIcon : kind === 'audio' ? MusicIcon : ImageIcon
const padLeft = (row: AssetTreeRow): string => (4 + row.depth * 20) + 'px'

const renameVal = computed({
  get: () => props.renameValue,
  set: (v: string) => emit('renameInput', v),
})

function rowClickBlocked(row: AssetTreeRow): boolean {
  return props.renamingId === row.id
}
function onAssetRowClick(row: AssetTreeRow, e: MouseEvent): void {
  if (rowClickBlocked(row)) return
  emit('openAsset', row, e)
}
function onFolderRowClick(row: AssetTreeRow): void {
  if (rowClickBlocked(row)) return
  if (props.folderClick === 'open') emit('openFolder', row.id)
  else emit('toggleExpand', row.id)
}
function onThumbClick(row: AssetTreeRow, e: MouseEvent): void {
  if (rowClickBlocked(row)) return
  emit('openThumb', row, e)
}
function registerAssetRow(el: unknown): void {
  props.registerRow(props.row, el)
}
function openMenuAt(e: MouseEvent): void {
  props.onContextMenu(props.row.id, e)
}
</script>

<template>
  <div
    class="asset-tree-row group/row relative flex h-10 w-full items-center gap-2 rounded-lg transition-colors hover:bg-hover"
    :class="[
      variant === 'dialog' ? 'px-2' : 'pr-1',
      batchOn ? 'pr-8' : '',
      dragOver ? 'is-drop-over' : '',
    ]"
    :data-dragging="dragging ? '1' : undefined"
    :style="{ paddingLeft: padLeft(row) }"
    :data-asset-row="''"
    :data-row-kind="row.kind"
    :data-row-id="row.id"
    :draggable="!batchOn && renamingId !== row.id"
    @dragstart="startDrag(row, $event)"
    @dragover="onDragOver(row, $event)"
    @dragleave="onDragLeave(row)"
    @drop="onDrop(row, $event)"
    @contextmenu="openMenuAt"
  >
    <!-- 批量勾选框：放行尾（flex 顺序里最后一个元素，绝对定位不占位）。
         口径 2026-10-07：①「左侧空余的空间挪掉，折叠按钮与搜索框左侧对齐」——
         此前勾选框以 size-4 常驻占位，把折叠箭头从行首挤出 24px；
         ② 参考图定稿：勾选框放**右侧**（行尾 absolute right-2，与图 1 一致）。 -->
    <button
      v-if="batchOn"
      class="absolute right-2 top-1/2 z-[1] grid size-4 -translate-y-1/2 place-items-center rounded-[4px] border transition-opacity"
      :class="selected ? 'border-transparent bg-ink text-panel' : 'border-line hover:border-ink-dim'"
      role="checkbox" :aria-checked="selected" :aria-label="'选中 ' + row.name"
      @click="emit('toggleSelect', row.id, $event.shiftKey)"
    ><CheckIcon v-if="selected" :size="10" /></button>

    <!-- 文件夹行 -->
    <template v-if="row.kind === 'folder'">
      <button class="grid size-5 flex-none place-items-center text-ink-dim" :aria-label="(collapsed ? '展开 ' : '折叠 ') + row.name" :aria-expanded="!collapsed" @click="emit('toggleExpand', row.id)">
        <ChevronIcon :size="13" class="transition-transform" :class="collapsed ? '' : 'rotate-90'" />
      </button>
      <button
        class="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
        @click="onFolderRowClick(row)"
      >
        <span class="relative grid size-8 flex-none place-items-center">
          <img :src="folderImg" alt="" class="size-8 object-contain" draggable="false" />
          <span v-if="folderIconName" class="absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-panel text-ink-dim"><component :is="folderIcon" :size="9" /></span>
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
        :ref="bindRowMenu"
        kind="folder" :id="row.id" :name="row.name" :icon="folderIconName"
        :folders="targets"
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
          :ref="registerAssetRow"
          class="relative grid size-8 flex-none place-items-center overflow-hidden rounded-lg bg-thumb-soft text-ink-mute"
          :title="'预览 ' + row.name"
          @click.stop="onThumbClick(row, $event)"
        >
          <iframe
            v-if="packHtml"
            :srcdoc="packHtml"
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
        :ref="bindRowMenu"
        kind="asset" :id="row.id" :name="row.name"
        :folders="targets"
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
</template>
