<script setup lang="ts">
// 左下角状态条：资产管理 chip（抽屉开着时隐藏）+ 工具组 + 缩放下拉。
// 「整理画布 / 隐藏节点连线 / 网格吸附」可切换：关闭时图标画斜线（照目标）。
//
// 这些按钮**不自己存状态**：点击只调 ui 里的统一入口，由它写内核设置或执行命令
// （与设置面板同一条通道，详见 composables/ui.ts 的「画布开关」段）。
//
// 「缩放选项」同理：百分比是**真实视口的镜像值**（ui.state.zoom），菜单动作调 viewport 服务
// 真正改画布（详见 composables/ui.ts 的「缩放」段）。
import { PanelLeft, LayoutGrid, Map, Link2Off, Link2, Magnet, Grid2x2X } from 'lucide-vue-next'
import AxDropdown from '../AxDropdown.vue'
import AxMenuItem from '../AxMenuItem.vue'
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
      <AxTooltip content="整理画布，Ctrl/Cmd+L" placement="top">
        <button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover" aria-label="整理画布，Ctrl/Cmd+L" @click="ui.organizeCanvas()"><LayoutGrid :size="14" /></button>
      </AxTooltip>
      <AxTooltip content="切换小地图" placement="top">
        <button
          class="grid size-7 place-items-center rounded-lg transition-colors hover:bg-hover"
          :class="ui.minimapOn ? 'text-ink' : 'text-ink-dim'" aria-label="切换小地图" :aria-pressed="ui.minimapOn ? 'true' : 'false'"
          @click="ui.toggleMinimap()"
        ><Map :size="14" /></button>
      </AxTooltip>
      <!-- 隐藏节点连线：关闭态 = Link2Off（自带斜线），照图 2 -->
      <AxTooltip :content="s.edgesVisible ? '隐藏节点连线' : '显示节点连线'" placement="top">
        <button
          class="grid size-7 place-items-center rounded-lg transition-colors hover:bg-hover"
          :class="s.edgesVisible ? 'text-ink' : 'text-ink-dim'"
          :aria-label="s.edgesVisible ? '隐藏节点连线' : '显示节点连线'" :aria-pressed="!s.edgesVisible"
          @click="ui.toggleEdges()"
        ><Link2Off v-if="!s.edgesVisible" :size="14" /><Link2 v-else :size="14" /></button>
      </AxTooltip>
      <!-- 网格吸附：关闭态 = MagnetOff（自带斜线） -->
      <AxTooltip :content="s.snapOn ? '关闭网格吸附' : '开启网格吸附'" placement="top">
        <button
          class="grid size-7 place-items-center rounded-lg transition-colors hover:bg-hover"
          :class="s.snapOn ? 'text-ink' : 'text-ink-dim'"
          :aria-label="s.snapOn ? '关闭网格吸附' : '开启网格吸附'" :aria-pressed="s.snapOn"
          @click="ui.toggleSnap()"
        ><Grid2x2X v-if="!s.snapOn" :size="14" /><Magnet v-else :size="14" /></button>
      </AxTooltip>
      <AxDropdown v-model="s.zoomMenuOpen" placement="top" align="center" menu-width="215px">
        <template #trigger>
          <AxTooltip content="缩放选项" placement="top">
            <button class="h-7 whitespace-nowrap rounded-lg px-1 text-[13px] text-ink transition-colors hover:bg-hover" aria-label="缩放选项">{{ s.zoom }}%</button>
          </AxTooltip>
        </template>
        <template #default="{ close }">
          <AxMenuItem @click="ui.zoomInStep(); close()">放大 <span class="ax-menu-hint">Ctrl +</span></AxMenuItem>
          <AxMenuItem @click="ui.zoomOutStep(); close()">缩小 <span class="ax-menu-hint">Ctrl −</span></AxMenuItem>
          <AxMenuItem @click="ui.zoomFit(); close()">适合屏幕 <span class="ax-menu-hint">Ctrl 0</span></AxMenuItem>
          <div class="ax-menu-sep"></div>
          <AxMenuItem :active="Math.abs(s.zoom - 50) <= 1" @click="ui.zoomToPercent(50); close()">缩放至 50%</AxMenuItem>
          <AxMenuItem :active="Math.abs(s.zoom - 100) <= 1" @click="ui.zoomToPercent(100); close()">缩放至 100%</AxMenuItem>
          <!-- 最大倍率取自设置 maxZoom（默认 200%），不写死 800%（那样默认上限下点不到） -->
          <AxMenuItem @click="ui.zoomToMax(); close()">缩放到最大</AxMenuItem>
        </template>
      </AxDropdown>
    </div>
  </div>
</template>
