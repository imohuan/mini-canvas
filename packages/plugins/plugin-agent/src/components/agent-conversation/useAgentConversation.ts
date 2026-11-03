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
import { computed, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type Ref } from 'vue'
import {
  ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X, Loader2, Sparkles, Plus, Box,
  WandSparkles, Plug, BellRing, ShieldCheck, Zap, CircleCheck,
  RefreshCw, Hand, ShieldAlert, Copy, Pencil,
  Search,
  Check, Layers,
  Pause, Play, Target, Trash2, CornerUpRight, MoreHorizontal, Upload,
  Minimize2, AlertCircle, GripVertical, CircleSlash,
} from 'lucide-vue-next'
import { VueDraggable } from 'vue-draggable-plus'
import { useUiComponent, useCanvasRender } from '@mini-canvas/canvas-render'
// 输入框工具行与发送键使用主题登记的 shadcn Button；两个下拉的**内容 UI 不改**，只换触发按钮。
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import { useAgent } from '../../useAgent.js'
import { useStickyScroll } from '../../useStickyScroll.js'
import { groupTurnBlocks, type TurnRow } from '../../turnBlocks.js'
import { scrollTopForVisibleItem } from '../../selectionScroll.js'
import { brandName, brandSvg, detectPlatform } from '../../modelBrandIcons.js'
// ICON_SKILL / ICON_MCP 由模板直接 v-html（@ 下拉里的菜单卡片头图）；解析那一段已搬去 userSegments。
import { skillResources, mcpResources, mcpToolResource, nodeResources, assetResource, assetResources, ICON_SKILL, ICON_MCP, type AssetRefOpen, type CanvasNodeRow } from '../../agentResources.js'
import { parseUserSegments, segClickable, segTitle, assetRefInputOf, type UserSegment } from '../../userSegments.js'
import { stripUserSteering } from '../../userSteering.js'
import { REF_CLICK_EVENT, refClickPayloadOf } from '../../refClickEvents.js'
import { DEFAULT_SUBMIT_KEY_MODE, isSubmitShortcut, normalizeSubmitKeyMode, shouldDeferEnterToMenu, loadSubmitKeyMode, type SubmitKeyMode } from '../../composerKeys.js'
import { pagerAnchors, type PagerGroup } from '../../branchNav.js'
import { segmentAnchors } from '../../modelSegments.js'
import {
  queuePanelView,
  sendButtonMode,
  budgetText,
  goalMarkText,
  goalEndedBadge,
  goalIsFinished,
  usedText,
  budgetTokenText,
  formatToken,
  parseTokenText,
  type TokenUnit,
  type QueueRow,
} from '../../queueModel.js'
import type { QueueStateView } from '../../agentApi.js'
import { loadNotifyPrefs, notifyPayload, playNotifySound, showNotify, type AgentNotifyPrefs } from '../../agentNotify.js'
import { loadQueueShowSending } from '../../queuePrefs.js'
import { toolView, toolBrief, type ToolView } from '../../toolViews.js'
import type { AgentTurnView, ToolCard } from '../../sessionModel.js'

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

/** 全屏媒体查看器也走主题目录（用户消息图片 / 待发送图片点开看大图） */
const MediaViewer = useUiComponent('mediaViewer')

const prompt = ref('')
/**
 * 待发送的图片（data URL）。
 *
 * 为什么用 data URL 而不是先传到服务器换个 id：Agent 的图片入口是 SDK 的
 * imageUrlMessage，它认 URL / data URL。用 data URL 就不必再开一条上传链路，
 * 图跟着这条消息走，回放时也照样画得出来（服务端会把它一起落进转录）。
 */
const attached = ref<string[]>([])
/**
 * 要不要显示消息流里的「过程提示」（`turn.notice`，多半是「已连接 MCP：…」）。
 *
 * 用户口径（2026-10-03）：**暂时隐藏，不要删除** —— 每次对话都会冒一条，
 * 而且说不清什么时候出现（SDK 懒连接），读起来很吵。
 * MCP 的真实状态改在 MCP 下拉里按需看（那里有「检测」）。
 * 数据没丢，想看回来把它改成 `true` 即可。
 */
const SHOW_PROCESS_NOTICE = false
const fileInput = ref<HTMLInputElement | null>(null)
/** 单次消息的图片上限：多了会撑爆一次请求，也超出大多数模型的接受量 */
const MAX_IMAGES = 4
/** 单张上限（base64 后约 1.37 倍，4MB 原图 ≈ 5.5MB 请求体） */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

function pickImages(): void {
  fileInput.value?.click()
}

async function onFilesPicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  // 先清空 input：否则同一张图连选两次不会触发 change
  input.value = ''
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue
    if (attached.value.length >= MAX_IMAGES) {
      s.error = '最多一次带 ' + MAX_IMAGES + ' 张图'
      break
    }
    if (f.size > MAX_IMAGE_BYTES) {
      s.error = '「' + f.name + '」太大了（单张上限 4MB）'
      continue
    }
    try {
      attached.value = [...attached.value, await readAsDataUrl(f)]
    } catch {
      s.error = '读不了「' + f.name + '」'
    }
  }
}
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

function removeAttachment(i: number): void {
  attached.value = attached.value.filter((_, idx) => idx !== i)
}

/**
 * 点缩略图看大图：整只交给主题注册的 MediaViewer（AxImageViewer 同款：
 * 滚轮缩放 / 拖拽 / 旋转 / 翻转 / 下载 / Esc 关闭），与底栏素材卡、
 * 生成历史、资产面板共用同一份实现 —— 不再自己画遮罩。
 */
const previewImage = ref<string | null>(null)
/**
 * 预览的是什么媒体（用户口径 2026-10-13）：read_file 现在也读视频 / 音频，
 * MediaViewer 靠 kind 决定挂图片舞台还是节点插件登记的真播放器 ——
 * 不带 kind 会把视频当图片打开（一片空白）。
 */
const previewKind = ref<'image' | 'video' | 'audio'>('image')
/**
 * 预览所在的**整组图片**（用户口径 2026-10-09：预览时用 ← / → 轮播，循环）。
 * MediaViewer 本来就支持（list + index + 键盘 ←→ 取模循环），此前各调用点只传了单张。
 * 传了 list 的才有轮播；单图（如目标只有一张参考图）不显示翻页按钮。
 */
const previewList = ref<string[] | null>(null)
function openPreview(url: string, list?: string[] | null): void {
  previewImage.value = url
  previewList.value = list && list.length > 1 ? list : null
  previewKind.value = 'image'
}
/** 工具卡里的画面：地址 + 媒体种类（视频 / 音频要 MediaViewer 挂对应播放器） */
function previewToolMedia(url: string, kind?: 'image' | 'video' | 'audio'): void {
  previewKind.value = kind ?? 'image'
  previewList.value = null
  previewImage.value = url
}
const previewItem = computed(() =>
  previewImage.value
    ? {
      name: previewKind.value === 'image' ? '图片预览' : previewKind.value === 'video' ? '视频预览' : '音频预览',
      kind: previewKind.value,
      url: previewImage.value,
      ...(previewList.value ? { list: previewList.value, index: Math.max(0, previewList.value.indexOf(previewImage.value)) } : {}),
    }
    : null,
)

/** 粘贴图片（截图直接 Ctrl+V）也收：比"先存盘再选文件"顺手得多 */
function onPaste(e: ClipboardEvent): void {
  const items = [...(e.clipboardData?.items ?? [])]
  const pics = items.filter((it) => it.type.startsWith('image/'))
  if (!pics.length) return
  e.preventDefault()
  for (const it of pics) {
    const f = it.getAsFile()
    if (f) void addFile(f)
  }
}

async function addFile(f: File): Promise<void> {
  if (attached.value.length >= MAX_IMAGES) {
    s.error = '最多一次带 ' + MAX_IMAGES + ' 张图'
    return
  }
  if (f.size > MAX_IMAGE_BYTES) {
    s.error = '图片太大了（单张上限 4MB）'
    return
  }
  try {
    attached.value = [...attached.value, await readAsDataUrl(f)]
  } catch {
    s.error = '读不了这张图'
  }
}

const scroller = ref<HTMLElement | null>(null)
/**
 * 顶部哨兵（对话分页，用户口径 2026-10-15）：它进入可视区域才调 loadEarlierTurns()。
 * 两次加载之间的最小间隔 —— 哨兵常驻可视区（对话很短就占满首屏）时不会连发请求；
 * 加载完成后内容从顶部插入，要把滚动位置补回去（否则画面会跳到顶部）。
 */
const earlierSentinel = ref<HTMLElement | null>(null)
let earlierObserver: IntersectionObserver | null = null
let lastEarlierLoadAt = 0
let earlierRetryTimer: ReturnType<typeof setTimeout> | null = null
/** 两次「加载更早」之间的最小间隔（毫秒），与生成历史的 1s 同款 */
const EARLIER_INTERVAL_MS = 1000

function teardownEarlierSentinel(): void {
  earlierObserver?.disconnect()
  earlierObserver = null
  if (earlierRetryTimer) {
    clearTimeout(earlierRetryTimer)
    earlierRetryTimer = null
  }
}

function maybeLoadEarlier(): void {
  if (!s.turnsHaveBefore || s.turnsLoadingEarlier) return
  const elapsed = Date.now() - lastEarlierLoadAt
  if (elapsed < EARLIER_INTERVAL_MS) {
    if (earlierRetryTimer) clearTimeout(earlierRetryTimer)
    earlierRetryTimer = setTimeout(() => {
      earlierRetryTimer = null
      maybeLoadEarlier()
    }, EARLIER_INTERVAL_MS - elapsed)
    return
  }
  lastEarlierLoadAt = Date.now()
  // 顶部插入会让浏览器把滚动锚点顶走：先记当前可视内容到顶部的距离，
  // 装载完（DOM 更新后）把「内容顶到第一条」的增量补回 scrollLeft 无关、只补 scrollTop。
  const el = scroller.value
  const beforeHeight = el?.scrollHeight ?? 0
  const beforeTop = el?.scrollTop ?? 0
  void agent.loadEarlierTurns().then(() => {
    nextTick(() => {
      const after = scroller.value
      if (after && after.scrollHeight > beforeHeight) after.scrollTop = beforeTop + (after.scrollHeight - beforeHeight)
    })
  })
}

function setupEarlierSentinel(): void {
  teardownEarlierSentinel()
  const sentinel = earlierSentinel.value
  if (!sentinel || typeof IntersectionObserver === 'undefined') return
  earlierObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) maybeLoadEarlier()
    },
    { root: scroller.value, rootMargin: '0px 600px 0px 0px' },
  )
  earlierObserver.observe(sentinel)
}

watch(
  () => [s.turnsHaveBefore, s.turnsLoadingEarlier, s.turns.length, s.sessionId],
  () => nextTick(setupEarlierSentinel),
)

onBeforeUnmount(teardownEarlierSentinel)
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

/**
 * MCP 实时检测（下拉里那个「检测」按钮）。
 *
 * 为什么要它：SDK 的 MCP 是**懒连接**的 —— 每开一条会话，第一次 run 时才去连，
 * 连完只在那条会话里出声（原来就是消息流里那句「已连接 MCP：…」，现在隐藏了）。
 * 于是「现在到底连没连上、有哪些工具」没有一个常驻的地方能看。这里补上：
 * 点一下主动探一次（服务端走独立连接，探完就关），结果直接标在下拉每一行上。
 */
const mcpProbing = ref(false)
const mcpProbeHint = ref('')
/** 服务名 → 检测结果（好没好 / 一句说明 / 工具数） */
const mcpStatus = ref<Record<string, { ok: boolean; text: string; tools: number }>>({})
/** 服务名 → 探测到的工具清单（点「重新检测」后填；面板据此展开工具行） */
const mcpTools = ref<Record<string, Array<{ name: string; description: string; fullName: string }>>>({})

function mcpStatusOf(name: string): { ok: boolean; text: string; tools: number } | null {
  return mcpStatus.value[name] ?? null
}

/** MCP 卡片副行：优先显示地址 / 命令（区分同名服务），没有就显示传输方式 */
function mcpServerDesc(item: { id: string; value?: string }): string {
  if (item.value) return item.value
  const row = s.mcpServers.find((m) => 'mcp:' + m.name === item.id)
  const cfg = row?.config ?? {}
  return String(cfg.type ?? (cfg.command ? 'stdio' : '内置'))
}

/** MCP 卡片右侧的传输方式（还没检测过时显示，代替工具数） */
function mcpTransport(item: { id: string }): string {
  const row = s.mcpServers.find((m) => 'mcp:' + m.name === item.id)
  if (!row) return '服务'
  if (row.builtin) return '内置'
  const cfg = row.config ?? {}
  return String(cfg.type ?? (cfg.command ? 'stdio' : '服务'))
}

/** 某个服务探测到的工具数（「重新检测」后才有；没有就给 0） */
function mcpToolCount(name: string): number {
  return mcpStatusOf(name)?.tools ?? 0
}

/** 某服务展开的工具行（没探测过 / 探测失败时是空数组，卡片就不画展开区） */
function mcpToolsOf(name: string): Array<{ name: string; description: string; fullName: string }> {
  return mcpTools.value[name] ?? []
}

/** 展开的 MCP 卡片（存服务名；DEMO 的 expandedMcp） */
const mcpExpanded = ref<Set<string>>(new Set())
function toggleMcpExpand(name: string): void {
  const next = new Set(mcpExpanded.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  mcpExpanded.value = next
}

/**
 * MCP 的**待确认选择**（用户口径 2026-10-30：跟参考 HTML 一样支持多选，选完点确认才插入）。
 *
 * 为什么不在点击时直接插：服务和工具是两级、都能多选，点一下就插等于逼着用户
 * 「开面板 → 点一个 → 再开 → 再点」，中间的勾选态也没地方显示。
 * 所以这里只记「选了什么」，真正落标签在底栏那个「确认引用」上。
 */
const mcpPickedServers = ref<Set<string>>(new Set())
const mcpPickedTools = ref<Set<string>>(new Set())

function mcpToolKey(server: string, toolName: string): string {
  return server + '/' + toolName
}

function toggleMcpServer(name: string): void {
  const next = new Set(mcpPickedServers.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  mcpPickedServers.value = next
}

function toggleMcpTool(server: string, toolName: string): void {
  const key = mcpToolKey(server, toolName)
  const next = new Set(mcpPickedTools.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  mcpPickedTools.value = next
}

/** 某个服务选了几个工具（卡片上显示「已选 N 个工具」） */
function pickedToolCountOf(server: string): number {
  let n = 0
  for (const key of mcpPickedTools.value) if (key.startsWith(server + '/')) n++
  return n
}

const mcpPickTotal = computed(() => mcpPickedServers.value.size + mcpPickedTools.value.size)

/** 把勾选的服务 + 工具一次性插成标签（插之前不清勾选，插完清） */
function confirmMcpPicks(close: () => void): void {
  const items: ResourceItem[] = []
  const allServers = mcpResources(s.mcpServers)
  for (const name of mcpPickedServers.value) {
    const item = allServers.find((x) => x.name === name)
    if (item) items.push(item)
  }
  for (const key of mcpPickedTools.value) {
    const cut = key.indexOf('/')
    if (cut < 0) continue
    const server = key.slice(0, cut)
    const toolName = key.slice(cut + 1)
    const tool = mcpToolsOf(server).find((t) => t.name === toolName)
    items.push(mcpToolResource(server, toolName, tool?.description ?? ''))
  }
  if (!items.length) return
  for (const item of items) editorRef.value?.insertResource(item)
  mcpPickedServers.value = new Set()
  mcpPickedTools.value = new Set()
  close()
}

/**
 * 探测 MCP（全部一次探完）。
 *
 * reconnect=true 时先把**当前会话**的旧连接丢掉（修「外部关了再开、连接已废」的那种），
 * 面板打开时的自动检测用 false —— 用户只是看一眼工具列表，不该顺手重建会话连接。
 */
async function probeMcpServers(reconnect: boolean): Promise<void> {
  if (mcpProbing.value) return
  mcpProbing.value = true
  mcpProbeHint.value = '正在连接…'
  try {
    // 先让当前会话丢掉旧的 MCP 连接，再探测。
    //
    // 顺序很重要，两步解决的是不同问题：
    //   · reconnect：修**正在用的那条会话** —— SDK 的连接建在会话上、且不会自己重连，
    //     外部把 MCP 关了再开，那条旧连接就废了；丢掉它，下一句 resume 时会重新连。
    //   · probe：给**用户看**当前到底连得上什么（独立连接，不碰会话）。
    // 先 reconnect 再 probe，用户看到的结果就是"修好之后"的状态。
    if (reconnect) await agent.reconnectMcp()
    const r = await agent.probeMcp()
    const next: Record<string, { ok: boolean; text: string; tools: number }> = {}
    const tools: Record<string, Array<{ name: string; description: string; fullName: string }>> = {}
    for (const sv of r.servers) {
      const ok = sv.status === 'completed'
      next[sv.name] = { ok, text: ok ? sv.tools + ' 个工具' : (sv.error || sv.status || '连接失败'), tools: sv.tools }
      if (ok) tools[sv.name] = r.tools.filter((t) => t.server === sv.name).map((t) => ({ name: t.name, description: t.description, fullName: t.fullName }))
    }
    mcpStatus.value = next
    mcpTools.value = tools
    if (r.error) mcpProbeHint.value = r.error
    else if (!r.servers.length) mcpProbeHint.value = '没有任何 MCP 返回结果'
    else {
      const bad = r.servers.filter((x) => x.status !== 'completed').length
      mcpProbeHint.value = bad ? bad + ' 个连不上（旁边标了原因）' : '全部正常'
    }
  } catch (err) {
    mcpProbeHint.value = err instanceof Error ? err.message : String(err)
  } finally {
    mcpProbing.value = false
  }
}

function runMcpProbe(): void {
  void probeMcpServers(true)
}

/** 首开自动检测：没有工具数据时才探一次（探过就记住，别每次开面板都连一遍） */
const mcpProbedOnce = ref(false)
function ensureMcpProbed(): void {
  if (mcpProbedOnce.value) return
  mcpProbedOnce.value = true
  void probeMcpServers(false)
}

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

/**
 * 画布节点 → @ 候选（节点标记 + 点击聚焦）。
 *
 * 节点从 doc 现取、并**订阅 doc 变化**：用户加/删/改节点后，@ 菜单要跟着变，
 * 不能只在挂载时取一次快照（否则新节点 @ 不出来）。
 */
const nodeList = ref<CanvasNodeRow[]>([])
let nodeSub: { dispose?: () => void } | null = null
/**
 * 节点显示名：**只认节点自己的名字 data.label**（建节点时由数据层按类型模板生成，如「图片 1」）。
 *
 * 为什么不再按 imageName / text 首行之类去猜：那是以前没有统一命名时的权宜，
 * 结果同一节点在标题条 / @ 菜单 / 左侧树三处显示三个名字。名字只有一个来源 —— data.label。
 */
function nodeNameOf(
  n: { id: string; type: string; data?: Record<string, unknown> },
  typeLabelOf: (t: string) => string | undefined,
): string {
  const label = n.data?.label
  if (typeof label === 'string' && label.trim()) return label.trim().split('\n')[0].slice(0, 40)
  // 没有 label（改动前建的旧节点）：回落类型中文名（与标题条 / 左侧树同一套兜底），最后才用 id。
  const d = n.data ?? {}
  const t = (typeof d.nodeType === 'string' && d.nodeType) || n.type
  return typeLabelOf(t) || n.id
}
function syncNodes(): void {
  const doc = ctx.tryGet<{
    getNodes(): Array<{ id: string; type: string; data?: Record<string, unknown>; parentId?: string | null }>
    types?: Map<string, { label?: string }>
  }>('doc')
  if (!doc) return
  const typeLabelOf = (t: string): string | undefined => doc.types?.get(t)?.label
  nodeList.value = doc
    .getNodes()
    .filter((n) => n.type !== 'group') // 分组只当容器，不作为内容引用
    .map((n) => ({ id: n.id, name: nodeNameOf(n, typeLabelOf), type: n.type }))
}
syncNodes()
onMounted(() => {
  // 告诉服务当前画布 id（节点标记要写 `画布id#节点id`）。
  // 认法跟 cloud-client 的 canvasId() 一致：URL `?canvas=` 优先，其次 hash 路由 `#/canvas/<id>`。
  try {
    const q = new URLSearchParams(window.location.search).get('canvas')
    const h = /\/canvas\/([A-Za-z0-9_-]{1,64})/.exec(window.location.hash)?.[1]
    const id = q || h
    if (id) agent.setCanvasId(id)
  } catch {
    /* 取不到 URL → 用默认画布 id */
  }
  const doc = ctx.tryGet<{ subscribe(cb: () => void): unknown }>('doc')
  // subscribe 返回取消句柄（与本仓其它插件同款）；形状不确定时按 off/dispose 兜底
  const off = doc?.subscribe(() => syncNodes()) as { dispose?: () => void } | (() => void) | undefined
  if (typeof off === 'function') nodeSub = { dispose: off }
  else if (off) nodeSub = off
})
onBeforeUnmount(() => nodeSub?.dispose?.())

/** 点节点标签 = 让画布聚焦到该节点（用户要的「点标签跳到节点」） */
function focusNode(nodeId: string): void {
  // 保留当前缩放、只平移；节点不存在时 fitTo 返回 false，不抛。
  ctx.tryGet<{ fitTo(target: string[], opts?: { keepZoom?: boolean }): boolean }>('view')
    ?.fitTo([nodeId], { keepZoom: true })
}

/**
 * @ 下拉候选 + **回填复用清单**：画布节点 + 已装技能 + 已配 MCP + 资产。
 *
 * 为什么要含资产：编辑回填时按名字从这份清单里复用现成 item —— 只有清单里的 item
 * 带 renderEditor（图标 + 标签外观），回填出来的标签才和右键插入的长得一样。
 * 资产清单用于「回填复用」；@ 下拉里按名字过滤也能顺带搜到资产，是加分项。
 */
const editorResources = computed<ResourceItem[]>(() => [
  // **命令组排最前**（用户口径 2026-10-11 的截图反馈）：@ 菜单打开时"能做什么"先于
  // "引用谁" —— 不用滚到列表最底下才能按到「压缩」。
  ...compactActionItems(),
  ...nodeResources(nodeList.value, s.canvasId, focusNode),
  ...skillResources(s.skills),
  ...mcpResources(s.mcpServers),
])

/**
 * @ 菜单里的「压缩」动作项。
 *
 * 为什么用 category「命令」单独一组：它和节点 / 技能 / MCP 不是一类东西
 * （那些是"引用谁"，这个是"现在做什么"），混在一组里读起来会错。
 */
function compactActionItems(): ResourceItem[] {
  return [
    {
      id: 'command:compact',
      name: '压缩上下文',
      category: '命令',
      value: '把历史总结成摘要，腾出上下文空间',
      renderItem: () =>
        h('span', { class: 'ac-mrow' }, [
          h('span', { class: 'ac-mrow-icon', innerHTML: ICON_COMPACT }),
          h('span', { class: 'ac-mrow-text' }, [
            h('span', { class: 'ac-mrow-name' }, '压缩上下文'),
            h('span', { class: 'ac-mrow-hint' }, '把历史总结成摘要，腾出上下文空间'),
          ]),
        ]),
      // 动作项：onPick 一给，编辑器就**不往正文插任何东西**（见 useEditor 的说明）
      onPick: () => void agent.compact(),
    },
  ]
}

/**
 * 「引用到 Agent」→ 把那些节点插成标签（两个入口共用：右键菜单给一个、多选上控制栏给一批）。
 *
 * 命令在插件上下文里执行、输入框在这里，服务是唯一共享通道：命令只往 state.pendingNodeRefs
 * 写一句「引用这些 id」，组件看见就插标签并清掉（见 agentPlugin 的 agent:reference-node）。
 */
function insertPendingNodeRefs(): void {
  const nodeIds = s.pendingNodeRefs
  if (!nodeIds || !nodeIds.length) return
  syncNodes()
  // 节点可能刚被删：拿不到的跳过，不插半截东西
  const all = nodeResources(nodeList.value, s.canvasId, focusNode)
  const items = nodeIds.map((id) => all.find((x) => x.id === 'node:' + id)).filter((x) => Boolean(x))
  if (items.length) void nextTick(() => { for (const item of items) editorRef.value?.insertResource(item!) })
  agent.clearNodeRefs()
}
// 两条路都要覆盖：
//   · 面板已开着 → 命令只改 state，watch 触发；
//   · 面板本来关着 → 命令会 show()，组件此刻才挂载，onMounted 补上这一次（watch 非 immediate，
//     挂载前设的值它收不到）。onMounted 跑在子组件挂载之后，editorRef 已就绪。
watch(() => s.pendingNodeRefs, () => insertPendingNodeRefs())
onMounted(() => insertPendingNodeRefs())

/**
 * 资产「添加到 Agent」：服务只记**资产数据**（state.pendingAsset），这里用 assetResource
 * 现造成完整标签再插 —— 与「引用到 Agent」完全同一条路（那边也是只传 id、组件现造标签）。
 * 面板关着时先记下，组件挂载/打开后补插。
 */
function insertPendingResource(): void {
  const asset = s.pendingAsset
  if (!asset) return
  // 带上 onClick：插进输入框的 chip 点一下也发同一条事件（与气泡里的标签同一件事）
  const item = assetResource(asset, emitRefClick)
  void nextTick(() => editorRef.value?.insertResource(item))
  agent.clearPendingResource()
}
watch(() => s.pendingAsset, () => insertPendingResource())
onMounted(() => insertPendingResource())

/**
 * 批量插资产标签（多选工具栏「加入资产库」→ referenceAssets）。
 * 每张与单张同形；插完一次清空（clearPendingResources）。
 */
function insertPendingResources(): void {
  const assets = s.pendingAssets
  if (!assets || !assets.length) return
  const items = assetResources(assets, emitRefClick)
  void nextTick(() => { for (const item of items) editorRef.value?.insertResource(item) })
  agent.clearPendingResources()
}
watch(() => s.pendingAssets, () => insertPendingResources())
onMounted(() => insertPendingResources())

/** 往输入框插一个标签（点下拉里的一项 = 插 chip，不切开关），插完就收起下拉 */
function insertRef(item: ResourceItem, close: () => void): void {
  editorRef.value?.insertResource(item)
  close()
}

/**
 * 「压缩」的两个入口（+ 菜单 / @ 菜单）共用这一个动作。
 *
 * 为什么收成一处：压缩是有前置条件的长动作（没有会话 / 正在跑 / 正在压都要有交代），
 * 两个入口各写一遍必然漂移 —— 用户会看到一个入口能点、另一个点了没反应。
 */
function compactNow(): void {
  void agent.compact()
}

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
 * 用户气泡「默认只显示前 8 行」（用户口径 2026-10-15）：
 * 长消息会把对话列表的滚动区占掉一大块，默认收着、想看再点「展开」。
 *
 * 超没超出靠 DOM 量（scrollHeight > clientHeight），模板算不出来 ——
 * 用 ResizeObserver 盯正文外壳：初次挂载、内容变化、面板拖宽换行都会触发。
 * 展开状态按消息 id 记，切会话 / 刷新回到收起态。
 */
const USER_BUBBLE_MAX_LINES = 8
const openUserBubbles = ref<Record<string, boolean>>({})
const overflowingUser = ref<Record<string, boolean>>({})
function toggleUserBubble(id: string): void {
  openUserBubbles.value[id] = !openUserBubbles.value[id]
}
/**
 * 测量本体挂哪：挂 <p> 本身会在 ref 回调里写响应式状态 —— 而写状态的当帧正是
 * 渲染刚结束的时机，状态一变又要重渲染，形成「渲染 → ref → 写状态 → 重渲染」
 * 的递归（真机报 Maximum recursive updates exceeded，实测踩到）。
 *
 * 改成渲染后统一量：ref 只把元素登记进普通 Map（零响应式），列表渲染完（nextTick）
 * 再一次性量 scrollHeight / clientHeight。之后的高度变化（面板拖宽换行）由
 * ResizeObserver 兜 —— RO 回调不在渲染帧里写状态，同样安全。
 */
const userBubbleBodies = new Map<string, HTMLElement>()
let bubbleRO: ResizeObserver | undefined
let measureScheduled = false
function scheduleMeasureUserBubbles(): void {
  if (measureScheduled) return
  measureScheduled = true
  void nextTick(() => {
    measureScheduled = false
    measureUserBubbles()
  })
}
function measureUserBubbles(): void {
  const next: Record<string, boolean> = {}
  for (const [id, el] of userBubbleBodies) {
    // 已展开的**保持原判**：展开态下夹层放开，scrollHeight == clientHeight，
    // 再按"超出"量会把按钮判没（用户就没法收起了）。收起判定交给收起那一次测量。
    if (openUserBubbles.value[id]) next[id] = overflowingUser.value[id] === true
    else next[id] = el.scrollHeight > el.clientHeight + 1
  }
  // 稳定态检测（2026-10-16 卡死修复）：与上次值相同就**不写** ref ——
  // 写相同的值 Vue 也会因引用变化触发重渲染 → ref 回调再触发 measure → 无限循环
  // （「一轮 AI 对话后整机卡死」的根因：滚动吸底动画/RO 每帧驱动 measure）。
  let changed = false
  const prev = overflowingUser.value
  for (const [id, v] of Object.entries(next)) if (prev[id] !== v) changed = true
  if (changed || Object.keys(prev).length !== Object.keys(next).length) overflowingUser.value = next
}
function setUserBubbleBody(id: string): (el: unknown) => void {
  // ref 回调只登记 DOM（普通 Map，不碰响应式）：渲染期间零副作用，不会自触发。
  return (el: unknown) => {
    const node = el as HTMLElement | null
    const old = userBubbleBodies.get(id)
    if (old && old !== node) bubbleRO?.unobserve(old)
    if (node) {
      userBubbleBodies.set(id, node)
      bubbleRO?.observe(node)
    } else {
      userBubbleBodies.delete(id)
    }
    scheduleMeasureUserBubbles()
  }
}

/**
 * 助手一轮里的块**按到达顺序**排（用户口径 2026-10-05）。
 *
 * 以前模板固定「先工具、后正文」，于是所有工具都被堆到最上面、看不出时序；
 * 现在交给纯函数 groupTurnBlocks：文字是分界线，中间没有文字的多个工具合并成一组。
 * 兜底：老数据 / 极端情况下 steps 为空但 text 有值，就当一整块文字渲染（别把回答藏起来）。
 * 用户那条返回空数组 —— 它的正文由下面的标签行单独渲染，不走这里（避免重复一遍）。
 */
function assistantRows(t: AgentTurnView): TurnRow[] {
  if (t.kind !== 'assistant') return []
  const steps = t.steps ?? []
  if (!steps.length) return t.text ? [{ type: 'text', key: 'fallback', text: t.text }] : []
  return groupTurnBlocks(steps, t.tools ?? [])
}

/** 工具组（一组多个工具）的展开态，key 用块的 key */
const openToolGroups = ref<Record<string, boolean>>({})
function toggleToolGroup(key: string): void {
  openToolGroups.value[key] = !openToolGroups.value[key]
}

/** 组标题：跑着几个 / 跑完了几个（照参考项目的「N 个工具调用」写法） */
function toolGroupTitle(tools: ToolCard[]): string {
  const running = tools.filter((x) => !x.settled).length
  return running ? `${tools.length} 个工具调用 · ${running} 个进行中` : `${tools.length} 个工具调用`
}

/**
 * 画布 MCP 工具（自带卡片）走「直接展示卡片 + 卡内详情折叠」；
 * **其它工具（默认工具）保持原来的折叠行行为**（用户口径 2026-10-07：只删 hover，别动折叠）。
 */
const openTools = ref<Record<string, boolean>>({})
function toggleTool(id: string): void {
  openTools.value[id] = !openTools.value[id]
}
/** 该工具是否有自定义卡片（画布族）——有卡片才直接展示，其余走折叠行 */
function hasCardView(tool: ToolCard): boolean {
  return viewOf(tool).family !== 'fallback'
}
/**
 * 收起行的摘要：优先用卡片给的人话摘要（「25 节点 · 11 连线」这种），
 * 没有才退回输出原文的一行截断（用户口径 2026-10-07：收起行也要能读懂）。
 */
function toolSummary(tool: ToolCard): string {
  const card = viewOf(tool)
  if (card.summary) return card.summary.length > 60 ? card.summary.slice(0, 60) + '…' : card.summary
  const one = (tool.output ?? '').replace(/\s+/g, ' ').trim()
  return one.length > 60 ? one.slice(0, 60) + '…' : one
}

/**
 * **折叠行**后面那截描述：优先给「执行内容」（跑的那条命令 / 读写的那个文件），
 * 没有才退回卡片摘要、再退回输出截断。
 *
 * 用户口径（2026-10-11）：「exec_command 后面应该跟一些执行命令的文本信息」——
 * 只显示一个工具名分不清是哪个（同一种工具能跑无数条命令）。
 * 为什么顺序是这样：收起时最想知道「它干了什么」，输出结果是展开后的事。
 */
function toolRowSummary(tool: ToolCard): string {
  const brief = toolBrief(tool.name, tool.arguments)
  if (brief) return brief
  return toolSummary(tool)
}

/**
 * 展开区的**专用视图**（用户口径 2026-10-06）：内置画布 MCP 工具各自配专用 UI，
 * 不认识的回退通用 JSON。纯函数 toolView 出数据，这里只缓存（同一工具不重复解析）。
 *
 * 缓存条件：output 已到。工具调用先到、结果后到 —— 若先给「无输出」的结果缓存了 fallback
 * 视图，结果到了也不会刷新（实测：专用渲染不生效的根因之一）。
 */
const viewCache = new Map<string, ToolView>()
function viewOf(tool: ToolCard): ToolView {
  if (tool.output !== undefined) {
    const hit = viewCache.get(tool.id)
    if (hit) return hit
  }
  const v = toolView(tool.name, tool.arguments, tool.output)
  if (tool.output !== undefined) viewCache.set(tool.id, v)
  return v
}

/** 换会话 / 清屏时把缓存与展开态一起丢掉（tool id 在不同会话可能重复） */
function resetViewCaches(): void {
  viewCache.clear()
  openTools.value = {}
  openToolGroups.value = {}
}
watch(() => s.sessionId, () => {
  resetViewCaches()
  resetEditStates()
})

/**
 * 换会话（含新建 / 删当前会话）时把三种编辑态归零。
 *
 * 为什么必须做（代码审查发现的洞）：`editingItems` / `editingGoal` 是**组件本地**状态，
 * 而 `s.editingId` 由 sessionModel 管（model.load / reset 会清）。不清的话，在 A 会话里
 * 点了「编辑排队消息 / 编辑目标」，切到 B 会话后那两条编辑标记还挂着 —— 输入框继续回填着
 * A 的内容，发送反而去改 B 的队列/目标（编辑互斥的前提是「同一会话内最多一个」，跨会话必须归零）。
 */
function resetEditStates(): void {
  if (editingItems.value.length) editingItems.value = []
  editingGoal.value = false
}

/**
 * 用户消息 hover 操作条（用户口径 2026-10-06，照参考图 2）。
 *
 * ① 时间：`10月2日 23:20` 格式；跨年带年份。拿不到时间（老数据）不显示。
 * ② 复制：把**显示文本**（@ 标记已降级成 `@名字` 的那份）复制进剪贴板，成功时短暂打勾。
 * ③ 编辑：把那条消息的**提示词 + @ 引用 + 图片**填回底部输入框（图片回附件区），
 *    相当于恢复那次发送 —— 分支（fork）的第一步（分支本身在第三批做）。
 */
const copied = ref<Record<string, boolean>>({})
function msgTimeText(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const md = d.getMonth() + 1 + '月' + d.getDate() + '日 ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  return sameYear ? md : d.getFullYear() + '年' + md
}
function msgTimeTitle(ts?: number): string | undefined {
  if (!ts) return undefined
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleString()
}
async function copyMessage(text: string, turnId: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    copied.value[turnId] = true
    setTimeout(() => { copied.value[turnId] = false }, 1200)
  } catch {
    /* 剪贴板被拒（非安全上下文等）：静默 —— 用户看得到没有变化，不值得为它弹错 */
  }
}

/**
 * 「编辑」= 恢复那次发送：正文回输入框、图片回附件区。
 *
 * 为什么直接 setText 就行：转录里存的是**引用标记原文**（`<ref … />`，后端口径：不翻译），
 * 而 setText 内部的 parsePlainTextToContent 会把它还原成与右键插入同款的 chip 标签
 *（见 prosemirror-editor-bundle 的 parsePlainTextToContent 与 refRestore 测试）。
 * 用户在此基础上改完直接重发即可（重发走 agentService 的分支 fork）。
 */
function editIntoComposer(text: string, images: string[] | undefined): void {
  editorRef.value?.setText(text)
  if (!editorRef.value) prompt.value = text
  attached.value = [...(images ?? [])]
  // 输入框获得焦点，用户直接改就行
  void nextTick(() => editorRef.value?.$el?.querySelector?.('.ProseMirror')?.focus?.())
}

/** 点「编辑」：回填 + 进入「正在编辑」状态（消息高亮、输入框出联动标记） */
function beginEditMessage(t: AgentTurnView): void {
  cancelAllEditsExcept('message')
  editIntoComposer(t.text, t.images)
  agent.beginEdit(t.id)
  // 高亮的消息要可见：滚到它（比「点标记滚回来」更早一步到位）
  void nextTick(() => scrollToEditing())
}

/** 输入框联动标记被点：滚回正在编辑的那条消息 */
function scrollToEditing(): void {
  // 三种编辑各自的目标元素不同：谁在编辑就滚到谁（类名挂在外层 .ac-msg 上，选择器对准真身）
  const sel =
    editingKind.value === 'message' ? '.ac-msg.is-editing'
      : editingKind.value === 'queue' ? '.ac-queue-row.is-editing'
        : '.ac-goal-row.is-editing'
  document.querySelector(sel)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
/** 当前在编辑哪一种（消息 / 队列 / 目标）；都没有则 null —— 三者互斥，最多一个 */
const editingKind = computed<'message' | 'queue' | 'goal' | null>(() => {
  if (s.editingId) return 'message'
  if (editingItems.value.length) return 'queue'
  if (editingGoal.value) return 'goal'
  return null
})
const editingKindText = computed(() =>
  editingKind.value === 'queue' ? '正在编辑排队消息'
    : editingKind.value === 'goal' ? '正在编辑目标'
      : '正在编辑',
)
/** 那条黄色标记上的 ✕：按当前是哪种编辑去取消 */
function cancelEditing(): void {
  if (editingKind.value === 'message') agent.cancelEdit()
  else if (editingKind.value === 'queue') {
    for (const id of [...editingItems.value]) void agent.cancelEditQueueItem(id)
    editingItems.value = []
  } else if (editingKind.value === 'goal') cancelEditGoal()
}

/**
 * 模型分割线：第 N 个用户消息之前，换成了哪个模型（用户口径 2026-10-11）。
 *
 * 为什么从前端现算而不是后端给 turnId：转录是后端的，而"第几个用户消息"这件事
 * 前端本来就按渲染顺序数得出来（与分页器的 userOrdinal 同一口径）——
 * 后端只给 fromUser 这个稳定坐标，位置由渲染层钉，改渲染不会让后端数据失配。
 *
 * 返回 turnId -> 分段；只给**分叉点那一条**上标（第一段 fromUser=0 也要画，
 * 否则用户不知道这个对话一开始用的是哪个模型）。
 */
// 定位规则住在 ../modelSegments.ts（纯函数，有单测）—— 这里只把状态喂给它。
const segmentByAnchor = computed(() => segmentAnchors(s.turns, s.segments))

/** 分割线上的模型名：有 displayName 就用它（界面上的模型列表是这么叫的） */
function segmentModelLabel(seg: { provider: string; modelId: string }): string {
  const hit = s.models.find((m) => m.provider === seg.provider && m.modelId === seg.modelId)
  return hit?.displayName || seg.modelId
}

/**
 * 这条错误是不是已经显示在消息流里了（挂在某条助手消息上）。
 *
 * 为什么要判：同一条错误两个地方都画就成了两条 —— 用户看到重复的报错会以为出了两次事。
 * 优先信消息里那条（它就在出错的那个位置旁边，读起来最连贯），没有才画底部那条常驻条。
 */
const hasInlineError = computed(() => s.turns.some((t) => !!t.error))

/** 分页器切到上/下一条（越界返回 null，按钮同时是 disabled 状态） */
function pagerTarget(p: PagerGroup, delta: number): string | null {
  const next = p.index + delta
  if (next < 0 || next >= p.items.length) return null
  return p.items[next].id
}

/* ——————————————————— 排队消息（设计 §3.6 G2/G3/G7/G8/G9/G10） ——————————————————— */

/**
 * 队列的**镜像**：真相在后台（会话文件里的 queue 字段），state.queue 由
 * 数据层恢复（GET 会话）+ SSE 的 `queue` 事件持续同步；本组件只读它。
 *
 * 上面再叠一层**本地编辑态**：后端的 `update` 语义是"改完待发"（op 一调就把状态刷回
 * queued），没有"置 editing"的接口 —— 所以"这条正在被编辑"由本组件自己记（唯一真相在这里），
 * 折算时把那几条强制成 `editing`（queueModel 据此出琥珀行 + 队列阻塞提示）。
 */
const editingItems = ref<string[]>([])
/**
 * 「发送中显示队列」开关（用户口径 2026-10-15，全局设置里配）：关 = sending 条目
 * 不画出来（真实发送后就从列表消失的效果）。默认显示 —— 关闭是用户显式的选择。
 */
const showSendingQueue = ref(true)
const queueView = computed<QueueStateView>(() => {
  const base = s.queue
  // 开关关闭：先把 sending 条目滤掉（编辑态映射在前 —— 别把用户正在改的那条滤丢）
  const keep = showSendingQueue.value ? base.items : base.items.filter((it) => it.state !== 'sending')
  if (!editingItems.value.length) return { ...base, items: keep }
  const ids = new Set(editingItems.value)
  return { ...base, items: keep.map((it) => (ids.has(it.id) ? { ...it, state: 'editing' as const } : it)) }
})
/** 折算成一排排要画的行（纯函数在 queueModel，可单测） */
const queue = computed(() => queuePanelView(queueView.value))
/**
 * 拖拽排序落地（用户口径 2026-10-16，Vue Draggable Plus）：拖完把全量 id 新顺序
 * 发给 service（乐观更新 + 服务端钉住 sending/sent 的位置）。sending 行没有把手，
 * 拖不动；被别的行拖动经过时由后端放回原位（前端顺序只作参考）。
 */
function onQueueReorder(nextRows: QueueRow[]): void {
  void agent.reorderQueue(nextRows.map((r) => r.id))
}
/**
 * 有队列消息正在编辑 ⇒ **队列整体阻塞**（后端保证不发下一条，G7）。
 * 组件用它决定列表上方那条提示（用户得知道"为什么队列不动了"）。
 */
const queueBlocked = computed(() => queue.value.blocked)

/**
 * 聚合容器是否要画：**有队列消息 或 有已发送的目标**时为真。
 * 未发送的目标不进这个容器（它在输入框内侧），所以不进这个判断。
 */
const pending = computed(() => ({ hasAny: queue.value.hasItems || !!goalRow.value }))

/** 目标标记（G12）：`+ → 目标` 直接加一个默认预算的标记，点标签才弹编辑框 */
const goalMark = computed<{ objective: string; budget: number } | null>(() => s.goalMark)

/**
 * token 口径（用户口径 2026-10-09）：**只有两态** —— 已用预算 ⇄ 剩余预算。
 * 未发送的目标标签、已发送的目标行**共用这一个开关**（两处都能改，口径一致）。
 * 持久化到 localStorage：刷新后口径不跳。
 */
/**
 * token 单位制（用户口径 2026-10-09）：国际 k/M/B/T ⇄ 中文 万/亿/万亿。
 * 跟着「换算口径」走，不放进设置弹框 —— 它就是这里数字的显示方式。
 */
const UNIT_KEY = 'mini-canvas:agent:token-unit'
const tokenUnit = ref<TokenUnit>(
  (typeof localStorage !== 'undefined' && localStorage.getItem(UNIT_KEY) === 'cn') ? 'cn' : 'si',
)
watch(tokenUnit, (u) => {
  try {
    localStorage.setItem(UNIT_KEY, u)
  } catch {
    /* 同上 */
  }
})
function toggleTokenUnit(): void {
  tokenUnit.value = tokenUnit.value === 'si' ? 'cn' : 'si'
}
/**
 * 目标默认预算：读全局设置（KV `config/agentGoalDefaults`，由设置弹窗那一路维护；
 * 与 packages/ui 的 agentSettings 同一个键 —— 别自创路径）。
 *
 * 为什么经**批量口**而不是单项 GET：这个键用户没改过时从未保存过，单项 GET 必然回 404
 * （控制台里多一条“加载资源失败”，而用户什么都没做错）。批量口一次拿回整个 config 域，
 * 缺键只是“桶里没有”，不再产生 404。
 *
 * 三种情况要分清（与 ui 侧 budgetFromKv 同口径）：
 *   · 桶里没这个键（从未保存过）⇒ 用默认 50000（设计 §3.6.3）；
 *   · 存了 `{ budget: 0 }` ⇒ 用户明确选了"不限"，就用 0，**不能**被默认值盖回去；
 *   · 坏数据 ⇒ 回落默认。
 */
const goalDefaultBudget = ref(50000)
async function loadGoalDefaults(): Promise<void> {
  try {
    const base = (s.baseUrl ?? '').replace(/\/+$/, '')
    const res = await fetch(base + '/api/kv/config?values=1', { headers: { accept: 'application/json' } })
    if (!res.ok) return
    const body = (await res.json()) as { values?: Record<string, unknown> } | null
    const raw = body?.values?.['agentGoalDefaults']
    if (!raw || typeof raw !== 'object' || !('budget' in raw)) return
    const b = Number(raw.budget)
    if (Number.isFinite(b) && b >= 0) goalDefaultBudget.value = Math.floor(b)
  } catch {
    /* 后台没连 / 没这个键：用默认值，不打扰用户 */
  }
}

/** 点「+ → 目标」：直接加标签（**不弹框**），内容留空提示「输入目标内容」 */
function addGoalMark(): void {
  agent.setGoalMark('', goalDefaultBudget.value)
}

function clearGoalMark(): void {
  agent.clearGoalMark()
  // 若正在编辑运行中的目标，撤掉标记 = 取消这次编辑（目标本身没动过）
  editingGoal.value = false
}

/**
 * 编辑**正在运行**的目标（用户口径 2026-10-09）：点目标行左侧那颗图标进入。
 * 效果与队列编辑一致 —— 恢复成**待编辑的草稿状态**：目标内容回填输入框 + 挂上目标标记；
 * 发送时（见 submit）**只更新该目标的内容**，不新建目标、也不进队列。
 */
const editingGoal = ref(false)
/**
 * 三种编辑**互斥**（用户口径 2026-10-09）：对话消息 / 队列消息 / 目标，同一时刻只能有一个在编辑。
 * 进入任一编辑前先调它 —— 把另外两种退出，避免三个编辑态叠在一起。
 */
function cancelAllEditsExcept(keep: 'message' | 'queue' | 'goal'): void {
  if (keep !== 'message' && s.editingId) agent.cancelEdit()
  if (keep !== 'queue' && editingItems.value.length) {
    for (const id of [...editingItems.value]) void agent.cancelEditQueueItem(id)
    editingItems.value = []
  }
  if (keep !== 'goal' && editingGoal.value) {
    editingGoal.value = false
    agent.clearGoalMark()
  }
}
function beginEditGoal(): void {
  const g = s.goal
  if (!g) return
  cancelAllEditsExcept('goal')
  editingGoal.value = true
  agent.setGoalMark(g.objective, g.budget)   // 挂上草稿标记（输入框顶部那条）
  // 图片也一并回填（与队列编辑同款）：目标的参考图就在宿主记录里
  editIntoComposer(g.objective, s.goalImages?.length ? s.goalImages : undefined)
}
/** 取消编辑目标：撤掉标记，恢复原样（目标本身没动过） */
function cancelEditGoal(): void {
  editingGoal.value = false
  agent.clearGoalMark()
}
/** 目标行左侧图标点击：进入编辑（再点一次 = 退出编辑、撤掉草稿标记） */
function startEditGoalRow(): void {
  if (editingGoal.value) cancelEditGoal()
  else beginEditGoal()
}

/** 目标标签文案（`目标内容 · 预算 50k`）—— 已发送目标行/无障碍用的文本 */
const goalText = computed(() => goalMarkText(goalMark.value?.objective, goalMark.value?.budget))

/**
 * 已发送目标的列表行：状态徽章 + 第 N 轮 + 进度。
 * 预算**只有一个口径**（用户口径 2026-10-09 修正）：进度 = 已用 / 总预算，没有「已用/剩余」切换。
 */
const goalRow = computed(() => {
  const g = s.goal
  if (!g) return null
  /**
   * 徽章：暂停优先；否则看**是不是真完了**（用户口径 2026-10-11）。
   * `ended` 有两种情形（真完成 / 只是这轮被中止），拿它当"已完成"会谎报，
   * 所以改问 goalIsFinished —— 中止仍显示「已中止」，只有真完成才「已完成」。
   */
  const finished = goalIsFinished(g.status)
  const badge = s.goalPaused
    ? { text: '已暂停', cls: 'is-paused' }
    : (g.ended || finished ? goalEndedBadge(g.status) : { text: '运行中', cls: '' })
  return {
    badge,
    round: g.round,
    resumed: s.goalPaused,
    /** 真完了才收按钮；中止（aborted）仍要给播放键，用户才能接着跑 */
    finished,
  }
})

/**
 * 预算值就地编辑（contenteditable）。用户口径 2026-10-09：
 *   1. **点进去就全选**（省得手动删）——用 focus 时 selectAll；
 *   2. **只有回车才算有效**；Esc 或点别处（失焦）= 放弃、还原原值。
 * 参数：kind = 'budget'（总预算）| 'used'（已用，只读，不触发提交）；scope = 'mark'(草稿) | 'row'(运行中)。
 */
function onGoalEditFocus(e: FocusEvent): void {
  const el = e.target as HTMLElement
  // 记下原值（用于 Esc / 失焦还原），再全选，用户一敲键盘就覆盖
  el.dataset.raw = el.textContent ?? ''
  const sel = window.getSelection?.()
  if (sel) {
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
  }
}
function commitGoalBudget(el: HTMLElement, scope: 'mark' | 'row' | 'used'): void {
  const n = parseTokenText(el.textContent)
  if (Number.isNaN(n)) {
    // 解析不了 = 不改，还原
    el.textContent = el.dataset.raw ?? el.textContent
    return
  }
  if (scope === 'used') void agent.updateGoal({ tokensUsed: n > 0 ? n : 0 })
  else if (scope === 'row') void agent.updateGoal({ budget: n > 0 ? n : -1 })
  else agent.setGoalMark(goalMark.value?.objective ?? '', n > 0 ? n : -1)
  // 提交后清掉 raw，避免下一次失焦又拿旧值还原
  delete el.dataset.raw
}
function onGoalBudgetKeydown(e: KeyboardEvent, el: HTMLElement, scope: 'mark' | 'row' | 'used'): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitGoalBudget(el, scope)   // **只有回车才提交**
    el.blur()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    el.textContent = el.dataset.raw ?? el.textContent
    delete el.dataset.raw
    el.blur()
  }
}
function onGoalBudgetBlur(e: FocusEvent): void {
  // 失焦**不提交**（用户口径：只有回车算有效）—— 有未提交的改动就还原
  const el = e.target as HTMLElement
  if (el.dataset.raw !== undefined) {
    el.textContent = el.dataset.raw
    delete el.dataset.raw
  }
}

/** 发送键三态（G1）：有内容 ⇒ 发送（跑着也是发送，点了进队列）；空 + 跑着 ⇒ 终止；空 + 空闲 ⇒ 禁用 */
const sendMode = computed(() => sendButtonMode(!!prompt.value.trim() || attached.value.length > 0, s.running))

/**
 * 「正在思考」加载指示的显示依据（用户口径 2026-10-16 二次澄清）：
 * **输入框按钮处于「停止」状态（s.running）就显示**，与消息内容/streaming 标记解耦 ——
 * 按钮状态本身就是"这一轮还在跑"的唯一真相，刷新后 openSession 也会把它恢复回来。
 * 只挂在最后一条助手消息上（跟原来一致），避免历史消息里凭空出现加载行。
 */
function showPendingOn(t: { id: string; kind: string }): boolean {
  if (!s.running || t.kind !== 'assistant') return false
  const turns = s.turns
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]!.kind === 'assistant') return turns[i]!.id === t.id
  }
  return false
}


/**
 * 「引导」↳：表面上像直接发送，实际插队（G4/G13）。
 * 跑着时 = 插进当前轮的下一次请求；没跑时后端会把它按普通发送处理（设计 §3.3.3，
 * 三种情况全由后端裁决，前端照调即可）。
 */
async function steerItem(id: string): Promise<void> {
  await agent.steerQueueItem(id)
}

/** 删除这条排队消息（真不要了）；正在编辑的那条删了 = 编辑结束（输入框内容保留） */
async function removeItem(id: string): Promise<void> {
  editingItems.value = editingItems.value.filter((x) => x !== id)
  await agent.removeQueueItem(id)
}

/** 「关闭排队」：不移除内容 —— 文本 + 图片**回填输入框**（用户接着改或直接发） */
async function closeItem(id: string): Promise<void> {
  // 服务把「被关掉那条的内容」回给调用方 —— 关掉的同时回填输入框（它就是"关闭排队"的语义）
  editingItems.value = editingItems.value.filter((x) => x !== id)
  const back = await agent.closeQueueItem(id)
  if (back) editIntoComposer(back.text, back.images)
}

/** 编辑队列消息（G3）：回填输入框 + 标记 editing（位置不变，队列整体阻塞） */
async function beginEditQueue(id: string): Promise<void> {
  // 先要内容（服务那边顺手把这条刷新一遍），再在本地记上"正在编辑"
  cancelAllEditsExcept('queue')
  const back = await agent.beginEditQueueItem(id)
  const item = back ?? s.queue.items.find((x) => x.id === id) ?? null
  if (item && !editingItems.value.includes(id)) editingItems.value = [...editingItems.value, id]
  if (item) editIntoComposer(item.text, item.images)
}

/** 取消编辑（队列行上的 ✕）：状态回 queued，内容不变 */
async function cancelEditQueue(id: string): Promise<void> {
  editingItems.value = editingItems.value.filter((x) => x !== id)
  await agent.cancelEditQueueItem(id)
}

/** 编辑中的那条消息发送：**原位替换**内容（不新起一条、不换位置） */
async function updateEditingQueueItem(id: string, text: string, images: string[]): Promise<void> {
  await agent.saveEditedQueueItem(id, text, images.length ? images : undefined)
  // 发送 = 编辑结束：本地那条"正在编辑"的标记要撤掉，队列才能继续
  editingItems.value = editingItems.value.filter((x) => x !== id)
}

/**
 * 暂停 / 启动队列的自动发送（G8）。
 *
 * 必须写成**函数**、每次点击时现读当前状态：原来的三元（`paused ? resume : pause`）
 * 在 setup 里立刻求值一次，挂载后永远是同一个分支 —— 暂停后点"启动"其实还在调 pause，
 * 看起来完全没反应（真机实测踩到的 bug）。
 */
function toggleQueuePause(): void {
  if (queueView.value.paused) void agent.resumeQueue()
  else void agent.pauseQueue()
}

/** 行内 ⋯ 菜单开合（同一时刻只留一个） */
const rowMenuId = ref<string | null>(null)
/** 当前 hover 的队列行（图标 ⇄ 拖拽把手交换的驱动；用户口径 2026-10-16） */
const hoverRowId = ref<string | null>(null)

/**
 * 分页器**跟随消息**的锚点（用户口径 2026-10-07）：
 * userOrdinal = 第几条用户消息（0 基）在当前位置被编辑过；
 * 分页器插在那条用户消息**整块回复**结束处（下一条用户消息之前 / 列表末尾）。
 * 返回 turnId -> PagerGroup（模板在对应回合后面渲染）。
 */
const pagerByAnchor = computed(() => pagerAnchors(s.turns, s.pagers))

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (previewImage.value) {
    previewImage.value = null
    return
  }
  // Esc 先关自己开的那些浮层，最后才轮到别的（手势优先级从最近的一次操作往回退）
  if (rowMenuId.value) {
    rowMenuId.value = null
    return
  }
  if (plusOpen.value) {
    plusOpen.value = false
    return
  }
  // 目标编辑框也吃 Esc（设计 §3.1 的模态三要素之一）
  modeOpen.value = modelOpen.value = skillOpen.value = mcpOpen.value = authOpen.value = false
}

/** 只有带密钥的模型能选 */
const usableModels = computed(() => s.models.filter((m) => m.hasKey))

/**
 * 面板化下拉（demo 同款）的本地状态：搜索词 / 视图 / 平台过滤。
 * 只放在这里，不进全局 store —— 它是菜单内部的浏览状态，关掉即重置（demo 口径）。
 */
const modelQuery = ref('')
const modelView = ref<'card' | 'split'>('card')
const modelPlatform = ref('all')
const skillQuery = ref('')
const skillView = ref<'card' | 'split'>('card')
const mcpQuery = ref('')
/** 模型 / 技能面板的卡片-分栏切换（Tabs 值来自组件库，收窄成两档） */
function setModelView(value: string | number): void {
  modelView.value = value === 'split' ? 'split' : 'card'
}
function setSkillView(value: string | number): void {
  skillView.value = value === 'split' ? 'split' : 'card'
}
/** 技能分栏的分类过滤（DEMO 的 activeCategory；卡片视图不看它，切到卡片时重置为全部） */
const skillCategory = ref('全部')

function modelNote(m: { contextWindow?: number; isVision: boolean }): string {
  if (m.contextWindow) return Math.round(m.contextWindow / 1000) + 'K'
  return m.isVision ? '视觉' : ''
}

/**
 * 这条模型是不是当前选中的那个。
 *
 * 为什么不能只比 modelId：不同 provider 可能有同名模型 ID（openrouter 的
 * `deepseek/...` 与 deepseek 官方同名尾巴），只比 ID 会把两条同时点亮。
 * provider 与 modelId 一起比才是「同一个模型」的唯一真相。
 */
function isModelPicked(m: { provider: string; modelId: string }): boolean {
  return s.model?.provider === m.provider && s.model?.modelId === m.modelId
}

/** 模型 → 平台 key（品牌图标与分栏分组共用一把尺子） */
function platformOf(m: { provider: string; modelId: string }): string {
  return detectPlatform(m.modelId, m.provider)
}

/** 平台展示名（卡片副行第一段） */
function brandNameOf(m: { provider: string; modelId: string }): string {
  return brandName(platformOf(m))
}

/** 卡片上的品牌图标（35px 托里 22px svg，尺寸由 CSS 管） */
function brandSvgOf(m: { provider: string; modelId: string }): string {
  return brandSvg(platformOf(m))
}

/** 技能分栏封面：名字 hash 成稳定色相（demo 的彩色渐变封面同款思路，数据里没有 hue 就从名字算）。 */
function skillCoverStyle(name: string): Record<string, string> {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360
  const hue2 = (hash + 42) % 360
  return {
    '--cover-h1': String(hash),
    '--cover-h2': String(hue2),
  }
}

/**
 * 分栏左列的平台分组：按 DEMO 的「平台」聚合（不是按 provider 原样分组）。
 *
 * 为什么要聚合：真实配置里 40 个可用模型可能来自 5 个 provider（openrouter 一家就几十个
 * 模型 ID），按 provider 列出来左列只有 5 行、右边几十行混着所有平台；DEMO 的口径是
 * 「DeepSeek / OpenAI / Claude … 每个平台一行」，所以先 detectPlatform 再聚合。
 * key 用平台 key（all 表示全部），过滤时用同一把尺子。
 */
const modelPlatformGroups = computed(() => {
  const order: Array<{ key: string; label: string; count: number }> = []
  for (const m of usableModels.value) {
    const key = detectPlatform(m.modelId, m.provider)
    const hit = order.find((g) => g.key === key)
    if (hit) hit.count++
    else order.push({ key, label: brandName(key), count: 1 })
  }
  return [{ key: 'all', label: '全部平台', count: usableModels.value.length }, ...order]
})

const filteredModels = computed(() => {
  const q = modelQuery.value.trim().toLowerCase()
  return usableModels.value.filter((m) => {
    if (modelPlatform.value !== 'all' && detectPlatform(m.modelId, m.provider) !== modelPlatform.value) return false
    if (!q) return true
    const brand = brandName(detectPlatform(m.modelId, m.provider))
    return (m.modelId + ' ' + m.provider + ' ' + modelNote(m) + ' ' + brand).toLowerCase().includes(q)
  })
})

const filteredSkills = computed(() => {
  const q = skillQuery.value.trim().toLowerCase()
  const items = skillResources(s.skills)
  // 分栏视图先按分类过滤（DEMO 口径：左列分类 = 全部 / 精选 / 各分类）
  const byCategory = items.filter((item) => {
    if (skillCategory.value === '全部') return true
    if (skillCategory.value === '精选') return skillMetaOf(item.name).featured
    return skillMetaOf(item.name).category === skillCategory.value
  })
  if (!q) return byCategory
  return byCategory.filter((item) => (item.name + ' ' + item.value).toLowerCase().includes(q))
})

/**
 * 技能的展示元数据（分类 / 精选 / 色相）。
 *
 * 后端只给名字 + 描述 + 目录，没有分类与封面；DEMO 用「教育培训 / 短视频 / 专业影视…」
 * 分组并给每个技能一个色相。这里按名字稳定派生：同一技能每次进来分类与颜色都一样
 *（不能用随机 —— 切一下视图封面就换色，看着像加载错了）。
 *
 * 精选 = 目录文件数 >= 4 的那批（DEMO 的 featured 标记；真实数据里 fileCount 是唯一可用的信号）。
 */
const SKILL_CATEGORIES = ['教育培训', '短视频', '商业广告', '专业影视', '动漫游戏', '音乐 MV', '短剧漫剧'] as const
const skillMetaCache = new Map<string, { category: string; featured: boolean; hue: number }>()
function skillMetaOf(name: string): { category: string; featured: boolean; hue: number } {
  const hit = skillMetaCache.get(name)
  if (hit) return hit
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const row = s.skills.find((k) => k.name === name)
  const text = name + ' ' + (row?.description ?? '')
  let textHash = 0
  for (let i = 0; i < text.length; i++) textHash = (textHash * 31 + text.charCodeAt(i)) >>> 0
  const meta = {
    category: SKILL_CATEGORIES[textHash % SKILL_CATEGORIES.length]!,
    featured: (row?.fileCount ?? 0) >= 4,
    hue: hash % 360,
  }
  skillMetaCache.set(name, meta)
  return meta
}

/** 分栏左列的分类行（DEMO 的 skillCategories：全部 → 各分类 → 精选，带计数） */
const skillCategoryRows = computed(() => {
  const items = skillResources(s.skills)
  const rows: Array<{ name: string; count: number }> = [{ name: '全部', count: items.length }]
  for (const cat of SKILL_CATEGORIES) {
    const count = items.filter((item) => skillMetaOf(item.name).category === cat).length
    if (count) rows.push({ name: cat, count })
  }
  const featured = items.filter((item) => skillMetaOf(item.name).featured).length
  if (featured) rows.push({ name: '精选', count: featured })
  return rows
})

/** 技能的文件数（后端给了 fileCount；没有就给 0，界面上仍显示「0 文件」） */
function skillFileCount(name: string): number {
  return s.skills.find((k) => k.name === name)?.fileCount ?? 0
}

/** 技能体积：SKILL.md 的字节数，按 KB 显示（不足 1KB 显示字节） */
function skillSize(name: string): string {
  const bytes = s.skills.find((k) => k.name === name)?.size ?? 0
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  return Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

/**
 * MCP 面板的搜索结果（用户口径 2026-10-30）。
 *
 * 搜索范围要覆盖**四样东西**：服务名、服务说明（地址/命令）、工具名、工具描述。
 * 只按服务名过滤的话，用户记得「有个叫 canvas_get 的工具」却想不起它在哪个服务下，
 * 就只能一条条展开找 —— 那正是这里要省掉的动作。
 * 命中工具、但服务名本身没命中时，这批工具单独收窄（toolHits），卡片自动展开只露命中项。
 */
const filteredMcpResources = computed(() => {
  const q = mcpQuery.value.trim().toLowerCase()
  const items = mcpResources(s.mcpServers)
  type McpToolRow = { name: string; description: string; fullName: string }
  if (!q) return items.map((item) => ({ ...item, toolHits: null as null | McpToolRow[] }))
  const hit = (text: string): boolean => text.toLowerCase().includes(q)
  const out: Array<(typeof items)[number] & { toolHits: null | McpToolRow[] }> = []
  for (const item of items) {
    const serverHit = hit(item.name) || hit(item.value ?? '')
    const tools = mcpToolsOf(item.name)
    const toolHits = tools.filter((t) => hit(t.name) || hit(t.description))
    if (!serverHit && !toolHits.length) continue
    out.push({ ...item, toolHits: serverHit ? null : toolHits })
  }
  return out
})

/**
 * 模型列表的滚动区（`.ac-menu-scroll`）。
 *
 * 为什么打开时要滚一下（用户口径 2026-10-10，附截图）：模型可能几十条（自建网关几十上百个
 * 模型 ID），列表限高只露几行 —— 当前选中的那条多半在可视区外，点开根本看不到"现在用的是哪个"，
 * 得自己往下翻。于是打开那一刻把它滚进可视区。
 *
 * 为什么用 ref 而不是进 DOM 里 querySelector：ref 直接拿到就是这个容器的元素，
 * 不用猜结构、也不会误伤别的下拉（技能 / MCP 也长着 .ac-menu-scroll）。
 */
const modelScrollRef = ref<HTMLElement | null>(null)

/**
 * 把选中的那条滚进列表的可视区（打开下拉时调一次）。
 *
 * 几何量法：用 `getBoundingClientRect()` 换算（见函数体注释）。
 * 曾经用 `offsetTop` 相减，理由是「rect 会被入场 scale 动画缩过」。
 * 但 offsetTop 只在**同一个 offsetParent** 下才可比 —— 模型列表的项与滚动区隔了两层，
 * 相减出来的值不是项在内容里的位置，滚完选中项仍贴在可视区下缘（2026-10-30 实测）。
 * 选中态认 `aria-selected="true"` —— 那是选中项的唯一真相，不再另造一个类名当第二处真相。
 */
function scrollSelectedModelIntoView(): void {
  // 卡片视图与分栏视图是**两个不同的滚动容器**（.ac-menu-scroll / .ac-split-scroll），
  // 切视图时 ref 还指着旧的那个 —— 对它写 scrollTop 什么也不会发生，
  // 表现就是「切到分栏，选中项又跑回列表顶」。所以每次都按当前 DOM 重新取一次，
  // 并优先认「正真装着选中项」的那个容器。
  const root = modelScrollRef.value
  const sel = (root ?? document).querySelector<HTMLElement>('[aria-selected="true"]')
  const box = sel?.closest<HTMLElement>('.ac-split-scroll, .ac-menu-scroll') ?? root
  if (!box || box.clientHeight <= 0) return
  const item = sel && box.contains(sel) ? sel : box.querySelector<HTMLElement>('[aria-selected="true"]')
  if (!item) return
  // 用**真实矩形**换算，不用 offsetTop：列表项可能挂在不同的 offsetParent 下
  // （模型面板外面还套着 .ac-panel-body / .ac-menu-scroll 两层），
  // 一旦 offsetParent 不一致，offsetTop 相减就不是「项在滚动内容里的位置」，
  // 滚出来的结果就会差一截、选中项仍停在可视区边缘（2026-10-30 实测）。
  // 公式：项相对可视区的位置 = itemRect.top - boxRect.top，再加上当前 scrollTop
  // 就换算到内容坐标系。入场 scale 动画的影响在下面 done 回调里已等过一帧。
  const top = item.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
  box.scrollTop = scrollTopForVisibleItem(
    { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight, clientHeight: box.clientHeight },
    { top, height: item.offsetHeight },
    4,
  )
  // 落地后再量一次，按**实际差**补齐。
  // 为什么要补：算出来的落点是按「滚之前的布局」估的，滚完滚动条可能出现/消失、
  // 行高也可能因换行重排而变，实际位置会差几个像素（实测 7px，正好卡在下缘外）。
  // 与其猜是哪一个量不准，不如按真实矩形收尾 —— 差多少补多少，最多再修一次。
  const selRect = item.getBoundingClientRect()
  const boxRect = box.getBoundingClientRect()
  if (selRect.bottom > boxRect.bottom) {
    box.scrollTop += selRect.bottom - boxRect.bottom
  } else if (selRect.top < boxRect.top) {
    box.scrollTop -= boxRect.top - selRect.top
  }
}

/**
 * 打开下拉时把选中项滚进可视区 —— 要滚两次。
 *
 * 第一次在 nextTick：面板刚挂上 DOM，先按当时的布局滚一下，用户不会看到「停在列表顶」。
 * 第二次在 200ms 后：浮层入场带 0.14s 的 scale(.96) 动画，动画中量出来的 rect 是全比例缩过的，
 * 换算出的位置会偏；等动画结束再按最终布局校正一次，选中项才真正落在可视区里
 * （2026-10-30 实测：只滚第一次时选中项停在下缘外面）。
 */
function scheduleScrollSelectedModel(): void {
  scrollSelectedModelIntoView()
  window.setTimeout(() => scrollSelectedModelIntoView(), 200)
}

/**
 * 盯着列表的可视高度：它一变就重新定位选中项。
 *
 * 为什么光靠定时器不够：浮层在入场动画里高度是渐变的，菜单设的 min-height 也在第一帧才生效，
 * 动画结束后可视高度还会再变一次（实测 332 → 319）。只按某个固定时刻算，选中项就会差十几像素、
 * 正卡在可视区下缘外。ResizeObserver 直接把「尺寸定型」当成触发条件，不猜时机。
 */
let modelBoxObserver: ResizeObserver | null = null
let modelBoxResizeTimer: number | null = null

/**
 * 高度一变就重新定位 —— 但不能**每次**都立刻滚。
 *
 * 坑（2026-10-30 实测）：写 scrollTop 本身会让滚动条出现/消失，可视高度随之变一点，
 * ResizeObserver 又触发一次，量到的还是「滚动前」的布局，于是把刚滚好的位置往回拉几像素，
 * 选中项正好卡在下缘外（差 7px）。所以一次尺寸变化先攒 80ms，尺寸稳下来了再算一次。
 */
function observeModelBox(): void {
  modelBoxObserver?.disconnect()
  // 观察「当前真正在滚的那一层」：卡片视图是 .ac-menu-scroll，分栏视图是右栏 .ac-split-scroll。
  const root = modelScrollRef.value
  const box = (root?.querySelector<HTMLElement>('.ac-split-scroll') ?? root) as HTMLElement | null
  if (!box || typeof ResizeObserver === 'undefined') return
  modelBoxObserver = new ResizeObserver(() => {
    if (modelBoxResizeTimer !== null) window.clearTimeout(modelBoxResizeTimer)
    modelBoxResizeTimer = window.setTimeout(() => {
      modelBoxResizeTimer = null
      scrollSelectedModelIntoView()
    }, 80)
  })
  modelBoxObserver.observe(box)
}

watch(modelOpen, (open) => {
  if (!open) {
    modelBoxObserver?.disconnect()
    modelBoxObserver = null
    return
  }
  void nextTick(() => {
    scheduleScrollSelectedModel()
    observeModelBox()
  })
})

// 切卡片/分栏会换一整套列表（高度、行高都变），选中项的位置也跟着变，同样要重新定位
watch(modelView, () => {
  if (!modelOpen.value) return
  void nextTick(() => {
    // 切视图后滚动容器整个换了，观察者要跟着换到新容器上
    observeModelBox()
    scheduleScrollSelectedModel()
  })
})

// 组件卸载时断开观察者（面板关掉、Agent 面板被销毁都走这里）
onBeforeUnmount(() => {
  modelBoxObserver?.disconnect()
  modelBoxObserver = null
})

// 首次打开 MCP 面板时自动探一次：不探就没有工具清单，展开区是空的、也搜不到工具名。
watch(mcpOpen, (open) => {
  if (open) ensureMcpProbed()
})

/** 点一项 = 切模型并收起（滚不滚是打开那一刻的事，这里不用管） */
function pickModel(m: { provider: string; modelId: string }, close: () => void): void {
  // 切模型 = 换一条会话（SDK 的模型钉在会话上）：服务那边会把历史接过去、
  // 补一条模型分段，界面上就出现"从这里换了模型"的分割线（用户口径 2026-10-11）。
  void agent.setModel(m.provider, m.modelId)
  close()
}

/**
 * 模式 = **两套独立的系统提示词**（用户口径 2026-10-05）。
 *
 * 以前这里是个死开关（选了不影响任何行为）。现在它读后台的提示词清单：
 * 选中哪一条，发送时就把那条的正文当系统提示词发给后端（见 agentService.sendOptions）。
 * 清单在「设置 → Agent → 提示词」里维护；内置两条不可删。
 */
const promptPresets = computed(() => s.prompts)
const activePrompt = computed(() => s.prompts.find((p) => p.id === s.activePromptId))
const modeLabel = computed(() => activePrompt.value?.name ?? '全能创作')
function pickMode(id: string, close: () => void): void {
  void agent.setActivePrompt(id)
  close()
}

/**
 * 授权方式（输入框左下角那个下拉）。
 *
 * 它**直接映射**服务端的审批策略开关（`policy.enabled`），是同一条通道的两个入口 ——
 * 不是又存一份本地状态（两份必然漂移）。
 *   · 完全自动授权 = policy.enabled 关掉 = 所有工具直接放行；
 *   · 接受审核     = policy.enabled 打开 = 命中规则列表的工具先问用户（设置 → Agent → 审批规则）。
 *
 * 与规则列表页共用同一个 `agent.savePolicy`，所以这里一改、那边立刻就变。
 */
const AUTH_MODES = [
  // 图标与配色（用户口径 2026-10-03）：
  //   接受审核     = 手掌；**无色**（默认样式）—— "先停一下"是常态，不该用彩色喊出来；
  //   完全自动授权 = 盾牌 + 感叹号；**琥珀色**（图标与文字都染）—— 唯一需要用户留意的那个选项。
  // 与 ChatGPT 那份授权菜单的差别：那边"审核"带琥珀、"放行"带红；我们反过来，只给放行上色。
  { value: 'ask', label: '接受审核', hint: '需要确认时先停下来问你。', icon: Hand, tone: 'plain' },
  { value: 'auto', label: '完全自动授权', hint: '所有工具直接执行，不再逐次确认。', icon: ShieldAlert, tone: 'auto' },
] as const
const authMode = computed<'ask' | 'auto'>(() => (s.policy.enabled ? 'ask' : 'auto'))
function setAuthMode(mode: 'ask' | 'auto'): void {
  const enabled = mode === 'ask'
  if (enabled === s.policy.enabled) return
  void agent.savePolicy({ enabled, rules: s.policy.rules })
}

/**
 * 浏览器通知提示条（照参考页实测：383×40、圆角 12、8% 强调色底）。
 * 只在**还没授权**时出现；点「开启」走真的 Notification.requestPermission，
 * 授权失败（浏览器不给 / 用户拒绝）就把这条收起来，不再反复打扰。
 */
const notifyDismissed = ref(false)
const notifyPermission = ref(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
const showNotifyTip = computed(
  () => !notifyDismissed.value && notifyPermission.value === 'default',
)
async function enableNotify(): Promise<void> {
  if (typeof Notification === 'undefined') {
    notifyDismissed.value = true
    return
  }
  try {
    notifyPermission.value = await Notification.requestPermission()
  } catch {
    notifyPermission.value = 'denied'
  }
  notifyDismissed.value = true
}

/**
 * 「一轮跑完 / 队列跑完」的通知（设计 §3.5 / G11）。
 *
 * 为什么在组件里做：浏览器通知与提示音**只能由页面发**（后台脚本发不了）。
 * 两个开关读后台 KV 的 `agentNotify`（设置弹窗维护那一边，这里只读）；
 * 开关关了就不弹、不响；通知权限没给也不弹（宁缺勿扰，不弹错）。
 */
const notifyPrefs = ref<AgentNotifyPrefs>({ notify: false, sound: false })
async function refreshNotifyPrefs(): Promise<void> {
  notifyPrefs.value = await loadNotifyPrefs({ baseUrl: s.baseUrl })
}

/**
 * 会话标题 + 最后一条的摘要（通知正文用）。
 * 摘要在**动手之前**取：`done` 事件一到，最后那条助手消息就是这一轮的答案。
 */
function notifySummary(): { title: string; summary: string } {
  const last = [...s.turns].reverse().find((t) => t.kind === 'assistant' && (t.text ?? '').trim())
  // 摘要要把换行 / 连续空白压成一个空格（通知正文只显示一行）——
  // 这里原本写成了 /s+/g（丢了反斜杠）：它匹配的是「一个或多个字母 s」，
  // 于是换行原样留在正文里、而且正文里所有 s 都被换成了空格（真机实测）。
  const raw = (last?.text ?? '').replace(/\s+/g, ' ').trim()
  return { title: s.title || 'Agent', summary: raw.length > 80 ? raw.slice(0, 80) + '…' : raw }
}

/** 一轮跑完：弹通知 + 播音（开关在用户手里） */
function onRoundDone(): void {
  const { title, summary } = notifySummary()
  showNotify('round_done', { title, summary }, notifyPrefs.value)
  playNotifySound(notifyPrefs.value)
}

/** 队列全部发完且会话空闲：再弹一条（用户口径：队列跑完也要说一声） */
function onQueueIdle(): void {
  const { title, summary } = notifySummary()
  showNotify('queue_idle', { title, summary }, notifyPrefs.value)
  playNotifySound(notifyPrefs.value)
}

/**
 * 盯住"跑完"的两个时刻。
 *
 * 为什么用 watch 而不是直接吃 SSE 事件：SSE 的 `round_done` / `queue_idle` 事件由
 * 数据层消化（不进 ChatModel），组件这一层看到的是**它消化后的状态变化**：
 *   · 一轮结束 ⇒ `s.running` 从 true 变 false；
 *   · 队列跑完且空闲 ⇒ 上一条的用户消息在队里发出、队空 + 空闲。
 * 两个时刻在这里都能可靠地观测到，且不依赖数据层把事件转发出来。
 *
 * 摘要必须在**变化之后**取：这时最后一条助手消息已是这一轮的答案。
 *
 * 一条附带纪律：**每轮开跑时重读一次开关**（见下面 `refreshNotifyPrefs` 的调用）。
 * 开关只在组件挂载时读过一次，用户中途在设置里关了它、当前页面却不知道 ——
 * 表现是「关掉了照样弹」（实测）。读一次是一次轻量请求，且发生在几秒～几分钟的
 * 一轮开始处，等这一轮结束时用的一定是新值。
 */
let roundDoneTimer: ReturnType<typeof setTimeout> | null = null
/** 这一轮开始时队列里还有几条：> 0 且这一轮跑完时队列空了 = **队列全部跑完**（G11 的第二个时机） */
let queueAtRunStart = 0
watch(
  () => s.running,
  (now, before) => {
    if (!before && now) {
      queueAtRunStart = queue.value.count
      // 这一轮开跑时把开关读新：用户在设置里刚改的开关要能马上生效，
      // 不必刷新页面（否则「关掉了照样弹 / 打开了还是不弹」）。
      void refreshNotifyPrefs()
      return
    }
    if (!(before && !now)) return
    const drained = queueAtRunStart > 0 && queue.value.count === 0
    queueAtRunStart = 0
    // 稍等一拍再取摘要：`done` 之后的最后几个 delta 可能还在路上
    if (roundDoneTimer) clearTimeout(roundDoneTimer)
    roundDoneTimer = setTimeout(() => {
      roundDoneTimer = null
      onRoundDone()
      // 这一轮是队列里的最后一条 ⇒ 队列跑完了，再来一条（两个时机各一条，G11）
      if (drained) onQueueIdle()
    }, 250)
  },
)
onBeforeUnmount(() => {
  if (roundDoneTimer) clearTimeout(roundDoneTimer)
  // 断开事件流订阅（只是取消收听；后台那一轮照跑 —— 这是「后台对话」的语义）
  agent.detachStream()
})

/** 空态下的三行建议（照参考图；点了就填进输入框） */
const SUGGESTIONS = [
  { icon: Box, text: '感知画布开始创作' },
  { icon: Sparkles, text: '从爆款预设开始剧本原创' },
  { icon: WandSparkles, text: '上传故事来改编' },
]
function useSuggestion(text: string): void {
  // 走编辑器的 setText（整体覆盖）而不是 `prompt.value = text`：
  // 后者会被编辑器当成「外部变更」走 watch 的纯文本恢复分支，实测那条分支会在前面
  // 多留一个空段落 —— 表现就是「点预设提示词，文本前面多一个换行」（用户报的 bug）。
  editorRef.value?.setText(text)
  // setText 会回吐 update:modelValue，正常情况下这里已经同步过了；
  // 编辑器还没挂好（ref 为空）时才退回直接写，至少按钮不是死的。
  if (!editorRef.value) prompt.value = text
}

/**
 * 把用户消息的纯文本切成「文字 / 标签」两种片段。
 *
 * 解析本身住在 ../userSegments.ts（纯函数，有单测）—— 这里只做「按段渲染 + 点击派发」。
 * 转录里存的是 `<ref … />` XML 原文（后端不翻译），字段自带完整信息，不再靠名字回推。
 */
const userSegments = parseUserSegments

/**
 * 用户气泡的显示文本：剥掉 [user_steering] 块的标记只留内文（用户口径 2026-10-15）。
 * 为什么不动 t.text 本身：编辑回填、复制消息要走原文（复制带标记无意义时再看，
 * 先保证显示干净 —— 复制也走这里更符合直觉，一并处理）。
 */
function displayUserText(text: string): string {
  return stripUserSteering(text)
}

/**
 * 点对话里的标签：
 *   · 节点 → 让画布聚焦到它（读起来最自然，也是老行为）；
 *   · 资产（文件或文件夹）→ 发一条 `agent:ref-click` 系统事件，由应用层决定怎么响应。
 *
 * 为什么用事件而不是服务（用户口径 2026-10-08）：预览与资产管理弹窗属于成品应用，
 * 本插件按依赖方向 import 不到它。走服务时两边被一个**服务名**绑住（还要满足注入先后）；
 * 走事件则三方互不认识 —— 本插件只负责「有人点了这个引用」，谁想响应谁 ctx.on 监听。
 */
function onSegClick(seg: UserSegment): void {
  if (seg.nodeId) { focusNode(seg.nodeId); return }
  emitRefClick(assetRefInputOf(seg))
}

/**
 * 把「某条引用被点了」广播出去（`agent:ref-click`）。
 *
 * 只发**引用自带的字段**，不做翻译：怎么响应（预览 / 打开资产管理 / 别的）是监听方的事。
 * 没人监听也不报错（事件是广播，不是调用）。
 */
function emitRefClick(ref: AssetRefOpen): void {
  const payload = refClickPayloadOf({ ...ref, refType: 'asset' })
  if (payload) ctx.emit(REF_CLICK_EVENT, payload)
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
    emitRefClick,
  }
}

