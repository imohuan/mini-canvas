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
import type { NotifyContract } from '@mini-canvas/canvas-base'
import type { ToolParamDef } from '@mini-canvas/kernel'
import type { PromptPreset } from './promptPresets'
import { bottomBarTagSpecFor, toToolResources } from './panelSource'
import { promptSegmentsFromDoc } from './promptSegments'
import HtmlPanelFrame from './node-bottom-bar/HtmlPanelFrame.vue'
import { readRunState } from './runState'
import { exitReference, referenceActive, referenceOwner, selectionEpoch, toggleReference as toggleReferenceMode } from './referenceMode'
import { resolveBottomBarShown } from './bottomBarOverlay'
import { invalidRefHint, type RefTile } from './refTiles'
import { registerStartDragHandler } from './ctrlDragMode'
import { exitCtrlDragMode as unifiedExitCtrlDragMode } from './selectionMode'
import {
  BottomBarActions,
  BottomBarModelPicker,
  BottomBarChoicePicker,
  BottomBarCardList,
  BottomBarHoverPreview,
  BottomBarPills,
  BottomBarPresets,
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
  useAgentChat,
  readBarModelChoice,
  choiceStillValid,
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
  currentModelIcon,
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

/**
 * provider 自带的 HTML 面板（有它就替掉默认的参数控件）。
 *
 * 有输入框时坐在输入框上方，没有输入框时贴着底栏行下面 —— 同一份 HTML，两种摆法。
 */
const panelHtml = computed(() => (currentAction.value as { panelHtml?: string } | undefined)?.panelHtml ?? '')
/** 参数区交给 HTML 面板时，默认的参数摘要按钮就不画了（避免两套 UI 打架） */
const useHtmlPanel = computed(() => panelHtml.value.trim() !== '')
const htmlPanelTheme = computed<Record<string, string>>(() => ({
  ink: 'var(--ui-ink, #e5e7eb)',
  inkDim: 'var(--ui-ink-dim, #9ca3af)',
  line: 'var(--ui-line, rgb(255 255 255 / 0.1))',
  surface: 'var(--ui-surface, rgb(255 255 255 / 0.04))',
  accent: 'var(--ui-accent, #0891b2)',
}))
/** 面板一次改多个参数：合并后统一写回一次，别逐个触发落盘 */
function onPanelValues(next: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue
    onFieldChange(k, v as string | number | boolean)
  }
}
/** 面板发来的一句提示，走统一的通知口（没有就不显示，不抛错） */
function onPanelNotify(payload: { level: 'info' | 'success' | 'error'; message: string }): void {
  if (!payload.message) return
  const n = ctx.tryGet<NotifyContract>('notify')
  if (payload.level === 'error') n?.error(payload.message)
  else if (payload.level === 'success') n?.success(payload.message)
  else n?.info(payload.message)
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

// —— 文本节点：任务化对话（用户 2026-11-09） ——
// 这个下拉不是「底栏动作」，而是 Agent 里配好的模型清单；
// 选中的模型存进节点 data.barModel；点发送 = 提交任务给后台（动作 agent:chat），
// 后台调模型、边生成边把正文写进本节点 data.text，加载态与终态也由后台写 —— 前端只提交。
const agentChat = useAgentChat({
  ctx,
  nodeId: props.id,
  prompt,
})
const { choice: agentChoice, pick: pickAgentModel, send: sendAgentMessage } = agentChat

/**
 * 文本 / 图片 / 视频都用 Agent 的模型下拉（用户口径 2026-11-07）。
 * 音频目前 Agent 侧没有对应模型，仍用底栏原有的动作下拉。
 */
/**
 * 只有文本节点直接用「Agent 的对话模型」——图片 / 视频要走生成动作（带比例、时长等参数），
 * 由下面的 ChoicePicker 承接（同样是卡片 + 分栏那套面板）。
 */
const AGENT_MODEL_TYPES = new Set(['text'])
const useAgentModels = computed(() => AGENT_MODEL_TYPES.has(String(nodeType.value ?? '')))

/**
 * Agent 的两块面板是否真的注册了。
 *
 * 直接探测 ui 场而不是等子组件回报：回报会晚一帧，首帧旧下拉已藏、新面板未出。
 */
const agentModelPickerComp = useUiComponent('agentModelPicker')
const agentChoicePickerComp = useUiComponent('agentChoicePicker')
const agentPickerAvailable = computed(() => Boolean(agentModelPickerComp.value))
const choicePickerAvailable = computed(() => Boolean(agentChoicePickerComp.value))

/** 真正用哪一套：节点类型能用 + Agent 的模型面板确实注册了 */
const useAgentModelsEffective = computed(() => useAgentModels.value && agentPickerAvailable.value)

/** 输入框：动作要输入框，或当前类型能用 Agent 的模型面板且组件确实在 */
const showPromptEditor = computed(() => showEditor.value || useAgentModelsEffective.value)

/** 动作 → ChoicePicker 的一行：参数摘要拼进副标题，图标与触发器同一份 */
const actionChoices = computed(() =>
  actionOptions.value.map((o) => {
    const action = actions.value.find((a) => a.id === o.value)
    const summary = (action?.fields ?? [])
      .filter((f) => f.kind !== 'style')
      .map((f) => values.value[f.key])
      .filter((v) => v !== undefined && v !== '')
      .map(String)
      .join(' · ')
    return {
      value: o.value,
      label: o.label,
      description: o.description ?? '',
      group: o.group ?? '',
      note: summary,
      /** provider 图标 / 图标名 / 兜底 —— 下拉列表与触发器必须同源 */
      model: o.model,
    }
  }),
)
// 打开时把节点里记着的模型读回来；Agent 删掉那个模型（或没存过）时落到「默认模型」
// —— 用户 2026-11-09：下拉里标了「默认」的那颗就是初始选中，不该是空的「选择模型」。
// 与 Agent 会话的初始模型同一条规则（usable.find(isDefault) ?? usable[0]，见 sessions.ts）。
watch(
  [() => props.data?.barModel, useAgentModels],
  () => {
    if (!useAgentModels.value) return
    const saved = readBarModelChoice(props.data)
    const models = agentChat.availableModels()
    if (choiceStillValid(saved, models)) { agentChoice.value = saved }
    else {
      const usable = models.filter((m) => m.hasKey)
      const def = usable.find((m) => m.isDefault) ?? usable[0]
      agentChoice.value = def ? { provider: def.provider, modelId: def.modelId } : null
    }
  },
  { immediate: true },
)

function onAgentModelPicked(m: { provider: string; modelId: string }): void {
  pickAgentModel(m)
  // 跟着作品走：换机器 / 刷新后仍记得选的是哪个模型
  try { ctx.get('doc').updateNode(props.id, { data: { barModel: { provider: m.provider, modelId: m.modelId } } }) } catch { /* 节点已不在 */ }
}

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

/*
 * 参数变化就安排落盘（400ms 防抖）。
 *
 * 之前这里只在「提示词变化」时保存（见 useBottomBarPrompt 的 persistValuesSoon 回调），
 * 于是**切动作 / 改参数都不落盘**：节点 data.barValues 永远停在上一次，
 * 重新选中节点时按旧值恢复 —— 表现就是「切到另一个动作，参数回到默认」，
 * 以及旧动作的 model 值（v2）串到新动作（候选只有 a/b/c）上、下拉显示空白
 * （用户 2026-11-09 截图）。
 *
 * 现在把 currentId / values 一起盯住：换动作与改值都写入，与提示词那条同一份防抖。
 */
watch(
  [currentId, values],
  () => persistValuesSoon(),
  { deep: true },
)

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

const tagMenuView = ref<{ anchorEl: HTMLElement | null; focusSearch(): void } | null>(null)
const tagApi = useBottomBarTagMenu({
  ctx,
  props,
  shownMaterials,
  videoThumbTick,
  videoThumbOf,
  videoProvider,
  replaceChipWith: cardApi.replaceChipWith,
  getAnchorEl: () => tagMenuView.value?.anchorEl ?? null,
  focusSearch: () => tagMenuView.value?.focusSearch(),
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
  restoreEditingChip,
} = tagApi

// 菜单不管从哪条路关（点外 / Esc / 选中 / 失效），都把标签恢复成缩略图
watch(tagMenuOpen, (open) => { if (!open) restoreEditingChip() })

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
    // 用户口径（2026-11-07）：预设按钮在所有类型都显示；
    // 零动作节点（音频、删掉复制 / 删除后的文本）也要能出底栏。
    hasPresets: true,
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
  // 文本走 Agent 的任务化对话：提交任务（带上选的模型），生成过程由后台写节点
  if (useAgentModelsEffective.value) {
    if (!agentChat.canSend()) return
    persistValues()
    if (promptBinding.value === 'text') ctx.get('doc').updateNode(props.id, { data: { text: prompt.value } })
    submitted.value = true
    const r = await sendAgentMessage()
    // 任务建成了就交给后台：加载态 / 完成 / 失败全由后台的 runState 帧驱动，
    // 不在这里 resetSubmitted —— 否则卡片还没进入加载态按钮就先解锁了（连点窗口）。
    // 只有下单失败才立即解锁并提示。
    if (!r.ok) {
      resetSubmitted()
      ctx.tryGet<NotifyContract>('notify')?.error(r.error)
    }
    return
  }
  if (!canRun.value || !currentAction.value) return
  if (submitted.value || running.value) return
  persistValues()
  if (promptBinding.value === 'text') ctx.get('doc').updateNode(props.id, { data: { text: prompt.value } })
  submitted.value = true
  await ctx.get<{ run(nodeId: string, actionId: string, input?: unknown): Promise<unknown> }>('nodeTask').run(props.id, currentAction.value.id, {
    prompts: promptSegmentsFromDoc(promptDoc.value, prompt.value),
    values: values.value,
    resources: toToolResources(shownMaterials.value),
  })
  resetSubmitted()
}

// —— 展开 / 设置 ——
const expanded = ref(false)

/**
 * 底栏根节点的 pointerdown：只拦画布拖拽，**不能拦住浮层的「点外关闭」**。
 *
 * 为什么不能写 `@pointerdown.stop`（用户 2026-11-09 截图）：
 * reka 的 DismissableLayer 在 **document** 上监听 pointerdown 来判断「点在外部」。
 * 之前这里无条件 stop，事件到这一层就断了，document 永远收不到 —— 于是：
 *   1. 点空白处关不掉；
 *   2. 再点同一个 trigger 关不掉（那次 pointerdown 被拦，reka 既没收到外部点击、
 *      也没走自己的 toggle）；
 *   3. 点左边的模型下拉时也不关（两个触发器都在这个节点里）。
 *
 * 需要的只是「别让画布开始拖拽」（CanvasFlow 在外层用 pointerdown 判断），
 * 所以改成按需 stop：有浮层开着就放行，平时照旧拦掉。
 */
function onRootPointerDown(e: PointerEvent): void {
  // 有浮层开着（底栏自己的下拉、参数面板、预设弹窗…）→ 放行，
  // 让 document 上的「点外关闭」判定能收到这一次点击。
  if (document.querySelector('[data-dismissable-layer]')) return
  e.stopPropagation()
}

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

// —— 最左侧 @ 按钮 ——
function insertAt(): void {
  editorComponentRef.value?.insertText?.('@')
}

// —— 预设提示词（用户 2026-11-06） ——
/**
 * 把预设正文填进输入框。
 *
 * 输入框已有内容时**接在后面**，不覆盖用户正在写的东西：
 * 用户选预设多半是「先有这半句，再加一段固定要求」。
 * 走 editor 的 setText（按行拆段落），比 insertText 稳 —— 后者插不了换行。
 */
/**
 * 把预设正文放进输入框。
 *
 * mode（用户 2026-11-09）：'append' 接在现有内容后面（默认，保持旧行为）；
 * 'replace' 清空后只留这条预设。
 */
function applyPreset(content: string, mode: 'append' | 'replace' = 'append'): void {
  const editor = editorComponentRef.value
  if (mode === 'replace') {
    if (editor?.setText) {
      editor.setText(content)
      editor.focusEnd?.()
      return
    }
    onPromptUpdate(content)
    return
  }
  if (editor?.setText) {
    // 读编辑器里**实际**的正文，而不是组件状态：两者正常同步，但以输入框里看到的为准
    const current = (editor.exportText?.() ?? prompt.value).trim()
    editor.setText(current ? current.replace(/\s+$/, '') + '\n\n' + content : content)
    editor.focusEnd?.()
    return
  }
  // 编辑器还没挂上（极短的一瞬）：至少把正文写进状态，下次渲染会带上
  const next = prompt.value.trim() ? prompt.value.replace(/\s+$/, '') + '\n\n' + content : content
  onPromptUpdate(next)
}

/** 本节点当前可用的动作 id（预设判「禁用」用） */
const availableActionIds = computed(() => actions.value.map((a) => a.id))
/** 新建预设时能选的模型清单（名字 + 该模型自己的参数定义） */
const modelChoices = computed(() =>
  actions.value
    .filter((a) => (a.needsPrompt ?? false) || (a.fields?.length ?? 0) > 0)
    .map((a) => ({
      id: a.id,
      title: a.title,
      params: (a.fields ?? []) as ToolParamDef[],
      /** provider 的 icon 一路带到弹窗：那边的选择器也要长同一副样子 */
      icon: a.icon,
      types: a.types,
      templates: a.templates ?? [],
      /** provider 自带 HTML 参数面板（底栏「参数」下拉渲染的就是它）；弹窗复用同一份 */
      panelHtml: (a as { panelHtml?: string }).panelHtml ?? '',
    })),
)

/**
 * 应用「带模型 / 参数」的预设：先切到它的模型（若当前节点有这个模型），
 * 再把参数与提示词一起写进去 —— 用户点一条预设，期望的是「配置整个切过去」。
 */
function applyTypedPreset(preset: PromptPreset): void {
  if (preset.actionId && availableActionIds.value.includes(preset.actionId)) {
    selectAction(preset.actionId)
  }
  if (preset.values) {
    // 等切模型的默认值写完之后再覆盖，避免被 selectAction 重置掉
    void nextTick(() => onPanelValues({ ...preset.values }))
  }
  if (preset.content.trim()) applyPreset(preset.content, preset.applyMode ?? 'append')
}

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
      @pointerdown="onRootPointerDown"
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

      <!-- 没有输入框的动作：HTML 面板直接占输入框那一行（用户口径：面板就渲染在输入框位置） -->
      <HtmlPanelFrame
        v-if="useHtmlPanel && !showEditor"
        :html="panelHtml"
        :values="values"
        :params="paramDefs"
        :action-id="currentId"
        :model="currentActionLabel"
        :node-type="nodeType"
        :disabled="running"
        :theme="htmlPanelTheme"
        :max-height="240"
        class="nb-panel-inline"
        @set-values="onPanelValues"
        @run="onRun"
        @notify="onPanelNotify"
      />

      <BottomBarPromptEditor
        v-if="showPromptEditor"
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
        :current-model-icon="currentModelIcon"
        :running="running"
        :param-defs="paramDefs"
        :hide-params="useHtmlPanel"
        :panel-html="useHtmlPanel && showEditor ? panelHtml : ''"
        :panel-theme="htmlPanelTheme"
        :values="values"
        :ai-buttons="aiButtons"
        :ai-running-id="aiRunningId"
        :ai-error="aiError"
        :show-editor="showPromptEditor"
        :char-count="charCount"
        :char-limit="CHAR_LIMIT"
        :invalid-hint="invalidHint"
        :can-run="useAgentModelsEffective ? Boolean(agentChoice) : canRun"
        :submitted="submitted"
        :current-action-title="currentAction?.title ?? ''"
        :icon-warn="ICON_WARN"
        :icon-send="ICON_SEND"
        :action-options="actionOptions"
        :has-model-picker="useAgentModelsEffective || choicePickerAvailable"
        @action-picked="onActionPicked"
        @field-change="onFieldChange"
        @panel-values="onPanelValues"
        @panel-notify="onPanelNotify"
        @ai-click="runAiAction"
        @insert-at="insertAt"
        @run="onRun"
      >
        <template #model-picker>
          <BottomBarModelPicker
            v-if="useAgentModelsEffective"
            :models="agentChat.availableModels()"
            :model="agentChoice"
            :disabled="running"
            @pick="onAgentModelPicked"
          />
          <!-- 图片 / 视频：同一套卡片 + 分栏面板，但选的是生成动作（带参数） -->
          <BottomBarChoicePicker
            v-if="!useAgentModelsEffective && choicePickerAvailable"
            :options="actionChoices"
            :current-id="currentId"
            :current-label="currentActionLabel"
            :current-model-icon="currentModelIcon"
            :disabled="running"
            @pick="onActionPicked"
          />
        </template>
        <template #presets>
          <BottomBarPresets
            :disabled="aiEditorLocked"
            :node-type="nodeType"
            :has-target="showPromptEditor"
            :available-ids="availableActionIds"
            :model-choices="modelChoices"
            :current-id="currentId"
            @apply="applyPreset"
            @apply-preset="applyTypedPreset"
          />
        </template>
      </BottomBarActions>

      <BottomBarSettingsPanel :settings-open="settingsOpen" />
    </div>
  </div>
  </Teleport>
</template>
