<script setup lang="ts">
// 左上角：块 A（项目胶囊）+ 块 B（视图切换），中间 8px 间隔。
// 块 A 与抽屉头部是同一个 ProjectCluster，抽屉打开时这里隐藏。
import { LayoutGrid, Clapperboard } from 'lucide-vue-next'
import ProjectCluster from '../ProjectCluster.vue'
import { useUi } from '../../composables/ui'

const ui = useUi()
const s = ui.state
</script>

<template>
  <ProjectCluster
    v-if="s.drawer !== 'left'"
    :canvas="ui.canvasNameOf(ui.currentCanvasId.value)"
    :canvas-id="ui.currentCanvasId.value"
    :canvas-items="ui.canvasOptions.value"
    :menu-open="s.canvasMenuOpen"
    @update:menu-open="s.canvasMenuOpen = $event"
    @new-canvas="ui.newCanvas()"
    @pick-canvas="ui.openCanvas($event)"
    @open-canvas-window="ui.openCanvasInNewWindow($event)"
    @rename-canvas-item="ui.renameCanvasById($event)"
    @duplicate-canvas="ui.duplicateCanvas($event)"
    @delete-canvas="ui.deleteCanvas($event)"
    @open-menu="ui.openDrawer('left')"
    @rename-canvas="ui.renameCanvas($event)"
  />
  <!-- <nav class="flex h-8 items-center rounded-lg border border-line bg-panel/80" aria-label="视图模式">
    <button
      class="grid size-8 place-items-center rounded-lg p-1 transition-colors"
      :class="s.navMode === 'workflow' ? 'bg-panel-active text-ink' : 'text-ink-dim hover:bg-hover'"
      aria-label="工作流" :aria-pressed="s.navMode === 'workflow'"
      @click="s.navMode = 'workflow'; ui.showToast('工作流视图')"
    ><LayoutGrid :size="14" /></button>
    <button
      class="grid size-8 place-items-center rounded-lg p-1 transition-colors"
      :class="s.navMode === 'storyboard' ? 'bg-panel-active text-ink' : 'text-ink-dim hover:bg-hover'"
      aria-label="故事板" :aria-pressed="s.navMode === 'storyboard'"
      @click="s.navMode = 'storyboard'; ui.showToast('故事板视图')"
    ><Clapperboard :size="14" /></button>
  </nav> -->
</template>
