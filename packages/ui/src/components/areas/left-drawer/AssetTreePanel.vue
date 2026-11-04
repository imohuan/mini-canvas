<script setup lang="ts">
import { Folder as FolderIcon } from 'lucide-vue-next'
import AssetTree, { type AssetTreeRow, type AssetTreeTarget } from '../../AssetTree.vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { AssetFolderSummary } from '../../../composables/projectsApi'

type AssetFolderNode = AssetFolderSummary & { children: AssetFolderNode[]; count: number }

defineProps<{
  show: boolean
  rootFolders: AssetFolderNode[]
  assetsCount: number
  assetRows: AssetTreeRow[]
  batchOn: boolean
  checkedIds: string[]
  collapsedFolderIds: string[]
  renamingFolderId: string | null
  renamingValue: string
  folderIconName: (id: string) => string
  iconOf: (name: string) => unknown
  treeMoveTargets: (row: AssetTreeRow) => AssetTreeTarget[]
  assetTags: string[]
}>()

const emit = defineEmits<{
  toggleExpand: [id: string]
  openAsset: [row: AssetTreeRow, e?: MouseEvent]
  toggleSelect: [id: string, shift?: boolean]
  renameInput: [value: string]
  renameCommit: [payload: { kind: 'folder' | 'asset'; id: string; name: string }]
  renameCancel: []
  startRename: [payload: { id: string; name: string }]
  dropOn: [payload: { from: AssetTreeRow; to: AssetTreeRow | null }]
  addAgent: [row: AssetTreeRow]
  addCanvas: [row: AssetTreeRow]
  childFolder: [row: AssetTreeRow]
  moveTo: [payload: { row: AssetTreeRow; targetFolderId?: string }]
  setIcon: [payload: { row: AssetTreeRow; icon: string }]
  setTags: [payload: { row: AssetTreeRow; tags: string[] }]
  download: [row: AssetTreeRow]
  remove: [row: AssetTreeRow]
  openHistory: []
}>()

const Button = useUiComponent('Button')
/** 资产树滚动层：与设置面板左栏同一套组件库 ScrollArea（细滚动条、叠在内容上）。 */
const ScrollArea = useUiComponent('ScrollArea')
</script>

<template>
  <ScrollArea v-if="show" class="asset-tree-scroll min-h-0 flex-1">
    <div class="px-2 pb-2">
    <!-- 空态：没有任何资产也没有文件夹 -->
    <div v-if="!rootFolders.length && !assetsCount"
      class="flex flex-col items-center justify-center gap-2.5 p-8">
      <div class="grid size-16 place-items-center rounded-2xl bg-veil text-ink-mute">
        <FolderIcon :size="30" />
      </div>
      <p class="max-w-[220px] mb-1 text-center text-xs leading-relaxed text-ink-mute">还没有资产。生成图片 / 视频 /
        音频之后，产物会自动出现在这里。
      </p>
      <Button variant="outline" size="sm" class="h-8 min-w-[176px] gap-1.5 rounded-lg text-xs"
        aria-label="打开生成历史" @click="emit('openHistory')">查看生成历史</Button>
    </div>

    <!-- 拖拽：行内拖到文件夹行 = 放进去；拖到列表空白 = 放到根目录（共用组件 AssetTree 内自管） -->
    <AssetTree v-else variant="drawer" :rows="assetRows" :batch-on="batchOn" :selected-ids="checkedIds"
      :collapsed-ids="collapsedFolderIds" :renaming-id="renamingFolderId" :rename-value="renamingValue"
      :folder-icon-name="folderIconName" :icon-of="iconOf" :move-targets="treeMoveTargets"
      :tag-options="assetTags" @toggle-expand="emit('toggleExpand', $event)" @open-asset="(row: AssetTreeRow, e?: MouseEvent) => emit('openAsset', row, e)"
      @open-thumb="(row: AssetTreeRow, e?: MouseEvent) => emit('openAsset', row, e)" @toggle-select="(id: string, shift?: boolean) => emit('toggleSelect', id, shift)"
      @rename-input="emit('renameInput', $event)" @rename-commit="emit('renameCommit', $event)"
      @rename-cancel="emit('renameCancel')" @start-rename="emit('startRename', $event)"
      @drop-on="emit('dropOn', $event)" @add-agent="emit('addAgent', $event)"
      @add-canvas="emit('addCanvas', $event)" @child-folder="emit('childFolder', $event)"
      @move-to="emit('moveTo', $event)" @set-icon="emit('setIcon', $event)"
      @set-tags="emit('setTags', $event)" @download="emit('download', $event)" @remove="emit('remove', $event)" />
    </div>
  </ScrollArea>
</template>
