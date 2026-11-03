/**
 * AgentConversation 的控制器（纯拆分产物）。
 *
 * 原组件 script 的语句与注册顺序原样搬入；只把顶层绑定集中返回，
 * 供入口与子组件共享同一份状态。不要在这里改行为。
 */
/**
 * AgentConversation —— 对话**内容**（消息流 + 输入区）。外壳在 packages/ui。
 *
 * 分工：外壳管位置/尺寸/拖拽/停靠，本组件只管红框里那一块。
 * 布局与数值逐项对齐 LiBTV（Chrome MCP 实测）：
 *   面板底 #212121 = --ui-overlay-solid；边框 #363636 = --ui-line；
 *   正文/输入 14px、行高 24px；图标 #919191 = --ui-ink-dim；
 *   输入框 = 圆角 16 + 1px --ui-line + 内边距 8 + 上下间距 8；
 *   工具条高 32、间距 3px；发送键 32×32 圆角 12（白底深字）。
 *
 * 两处刻意的设计：
 *  ① 下拉一律用 shadcn 的 DropdownMenu 分离件，不自绘浮层 ——
 *    定位/翻边/出屏收进/点外关闭都由 reka-ui 统一负责。
 *  ② 技能 / MCP / 节点是**输入框内联标签**：点下拉里的一项 = 往正文插一个标记 chip，
 *    引用了谁由正文里的标记决定 —— 删掉 chip 引用即失效，不再切开关。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useUiComponent, useCanvasRender } from '@mini-canvas/canvas-render'
// 输入框工具行与发送键使用主题登记的 shadcn Button；两个下拉的**内容 UI 不改**，只换触发按钮。
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import { useAgent } from '../../useAgent.js'
import { useStickyScroll } from '../../useStickyScroll.js'
// ICON_SKILL / ICON_MCP 由模板直接 v-html（@ 下拉里的菜单卡片头图）；解析那一段已搬去 userSegments。
import { ICON_SKILL, ICON_MCP } from '../../agentResources.js'
import { DEFAULT_SUBMIT_KEY_MODE, isSubmitShortcut, normalizeSubmitKeyMode, shouldDeferEnterToMenu, loadSubmitKeyMode, type SubmitKeyMode } from '../../composerKeys.js'
import { pagerAnchors, type PagerGroup } from '../../branchNav.js'
import { loadQueueShowSending } from '../../queuePrefs.js'
import { useAgentAttachments } from './useAgentAttachments.js'
import { useAgentEarlierTurns } from './useAgentEarlierTurns.js'
import { useAgentMcpPanel } from './useAgentMcpPanel.js'
import { useAgentMessageEditing } from './useAgentMessageEditing.js'
import { useAgentMessageViews } from './useAgentMessageViews.js'
import { useAgentEditing } from './useAgentEditing.js'
import { useAgentMenus } from './useAgentMenus.js'
import { useAgentNotify } from './useAgentNotify.js'
import { useAgentResources } from './useAgentResources.js'
import { segClickable, segTitle } from '../../userSegments.js'
import { formatToken, budgetTokenText, goalMarkText } from '../../queueModel.js'
import { brandSvg } from '../../modelBrandIcons.js'

/** 对话内容用到的完整控制器形状（由 useAgentConversation 的返回值推导）。 */
export type AgentConversationController = ReturnType<typeof useAgentConversation>

export function useAgentConversation() {

const agent = useAgent()
const s = agent.state

/** 画布上下文：节点 @ 引用与「点标签聚焦节点」都要它（doc / view） */
const { ctx } = useCanvasRender()
const Button = useUiComponent('Button')
const Badge = useUiComponent('Badge')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
const InputGroup = useUiComponent('InputGroup')
const InputGroupAddon = useUiComponent('InputGroupAddon')
const InputGroupButton = useUiComponent('InputGroupButton')
const InputGroupInput = useUiComponent('InputGroupInput')
const Tabs = useUiComponent('Tabs')
const TabsList = useUiComponent('TabsList')
const TabsTrigger = useUiComponent('TabsTrigger')
const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')

/**
 * 上下文环的几何常量（照参考页实测：viewBox 12×12、半径 5.25、描边 1.5）。
 * 周长直接由 r 算，不写死数字 —— 以后想调大小只改半径，弧长自动跟上。
 */
const CONTEXT_R = 5.25
const CONTEXT_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_R

/**
 * 「压缩」动作项的图标（Lucide minimize-2 同款：两条向内的箭头）。
 *
 * 为什么内联 SVG 而不是从 lucide 组件取：@ 菜单的行是由编辑器直接造 DOM 渲染的
 * （renderItem 返回 VNode，但图标在菜单里就是一段 innerHTML），与技能 / MCP 的
 * ICON_SKILL / ICON_MCP 同一条路 —— 那两枚也在 agentResources 里以字符串形式存着。
 */
const ICON_COMPACT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'

/**
 * 已用弧的 dashoffset = 周长 × 剩余比例 —— dashoffset 越大弧越短。
 * 于是「剩余 96%」画出来就是一段 4% 的弧，圈基本是空的（与参考图一致）。
 * 用界面显示的那个整数算，保证环与「上下文剩余 96%」这句话永远对得上。
 */
const contextArcOffset = computed(() => {
  const left = s.contextLeft
  if (left === null) return CONTEXT_CIRCUMFERENCE
  return CONTEXT_CIRCUMFERENCE * (Math.min(100, Math.max(0, left)) / 100)
})

const {
  MediaViewer,
  prompt,
  attached,
  SHOW_PROCESS_NOTICE,
  fileInput,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  pickImages,
  onFilesPicked,
  readAsDataUrl,
  removeAttachment,
  previewImage,
  previewKind,
  previewList,
  openPreview,
  previewToolMedia,
  previewItem,
  onPaste,
  addFile,
} = useAgentAttachments(s)

const scroller = ref<HTMLElement | null>(null)
const {
  earlierSentinel,
  earlierObserver,
  lastEarlierLoadAt,
  earlierRetryTimer,
  EARLIER_INTERVAL_MS,
  teardownEarlierSentinel,
  maybeLoadEarlier,
  setupEarlierSentinel,
} = useAgentEarlierTurns(agent, s, scroller)
/** 编辑器暴露的方法（组件库 defineExpose 的方法在实例类型里未声明）。 */
type ProseMirrorEditorExposed = InstanceType<typeof ProseMirrorEditor> & {
  insertResource(item: ResourceItem): void
  setText(text: string): void
  menuOpen?: boolean
}
const editorRef = ref<ProseMirrorEditorExposed | null>(null)
/**
 * 提交键（全局设置 → 发送键；用户口径 2026-10-25）：默认 Ctrl+回车。
 * 真源在后台 KV（config/agentComposerPrefs），这里只留一份**只读快照**给按键判定用。
 */
const submitKeyMode = ref<SubmitKeyMode>(DEFAULT_SUBMIT_KEY_MODE)
const openThinking = ref<Record<string, boolean>>({})
/** 顶部那条「我能帮你做很多事」提示；点 ✕ 后本次打开不再显示 */
const hintDismissed = ref(false)
/** 各下拉各自开合（互斥由 dropdown 自己保证：同屏只留一个） */
const modeOpen = ref(false)
const authOpen = ref(false)
const modelOpen = ref(false)
const skillOpen = ref(false)
const mcpOpen = ref(false)
/** 「+」两项菜单（目标 / 上传文件） */
const plusOpen = ref(false)

/**
 * 输入区所有下拉的统一位置参数（用户口径 2026-11-02）：
 * 一律从按钮**向上**弹出、水平**居中**，且离按钮的距离一致。
 *
 * 之前每个菜单各写各的：align 有 start 也有 end，side-offset 有 8 / 10 / 18；
 * 同一排按钮点开，菜单一个贴左、一个贴右、一个离得远，看起来像没对齐。
 * 收成一份常量，改一处就会一起变，也不用再逐个比对。
 */
const COMPOSER_MENU_SIDE = 'top' as const
const COMPOSER_MENU_ALIGN = 'center' as const
const COMPOSER_MENU_OFFSET = 10

/**
 * 输入区菜单「同一时刻只开一个」。
 *
 * 每个 DropdownMenu 各自 v-model:open，reka 只保证点到外面会关，不会替你关掉
 * **另一个**已经开着的菜单。实测（2026-11-02）：先开「创作模式」再点「选择模型」，
 * 两个菜单会同时挂在 body 上，AI 面板上就叠出两层浮层。
 *
 * 收成一个 open flag：任何一个要打开，先把其余五个关掉；关的时候只动自己。
 */
type ComposerMenuKey = 'plus' | 'mode' | 'auth' | 'model' | 'skill' | 'mcp'
const COMPOSER_MENU_FLAGS: Record<ComposerMenuKey, Ref<boolean>> = {
  plus: plusOpen,
  mode: modeOpen,
  auth: authOpen,
  model: modelOpen,
  skill: skillOpen,
  mcp: mcpOpen,
}

function composerMenuOpen(key: ComposerMenuKey): boolean {
  return COMPOSER_MENU_FLAGS[key].value
}

function setComposerMenuOpen(key: ComposerMenuKey, open: boolean): void {
  if (open) {
    for (const [other, flag] of Object.entries(COMPOSER_MENU_FLAGS)) {
      if (other !== key) flag.value = false
    }
  }
  COMPOSER_MENU_FLAGS[key].value = open
}

/**
 * 工具行按钮的 pointerdown：先把其它菜单收掉，**再主动打开自己**。
 *
 * 只关不开会丢一次点击：A 开着时，A 的「点外面」层会在 pointerdown 关掉 A，
 * 浏览器随后认为这次点击已经处理完，B 的 click 就不再触发 ——
 * 用户看到的就是「点第二个菜单没反应，要点两次」。这里在 pointerdown 里直接开 B，
 * 一次按下就能切换。
 */
function switchComposerMenu(key: ComposerMenuKey): void {
  // 再点同一个按钮 = 收起（和原生下拉一致）；点另一个 = 直接切过去。
  setComposerMenuOpen(key, !COMPOSER_MENU_FLAGS[key].value)
}

function dismissHint(): void {
  hintDismissed.value = true
}

const {
  mcpProbing,
  mcpProbeHint,
  mcpStatus,
  mcpTools,
  mcpStatusOf,
  mcpServerDesc,
  mcpTransport,
  mcpToolCount,
  mcpToolsOf,
  mcpExpanded,
  toggleMcpExpand,
  mcpPickedServers,
  mcpPickedTools,
  mcpToolKey,
  toggleMcpServer,
  toggleMcpTool,
  pickedToolCountOf,
  mcpPickTotal,
  confirmMcpPicks,
  probeMcpServers,
  runMcpProbe,
  mcpProbedOnce,
  ensureMcpProbed,
} = useAgentMcpPanel(agent, s, editorRef)

onMounted(() => {
  void agent.refresh()
  // 两个全局设置都读一次（后台对话开关在这里只作"设置页"的值来源，退出时也不用它，
  // 反正组件不订阅别的 config 键）
  void Promise.all([loadGoalDefaults(), refreshNotifyPrefs(), loadQueueShowSending({ baseUrl: s.baseUrl }).then((v) => (showSendingQueue.value = v))])
  void loadSubmitKeyMode({ baseUrl: s.baseUrl }).then((m) => (submitKeyMode.value = m))
  // 常驻订阅不在这里接：refresh() → restoreCurrentSession() 装载完会话后自己会接
  // （那里拿到的才是"当前会话"的正确 id）。这里再接一次只会用**刷新前遗留的旧 id**
  // 先占住流句柄，后面真正该接的那次被 "已经有流了" 挡掉（真机实测踩到的坑）。
})

// 「发送中显示队列」设置页翻开关 ⇒ 同页立即生效（评审抓到：只在挂载时读一次，
// 已打开的对话面板不会跟着变）。KV 的跨标签页同步归 agentSettings 管，这里只管本页。
function onQueuePrefsChanged(e: Event): void {
  const d = (e as CustomEvent).detail as { showSending?: unknown } | undefined
  if (d && typeof d.showSending === 'boolean') showSendingQueue.value = d.showSending
}
onMounted(() => window.addEventListener('mini-canvas:agent-queue-prefs-changed', onQueuePrefsChanged))
onBeforeUnmount(() => window.removeEventListener('mini-canvas:agent-queue-prefs-changed', onQueuePrefsChanged))

// 「发送键」设置页改完 ⇒ 同页立即生效（与上面队列开关同一套：设置页发本地广播；
// 跨标签页的那份由 agentSettings 自己的 KV 订阅负责）。
function onComposerPrefsChanged(e: Event): void {
  const d = (e as CustomEvent).detail as { submitKeyMode?: unknown } | undefined
  if (d && d.submitKeyMode !== undefined) submitKeyMode.value = normalizeSubmitKeyMode(d.submitKeyMode)
}
onMounted(() => window.addEventListener('mini-canvas:agent-composer-prefs-changed', onComposerPrefsChanged))
onBeforeUnmount(() => window.removeEventListener('mini-canvas:agent-composer-prefs-changed', onComposerPrefsChanged))

onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return
  bubbleRO = new ResizeObserver(() => scheduleMeasureUserBubbles())
  measureUserBubbles()
})

onBeforeUnmount(() => {
  bubbleRO?.disconnect()
  bubbleRO = undefined
  userBubbleBodies.clear()
})

/**
 * 流输出自动吸底（逻辑全在 useStickyScroll 里，本组件只提供两样东西）：
 *   ① 滚动容器 ref；② 一个「内容变了」的信号 —— 消息数 + 已生成字数。
 *
 * 为什么信号要带上**字数**：流式增量只往最后一条里加字，消息数不变，
 * 只有看字数才能感知「新一轮文字进来了」。至于「已有气泡被撑高」那种情况，
 * 由 useStickyScroll 内部的内容尺寸观察兜住。
 */
const streamSignal = computed(() =>
  s.turns.length + ':' + s.turns.reduce((n, t) => n + (t.text?.length ?? 0) + (t.thinking?.length ?? 0), 0),
)
const { scrollToBottom: stickToBottom, showScrollToBottom, smoothScrollToBottom } = useStickyScroll({
  target: scroller,
  signal: () => streamSignal.value,
  threshold: 48,
})
let bubbleRO: ResizeObserver | undefined

const {
  nodeList,
  nodeSub,
  nodeNameOf,
  syncNodes,
  focusNode,
  editorResources,
  compactActionItems,
  insertPendingNodeRefs,
  insertPendingResource,
  insertPendingResources,
  insertRef,
  compactNow,
  SUGGESTIONS,
  useSuggestion,
  userSegments,
  displayUserText,
  onSegClick,
  emitRefClick,
} = useAgentResources(agent, s, { ctx, editorRef, prompt, ICON_COMPACT })

const {
  USER_BUBBLE_MAX_LINES,
  openUserBubbles,
  overflowingUser,
  toggleUserBubble,
  userBubbleBodies,
  measureScheduled,
  scheduleMeasureUserBubbles,
  measureUserBubbles,
  setUserBubbleBody,
  assistantRows,
  openToolGroups,
  toggleToolGroup,
  toolGroupTitle,
  openTools,
  toggleTool,
  hasCardView,
  toolSummary,
  toolRowSummary,
  viewCache,
  viewOf,
  resetViewCaches,
} = useAgentMessageViews({
  unobserve: (el) => bubbleRO?.unobserve(el),
  observe: (el) => bubbleRO?.observe(el),
})

const {
  resetEditStates: resetMessageEditStates,
  copied,
  msgTimeText,
  msgTimeTitle,
  copyMessage,
  editIntoComposer,
  beginEditMessage,
  scrollToEditing,
  editingKind: messageEditingKind,
  editingKindText,
  cancelEditing,
  segmentByAnchor,
  segmentModelLabel,
  hasInlineError,
  pagerTarget,
} = useAgentMessageEditing(
  agent,
  s,
  {
    editorRef,
    prompt,
    attached,
    getEditingItems: () => editingItems,
    getEditingGoal: () => editingGoal,
    getCancelAllEditsExcept: () => cancelAllEditsExcept,
    getCancelEditGoal: () => cancelEditGoal,
  },
)
watch(() => s.sessionId, () => {
  resetViewCaches()
  resetMessageEditStates()
})
const resetEditStates = resetMessageEditStates
const editingKind = messageEditingKind

const {
  editingItems,
  showSendingQueue,
  queueView,
  queue,
  onQueueReorder,
  queueBlocked,
  pending,
  goalMark,
  UNIT_KEY,
  tokenUnit,
  toggleTokenUnit,
  goalDefaultBudget,
  loadGoalDefaults,
  addGoalMark,
  clearGoalMark,
  editingGoal,
  cancelAllEditsExcept,
  beginEditGoal,
  cancelEditGoal,
  startEditGoalRow,
  goalText,
  goalRow,
  onGoalEditFocus,
  commitGoalBudget,
  onGoalBudgetKeydown,
  onGoalBudgetBlur,
  sendMode,
  showPendingOn,
  steerItem,
  removeItem,
  closeItem,
  beginEditQueue,
  cancelEditQueue,
  updateEditingQueueItem,
  toggleQueuePause,
  rowMenuId,
  hoverRowId,
  onKeydown,
} = useAgentEditing(agent, s, {
  prompt,
  attached,
  previewImage,
  plusOpen,
  modeOpen,
  authOpen,
  modelOpen,
  skillOpen,
  mcpOpen,
  editIntoComposer,
})

/**
 * 分页器**跟随消息**的锚点（用户口径 2026-10-07）：
 * userOrdinal = 第几条用户消息（0 基）在当前位置被编辑过；
 * 分页器插在那条用户消息**整块回复**结束处（下一条用户消息之前 / 列表末尾）。
 * 返回 turnId -> PagerGroup（模板在对应回合后面渲染）。
 */
const pagerByAnchor = computed(() => pagerAnchors(s.turns, s.pagers))

const {
  usableModels,
  modelQuery,
  modelView,
  modelPlatform,
  skillQuery,
  skillView,
  mcpQuery,
  setModelView,
  setSkillView,
  skillCategory,
  modelNote,
  isModelPicked,
  platformOf,
  brandNameOf,
  brandSvgOf,
  skillCoverStyle,
  modelPlatformGroups,
  filteredModels,
  filteredSkills,
  SKILL_CATEGORIES,
  skillMetaCache,
  skillMetaOf,
  skillCategoryRows,
  skillFileCount,
  skillSize,
  filteredMcpResources,
  modelScrollRef,
  scrollSelectedModelIntoView,
  scheduleScrollSelectedModel,
  modelBoxObserver,
  modelBoxResizeTimer,
  observeModelBox,
  pickModel,
  promptPresets,
  activePrompt,
  modeLabel,
  pickMode,
} = useAgentMenus(agent, s, { modelOpen, mcpOpen, mcpToolsOf, ensureMcpProbed })

const {
  AUTH_MODES,
  authMode,
  setAuthMode,
  notifyDismissed,
  notifyPermission,
  showNotifyTip,
  enableNotify,
  notifyPrefs,
  refreshNotifyPrefs,
  notifySummary,
  onRoundDone,
  onQueueIdle,
  roundDoneTimer,
  queueAtRunStart,
} = useAgentNotify(agent, s, { queue })

/**
 * 输入框提交键：**Ctrl / Cmd + Enter 才提交**，单独 Enter 只换行（用户口径 2026-10-11）。
 *
 * 为什么不再用模板上的 `@keydown.enter.exact`：那条读起来像「回车就发」，
 * 实际行为是「任何没按修饰键的回车都发」——用户按错一下就把半截话送出去了。
 * 判定收进 composerKeys.isSubmitShortcut（含输入法合成态），这里只做转发。
 */
function onEditorKeydown(e: KeyboardEvent): void {
  /**
   * 为什么这个处理器必须挂在**捕获阶段**（模板上是 @keydown.capture）：
   *
   * 回车有两个人抢 —— @ 下拉（选中一项）与提交。ProseMirror 的菜单处理在**内层**，
   * 组件的处理在**外层**；若在冒泡阶段读 `menuOpen`，菜单选中后已把自己关掉，
   * 组件读到的是 false，「让给菜单」的判定落空 → **既选中又发送**（用户 2026-10-26 报的重合）。
   * 捕获阶段在 ProseMirror 之前跑，读到的是按键那一刻的真实状态：
   *
   *   ① 菜单开着 ⇒ 回车归菜单：放行（不 preventDefault / 不 stopPropagation），
   *      让 ProseMirror 去选中当前项；
   *   ② 菜单关着且命中提交键 ⇒ 在捕获阶段就拦下（preventDefault + stopPropagation），
   *      不让 ProseMirror 再处理这次回车（否则会先插一个换行/空段落）。
   */
  if (shouldDeferEnterToMenu(e, !!editorRef.value?.menuOpen)) return
  // ② 其余情况按「全局设置 → 发送键」里选的那一种回车提交。
  if (e.key !== 'Enter') return
  if (!isSubmitShortcut(e, submitKeyMode.value)) return
  e.preventDefault()
  e.stopPropagation()
  submit()
}

function submit(): void {
  const text = prompt.value.trim()
  const pics = [...attached.value]
  // 只有图、没打字也算合法的一条（"这图里是什么"这种问法很常见）
  if (!text && !pics.length) return
  prompt.value = ''
  attached.value = []
  modeOpen.value = modelOpen.value = skillOpen.value = mcpOpen.value = authOpen.value = false
  plusOpen.value = false
  // 一条正在编辑的**队列消息**：发送 = 原位替换那一条（设计 §3.3.4 / G3 —— 不换位置、不新起一条）
  const editingItem = queue.value.editingId
  if (editingItem) {
    void updateEditingQueueItem(editingItem, text, pics)
  } else if (editingGoal.value) {
    // 编辑**已有目标**：只改它的内容（用户口径 2026-10-09）—— 不新建目标、不进队列。
    // 预算一并带上（用户可能在草稿标记里改了预算）。下一轮生效（stop.mjs 每轮读 GOAL.json）。
    const b = goalMark.value?.budget ?? s.goal?.budget ?? -1
    void agent.updateGoal({ objective: text, budget: b > 0 ? b : -1 })
    // 参考图也跟着更新（目标行迷你预览用）；没带图 = 清掉
    if (s.goal) s.goalImages = pics
    void agent.setGoalImages(pics)
    editingGoal.value = false
    agent.clearGoalMark()
  } else if (goalMark.value) {
    // 有目标标记：跑着时进队列（条目里带 goal，轮到它时按目标模式起）；
    // 空闲时直接按目标模式起一轮（目标消息不进队列，见 agentService.sendGoal 的分工）
    void (s.running ? agent.sendToQueue(text, pics.length ? pics : undefined) : agent.sendGoal(text, pics.length ? pics : undefined))
  } else if (s.running) {
    // 跑着的时候发送 = **进队列**（设计 G1/G2），不再像以前那样把这条丢掉
    void agent.sendToQueue(text, pics.length ? pics : undefined)
  } else if (queue.value.rows.some((r) => !r.sent)) {
    // 队列里已有排着的任务（含**暂停**状态）⇒ 新消息**一律入队**（用户口径 2026-10-16）：
    // 以前只看"有没有会话在跑" —— 暂停时没有会话在跑，新消息被直发到对话里，
    // 插到已排任务的前面，打乱队列顺序。只要队列里还有排队条目（queued/editing/
    // sending），新消息就排在它们后面按序走。
    void agent.sendToQueue(text, pics.length ? pics : undefined)
  } else {
    // 空闲：和以前一样直接发
    void agent.send(text, pics.length ? pics : undefined)
  }
  // 自己发的消息必须能看见：无视之前的吸附状态，直接到底。
  // （用户如果先往上翻着看历史，然后发一句 —— 不这样做就会看不到自己刚发的内容。）
  void nextTick(() => stickToBottom())
}

function toggleThinking(id: string): void {
  openThinking.value[id] = !openThinking.value[id]
}

/**
 * Esc 走**捕获阶段**（第三个参数 true）。
 *
 * 为什么不能用冒泡：焦点在输入编辑器里时，ProseMirror 会在自己那层把 Esc 吃掉
 * （它要用来关自己的 @ 菜单等等），事件根本传不到 document 的冒泡监听 ——
 * 实测「目标编辑框开着、光标还在输入框里，按 Esc 关不掉」就是这么来的。
 * 捕获阶段先于编辑器拿到事件，模态的 Esc 才真的可靠。
 */
onMounted(() => document.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown, true))

  return {
    agent,
    s,
    ctx,
    Button,
    Badge,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
    Tabs,
    TabsList,
    TabsTrigger,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
    CONTEXT_R,
    CONTEXT_CIRCUMFERENCE,
    ICON_COMPACT,
    contextArcOffset,
    MediaViewer,
    prompt,
    attached,
    SHOW_PROCESS_NOTICE,
    fileInput,
    MAX_IMAGES,
    MAX_IMAGE_BYTES,
    pickImages,
    onFilesPicked,
    readAsDataUrl,
    removeAttachment,
    previewImage,
    previewKind,
    previewList,
    openPreview,
    previewToolMedia,
    previewItem,
    onPaste,
    addFile,
    scroller,
    earlierSentinel,
    earlierObserver,
    lastEarlierLoadAt,
    earlierRetryTimer,
    EARLIER_INTERVAL_MS,
    teardownEarlierSentinel,
    maybeLoadEarlier,
    setupEarlierSentinel,
    editorRef,
    submitKeyMode,
    openThinking,
    hintDismissed,
    modeOpen,
    authOpen,
    modelOpen,
    skillOpen,
    mcpOpen,
    plusOpen,
    COMPOSER_MENU_SIDE,
    COMPOSER_MENU_ALIGN,
    COMPOSER_MENU_OFFSET,
    COMPOSER_MENU_FLAGS,
    composerMenuOpen,
    setComposerMenuOpen,
    switchComposerMenu,
    dismissHint,
    mcpProbing,
    mcpProbeHint,
    mcpStatus,
    mcpTools,
    mcpStatusOf,
    mcpServerDesc,
    mcpTransport,
    mcpToolCount,
    mcpToolsOf,
    mcpExpanded,
    toggleMcpExpand,
    mcpPickedServers,
    mcpPickedTools,
    mcpToolKey,
    toggleMcpServer,
    toggleMcpTool,
    pickedToolCountOf,
    mcpPickTotal,
    confirmMcpPicks,
    probeMcpServers,
    runMcpProbe,
    mcpProbedOnce,
    ensureMcpProbed,
    onQueuePrefsChanged,
    onComposerPrefsChanged,
    streamSignal,
    stickToBottom,
    showScrollToBottom,
    smoothScrollToBottom,
    nodeList,
    nodeSub,
    nodeNameOf,
    syncNodes,
    focusNode,
    editorResources,
    compactActionItems,
    insertPendingNodeRefs,
    insertPendingResource,
    insertPendingResources,
    insertRef,
    compactNow,
    onEditorKeydown,
    submit,
    toggleThinking,
    USER_BUBBLE_MAX_LINES,
    openUserBubbles,
    overflowingUser,
    toggleUserBubble,
    userBubbleBodies,
    bubbleRO,
    measureScheduled,
    scheduleMeasureUserBubbles,
    measureUserBubbles,
    setUserBubbleBody,
    assistantRows,
    openToolGroups,
    toggleToolGroup,
    toolGroupTitle,
    openTools,
    toggleTool,
    hasCardView,
    toolSummary,
    toolRowSummary,
    viewCache,
    viewOf,
    resetViewCaches,
    resetEditStates,
    copied,
    msgTimeText,
    msgTimeTitle,
    copyMessage,
    editIntoComposer,
    beginEditMessage,
    scrollToEditing,
    editingKind,
    editingKindText,
    cancelEditing,
    segmentByAnchor,
    segmentModelLabel,
    hasInlineError,
    pagerTarget,
    editingItems,
    showSendingQueue,
    queueView,
    queue,
    onQueueReorder,
    queueBlocked,
    pending,
    goalMark,
    UNIT_KEY,
    tokenUnit,
    toggleTokenUnit,
    goalDefaultBudget,
    loadGoalDefaults,
    addGoalMark,
    clearGoalMark,
    editingGoal,
    cancelAllEditsExcept,
    beginEditGoal,
    cancelEditGoal,
    startEditGoalRow,
    goalText,
    goalRow,
    onGoalEditFocus,
    commitGoalBudget,
    onGoalBudgetKeydown,
    onGoalBudgetBlur,
    sendMode,
    showPendingOn,
    steerItem,
    removeItem,
    closeItem,
    beginEditQueue,
    cancelEditQueue,
    updateEditingQueueItem,
    toggleQueuePause,
    rowMenuId,
    hoverRowId,
    pagerByAnchor,
    onKeydown,
    usableModels,
    modelQuery,
    modelView,
    modelPlatform,
    skillQuery,
    skillView,
    mcpQuery,
    setModelView,
    setSkillView,
    skillCategory,
    modelNote,
    isModelPicked,
    platformOf,
    brandNameOf,
    brandSvgOf,
    skillCoverStyle,
    modelPlatformGroups,
    filteredModels,
    filteredSkills,
    SKILL_CATEGORIES,
    skillMetaCache,
    skillMetaOf,
    skillCategoryRows,
    skillFileCount,
    skillSize,
    filteredMcpResources,
    modelScrollRef,
    scrollSelectedModelIntoView,
    scheduleScrollSelectedModel,
    modelBoxObserver,
    modelBoxResizeTimer,
    observeModelBox,
    pickModel,
    promptPresets,
    activePrompt,
    modeLabel,
    pickMode,
    AUTH_MODES,
    authMode,
    setAuthMode,
    notifyDismissed,
    notifyPermission,
    showNotifyTip,
    enableNotify,
    notifyPrefs,
    refreshNotifyPrefs,
    notifySummary,
    onRoundDone,
    onQueueIdle,
    roundDoneTimer,
    queueAtRunStart,
    SUGGESTIONS,
    useSuggestion,
    userSegments,
    displayUserText,
    onSegClick,
    segClickable,
    segTitle,
    formatToken,
    budgetTokenText,
    goalMarkText,
    brandSvg,
    emitRefClick,
  }
}

