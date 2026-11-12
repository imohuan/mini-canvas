<script setup lang="ts">
// 左侧抽屉：头部（复用 ProjectCluster）+ 画布/资产 tab + 列表/宫格双模式树 + 底部收起条 + 拖宽手柄。
// 图标用 LibIcon（照 LibTV 官网 SVG 原样复刻），交互行为照目标实测。
import { computed, h, defineComponent } from 'vue'
import { ArrowLeftToLine as ArrowLeftToLineIcon } from 'lucide-vue-next'
import { AnimatePresence, motion } from 'motion-v'
import PanelResizeHandle from '../PanelResizeHandle.vue'
import ProjectCluster from '../ProjectCluster.vue'
import AssetBatchBar from '../AssetBatchBar.vue'
import AssetUploadDialog from '../AssetUploadDialog.vue'
import AppDialog from '../AppDialog.vue'
// 抽屉的页签 / 工具按钮 / 搜索框从画布 ctx 的 ui 注册表按名取（默认主题插件登记），
// 外壳不直接 import 组件库（用户口径 2026-11-03）。
import { useUi } from '../../composables/ui'
import { SlotAnchor, SlotComposer, useUiComponent } from '@plume-canvas/canvas-render'
import { DRAWER_TAB_ASSETS, DRAWER_TAB_CANVAS } from '../../composables/drawerTabs'
import CanvasTreePanel from './left-drawer/CanvasTreePanel.vue'
import AssetTreePanel from './left-drawer/AssetTreePanel.vue'
import CanvasTabToolbar from './left-drawer/CanvasTabToolbar.vue'
import AssetTabToolbar from './left-drawer/AssetTabToolbar.vue'
import { useDrawerTabs } from './left-drawer/useDrawerTabs'
import { useAssetTreeActions } from './left-drawer/useAssetTreeActions'
import { useCanvasTree } from './left-drawer/useCanvasTree'
import { useAssetCanvasDrop } from './left-drawer/useAssetCanvasDrop'

const ui = useUi()
const s = ui.state

const Button = useUiComponent('Button')
/** 插槽调试提示：主题插件登记的默认件 */

// ===== 插件页签（第三个及之后的页签）=====
const { activePluginTab, drawerHost, slotShared, drawerTabProps } = useDrawerTabs()
const {
  viewMode,
  menuOpen,
  setMenuOpen,
  setViewMode,
  expandAll,
  collapseAll,
  canvasBlocks,
  renamingNodeId,
  renamingNodeName,
  startRenameNode,
  cancelRenameNode,
  commitRenameNode,
  bindCanvasMenu,
  openCanvasMenu,
} = useCanvasTree()
const {
  ASSET_TAGS,
  pickAssetKind,
  assetSearchActive,
  setAssetSearchActive,
  plusOpen,
  setPlusOpen,
  setUploadOpen,
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
} = useAssetTreeActions()
useAssetCanvasDrop()
/** 当前是不是画布 tab（模板里多次比较 s.leftTab 会被 TS 逐次收窄，用独立只读判断避开） */
const isCanvasTab = computed(() => s.leftTab === 'canvas')

</script>

<template>
  <AnimatePresence>
    <motion.aside v-if="s.drawer === 'left'"
      class="left-drawer plume-layer-app-panel fixed bottom-0 left-0 top-0 flex flex-col bg-panel-soft backdrop-blur-xl"
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
        :item-props="drawerTabProps" :shared-props="slotShared"
        >
        <SlotAnchor id="host/canvas-tab" :order="100">
          <Button variant="ghost" size="sm" class="h-7 rounded-[10px] px-3 text-[13px] font-normal"
            :class="s.leftTab === DRAWER_TAB_CANVAS ? 'bg-hover-strong text-ink' : 'text-ink/90 hover:bg-hover'"
            role="tab" :aria-selected="s.leftTab === DRAWER_TAB_CANVAS"
            @click="ui.openDrawerTab(DRAWER_TAB_CANVAS)">画布</Button>
        </SlotAnchor>
        <SlotAnchor id="host/assets-tab" :order="200">
          <Button variant="ghost" size="sm" class="h-7 rounded-[10px] px-3 text-[13px] font-normal"
            :class="s.leftTab === DRAWER_TAB_ASSETS ? 'bg-hover-strong text-ink' : 'text-ink/90 hover:bg-hover'"
            role="tab" :aria-selected="s.leftTab === DRAWER_TAB_ASSETS"
            @click="ui.openDrawerTab(DRAWER_TAB_ASSETS)">资产</Button>
        </SlotAnchor>
      </SlotComposer>

      <CanvasTabToolbar :menu-open="menuOpen" :view-mode="viewMode" @update:menu-open="setMenuOpen"
        @update:view-mode="setViewMode" @expand-all="expandAll" @collapse-all="collapseAll" />
      <AssetTabToolbar :asset-search-active="assetSearchActive" :plus-open="plusOpen"
        :asset-kinds="['全部', '图片', '视频', '音频', '其他']" @update:plus-open="setPlusOpen" @update:upload-open="setUploadOpen"
        @update:asset-search-active="setAssetSearchActive" @add-folder="addFolder()"
        @pick-asset-kind="pickAssetKind" @upload-change="onUploadChange" />
      <!-- ===== 资产 tab：文件夹树 + 根级资产（后台结构与此显示一致）===== -->
      <AssetTreePanel :show="s.leftTab === 'assets'" :root-folders="rootFolders"
        :assets-count="ui.filteredAssets.value.length" :asset-rows="assetRows" :batch-on="s.assetBatchOn"
        :checked-ids="checkedIds" :collapsed-folder-ids="collapsedFolderIds" :renaming-folder-id="renamingFolderId"
        :renaming-value="renamingValue" :folder-icon-name="folderIconNameOf" :icon-of="folderIconCmp"
        :tree-move-targets="treeMoveTargets" :asset-tags="[...ASSET_TAGS]" @open-history="ui.toggleHistory()"
        @toggle-expand="toggleFolderExpand" @open-asset="onTreeOpenAsset" @toggle-select="onTreeToggleSelect"
        @rename-input="renamingValue = $event" @rename-commit="onTreeRenameCommit"
        @rename-cancel="renamingFolderId = null" @start-rename="startRename($event.id, $event.name)"
        @drop-on="onTreeDrop" @add-agent="onTreeAddAgent" @add-canvas="onTreeAddCanvas"
        @child-folder="onTreeChildFolder" @move-to="onTreeMoveTo" @set-icon="onTreeSetIcon"
        @set-tags="onTreeSetTags" @download="onTreeDownload" @remove="onTreeRemove" />

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
      <AppDialog :model-value="!!folderConfirm" width="380px"
        :title="folderConfirm ? '把「' + folderConfirm.name + '」添加到画布？' : '添加到画布'"
        description="文件夹内容较多时一次全部添加可能会卡顿，需要确认后再继续。"
        @update:model-value="onFolderConfirmCancel">
        <div v-if="folderConfirm" class="flex flex-col gap-4 p-5">
          <p class="text-sm font-medium text-ink">把「{{ folderConfirm.name }}」添加到画布？</p>
          <p class="text-[13px] leading-relaxed text-ink-dim">
            这个文件夹里有 <span class="font-medium text-ink">{{ folderConfirm.count }}</span> 项内容，
            一次全部添加可能会卡顿。确定要继续吗？
          </p>
          <div class="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" class="h-8 rounded-lg px-3.5 text-[13px]"
              aria-label="取消添加" @click="onFolderConfirmCancel">取消</Button>
            <Button size="sm" class="h-8 rounded-lg bg-brand px-4 text-[13px] text-white hover:bg-brand/85"
              aria-label="确认添加" @click="onFolderConfirmOk">继续添加</Button>
          </div>
        </div>
      </AppDialog>


      <CanvasTreePanel :show="isCanvasTab" :blocks="canvasBlocks" :view-mode="viewMode"
        :renaming-node-id="renamingNodeId" :renaming-node-name="renamingNodeName"
        :bind-canvas-menu="bindCanvasMenu" @toggle-collapse="ui.collapsed[$event] = !ui.collapsed[$event]"
        @rename-input="renamingNodeName = $event" @rename-commit="commitRenameNode()"
        @rename-cancel="cancelRenameNode()" @start-rename="startRenameNode"
        @open-menu="openCanvasMenu" @locate="ui.locateNode($event)" @ungroup="ui.ungroupNode($event)"
        @duplicate="ui.duplicateNode($event)" @add-agent="ui.referenceNodeToAgent($event)"
        @remove="ui.removeNode($event)" />

      <!-- 插件页签正文：只在当前选中的是插件页签时渲染（画布/资产树走各自的 v-if） -->
      <div v-if="activePluginTab" class="min-h-0 flex-1 overflow-y-auto p-2">
        <component :is="activePluginTab.panel" :host="drawerHost" />
      </div>

      <!-- 底部状态条 -->
      <div class="flex h-[53px] flex-none items-center justify-between border-t border-line px-3 pb-3 pt-2">
        <Button variant="ghost" size="icon-sm" class="rounded-lg text-ink/85"
          :aria-label="s.leftCollapsed ? '展开节点侧栏' : '收起节点侧栏'" @click="ui.toggleLeftCollapsed()">
          <ArrowLeftToLineIcon :size="16" class="size-4" />
        </Button>
        <span class="text-xs text-ink-dim">共 {{ ui.treeTotal }} 节点</span>
      </div>
      <PanelResizeHandle class="left-drawer-resize" edge="right" label="调整侧栏宽度"
        @resize-start="ui.startDrawerResize" />
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
/* 拖宽手柄的观感统一在 PanelResizeHandle 里；这里只定位置（线贴抽屉右缘） */
.left-drawer-resize { top: 0; bottom: 0; right: 0; z-index: 2; }
</style>
