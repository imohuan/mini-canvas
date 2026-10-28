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
import { SlotAnchor, SlotComposer } from '@mini-canvas/canvas-render'
import SlotButton from './SlotButtons.vue'
import { useMiniMapDockTarget } from '../../composables/miniMapDock'

const ui = useUi()
const s = ui.state

/** 下发给插件条目的共享 props：状态条默认按钮 + 常用函数 */
const slotShared = {
  coreButton: SlotButton,
  buttonTone: 'status',
  openDrawer: () => ui.openDrawer('left'),
  showToast: (msg: string) => ui.showToast(msg),
}

/**
 * 小地图托盘点（2026-10-28 修「开合抽屉后地图要等 0.5~2 秒才跳过去」）。
 *
 * 旧实现：地图在画布 #ui 的 fixed 容器里，由 App.vue 读按钮矩形再写 transform。
 * 按钮随状态条做 CSS transform 动画（宽度不变 → ResizeObserver 不触发），
 * 只能等 2 秒兜底轮询，所以看到的是「按钮先到位、地图后闪过去」。
 *
 * 现在：地图 Teleport 到这个零尺寸节点，用 absolute 定位到按钮正上方。
 * 它和按钮同在一个 transform 上下文里 —— 抽屉动画移位多少，地图同帧移多少，
 * 完全不需要 JS 读坐标 / 轮询。
 */
const miniMapDock = useMiniMapDockTarget()
</script>

<template>
  <div class="flex items-end" aria-label="画布状态栏" style="overflow: visible">
    <div class="flex h-10 items-center gap-1 rounded-xl bg-panel p-1.5">
      <SlotComposer slot="shell.status" item-class="flex-none" class="flex items-center gap-1" :shared-props="slotShared"
        :debug="Boolean(s.cfg.debug.slotDebug)" label="状态条">
        <SlotAnchor id="host/assets" :order="100">
      <AxTooltip v-if="s.drawer !== 'left'" content="资产管理" placement="top">
        <button
          class="flex h-7 items-center gap-1 rounded-lg px-3 text-[13px] text-ink transition-colors hover:bg-hover"
          aria-label="资产管理" @click="ui.openDrawer('left')"
        ><PanelLeft :size="14" /> 资产管理</button>
      </AxTooltip>
        </SlotAnchor>
        <SlotAnchor id="host/organize" :order="200">
      <AxTooltip content="整理画布，Ctrl/Cmd+L" placement="top">
        <button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover" aria-label="整理画布，Ctrl/Cmd+L" @click="ui.organizeCanvas()"><LayoutGrid :size="14" /></button>
      </AxTooltip>
        </SlotAnchor>
        <SlotAnchor id="host/minimap" :order="300">
      <!-- 外层只负责定位：地图挂点和按钮共享同一个 relative 起点。
           挂点必须放在 AxTooltip 外面，否则鼠标移到地图上会触发「切换小地图」气泡。 -->
      <span class="relative flex-none" style="overflow: visible">
        <AxTooltip content="切换小地图" placement="top">
          <button
            class="grid size-7 place-items-center rounded-lg transition-colors hover:bg-hover"
            :class="ui.minimapOn ? 'text-ink' : 'text-ink-dim'" aria-label="切换小地图" :aria-pressed="ui.minimapOn ? 'true' : 'false'"
            @click="ui.toggleMinimap()"
          ><Map :size="14" /></button>
        </AxTooltip>
        <!-- 地图挂点：零尺寸、不拦截点击；地图 absolute 浮在按钮上方 -->
        <span ref="miniMapDock" class="mini-map-dock" aria-hidden="true" />
      </span>
        </SlotAnchor>
        <SlotAnchor id="host/edges" :order="400">
      <!-- 隐藏节点连线：关闭态 = Link2Off（自带斜线），照图 2 -->
      <AxTooltip :content="s.edgesVisible ? '隐藏节点连线' : '显示节点连线'" placement="top">
        <button
          class="grid size-7 place-items-center rounded-lg transition-colors hover:bg-hover"
          :class="s.edgesVisible ? 'text-ink' : 'text-ink-dim'"
          :aria-label="s.edgesVisible ? '隐藏节点连线' : '显示节点连线'" :aria-pressed="!s.edgesVisible"
          @click="ui.toggleEdges()"
        ><Link2Off v-if="!s.edgesVisible" :size="14" /><Link2 v-else :size="14" /></button>
      </AxTooltip>
        </SlotAnchor>
        <SlotAnchor id="host/snap" :order="500">
      <!-- 网格吸附：关闭态 = MagnetOff（自带斜线） -->
      <AxTooltip :content="s.snapOn ? '关闭网格吸附' : '开启网格吸附'" placement="top">
        <button
          class="grid size-7 place-items-center rounded-lg transition-colors hover:bg-hover"
          :class="s.snapOn ? 'text-ink' : 'text-ink-dim'"
          :aria-label="s.snapOn ? '关闭网格吸附' : '开启网格吸附'" :aria-pressed="s.snapOn"
          @click="ui.toggleSnap()"
        ><Grid2x2X v-if="!s.snapOn" :size="14" /><Magnet v-else :size="14" /></button>
      </AxTooltip>
        </SlotAnchor>
        <SlotAnchor id="host/zoom" :order="600">
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
        </SlotAnchor>
      </SlotComposer>
    </div>
  </div>
</template>
