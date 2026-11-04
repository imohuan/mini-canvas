<script setup lang="ts">
// 左下角状态条：资产管理 chip（抽屉开着时隐藏）+ 工具组 + 缩放下拉。
// 「整理画布 / 隐藏节点连线 / 网格吸附」可切换：关闭时图标画斜线（照目标）。
//
// 这些按钮**不自己存状态**：点击只调 ui 里的统一入口，由它写内核设置或执行命令
// （与设置面板同一条通道，详见 composables/ui.ts 的「画布开关」段）。
//
// 「缩放选项」同理：百分比是**真实视口的镜像值**（ui.state.zoom），菜单动作调 viewport 服务
// 真正改画布（详见 composables/ui.ts 的「缩放」段）。
import { PanelLeft, LayoutGrid, MapPin, MapPinOff, Link2Off, Link2, Magnet, Grid2x2X } from 'lucide-vue-next'
// 状态栏控件从画布 ctx 的 ui 注册表按名取（默认主题插件登记），不直接 import 组件库。
import { SlotAnchor, SlotComposer, useUiComponent } from '@mini-canvas/canvas-render'
import { useUi } from '../../composables/ui'
import { computed } from 'vue'
import { useMiniMapDockTarget } from '../../composables/miniMapDock'

const Button = useUiComponent('Button')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuRadioGroup = useUiComponent('DropdownMenuRadioGroup')
const DropdownMenuRadioItem = useUiComponent('DropdownMenuRadioItem')
const DropdownMenuSeparator = useUiComponent('DropdownMenuSeparator')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')

const ui = useUi()
const s = ui.state

/** 缩放固定档位的当前值：只在真实倍率落在某一档附近时有值（其余情况不勾）。 */
const fixedZoomValue = computed(() => {
  if (Math.abs(s.zoom - 50) <= 1) return '50'
  if (Math.abs(s.zoom - 100) <= 1) return '100'
  return ''
})

/** 单选组在用户点选时会回写值；真正的缩放动作由每个选项自己的 @select 执行。 */
function pickFixedZoom(value: unknown): void {
  if (typeof value === 'string' && value) s.zoom = Number(value)
}

/** 下发给插件条目的共享 props：常用函数（按钮由插件自己从 ui 注册表取） */
const slotShared = {
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
  <TooltipProvider :delay-duration="200">
  <div class="flex items-end" aria-label="画布状态栏" style="overflow: visible">
    <div class="flex h-10 items-center gap-1 rounded-xl bg-panel p-1.5">
      <SlotComposer slot="shell.status" item-class="flex-none" class="flex items-center gap-1" :shared-props="slotShared"
        >
        <SlotAnchor id="host/assets" :order="100">
      <Tooltip v-if="s.drawer !== 'left'">
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" class="h-7 gap-1 rounded-lg px-3 text-[13px] font-normal hover:bg-hover"
            aria-label="资产管理" @click="ui.openDrawer('left')">
            <PanelLeft :size="14" class="size-3.5 shrink-0" /> 资产管理
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">资产管理</TooltipContent>
      </Tooltip>
        </SlotAnchor>
        <SlotAnchor id="host/organize" :order="200">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" class="size-7 rounded-lg" aria-label="整理画布，Ctrl/Cmd+L"
            @click="ui.organizeCanvas()"><LayoutGrid :size="14" class="size-3.5" /></Button>
        </TooltipTrigger>
        <TooltipContent side="top">整理画布，Ctrl/Cmd+L</TooltipContent>
      </Tooltip>
        </SlotAnchor>
        <SlotAnchor id="host/minimap" :order="300">
      <!-- 外层只负责定位：地图挂点和按钮共享同一个 relative 起点。
           挂点必须放在 AxTooltip 外面，否则鼠标移到地图上会触发「切换小地图」气泡。 -->
      <span class="relative flex-none" style="overflow: visible">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" class="size-7 rounded-lg"
              :class="ui.minimapOn ? 'text-ink' : 'text-ink-dim'" aria-label="切换小地图"
              :aria-pressed="ui.minimapOn ? 'true' : 'false'" @click="ui.toggleMinimap()">
              <MapPin v-if="ui.minimapOn" :size="14" class="size-3.5" />
              <MapPinOff v-else :size="14" class="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">切换小地图</TooltipContent>
        </Tooltip>
        <!-- 地图挂点：零尺寸、不拦截点击；地图 absolute 浮在按钮上方 -->
        <span ref="miniMapDock" class="mini-map-dock" aria-hidden="true" />
      </span>
        </SlotAnchor>
        <SlotAnchor id="host/edges" :order="400">
      <!-- 隐藏节点连线：关闭态 = Link2Off（自带斜线），照图 2 -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" class="size-7 rounded-lg"
            :class="s.edgesVisible ? 'text-ink' : 'text-ink-dim'"
            :aria-label="s.edgesVisible ? '隐藏节点连线' : '显示节点连线'" :aria-pressed="!s.edgesVisible"
            @click="ui.toggleEdges()">
            <Link2Off v-if="!s.edgesVisible" :size="14" class="size-3.5" /><Link2 v-else :size="14" class="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{{ s.edgesVisible ? '隐藏节点连线' : '显示节点连线' }}</TooltipContent>
      </Tooltip>
        </SlotAnchor>
        <SlotAnchor id="host/snap" :order="500">
      <!-- 网格吸附：关闭态 = MagnetOff（自带斜线） -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" class="size-7 rounded-lg"
            :class="s.snapOn ? 'text-ink' : 'text-ink-dim'"
            :aria-label="s.snapOn ? '关闭网格吸附' : '开启网格吸附'" :aria-pressed="s.snapOn"
            @click="ui.toggleSnap()">
            <Grid2x2X v-if="!s.snapOn" :size="14" class="size-3.5" /><Magnet v-else :size="14" class="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{{ s.snapOn ? '关闭网格吸附' : '开启网格吸附' }}</TooltipContent>
      </Tooltip>
        </SlotAnchor>
        <SlotAnchor id="host/zoom" :order="600">
      <DropdownMenu v-model:open="s.zoomMenuOpen">
        <DropdownMenuTrigger as-child>
          <!-- 缩放菜单和 Tooltip 共用一个按钮时，Tooltip 会接管浮层锚点，菜单被挪出屏幕。
               用原生 title 保留悬停提示，菜单定位只认按钮本身。 -->
          <Button variant="ghost" size="sm" class="h-7 rounded-lg whitespace-nowrap px-1 text-[13px] font-normal hover:bg-hover"
            aria-label="缩放选项" title="缩放选项" :aria-expanded="s.zoomMenuOpen">{{ s.zoom }}%</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="center" :style="{ minWidth: '215px' }">
          <DropdownMenuItem @select="ui.zoomInStep(); s.zoomMenuOpen = false">放大 <span class="ax-menu-hint ml-auto">Ctrl +</span></DropdownMenuItem>
          <DropdownMenuItem @select="ui.zoomOutStep(); s.zoomMenuOpen = false">缩小 <span class="ax-menu-hint ml-auto">Ctrl −</span></DropdownMenuItem>
          <DropdownMenuItem @select="ui.zoomFit(); s.zoomMenuOpen = false">适合屏幕 <span class="ax-menu-hint ml-auto">Ctrl 0</span></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup :model-value="fixedZoomValue" @update:model-value="pickFixedZoom">
            <DropdownMenuRadioItem value="50" @select="ui.zoomToPercent(50); s.zoomMenuOpen = false">缩放至 50%</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="100" @select="ui.zoomToPercent(100); s.zoomMenuOpen = false">缩放至 100%</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <!-- 最大倍率取自设置 maxZoom（默认 200%），不写死 800%（那样默认上限下点不到） -->
          <DropdownMenuItem @select="ui.zoomToMax(); s.zoomMenuOpen = false">缩放到最大</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
        </SlotAnchor>
      </SlotComposer>
    </div>
  </div>
  </TooltipProvider>
</template>
