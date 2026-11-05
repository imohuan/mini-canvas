<script setup lang="ts">
/**
 * NodeBottomBar —— 默认底栏皮（themeRegistry 槽 bottomBar 的默认赢家）。
 *
 * 入口只保留外壳与编排：显示条件、动作/提示词/素材/标签/AI/预览等状态
 * 住在 ./node-bottom-bar 下的 hooks 与子组件里。对外路径、props、class、
 * 文案与执行顺序保持不变。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { registerTagSpec } from 'prosemirror-editor-bundle'
import './node-bottom-bar/bottom-bar-layout.css'
import './node-bottom-bar/bottom-bar-cards.css'
import './node-bottom-bar/bottom-bar-tagmenu.css'
import './node-bottom-bar/bottom-bar-editor-footer.css'
import './node-bottom-bar/bottom-bar-preview.css'
import { useCanvasRender, useGenPanelMetrics, useSoleNodeSelected, useUiComponent, RenderEvents, LAYERS, type FeedbackService } from '@mini-canvas/canvas-render'
import { bottomBarTagSpecFor, toToolResources } from './panelSource'
import { readRunState } from './runState'
import { exitReference, referenceActive, referenceOwner, selectionEpoch, toggleReference as toggleReferenceMode } from './referenceMode'
import { resolveBottomBarShown } from './bottomBarOverlay'
import { invalidRefHint, type RefTile } from './refTiles'
import { registerStartDragHandler } from './ctrlDragMode'
import { exitCtrlDragMode as unifiedExitCtrlDragMode } from './selectionMode'
import {
  BottomBarActions,
  BottomBarCardList,
  BottomBarHoverPreview,
  BottomBarPills,
  BottomBarPromptEditor,
  BottomBarSettingsPanel,
  BottomBarTagMenu,
  BottomBarTagPreview,
  ICON_WARN,
  ICON_EXPAND,
  ICON_COLLAPSE,
  ICON_SEND,
  useBottomBarActions,
  useBottomBarAiActions,
  useBottomBarCards,
  useBottomBarMaterials,
  useBottomBarPersistence,
  useBottomBarPreview,
  useBottomBarPrompt,
  useBottomBarTagMenu,
  useCtrlResourceDrag,
  useBarNudge,
  type BottomBarEditorHandle,
} from './node-bottom-bar'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx, host, renderEdges, renderNodes } = useCanvasRender()
const Button = useUiComponent('Button')

// 单选才显示（与既有三份面板同语义）
const visible = useSoleNodeSelected(props.id)
const metrics = useGenPanelMetrics()
const panelStyle = computed<Record<string, string>>(() => ({
  width: metrics.value.imageWidth + 'px',
}))

/**
 * 贴边收拢：底栏宽度固定，节点靠近视口左右边缘时会被裁掉一半。
 * 这里只做横向平移，宽度与插槽定位规则都不变（见 useBarNudge 的说明）。
 */
const barEl = ref<HTMLElement | null>(null)
const editorStyle = computed<Record<string, string>>(() => ({
  '--nb-min': '20px',
  '--nb-max': metrics.value.editorMaxHeight + 'px',
}))

const doc = computed(() => ctx.tryGet<{
  getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined
  subscribe(fn: () => void): () => void
}>('doc'))

// —— 动作 / 参数 ——
const actionApi = useBottomBarActions(props, { ctx, host, doc })
const {
  nodeType,
  actions,
  hasActions,
  actionOptions,
  currentId,
  currentAction,
  currentActionLabel,
  values,
  storedActionId,
  selectAction,
  onFieldChange,
  paramDefs,
  promptBinding,
  showEditor,
} = actionApi

function onActionPicked(value: string | number): void {
  selectAction(String(value))
}

// —— 提示词 ——
let persistValuesSoonRef: () => void = () => {}
const promptApi = useBottomBarPrompt({
  ctx,
  props,
  promptBinding,
  persistValuesSoon: () => persistValuesSoonRef(),
})
const { prompt, promptDoc, onPromptUpdate, CHAR_LIMIT, charCount } = promptApi

const persistence = useBottomBarPersistence({
  ctx,
  props,
  currentId,
  values,
  storedActionId,
  showEditor,
  promptBinding,
  prompt,
  promptDoc,
})
const { persistValues, persistValuesSoon, flushPersistValues } = persistence
persistValuesSoonRef = persistValuesSoon

// —— 上游素材 / 卡片 ——
const materialApi = useBottomBarMaterials({ ctx, props, renderEdges, renderNodes })
const {
  refOrder,
  shownMaterials,
  videoThumbTick,
  videoProvider,
  videoThumbOf,
  cardImageOf,
  ensureFullVideoThumb,
  cards,
  editorResources,
  resolveResource,
} = materialApi

const editorComponentRef = ref<BottomBarEditorHandle | null>(null)
let openTagMenuRef: (item: import('prosemirror-editor-bundle').ResourceItem, anchor: { left: number; top: number; right: number; bottom: number }) => void = () => {}

const cardApi = useBottomBarCards({
  ctx,
  props,
  renderEdges,
  refOrder,
  shownMaterials,
  cards,
  cardImageOf,
  videoThumbOf,
  ensureFullVideoThumb,
  videoThumbTick,
  editorComponentRef,
  prompt,
  promptDoc,
  persistValues,
  onPromptText: onPromptUpdate,
  onOpenTagMenu: (item, anchor) => openTagMenuRef(item, anchor),
})
const {
  promptChips,
  refTiles,
  loadingTiles,
  brokenTiles,
  clearBrokenTile,
  markBrokenTile,
  slotErrorOf,
  cardTooltip,
  openCard,
  dragging,
  onDragEndMark,
  onRemovePointerDown,
  onCardsClickCapture,
  onCardDblClick,
  onCardsKeydown,
  onReorderTiles,
  onAtPointerDown,
  onAtClick,
  markRefSlotsInPrompt,
  onPasteFiles,
  bindTileToNode,
  refreshSlotChips,
  slotsDropHot,
  onSlotDragOver,
  onSlotDragLeave,
  onSlotDrop,
  markDragEnd,
} = cardApi

const tagMenuView = ref<{ anchorEl: HTMLElement | null; searchEl: HTMLInputElement | null } | null>(null)
const tagApi = useBottomBarTagMenu({
  ctx,
  props,
  shownMaterials,
  videoThumbTick,
  videoThumbOf,
  videoProvider,
  replaceChipWith: cardApi.replaceChipWith,
  getAnchorEl: () => tagMenuView.value?.anchorEl ?? null,
  focusSearch: () => tagMenuView.value?.searchEl?.focus(),
})
openTagMenuRef = tagApi.openTagMenu
const {
  tagMenuOpen,
  tagMenuQuery,
  tagMenuChip,
  tagMenuAnchorShift,
  tagMenuPreviewEntry,
  tagMenuPreviewVisible,
  tagMenuPreviewBox,
  tagMenuPreviewPos,
  tagMenuRootStyle,
  tagMenuFlat,
  tagMenuSections,
  tagMenuActiveKind,
  tagMenuActiveItems,
  tagMenuFlatItems,
  tagMenuThumbOf,
  hoverTagMenuRow,
  leaveTagMenuRow,
  pickTagMenuNode,
} = tagApi

// —— 悬浮预览 ——
const previewApi = useBottomBarPreview({
  refTiles,
  cardImageOf,
  openFullscreen: (tile: RefTile) => openCard({
    id: tile.nodeId ?? tile.key,
    name: tile.label,
    kind: tile.kind ?? 'image',
    ...(tile.url ? { url: tile.url } : {}),
  }),
})
const {
  previewPos,
  previewBox,
  livePreviewTile,
  schedulePreview,
  onPreviewMediaReady,
  cancelPreviewSchedule,
  schedulePreviewClose,
  cancelPreviewClose,
  closePreviewNow,
  openFullscreenFromPreview,
  toggleAudioPlay,
  stopPreviewAudio,
} = previewApi

// —— 参考选择态 ——
const referencing = ref(false)
function syncReference(): void {
  referencing.value = referenceActive() && referenceOwner() === props.id
}
syncReference()
watch(selectionEpoch, syncReference)
function toggleReference(): void {
  toggleReferenceMode(props.id)
  syncReference()
}

// —— 失效引用 ——
const invalidHint = computed(() => invalidRefHint(refTiles.value))
const invalidTiles = computed(() => refTiles.value.filter((t) => t.invalid))
async function clearInvalidRefs(): Promise<void> {
  const ids = invalidTiles.value.map((t) => t.key).filter(Boolean)
  if (ids.length === 0) return
  const feedback = ctx.get<FeedbackService>('feedback')
  const ok = feedback
    ? await feedback.confirm({
      title: '清理失效引用',
      description: '会从提示词里删除 ' + ids.length + ' 个失效引用（正文其它内容不动），继续？',
      confirmText: '删除',
      cancelText: '取消',
      tone: 'destructive',
    })
    : false
  if (!ok) return
  const removed = editorComponentRef.value?.removeRefChips?.(ids) === true
  if (!removed) return
  void nextTick().then(() => {
    const alive = new Set(promptChips.value.map((c) => c.id))
    const order = refOrder.value.filter((k) => alive.has(k))
    try {
      ctx.get('doc').updateNode(props.id, { data: { refOrder: order } })
    } catch { /* 节点已不在：忽略 */ }
    refreshSlotChips()
  })
}

// —— 运行状态 ——
const infoText = computed(() => {
  const info = currentAction.value?.info
  return info ? info(props.data) : ''
})
const runState = computed(() => readRunState(props.data))
const running = computed(() => runState.value.status === 'running')
const canRun = computed(() => !running.value && !!currentAction.value && !invalidHint.value)

// —— 折叠 / 提交 ——
const submitted = ref(false)
function resetSubmitted(): void {
  submitted.value = false
}
const barShown = computed(() =>
  resolveBottomBarShown({
    soleSelected: visible.value,
    hasActions: hasActions.value,
    submitted: submitted.value,
  }),
)
if (typeof ctx.on === 'function') {
  const clickOff = ctx.on(RenderEvents.NodeClick, (p: { nodeId?: string }) => {
    if (p?.nodeId === props.id) resetSubmitted()
  })
  // 与既有行为一致：这个监听随组件生命周期存在，沿用本地保存的 disposer。
  onBeforeUnmount(() => clickOff.dispose())
}

async function onRun(): Promise<void> {
  if (!canRun.value || !currentAction.value) return
  if (submitted.value || running.value) return
  persistValues()
  if (promptBinding.value === 'text') ctx.get('doc').updateNode(props.id, { data: { text: prompt.value } })
  submitted.value = true
  await ctx.get<{ run(nodeId: string, actionId: string, input?: unknown): Promise<unknown> }>('nodeTask').run(props.id, currentAction.value.id, {
    prompt: prompt.value,
    values: values.value,
    resources: toToolResources(shownMaterials.value),
  })
  resetSubmitted()
}

// —— 展开 / 设置 ——
const expanded = ref(false)

/** 贴边收拢：只在收起态生效（展开是全屏 dialog，有自己的居中） */
const { shift: barShift } = useBarNudge({
  el: barEl,
  shown: barShown,
  paused: expanded,
})
function onExpandKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && expanded.value) {
    e.stopPropagation()
    expanded.value = false
  }
}
onMounted(() => window.addEventListener('keydown', onExpandKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onExpandKeydown, true))
const settingsOpen = ref(false)

// —— AI 按钮 ——
const aiApi = useBottomBarAiActions({
  ctx,
  props,
  nodeType,
  currentAction,
  promptBinding,
  prompt,
  promptDoc,
  showEditor,
  editorComponentRef,
})
const { aiRunningId, aiPhase, aiEditorLocked, aiError, aiButtons, runAiAction } = aiApi

// —— Ctrl 拖资源 ——
const ctrlApi = useCtrlResourceDrag({
  ctx,
  props,
  renderEdges,
  refTiles,
  barShown,
  bindTileToNode,
  markDragEnd,
  cancelPreviewTimers: () => { cancelPreviewSchedule(); cancelPreviewClose() },
  stopPreviewAudio,
})

// —— 生命周期：保持原挂载/卸载职责（标签规格、Ctrl 拖拽、预览与选择态） ——
onMounted(() => {
  registerTagSpec(bottomBarTagSpecFor(() => shownMaterials.value))
  registerStartDragHandler(ctrlApi.startCtrlDrag)
})
onBeforeUnmount(() => {
  registerStartDragHandler(null)
  registerTagSpec(null)
  cancelPreviewSchedule()
  cancelPreviewClose()
  stopPreviewAudio()
  unifiedExitCtrlDragMode()
  exitReference()
  ctx.tryGet<{ notify(m: string, o?: object): unknown }>('canvas')?.notify('', { source: 'bottom-bar' })
  flushPersistValues()
})
</script>

<template>
  <Teleport to="body" :disabled="!expanded">
  <div
    v-if="barShown"
    class="nb-shell"
    :class="{ 'is-expanded': expanded }"
    :style="expanded ? { zIndex: 'var(--ui-layer-dialog, 100000)' } : undefined"
    @pointerdown.self="expanded = false"
  >
    <div
      ref="barEl"
      class="nb-root nodrag nopan"
      :class="{ 'is-expanded': expanded, 'is-ai-locking': aiEditorLocked }"
      :style="expanded ? undefined : [panelStyle, barShift ? { transform: 'translateX(' + barShift + 'px)' } : undefined]"
      :role="expanded ? 'dialog' : undefined"
      :aria-modal="expanded ? 'true' : undefined"
      data-testid="node-bottom-bar"
      @pointerdown.stop
    >
      <BottomBarPills
        :expanded="expanded"
        :referencing="referencing"
        :card-count="cards.length"
        :invalid-count="invalidTiles.length"
        @toggle-reference="toggleReference"
        @mark="markRefSlotsInPrompt"
        @clear-invalid="clearInvalidRefs"
      />

      <Button variant="ghost" size="icon-sm"
        class="nb-expand nb-icon-btn"
        type="button"
        :title="expanded ? '收起为浮动底栏' : '展开为大窗口'"
        :aria-label="expanded ? '收起' : '展开'"
        :aria-expanded="expanded"
        @click.stop="expanded = !expanded"
      >
        <span aria-hidden="true" v-html="expanded ? ICON_COLLAPSE : ICON_EXPAND" />
      </Button>

      <BottomBarCardList
        :ref-tiles="refTiles"
        :loading-tiles="loadingTiles"
        :broken-tiles="brokenTiles"
        :dragging="dragging"
        :ctrl-dragging="!!ctrlApi.ctrlDrag()"
        :slots-drop-hot="slotsDropHot"
        :card-image-of="cardImageOf"
        :card-tooltip="cardTooltip"
        :slot-error-of="slotErrorOf"
        @drag-end="onDragEndMark"
        @reorder="onReorderTiles"
        @drag-start="dragging = true"
        @click-capture="onCardsClickCapture"
        @keydown="onCardsKeydown"
        @preview-enter="schedulePreview"
        @preview-leave="cancelPreviewSchedule(); schedulePreviewClose()"
        @card-click="$event.pending ? $event : undefined"
        @card-dbl-click="onCardDblClick"
        @slot-drag-over="onSlotDragOver"
        @slot-drag-leave="onSlotDragLeave"
        @slot-drop="onSlotDrop"
        @clear-broken="clearBrokenTile"
        @mark-broken="markBrokenTile"
        @audio-play="toggleAudioPlay"
        @at-pointer-down="onAtPointerDown"
        @at-click="onAtClick"
        @remove-pointer-down="onRemovePointerDown"
      />

      <BottomBarHoverPreview
        :live-preview-tile="livePreviewTile"
        :preview-pos="previewPos"
        :preview-box="previewBox"
        :card-image-of="cardImageOf"
        @enter="cancelPreviewClose"
        @leave="schedulePreviewClose"
        @media-ready="onPreviewMediaReady"
        @open-fullscreen="openFullscreenFromPreview"
      />

      <component :is="(currentAction as any).panel" v-if="currentAction?.panel" :id="props.id" :data="props.data" />

      <BottomBarPromptEditor
        v-if="showEditor"
        :prompt="prompt"
        :prompt-doc="promptDoc"
        :editor-style="editorStyle"
        :ai-phase="aiPhase"
        :ai-editor-locked="aiEditorLocked"
        :editor-resources="editorResources"
        :resolve-resource="resolveResource"
        :on-paste-files="onPasteFiles"
        @update="onPromptUpdate"
        @update-prompt-doc="promptDoc = $event"
        @ready="editorComponentRef = $event"
      >
        <template #tag-menu>
          <BottomBarTagMenu
            ref="tagMenuView"
            :open="tagMenuOpen"
            :anchor-style="tagMenuRootStyle"
            :query="tagMenuQuery"
            :chip="tagMenuChip"
            :flat="tagMenuFlat"
            :flat-items="tagMenuFlatItems"
            :sections="tagMenuSections"
            :active-kind="tagMenuActiveKind"
            :active-items="tagMenuActiveItems"
            :thumb-of="tagMenuThumbOf"
            @update:open="tagMenuOpen = $event"
            @update:query="tagMenuQuery = $event"
            @update:active-kind="tagMenuActiveKind = $event"
            @row-enter="hoverTagMenuRow"
            @row-leave="leaveTagMenuRow"
            @pick="pickTagMenuNode"
          />
        </template>
      </BottomBarPromptEditor>

      <BottomBarTagPreview
        :open="tagMenuOpen"
        :entry="tagMenuPreviewEntry"
        :visible="tagMenuPreviewVisible"
        :pos="tagMenuPreviewPos"
        :box="tagMenuPreviewBox"
      />

      <BottomBarActions
        :id="props.id"
        :current-id="currentId"
        :current-action-label="currentActionLabel"
        :running="running"
        :param-defs="paramDefs"
        :values="values"
        :info-text="infoText"
        :ai-buttons="aiButtons"
        :ai-running-id="aiRunningId"
        :ai-error="aiError"
        :show-editor="showEditor"
        :char-count="charCount"
        :char-limit="CHAR_LIMIT"
        :invalid-hint="invalidHint"
        :can-run="canRun"
        :submitted="submitted"
        :current-action-title="currentAction?.title ?? ''"
        :icon-warn="ICON_WARN"
        :icon-send="ICON_SEND"
        :action-options="actionOptions"
        @action-picked="onActionPicked"
        @field-change="onFieldChange"
        @ai-click="runAiAction"
        @run="onRun"
      />

      <BottomBarSettingsPanel :settings-open="settingsOpen" />
    </div>
  </div>
  </Teleport>
</template>
