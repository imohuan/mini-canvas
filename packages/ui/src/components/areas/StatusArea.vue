<script setup lang="ts">
// 左下角状态条：资产管理 chip（抽屉开着时隐藏）+ 工具组 + 缩放下拉。
// 「隐藏节点连线 / 网格吸附」可切换：关闭时图标画斜线（照目标）。
import { PanelLeft, LayoutGrid, Map, Link2Off, Link2, Magnet, Grid2x2X } from 'lucide-vue-next'
import AxDropdown from '../AxDropdown.vue'
import AxTooltip from '../AxTooltip.vue'
import { useUi } from '../../composables/ui'

const ui = useUi()
const s = ui.state
</script>

<template>
  <div class="flex items-end" aria-label="画布状态栏">
    <div class="flex h-10 items-center gap-1 rounded-xl bg-canvas-bg/70 p-1.5 backdrop-blur-md">
      <AxTooltip v-if="s.drawer !== 'left'" content="资产管理" placement="top">
        <button
          class="flex h-7 items-center gap-1 rounded-lg px-3 text-[13px] text-ink transition-colors hover:bg-hover"
          aria-label="资产管理" @click="ui.openDrawer('left')"
        ><PanelLeft :size="14" /> 资产管理</button>
      </AxTooltip>
      <AxTooltip content="整理画布，Alt+Shift+F" placement="top">
        <button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover" aria-label="整理画布，Alt+Shift+F" @click="ui.showToast('整理画布')"><LayoutGrid :size="14" /></button>
      </AxTooltip>
      <AxTooltip content="切换小地图" placement="top">
        <button
          class="grid size-7 place-items-center rounded-lg transition-colors hover:bg-hover"
          :class="ui.minimapOn ? 'text-ink' : 'text-ink-dim'" aria-label="切换小地图" :aria-pressed="ui.minimapOn"
          @click="ui.toggleMinimap()"
        ><Map :size="14" /></button>
      </AxTooltip>
      <!-- 隐藏节点连线：关闭态 = Link2Off（自带斜线），照图 2 -->
      <AxTooltip :content="s.edgesVisible ? '隐藏节点连线' : '显示节点连线'" placement="top">
        <button
          class="grid size-7 place-items-center rounded-lg transition-colors hover:bg-hover"
          :class="s.edgesVisible ? 'text-ink' : 'text-ink-dim'"
          :aria-label="s.edgesVisible ? '隐藏节点连线' : '显示节点连线'" :aria-pressed="!s.edgesVisible"
          @click="s.edgesVisible = !s.edgesVisible; ui.showToast(s.edgesVisible ? '已显示节点连线' : '已隐藏节点连线')"
        ><Link2Off v-if="!s.edgesVisible" :size="14" /><Link2 v-else :size="14" /></button>
      </AxTooltip>
      <!-- 网格吸附：关闭态 = MagnetOff（自带斜线） -->
      <AxTooltip :content="s.snapOn ? '关闭网格吸附' : '开启网格吸附'" placement="top">
        <button
          class="grid size-7 place-items-center rounded-lg transition-colors hover:bg-hover"
          :class="s.snapOn ? 'text-ink' : 'text-ink-dim'"
          :aria-label="s.snapOn ? '关闭网格吸附' : '开启网格吸附'" :aria-pressed="s.snapOn"
          @click="s.snapOn = !s.snapOn; ui.showToast(s.snapOn ? '已开启网格吸附' : '已关闭网格吸附')"
        ><Grid2x2X v-if="!s.snapOn" :size="14" /><Magnet v-else :size="14" /></button>
      </AxTooltip>
      <AxDropdown v-model="s.zoomMenuOpen" placement="top" align="center" menu-width="215px">
        <template #trigger>
          <AxTooltip content="缩放选项" placement="top">
            <button class="h-7 whitespace-nowrap rounded-lg px-1 text-[13px] text-ink transition-colors hover:bg-hover" aria-label="缩放选项">{{ s.zoom }}%</button>
          </AxTooltip>
        </template>
        <template #default="{ close }">
          <button class="menu-item" @click="s.zoom = Math.min(800, s.zoom + 10); close()"><span>放大</span><kbd>⌘ +</kbd></button>
          <button class="menu-item" @click="s.zoom = Math.max(10, s.zoom - 10); close()"><span>缩小</span><kbd>⌘ −</kbd></button>
          <button class="menu-item" @click="s.zoom = 39; close()"><span>适合屏幕</span><kbd>⌘ 0</kbd></button>
          <div class="mx-0 my-1 h-px bg-line"></div>
          <button v-for="z in [50, 100, 800]" :key="z" class="menu-item" @click="s.zoom = z; close()"><span>缩放至{{ z }}%</span></button>
        </template>
      </AxDropdown>
    </div>
  </div>
</template>
