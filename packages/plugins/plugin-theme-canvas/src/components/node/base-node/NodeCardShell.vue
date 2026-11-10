<script setup lang="ts">
// NodeCardShell —— BaseNode 的渲染实现（BaseNode 只保留 props 与 inheritAttrs 声明）。
// 纯拆分：模板、class、z-index、样式和原 BaseNode 完全一致；setup 的各块逻辑在同目录 useNode*.ts。
import { computed } from 'vue'
import {
  Position,
  useCanvasRender,
  RegionEntryHost,
} from '@mini-canvas/canvas-render'
import MovingHandle from '../MovingHandle.vue'
import NodeLoadingState from '../NodeLoadingState.vue'
import { useNodeTaskState } from './useNodeTaskState'
import BaseTitle from '../BaseTitle.vue'
import TitleLabel from '../TitleLabel.vue'
import { useNodeCapability } from '../../../composables/useNodeCapability'
import { useNodeCardAppearance } from './useNodeCardAppearance'
import { useNodeCardChrome } from './useNodeCardChrome'
import { useNodeCardSize } from './useNodeCardSize'
import { useNodeConnectionFeedback } from './useNodeConnectionFeedback'
import { useNodeDebugOverlay } from './useNodeDebugOverlay'
import { useNodeMultiSelectState } from './useNodeMultiSelectState'
import { useNodeRegions } from './useNodeRegions'
import { useNodeTitleEdit } from './useNodeTitleEdit'
import { useNodeToolbarLayout } from './useNodeToolbarLayout'
import { useNodeVisibilityPolicy } from './useNodeVisibilityPolicy'

// 只声明壳真正读取的字段；BaseNode 仍按 NodeProps 接收全量。
// 其余 VueFlow 内部字段在这里既不用、也不透传到 DOM（inheritAttrs:false）。
const props = defineProps<{
  id: string
  type: string
  data?: Record<string, unknown>
  selected?: boolean
  position?: { x: number; y: number }
}>()
defineOptions({ inheritAttrs: false })
const type = computed(() => props.type)
const { ctx, registry, nodeWrite, handleParams, connectionState, interaction, debug, snapZone, visibleRect, flow } =
  useCanvasRender()
const viewport = flow.viewport

const appearance = useNodeCardAppearance({
  ctx,
  viewport,
  data: () => props.data ?? {},
})
const {
  zoom,
  lowDetail,
  TITLE_OFFSET,
  TITLE_MIN_ZOOM,
  TITLE_VISIBLE,
  MULTI_RADIO,
  HIDE_TITLES_ON_MULTI,
  isHandTool,
  isCulled,
  isCulledLinked,
  culledReduced,
  culledGhost,
  titleScale,
  resizeHandleScale,
} = appearance

const cap = useNodeCapability(props.type)
const showTargetHandle = cap.hasTarget
const showSourceHandle = cap.hasSource

const cardSize = useNodeCardSize({
  id: props.id,
  type: props.type,
  data: () => props.data ?? {},
  writeback: nodeWrite ?? undefined,
  flow,
  interaction,
  zoom,
})
const { card, cardWidth, cardHeight, cardResizable, cardIsResizing } = cardSize

const titleEdit = useNodeTitleEdit({
  view: () => ctx?.tryGet('view'),
  id: props.id,
  selected: () => props.selected,
  visibleRect,
  nodeWrite: nodeWrite ?? undefined,
})
const { isEditingTitle, startTitleEdit, commitTitleEdit, cancelTitleEdit } = titleEdit

const multiSelect = useNodeMultiSelectState({
  ctx,
  id: props.id,
  selected: () => props.selected,
  zoom,
  titleMinZoom: TITLE_MIN_ZOOM,
  lowDetail,
  multiRadio: MULTI_RADIO,
  hideTitlesOnMulti: HIDE_TITLES_ON_MULTI,
})
const {
  isSelected,
  selectedCount,
  isSoloSelected,
  isMultiSelected,
  hideTitleOnMulti,
  showMultiRadio,
  radioStyle,
} = multiSelect

const visibility = useNodeVisibilityPolicy({
  id: props.id,
  interaction,
  isSelected,
  selectedCount,
  isHandTool,
})
const { hideOverlays, hideSlotBars } = visibility

/**
 * 节点的全局三态 + 加载覆盖层用的数据（进度 / 文案 / 计时）。
 *
 * 用户口径 2026-11-09：这三个状态是全局的，覆盖层由**节点壳自己画** ——
 * 不依赖底部状态栏插件，卸载它之后图片 / 文本 / 可视化节点照样有加载态。
 */
const taskState = useNodeTaskState({ data: () => props.data })
const {
  loading,
  failed,
  covered,
  percent,
  label: taskLabel,
  reason: taskReason,
  hint: taskHint,
  startedAt: taskStartedAt,
  stats: taskStats,
  streamTail: taskStreamTail,
  displayValue: taskValue,
  displaySuffix: taskSuffix,
  displayText: taskProgressText,
} = taskState
/**
 * 加载件的「进度显示」**全部来自后台**（`runState.value` / `suffix` / `progressText`）。
 *
 * 用户口径 2026-11-10：进度是后台的数据 —— provider 的轮询结果决定显示什么，
 * 前端只管把字段画出来，不自己判断任务类型、不自己估算 token。
 * 后台没给 `value` 时回落到老的百分比字段（图片/视频那些动作照旧）。
 */
const progressAsValue = computed(() => taskValue.value)
const progressAsPercent = computed(() => (taskValue.value === null ? percent.value : null))
const progressSuffix = computed(() => taskSuffix.value)

/**
 * 取消任务：**可选能力**（底部状态栏插件上架 nodeTask 服务才有）。
 *
 * 为什么做成可选：加载覆盖层现在住在节点壳里，壳不允许依赖任何一个业务插件
 * （否则又是一条反向依赖）。没有该服务时按钮不渲染，只显示进度 —— 不报错、不假装能点。
 */
const taskService = ctx.tryGet?.<{
  cancel(nodeId: string): void
  /** 按节点上记着的任务号取消（统一口径）；返回是否真的发出了取消 */
  cancelByNodeTaskId?(nodeId: string): Promise<boolean>
  /** 本节点这条任务能不能取消（底栏按动作声明算）；旧宿主没有这个方法时当作能取消 */
  canCancel?(nodeId: string): boolean
}>('nodeTask')
const cancelTask = taskService?.cancel
/**
 * 取消按钮只在「加载中 + 这条动作确实能取消」时出现（用户 2026-11-10）。
 *
 * 以前只看「加载中」：有些动作根本没有取消通道（没有 onCancel），按钮照画，
 * 点了什么都不发生 —— 用户看到的就是「取消没效果」。
 */
const canCancel = computed(() => {
  if (typeof cancelTask !== 'function' || !loading.value) return false
  const ask = taskService?.canCancel
  if (typeof ask !== 'function') return true
  try {
    return ask.call(taskService, props.id)
  } catch {
    return false
  }
})
/**
 * 取消本节点的任务。
 *
 * 统一按节点上的 `runState.taskId` 取消（用户 2026-11-10）——
 * 任务号只有这一份真源，前端不另存，刷新 / 换标签页都还认得。
 */
function onCancelTask(): void {
  const byTaskId = taskService?.cancelByNodeTaskId
  if (typeof byTaskId === 'function') {
    void Promise.resolve().then(() => byTaskId.call(taskService, props.id)).catch(() => {})
    return
  }
  if (typeof cancelTask === 'function') cancelTask(props.id)
}

const regions = useNodeRegions({
  ctx,
  registry,
  id: props.id,
  type: props.type,
  data: () => props.data ?? {},
  isSelected,
  isSoloSelected,
  zoom,
  nodeWrite,
})
const toolbar = useNodeToolbarLayout({
  zoom,
  cardWidth,
  cardHeight,
  position: () => props.position,
})
const {
  topSlotsStyle,
  bottomSlotsStyle,
  toolbarHost,
  toolbarAnchorStyle,
  overlayLayerStyle,
} = toolbar

const {
  contentStack,
  customTitleEntry,
  topSlots,
  bottomSlots,
  overlaySlots,
  leftRegions,
  rightRegions,
  onTopRegions,
  onBottomRegions,
  outsetRegions,
  stateOverlayRegions,
  editable,
  capabilityCache,
  capabilityIsDev,
} = regions

/**
 * 节点状态层（`state:overlay`）要不要画、按哪一套画。
 *
 * 判断顺序（用户 2026-11-09 定）：
 * 1. 有插件在 `state:overlay` 注册了组件 → 直接渲染那个组件（它自己读 `data.runState`）；
 * 2. 没注册组件、但节点有状态（加载中 / 失败）→ 画内置默认加载件；
 * 3. 都没有 → 什么都不画，节点照常显示内容。
 *
 * 这一层**不参与任何交互压制**：resize、框选、多选、拖动都照常显示。
 * 用户口径：「resize 还是多选，都不应该修改当前节点的状态。它有什么就显示什么。」
 * 所以这里不读 hideOverlays / hideSlotBars / resizingThisNode —— 状态是数据，不是临时 UI。
 */
const hasCustomStateOverlay = computed(() => stateOverlayRegions.value.length > 0)
const showStateLayer = computed(() => hasCustomStateOverlay.value || covered.value)

/**
 * 全屏加载件：**加载中（或失败）就铺**，只有一种形态。
 *
 * 用户口径 2026-11-10：加载 UI 是**全局唯一**的一件，不要额外再画一条自己的状态条。
 * 之前这里按「有没有正文」切成两条 UI（全屏件 + 顶部小条），那是多画了一套；
 * 现在只保留全局加载件，流式内容与进度都由它自己渲染。
 */
const showDefaultState = computed(() => !hasCustomStateOverlay.value && covered.value)

const feedback = useNodeConnectionFeedback({
  ctx,
  id: props.id,
  type: props.type,
  selected: () => props.selected,
  connectionState,
  interaction,
  flow,
  cap,
  cardWidth,
  cardHeight,
  lowDetail,
  isHandTool,
  isMultiSelected,
})
const {
  isHovered,
  isConnecting,
  suppressHandles,
  isConnectionValidTarget,
  isConnectionInvalidTarget,
  showConnectFeedback,
  targetHandleRef,
  sourceHandleRef,
  snapZonesActive,
  onInputSnapEnter,
  onOutputSnapEnter,
  onSnapLeave,
  onPortHover,
  onCardMouseEnter,
  onCardMouseLeave,
  updateCardMousePosition,
  cardTransform,
  handleBlocked,
  shouldShowHandles,
  blockedTargetPort,
  blockedSourcePort,
  isCurrentConnectingNode,
} = feedback

const debugView = useNodeDebugOverlay({
  id: props.id,
  type: props.type,
  debug,
  snapZone,
  handleParams,
  cardWidth,
  cardHeight,
  lowDetail,
  isConnecting,
  suppressHandles,
  showTargetHandle,
})
const {
  debugHandle,
  showSnapDebugOverlay,
  portZoneWidth,
  portZoneHeight,
  portZoneOffset,
  portZoneShape,
  portZoneArcRatio,
  debugOverlay,
  debugViewBox,
  bodyRect,
  inputSnapStyle,
  outputSnapStyle,
} = debugView

const chrome = useNodeCardChrome({
  cap,
  type: props.type,
  selected: () => props.selected,
  data: () => props.data ?? {},
  zoom,
  titleMinZoom: TITLE_MIN_ZOOM,
  titleOffset: TITLE_OFFSET,
  titleScale,
  lowDetail,
  titleVisible: TITLE_VISIBLE,
  hideTitleOnMulti,
  cardWidth,
  cardHeight,
  cardTransform,
})
const {
  titleIcon,
  nodeLabel,
  titleExtraText,
  titleExtraSlotComp,
  titlePositionStyle,
  showSelectionOutline,
  cardInlineStyle,
  showTitle,
} = chrome
</script>

<template>
  <div class="v2-node" :class="{
    'is-selected': showSelectionOutline,
    'is-pointer-hovered': isHovered,
    'is-low-detail': lowDetail,
    'is-culled': isCulled,
    'is-culled-linked': isCulledLinked,
    'is-culled-ghost': culledGhost,
    'is-connection-valid': isConnectionValidTarget,
    'is-connection-invalid': isConnectionInvalidTarget,
  }" @mouseenter="onCardMouseEnter" @mouseleave="onCardMouseLeave">
    <!-- 上/下控制栏：装了解层宿主就 Teleport 过去（压过置顶连线），否则原地渲染（行为与改动前逐字一致）。
         逻辑与能力实例都不搬 —— Teleport 只换 DOM 位置，provide/inject 沿组件树传递，共享关系不变。
         压制条件：框选中整排收起、多选收起、本节点 resize 中（hideToolbars），再加"画布上有节点在拖"
          （hideSlotBars —— 拖动只收这两排栏，不动卡片上的覆盖层，见该 computed 的说明）。 -->
    <Teleport v-if="toolbarHost" :to="toolbarHost">
      <!-- 与卡片同位置同尺寸的锚点盒：.v2-slot 的 calc(100% +/- offset) 才仍等于「离卡片这条边的距离」 -->
      <div class="v2-toolbar-anchor" :data-node-id="id" :style="toolbarAnchorStyle">
        <div
          v-if="topSlots.length > 0 && !hideSlotBars && !culledReduced"
          class="v2-slot v2-slot--top nodrag nopan"
          :style="topSlotsStyle"
        >
          <RegionEntryHost v-for="seg in topSlots" :key="'top-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
        </div>
        <div
          v-if="bottomSlots.length > 0 && !hideSlotBars && !culledReduced"
          class="v2-slot v2-slot--bottom nodrag nopan"
          :style="bottomSlotsStyle"
        >
          <RegionEntryHost v-for="seg in bottomSlots" :key="'bottom-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
        </div>
      </div>
    </Teleport>
    <div
      v-else-if="topSlots.length > 0 && !hideSlotBars && !culledReduced"
      class="v2-slot v2-slot--top nodrag nopan"
      :style="topSlotsStyle"
    >
      <RegionEntryHost v-for="seg in topSlots" :key="'top-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>

    <div class="v2-card" :class="{
      'is-connecting-hover': showConnectFeedback,
      'is-connection-invalid': isConnectionInvalidTarget,
    }" :style="cardInlineStyle" @mousemove="updateCardMousePosition">
      <!-- 多选标记：内容区左上角的圆形单选点（只在多选时出现；大小/颜色/缩放都来自本插件 Config）。
           纯指示，不接事件 —— 点击行为交给卡片本身（Shift+点节点 = 从选中集里去掉它）。 -->
      <div
        v-if="showMultiRadio && !culledReduced"
        class="v2-multi-radio nodrag nopan mc-export-ignore"
        :style="radioStyle"
        role="presentation"
        aria-hidden="true"
      >
        <!-- 自绘 SVG（不用 CSS 画圆）：矢量、走当前颜色 currentColor（= 配置里的标记颜色）、任意缩放都清晰。
             选中态 = 外圈 + 中心实心点（"这个节点在选中集里"）。 -->
        <svg class="v2-multi-radio-icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle class="v2-multi-radio-ring" cx="10" cy="10" r="8.25" />
          <circle class="v2-multi-radio-dot" cx="10" cy="10" r="4.25" />
        </svg>
      </div>
      <!-- 标题条：卡片内部、继承卡片 transform，反向缩放（BaseTitle / 就地改名） -->
      <div v-if="showTitle && !culledReduced" class="v2-title nodrag nopan" :style="titlePositionStyle"
        @dblclick.stop="editable && startTitleEdit()" @pointerdown.stop>
      <RegionEntryHost v-if="customTitleEntry" :entry="customTitleEntry" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
        <BaseTitle v-else :interactive="true" :editing="isEditingTitle" :title-icon="titleIcon">
          <template #title-label>
            <!-- 编辑用 contenteditable（同一元素切换属性），不换 <input>：换元素会改行高把标题条撑变形 -->
            <TitleLabel :label="nodeLabel" :editing="isEditingTitle" @commit="commitTitleEdit"
              @cancel="cancelTitleEdit" />
          </template>
          <!-- 标题右侧插槽：优先渲染节点类型注册的 titleExtraSlot 组件（调试标签等
               运行态内容由声明方自持）；否则回落到 titleExtra 文本。两者都空就不占位
               （BaseTitle 那一格本来就是 ≤20% 的收缩槽）。 -->
          <template v-if="titleExtraSlotComp" #title-extra>
            <component :is="titleExtraSlotComp" :node-id="id" :data="data" />
          </template>
          <template v-else-if="titleExtraText" #title-extra>
            <span class="v2-title-extra">{{ titleExtraText }}</span>
          </template>
        </BaseTitle>
      </div>

      <!-- 非法连接 / 满额替换提示：统一由渲染层 tip 服务显示（跟随鼠标，与其它提示同一套观感）。
           节点内不再自绘气泡 —— 用户口径 2026-10-26：提示是全局基础设施。 -->

      <!-- 调试叠加：吸附带 + 卡片接收区（吸附调试 connectionSnapDebugVisible，拖线目标态才显示）。
           用 SVG 在卡内坐标画，overflow:visible 让负 x 的吸附带也能画出去（v1 用 clip-path div，效果差）。 -->
      <svg v-if="showSnapDebugOverlay" class="v2-debug-overlay" :viewBox="debugViewBox">
        <!-- 卡片接收区（body） -->
        <rect class="v2-debug-body" :x="bodyRect.x" :y="bodyRect.y" :width="bodyRect.width" :height="bodyRect.height"
          rx="8" />
        <!-- 左侧 target 输入口吸附带：shape=rect 用矩形、arc 用半椭圆弧（圆心在左缘锚点 (0, anchorY)，
             rx=带宽、ry=带高/2，经 overflow:visible 向左画出卡片） -->
        <rect v-if="debugOverlay.shape.value === 'rect'" class="v2-debug-band" :x="debugOverlay.leftBand.value.x"
          :y="debugOverlay.leftBand.value.y" :width="debugOverlay.leftBand.value.width"
          :height="debugOverlay.leftBand.value.height" />
        <ellipse v-else class="v2-debug-band" :cx="0" :cy="debugOverlay.anchorY.value"
          :rx="debugOverlay.leftBand.value.width" :ry="debugOverlay.leftBand.value.height / 2" />
        <!-- 右侧 source 输出口吸附带（镜像到右缘，圆心在 (cardWidth, anchorY)） -->
        <rect v-if="debugOverlay.shape.value === 'rect'" class="v2-debug-band is-source"
          :x="debugOverlay.rightBand.value.x" :y="debugOverlay.rightBand.value.y"
          :width="debugOverlay.rightBand.value.width" :height="debugOverlay.rightBand.value.height" />
        <ellipse v-else class="v2-debug-band is-source" :cx="cardWidth" :cy="debugOverlay.anchorY.value"
          :rx="debugOverlay.rightBand.value.width" :ry="debugOverlay.rightBand.value.height / 2" />
        <!-- 目标锚点短线标注 -->
        <!-- <line class="v2-debug-anchor" :x1="0" :y1="debugOverlay.anchorY.value - 6" :x2="0"
          :y2="debugOverlay.anchorY.value + 6" /> -->
      </svg>

      <!-- 吸附带（真正触发吸附判定的区域，与端口按钮跟随区 .port-follow-zone 分离）：
           左侧 target 输入口吸附带 / 右侧 source 输出口吸附带，几何与 SnapZoneConfig 吸附带同源。
           mouseenter/leave 上报 aim(input/output)，后端据此吸到端口锚点 + 判边；平时 pointer-events:none 不挡卡片。 -->
      <div v-if="showTargetHandle" class="snap-band snap-band--input" :class="{ 'is-active': snapZonesActive }"
        :style="inputSnapStyle" @mouseenter="onInputSnapEnter" @mouseleave="onSnapLeave" />
      <div v-if="showSourceHandle" class="snap-band snap-band--output" :class="{ 'is-active': snapZonesActive }"
        :style="outputSnapStyle" @mouseenter="onOutputSnapEnter" @mouseleave="onSnapLeave" />

      <!-- 左侧输入口(target)：有输入能力才渲染。
           拖线中"同类型(target)端口"只传 :disabled（DOM 一直保留 → VueFlow handleBounds 稳定），
           加上 Strict 模式 isValidHandle 类型校验，行为门是双保险。 -->
      <MovingHandle v-if="showTargetHandle" ref="targetHandleRef" id="target" type="target" :position="Position.Left"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode || blockedTargetPort" :selected="props.selected"
        :blocked="handleBlocked"
        :rest-offset="handleParams.handleRestOffset" :cursor-gap="handleParams.handleCursorGap"
        :button-size="handleParams.handleButtonSize" :zone-width="portZoneWidth" :zone-height="portZoneHeight"
        :zone-offset="portZoneOffset" :zone-shape="portZoneShape" :zone-arc-ratio="portZoneArcRatio"
        :debug="debugHandle && !isConnecting" @hover="onPortHover" />

      <!-- 内容裁剪层：overflow hidden 确保不溢出卡片圆角 -->
      <div v-if="!culledReduced" class="v2-content-clip">
        <!-- in 区域（老 content 段）：基座 + attach 场条目按 order 同摞渲染 -->
      <RegionEntryHost v-for="seg in contentStack" :key="'in-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
        <div v-if="contentStack.length === 0" class="v2-content-missing">（type "{{ type }}" 未注册 content 段）</div>
      </div>

      <!-- 右下角 resize 拖拽句柄（类型声明 resizable 或 data.resizable === true 时显示；useNodeCardSize 门）。
           反缩放：屏幕大小恒定，transform-origin 在右下角（钉在卡片角上不漂移）。
           只在 pointerdown 起手；move/up 由 useNodeCardSize 绑到全局 document —— 指针移出手柄也不会断。 -->
      <div v-if="cardResizable && !culledReduced && !covered" class="resize-handle mc-export-ignore" :class="{ 'is-resizing': cardIsResizing }"
        :style="{ transform: `scale(${resizeHandleScale})` }" @pointerdown="card.onResizePointerDown">
        <svg viewBox="0 0 8 8" fill="none" class="resize-handle-icon">
          <path d="M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
          <path d="M7 5L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
        </svg>
      </div>

      <!-- 右侧输出口(source)：同 target。 -->
      <MovingHandle v-if="showSourceHandle" ref="sourceHandleRef" id="source" type="source" :position="Position.Right"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode || blockedSourcePort" :selected="props.selected"
        :blocked="handleBlocked"
        :rest-offset="handleParams.handleRestOffset" :cursor-gap="handleParams.handleCursorGap"
        :button-size="handleParams.handleButtonSize" :zone-width="portZoneWidth" :zone-height="portZoneHeight"
        :zone-offset="portZoneOffset" :zone-shape="portZoneShape" :zone-arc-ratio="portZoneArcRatio"
        :debug="debugHandle && !isConnecting" @hover="onPortHover" />
    </div>

    <!--
      节点状态层（`state:overlay`）：加载中 / 执行失败 / 插件自定义状态。

      为什么单独一层、与卡片**同级**（不在 .v2-card 里）：
      - 它是「节点现在是什么状态」，不是临时 UI —— resize、框选、多选、拖动都照实显示；
        放在卡片内部会被 `culledReduced` 这类可见性降级连坐（用户实测：一拖尺寸加载态就没了）；
      - 与 over:inset（编辑浮层）分开，编辑框收起的规矩就管不到它。
      尺寸与卡片严格一致（overlayLayerStyle），不反缩放 —— 画面像素对齐优先。

      顺序：有注册组件画注册组件，否则回落到内置 NodeLoadingState，都没有就不画。

      指针：这层**要接指针**（pointer-events: auto），但不带 nodrag/nopan ——
      为什么必须接：它盖在卡片上，底下是视频控制条 / 文本编辑区这些挂了 `nowheel` 的元素。
      层自己不接指针的话，滚轮会落到底下那些 nowheel 上，画布就不缩放了（用户实测：
      「失败和加载状态阻塞了滚动事件」）。接住之后滚轮在这层上，画布照常缩放。
      为什么不加 nodrag/nopan：按住加载中的卡片仍然应该能拖动、能选中 —— 带 nodrag 就拖不动了。
      取消按钮在组件内部自己开 pointer-events。
    -->
    <div
      v-if="showStateLayer && !culledReduced"
      class="v2-state-layer"
      :class="{ 'is-error': failed && !hasCustomStateOverlay }"
      :style="overlayLayerStyle"
    >
      <RegionEntryHost
        v-for="seg in stateOverlayRegions"
        :key="'state-' + seg.id"
        :entry="seg"
        :cache="capabilityCache"
        :node-id="id"
        :data="data"
        :is-dev="capabilityIsDev"
      />
      <NodeLoadingState
        v-if="showDefaultState"
        :tone="failed ? 'error' : 'loading'"
        :label="taskLabel"
        :percent="failed ? null : progressAsPercent"
        :value="failed ? null : progressAsValue"
        :suffix="progressSuffix"
        :progress-text="failed ? '' : taskProgressText"
        :message="taskReason"
        :hint="taskHint"
        :started-at="failed ? 0 : taskStartedAt"
        :stream-tail="failed ? '' : taskStreamTail"
        :stats="failed ? undefined : taskStats"
      >
        <template #action>
          <!-- 取消：只有装了能取消任务的插件（底部状态栏提供 nodeTask）才出现 -->
          <button
            v-if="canCancel"
            class="v2-task-cancel nodrag nopan"
            type="button"
            title="取消任务"
            @click.stop="onCancelTask"
          >
            取消
          </button>
        </template>
      </NodeLoadingState>
    </div>

    <!-- 下插槽：装了解层宿主时已随上面一起 Teleport 过去；这里只在原地模式渲染。 -->
    <div
      v-if="!toolbarHost && bottomSlots.length > 0 && !hideSlotBars && !culledReduced"
      class="v2-slot v2-slot--bottom nodrag nopan"
      :style="bottomSlotsStyle"
    >
      <RegionEntryHost v-for="seg in bottomSlots" :key="'bottom-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>

    <!-- out:left / out:right（新增区域）：左右外侧，垂直居中；不参与卡片布局、不撑高节点 -->
    <div v-if="leftRegions.length > 0 && !lowDetail && !culledReduced" class="v2-region v2-region--out-left nodrag nopan">
      <RegionEntryHost v-for="seg in leftRegions" :key="'out-left-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>
    <div v-if="rightRegions.length > 0 && !lowDetail && !culledReduced" class="v2-region v2-region--out-right nodrag nopan">
      <RegionEntryHost v-for="seg in rightRegions" :key="'out-right-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>

    <!-- on:top / on:bottom（新增区域）：贴在卡片边框线上（骑线居中，如进度条） -->
    <div v-if="onTopRegions.length > 0 && !lowDetail && !culledReduced" class="v2-region v2-region--on-top nodrag nopan">
      <RegionEntryHost v-for="seg in onTopRegions" :key="'on-top-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>
    <div v-if="onBottomRegions.length > 0 && !lowDetail && !culledReduced" class="v2-region v2-region--on-bottom nodrag nopan">
      <RegionEntryHost v-for="seg in onBottomRegions" :key="'on-bottom-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>

    <!-- 编辑浮层（裁剪框/扩展框）：与卡片**同级**、画在卡片外面，所以不会被内容层的 overflow:hidden 裁掉。
         尺寸与卡片严格一致（不反缩放）—— 浮层必须和底下的画面像素对齐，缩放会错位。
         z-index 高于卡片但低于上/下控制栏：编辑框盖住画面，但"确认/取消"按钮仍在最上层可点。 -->
    <div
      v-if="overlaySlots.length > 0 && !hideOverlays && !culledReduced"
      class="v2-overlay nodrag nopan"
      :style="overlayLayerStyle"
    >
      <RegionEntryHost v-for="seg in overlaySlots" :key="'overlay-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>

    <!-- over:outset（新增区域）：盖住整张卡且允许超出卡片边界；与卡片重合（不反缩放，画面像素对齐优先），
         overflow 交给组件自带样式（拖拽手柄/悬停放大会出界）。 -->
    <div v-if="outsetRegions.length > 0 && !lowDetail && !culledReduced" class="v2-region v2-region--over-outset nodrag nopan" :style="overlayLayerStyle">
      <RegionEntryHost v-for="seg in outsetRegions" :key="'over-outset-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>
  </div>
</template>

<style scoped>
/* —— 节点根 —— */
.v2-node {
  position: relative;
  display: flex;
  flex-direction: column;
  /* 跟随主题插件「外观 → 正文字体」；没选时回落到原来的系统栈。
     这条以前写死 system-ui，于是整站换字体时节点里的文字不跟着变。 */
  font-family: var(--mct-font-body, system-ui, sans-serif);
}

/* —— 视口外节点（culled / culled-linked）骨架态 ——
   宿主常驻节点（VueFlow hidden 会连坐连线），壳把可见部分收干净：
   卡片本体隐身但保留盒子（占位 + 端口锚点几何），标题条与 MovingHandle 留在 DOM
   （连线端点读 handleBounds，隐身不影响）；内容/栏位/区域条已由模板不挂载。 */
.v2-node.is-culled .v2-card {
  visibility: hidden;
}
/* 骨架节点不响应指针：卡片隐身后不可点、不可框内起拖；端口锚点保留几何但不再起线 */
.v2-node.is-culled .v2-card * {
  pointer-events: none !important;
}
/* ghost 档：画一个可见的空心细边框（远端连线走向一目了然；随缩放反比保持屏幕 1px） */
.v2-node.is-culled-ghost .v2-card {
  visibility: visible;
  background: transparent;
  box-shadow: none;
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  /* 圆角继承卡片本体（cardFrame 单一出处），不自造数值（ui-style-guide） */
  border-radius: inherit;
}

/* —— 上/下插槽定位层（位置由壳给，插件只放内容）——
   浮在卡片外侧：绝对定位、不占布局高度（节点不会被撑高）。
   贴边距离 / 水平居中 / 反缩放全在 :style 里（resolveNodeSlotStyle）；这里只给"排一行"的默认排版：
   插槽里可能只放一个插件组件，也可能叠了好几个 occupant 并排。 */

/* 控制栏脱层后的定位锚：与卡片同位置同尺寸（flow 绝对坐标），纯定位层不接事件。
   为什么需要：.v2-slot 的 bottom/top: calc(100% ± offset) 是相对**定位父元素**算的
   （留在节点里时父元素就是卡片盒）。传送到画布级层后父元素变成零尺寸宿主，
   补这一块与卡片重合的锚点盒，calc(100% ± offset) 才仍等于「离卡片这条边的距离」。 */
.v2-toolbar-anchor {
  position: absolute;
  pointer-events: none;
}

/* 传送宿主那层是 pointer-events:none（不挡画布交互），但控制栏里的按钮必须能点 ——
   留在节点里时它们从 .v2-node 继承 auto，传送后必须显式恢复，否则按钮全变"看得见点不到"。 */
.v2-slot--top,
.v2-slot--bottom {
  pointer-events: auto;
}

/* 上/下插槽的外层。
   z-index:30 是**节点内**渲染时的必需值：slot 与 .v2-card 是 .v2-node 下的兄弟，
   不加 z 会被卡片盖住（--top 在卡片之前、--bottom 在之后）。
   装了解层宿主时本层会被 Teleport 到画布级层（.csurface-node-toolbars，层值 LAYERS.nodeToolbar），
   那时这个 z 只在传送容器内部生效、不影响它与置顶连线的先后。 */
.v2-slot {
  position: absolute;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

/* —— 卡片 —— */
.v2-card {
  position: relative;
  box-sizing: border-box;
  transform-origin: center;
  border-style: solid;
  border-color: var(--canvas-node-border, rgb(209 213 219 / 0.95));
  background: var(--card-surface, var(--canvas-node-surface, #f9fafb));
  box-shadow: var(--card-shadow, 0 1px 3px var(--canvas-node-shadow-subtle, rgb(0 0 0 / 0.06)));
  overflow: visible;
  /* SVG 吸附调试带可负 x 溢出左缘，必须 visible */
  transition:
    border-color 240ms cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.v2-node.is-low-detail .v2-card {
  transition: none;
  box-shadow: none;
}

/* 选中态：边框色 + 外侧 2px 环 */
.v2-node.is-selected .v2-card {
  border-color: var(--canvas-node-border-selected, rgb(17 24 39 / 0.85));
}

.v2-node.is-selected .v2-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: 0 0 0 var(--card-outline-width, 0px) var(--canvas-node-ring-soft, rgb(17 24 39 / 0.38));
  pointer-events: none;
}

/* 连接中可连：边框高亮 + 光晕 */
.v2-card.is-connecting-hover {
  border-color: var(--canvas-node-border-selected, rgb(17 24 39 / 0.85));
}

/* 非法连接：灰框 + 内容模糊遮罩 */
.v2-card.is-connection-invalid {
  border-color: var(--canvas-node-border-hover, rgba(156, 163, 175, 0.45));
}

.v2-card.is-connection-invalid::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 25;
  border-radius: inherit;
  background: var(--ui-hover-strong, rgba(255, 255, 255, 0.25));
  backdrop-filter: blur(1.5px);
  pointer-events: none;
}

/* 非法气泡 */
.invalid-connection-tooltip {
  position: absolute;
  z-index: 60;
  transform: translate(-50%, -50%);
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--ui-tip, rgba(31, 41, 55, 0.94));
  color: var(--ui-tip-ink, #fff);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: var(--ui-shadow-lg, 0 10px 24px rgba(0, 0, 0, 0.28));
}

/* 满额"将替换"提示（蓝色系，与红气泡区分） */
.will-evict-tooltip {
  position: absolute;
  z-index: 60;
  transform: translate(-50%, -50%);
  padding: 6px 12px;
  border-radius: 999px;
  /* 满额替换提示：走蓝色系数据色（与红色非法气泡区分），不属主题外观 */
  /* 主题色白名单: 满额替换提示的蓝色语义色，需与非法连接的红色气泡区分 */
  background: rgba(37, 99, 235, 0.95);
  color: var(--ui-tip-ink, #fff);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  box-shadow: var(--ui-shadow-lg, 0 10px 24px rgba(0, 0, 0, 0.22));
}

.will-evict-tooltip .we-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ui-tip-ink, #fff);
}

/* —— 调试叠加（SVG）—— */
.v2-debug-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  /* 吸附带向左可出卡片 */
  pointer-events: none;
  z-index: 22;
}

.v2-debug-body {
  fill: var(--canvas-node-target-zone-surface, rgba(17, 24, 39, 0.08));
  stroke: var(--canvas-node-target-zone-border, rgba(17, 24, 39, 0.55));
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.v2-debug-band {
  fill: var(--canvas-node-snap-zone-surface, rgba(17, 24, 39, 0.12));
  stroke: var(--canvas-node-snap-zone-border, rgba(17, 24, 39, 0.9));
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.v2-debug-band.is-source {
  fill: var(--canvas-node-snap-zone-source-surface, rgba(37, 99, 235, 0.12));
  stroke: var(--canvas-node-snap-zone-source-border, rgba(37, 99, 235, 0.9));
}

.v2-debug-anchor {
  stroke: var(--canvas-node-snap-zone-highlight, #dc2626);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

/* —— 吸附带 .snap-band（真正触发吸附判定的区域）——
   绝对定位在卡内，几何与 SnapZoneConfig 吸附带同源（useNodeDebugOverlay）。
   平时 pointer-events:none 完全不挡卡片 hover/点击；拖线期间(非源自身)才 pointer-events:auto 接收 mouseenter。 */
.snap-band {
  position: absolute;
  z-index: 21;
  pointer-events: none;
}

.snap-band.is-active {
  pointer-events: auto;
}

/* —— 多选标记：内容区左上角的圆形单选点（自绘 SVG）—— */
.v2-multi-radio {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 26;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 尺寸 / 反缩放 由 multiRadioStyle() 内联给；**颜色走主题强调色**（不再有单独的颜色配置项，
     用户要求删掉它）—— 在「常规/主题配色」里改强调色或切亮/暗主题，这个标记自动跟随。 */
  color: var(--ui-accent, #0891b2);
  pointer-events: none;
}

.v2-multi-radio-icon {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
  /* 圆环与圆点都吃父元素给的色（= 配置里那一项，默认值是主题的"选中色"变量，浅色/深色主题下都跟随） */
  color: inherit;
  /* 白底圆：让标记在任何节点内容上都看得清（SVG 里画白底而不是靠 CSS 底色） */
  filter: drop-shadow(0 1px 2px var(--canvas-node-shadow-strong, rgb(0 0 0 / 0.28)));
}

/* 外圈：白底 + 主题色描边（用描边而不是实心，视觉更轻、不压内容） */
.v2-multi-radio-ring {
  /* 恒白：这个标记要浮在**任意节点内容**上都看得清（图片/视频/文本），
     跟随主题底色会在暗色下变成"深色环上的深色描边"、直接看不见 → 有意不跟随主题。 */
  /* 主题色白名单: 多选标记的恒白底，保证浮在任何节点内容上都可见 */
  fill: #ffffff;
  stroke: currentColor;
  stroke-width: 2;
}

/* 中心实心点：选中态 */
.v2-multi-radio-dot {
  fill: currentColor;
}

/* —— 标题条：卡片上缘外、反向缩放 —— */
.v2-title {
  position: absolute;
  z-index: 3;
  display: flex;
  align-items: center;
  cursor: text;
}

/*
 * 标题右侧附加文本（尺寸之类的派生信息）。
 * 靠右：BaseTitle 里 label 固定占 80%、extra 是剩下那 ≤20% 的收缩槽，
 * margin-left:auto 把这格推到标题条最右端（即卡片右上角）。
 * 用比标题更弱的字色：它是"顺带看一眼"的元信息，不该跟节点名字抢注意力。
 */
.v2-title-extra {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--canvas-node-text-faint, #9ca3af);
  font-variant-numeric: tabular-nums;
}

/* 选中态标题加深（文案元素在 TitleLabel 子组件内，需 :deep 穿透 scoped） */
.v2-node.is-selected :deep(.title-label) {
  color: var(--canvas-node-text-strong, #111827);
}

/* —— 编辑浮层（裁剪/扩展框）——
   与卡片同级、画在卡片外面：不受内容层 overflow:hidden 裁剪（用户报的"裁剪区域被节点切掉"）。
   绝对定位到卡片左上角，尺寸由内联样式给（= 卡片尺寸），所以浮层与底下的画面严格对齐。
   z-index 取 25：高过卡片内容与端口，低过 30 的上/下控制栏 ——
   编辑框盖住画面，但"确认/取消"按钮永远在最上层可点。 */
.v2-overlay {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 25;
  overflow: visible;
  pointer-events: none;
}

/* —— content 裁剪层 —— */
.v2-content-clip {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--card-content-surface, #eee);
}

/* —— 节点状态层（state:overlay，见模板注释）——
    与卡片同级、同尺寸，盖住整张卡。
    **接指针**：底下常是带 nowheel 的视频控制条 / 文本区，这层不接就会把滚轮吃掉、画布不能缩放。
    但它不带 nodrag/nopan，所以按住这张卡仍然能拖动、点选 —— 只有滚轮和点击落在这一层上。
    层内默认仍不接事件（子元素 pointer-events: none），取消按钮自己开（NodeLoadingState 的 #action）。
    z-index 取 24：高过卡片本体，低过编辑浮层（25）、多选圆点（26）与上/下控制栏（30）——
    用户口径「多选时在覆盖层上再叠一层覆盖没关系」，所以选中标记、工具条、编辑框照旧压在上面。 */
.v2-state-layer {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 24;
  overflow: visible;
  pointer-events: auto;
}

/* 取消按钮：右下角一小格，是覆盖层里唯一接指针的东西（加载期间节点照样能拖能选） */
.v2-task-cancel {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 3;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  background: var(--ui-overlay-solid, #fff);
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  pointer-events: auto;
  transition: color 0.15s ease-out, background-color 0.15s ease-out;
}
.v2-task-cancel:hover {
  color: var(--ui-danger, #ef4444);
  background: var(--ui-danger-soft, color-mix(in srgb, var(--ui-danger, #ef4444) 14%, transparent));
}
@media (prefers-reduced-motion: reduce) {
  .v2-task-cancel {
    transition: none;
  }
}

/* —— 新增区域容器（out:left / out:right / on:top / on:bottom / over:outset）——
   绝对定位、不占布局高度（节点不被撑高）、不接画布交互（nodrag/nopan 由 class 声明，
   pointer-events 交给子组件自己开）。位置是默认值，组件可自带样式/transform 覆盖。 */
.v2-region {
  position: absolute;
  z-index: 26;
  display: flex;
  align-items: center;
}

/* 左右外侧：垂直居中，left/right 贴卡缘（负偏移让容器悬在卡外） */
.v2-region--out-left {
  right: 100%;
  top: 50%;
  transform: translateY(-50%);
}

.v2-region--out-right {
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
}

/* 贴边框线：水平居中、骑在上下缘上（translateY(-50%) 让组件垂直骑线） */
.v2-region--on-top {
  left: 50%;
  top: 0;
  transform: translate(-50%, -50%);
}

.v2-region--on-bottom {
  left: 50%;
  top: 100%;
  transform: translate(-50%, -50%);
}

/* over:outset：与卡片重合（不反缩放），overflow 可见允许出界 */
.v2-region--over-outset {
  left: 0;
  top: 0;
  overflow: visible;
}

.v2-content-missing {
  color: var(--ui-warn, #b45309);
  padding: 8px;
  font-size: 12px;
}

/* —— resize 拖拽句柄 —— */
.resize-handle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 24px;
  height: 24px;
  cursor: nwse-resize;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.4;
  transition: opacity 140ms ease;
  touch-action: none;
  /* 反缩放时钉在卡片右下角（跟标题 left bottom 原点同一套语义） */
  transform-origin: 100% 100%;
}

.resize-handle:not(.is-resizing):hover,
.v2-node.is-pointer-hovered .resize-handle,
.v2-node.is-selected .resize-handle {
  opacity: 0.85;
}

.resize-handle-icon {
  width: 12px;
  height: 12px;
  color: var(--canvas-node-resize-handle, #9ca3af);
  pointer-events: none;
}

/**.resize-handle:hover .resize-handle-icon,
.v2-node.is-pointer-hovered .resize-handle .resize-handle-icon,
.v2-node.is-selected .resize-handle .resize-handle-icon {
  color: var(--canvas-node-resize-handle-active, #111827);
} */

.resize-handle:hover .resize-handle-icon {
  color: var(--canvas-node-resize-handle-active, #111827);
}

/* LOD：隐标题条、隐拖柄 */
.v2-node.is-low-detail .v2-title,
.v2-node.is-low-detail .resize-handle {
  display: none;
}
</style>
