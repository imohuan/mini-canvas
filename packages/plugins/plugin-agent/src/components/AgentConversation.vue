<script setup lang="ts">
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
 *  ① 下拉一律用**设计系统目录里登记的 dropdown**（useUiComponent('dropdown')），
 *    不自绘浮层 —— 定位/翻边/出屏收进/互斥/点外关闭都由它统一负责（换主题零改动）。
 *  ② 技能 / MCP / 节点是**输入框内联标签**：点下拉里的一项 = 往正文插一个标记 chip，
 *    引用了谁由正文里的标记决定 —— 删掉 chip 引用即失效，不再切开关。
 */
import { computed, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
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
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import { useAgent } from '../useAgent.js'
import { useStickyScroll } from '../useStickyScroll.js'
import { groupTurnBlocks, type TurnRow } from '../turnBlocks.js'
import { scrollTopForVisibleItem } from '../selectionScroll.js'
import { brandName, brandSvg, detectPlatform } from '../modelBrandIcons.js'
// ICON_SKILL / ICON_MCP 由模板直接 v-html（@ 下拉里的菜单卡片头图）；解析那一段已搬去 userSegments。
import { skillResources, mcpResources, mcpToolResource, nodeResources, assetResource, assetResources, ICON_SKILL, ICON_MCP, type AssetRefOpen, type CanvasNodeRow } from '../agentResources.js'
import { parseUserSegments, segClickable, segTitle, assetRefInputOf, type UserSegment } from '../userSegments.js'
import { stripUserSteering } from '../userSteering.js'
import { REF_CLICK_EVENT, refClickPayloadOf } from '../refClickEvents.js'
import { DEFAULT_SUBMIT_KEY_MODE, isSubmitShortcut, normalizeSubmitKeyMode, shouldDeferEnterToMenu, loadSubmitKeyMode, type SubmitKeyMode } from '../composerKeys.js'
import { pagerAnchors, type PagerGroup } from '../branchNav.js'
import { segmentAnchors } from '../modelSegments.js'
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
} from '../queueModel.js'
import type { QueueStateView } from '../agentApi.js'
import { loadNotifyPrefs, notifyPayload, playNotifySound, showNotify, type AgentNotifyPrefs } from '../agentNotify.js'
import { loadQueueShowSending } from '../queuePrefs.js'
import { toolView, toolBrief, type ToolView } from '../toolViews.js'
import type { AgentTurnView, ToolCard } from '../sessionModel.js'
import AgentMarkdown from './AgentMarkdown.vue'
import ToolViewBody from './ToolViewBody.vue'

const agent = useAgent()
const s = agent.state

/** 画布上下文：节点 @ 引用与「点标签聚焦节点」都要它（doc / viewport / nodeLayout） */
const { ctx } = useCanvasRender()

/**
 * 根是多根（fragment）：对话本体 .ac-root + 一个全屏 MediaViewer。
 * SlotHost 会下发 class / data-slot-* 等属性，fragment 根没有唯一元素可继承，
 * Vue 每次渲染都会警告一条 "Extraneous non-props attributes ... fragment root nodes"。
 * 这里关掉自动继承（这些属性对对话面板没有意义）。
 */
defineOptions({ inheritAttrs: false })

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
 * 分段切换（卡片 / 分栏）的两枚图标 —— 直接照抄 DEMO 的 LINE.grid / LINE.columns。
 *
 * 为什么不用 lucide 的 LayoutGrid / Columns3：同一块面板里技能封面、MCP 插头
 * 都走 agentResources 的内联 SVG（stroke-width 2、圆角 1.6 的方框），再混一套
 * lucide 组件会出现「线条粗细与圆角不一致」的两套图标观感（用户 2026-10-29 指出过）。
 * 统一成 DEMO 原图后，面板内部只有一种线稿。
 */
const ICON_VIEW_GRID =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></svg>'

const ICON_VIEW_SPLIT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>'

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

/** 设计系统件按名取（主题目录）：换主题时这里一行不改 */
const ThemedDropdown = useUiComponent('dropdown')
/** 悬浮提示也走主题目录（与 dropdown 同一套做法）—— 提示气泡的观感随主题一起换 */
const ThemedTooltip = useUiComponent('tooltip')
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
const editorRef = ref<InstanceType<typeof ProseMirrorEditor> | null>(null)
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
  const layout = ctx.tryGet<{ getNodeRect(id: string): { x: number; y: number; w: number; h: number } | null }>('nodeLayout')
  const viewport = ctx.tryGet<{ setCenter(x: number, y: number, zoom?: number): void; getViewport(): { zoom: number } }>('viewport')
  if (!viewport) return
  const rect = layout?.getNodeRect(nodeId)
  if (rect) {
    viewport.setCenter(rect.x + rect.w / 2, rect.y + rect.h / 2, viewport.getViewport().zoom)
    return
  }
  const doc = ctx.tryGet<{ getNode(id: string): { position: { x: number; y: number } } | undefined }>('doc')
  const node = doc?.getNode(nodeId)
  if (node) viewport.setCenter(node.position.x, node.position.y, viewport.getViewport().zoom)
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
/** 技能分栏的分类过滤（DEMO 的 activeCategory；卡片视图不看它，切到卡片时重置为全部） */
const skillCategory = ref('全部')
/** 窄面板下折叠成按钮的搜索框（DEMO 的 searchOpen；三个面板各一份） */
const modelSearchOpen = ref(false)
const skillSearchOpen = ref(false)
const mcpSearchOpen = ref(false)

function searchOpenOf(kind: 'skill' | 'mcp' | 'model') {
  return kind === 'skill' ? skillSearchOpen : kind === 'mcp' ? mcpSearchOpen : modelSearchOpen
}

/** 点搜索按钮：展开/收起（展开后自动聚焦输入框，与 DEMO 一致） */
function togglePanelSearch(kind: 'skill' | 'mcp' | 'model'): void {
  const box = searchOpenOf(kind)
  box.value = !box.value
  if (!box.value) return
  void nextTick(() => {
    const el = document.querySelector<HTMLInputElement>('[data-ac-search="' + kind + '"]')
    el?.focus()
  })
}

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
</script>

<template>
  <div class="ac-root" aria-label="Agent 对话">
    <!-- ① 未配模型：引导 -->
    <div v-if="s.needsModel" class="ac-onboard">
      <Sparkles :size="22" class="ac-onboard-icon" />
      <strong>还没有可用的模型</strong>
      <p>先去设置里加一个带 API Key 的模型，回来就能对话了。</p>
      <p class="ac-onboard-path">{{ s.models.length ? '现有模型都没有密钥' : '当前没有任何模型' }}</p>
    </div>

    <!-- ② 连不上后台 -->
    <div v-else-if="s.offline" class="ac-onboard">
      <strong>连不上后台</strong>
      <p>{{ s.error || '请确认 cloud-server 已经启动。' }}</p>
      <p class="ac-onboard-path">{{ s.baseUrl || '同源（当前页面所在地址）' }}</p>
      <button class="ac-btn" @click="agent.refresh()">重试连接</button>
    </div>

    <!-- ③ 消息流 -->
    <div v-else class="ac-scroll-wrap">
      <!-- 「回到底部」（用户口径 2026-10-09）：放在**消息区内部、底部居中**。
         有滚动条且未滚到底时才出现（原语义不变）。 -->
      <button v-if="showScrollToBottom" class="ac-to-bottom" aria-label="回到底部" title="回到底部"
        @click="smoothScrollToBottom()">
        <ChevronDown :size="16" />
      </button>
      <div ref="scroller" class="ac-scroll" role="log" aria-live="polite">
        <!-- 稳定的**内容容器**：空态与消息流都在它里面。
           为什么必须有一层稳定的壳：ResizeObserver 只能盯住一个具体的 DOM 节点，
           而空态与消息流是 v-if/v-else 互换的（挂载时看到的那个节点随后会被换掉），
           盯它就会盯到已被丢弃的节点上 —— 内容再长也不触发。 -->
        <div class="ac-inner">
          <!-- 更早历史的加载哨兵（用户口径 2026-10-15）：对话只先装最后三四轮，
               滚到顶、这个元素进入可视区域才拉更早的（每次之间有最小间隔）。
               可视化元素：加载中显示转圈文案，还有更早但没加载时给一条淡提示。 -->
          <div v-if="s.turns.length && (s.turnsHaveBefore || s.turnsLoadingEarlier)" ref="earlierSentinel"
            class="ac-earlier" role="status">
            <span v-if="s.turnsLoadingEarlier" class="ac-earlier-loading">
              <Loader2 :size="13" class="ac-spin" />
              <span>正在加载更早的对话…</span>
            </span>
            <span v-else class="ac-earlier-hint">向上滚动查看更早的对话</span>
          </div>
          <!-- 空态：中心欢迎 + 三行建议（照参考图） -->
          <div v-if="!s.turns.length" class="ac-welcome">
            <div v-if="!hintDismissed" class="ac-hint-card">
              <p class="ac-hint-text"><strong>我能帮你做很多事</strong>，比如回答问题、写文章、编剧本、生成图片/视频/音频…</p>
              <button class="ac-hint-close" aria-label="我知道了" @click="dismissHint">
                <X :size="13" />
              </button>
            </div>
            <div class="ac-welcome-orb"></div>
            <p class="ac-welcome-title">让 Agent 辅助你的无限创意</p>
            <div class="ac-suggestions">
              <button v-for="g in SUGGESTIONS" :key="g.text" class="ac-suggestion" @click="useSuggestion(g.text)">
                <component :is="g.icon" :size="15" />
                <span>{{ g.text }}</span>
                <ChevronRight :size="14" class="ac-suggestion-arrow" />
              </button>
            </div>
          </div>

          <template v-for="t in s.turns" :key="t.id">
            <!-- 模型分割线（用户口径 2026-10-11）：切换模型 = 换一条会话（SDK 的模型钉在会话上），
             所以在"这边的第一句话"之前横一条线，标明这一段用的是哪个模型。
             div 不能省：用 template 包两层兄弟节点时 v-for 的 key 会落到顶层节点上，
             而分割线要先于消息渲染。 -->
            <div v-if="segmentByAnchor.get(t.id)" class="ac-model-split" role="separator"
              :aria-label="'从这里开始使用模型 ' + segmentModelLabel(segmentByAnchor.get(t.id)!)">
              <span class="ac-model-split-line"></span>
              <span class="ac-model-split-badge">
                <Box :size="12" />
                <span class="ac-model-split-name">{{ segmentModelLabel(segmentByAnchor.get(t.id)!) }}</span>
              </span>
              <span class="ac-model-split-line"></span>
            </div>
            <!-- 审批卡片：**只在等你决定时出现**。点过允许/拒绝之后这张卡就消失
             （用户口径：「都授权了 就不显示」）—— 已经放行、工具也跑完了，
             再挂一张「已允许」的死卡片只是挡着看下面的内容。 -->
            <div v-if="t.kind === 'approval' && !t.approval?.decision" class="ac-approval">
              <div class="ac-approval-head">
                <Loader2 :size="14" class="ac-spin" />
                <strong>需要审批：{{ t.approval?.toolName }}</strong>
              </div>
              <pre class="ac-approval-args">{{ t.approval?.arguments }}</pre>
              <div class="ac-approval-actions">
                <button class="ac-btn ac-btn-primary" @click="agent.decide(t.approval!.id, 'allow')">允许</button>
                <button class="ac-btn" @click="agent.decide(t.approval!.id, 'deny')">拒绝</button>
              </div>
            </div>

            <!-- 用户靠右 / 助手靠左（照参考图，都没有头像） -->
            <div v-else class="ac-msg" :class="[t.kind, { 'is-editing': t.editing }]">
              <div class="ac-bubble">
                <!-- 助手内容**按到达顺序**逐块渲染（用户口径 2026-10-05）：
                 文字一段、中间没有文字隔开的多个工具合并成一组、再一段文字。
                 以前这里是「先把所有工具画完、再画正文」，所以工具永远堆在最上面、看不出时序。
                 注意：思考现在也是分界线（用户口径 2026-10-16）：每段思考按发生位置
                 原位渲染成折叠行（thinking 行），不再统一堆到顶部。 -->
                <template v-for="row in assistantRows(t)" :key="row.key">
                  <AgentMarkdown v-if="row.type === 'text' && row.text" :text="row.text" />

                  <!-- 原位思考折叠行：这一段思考发生在它所处的位置（用户口径 2026-10-16） -->
                  <div v-else-if="row.type === 'thinking' && row.text" class="ac-think-inline">
                    <button class="ac-think-toggle" @click="toggleThinking(t.id + ':' + row.key)">
                      <ChevronRight :size="12" :class="{ 'ac-rot': openThinking[t.id + ':' + row.key] }" />思考过程
                    </button>
                    <pre v-if="openThinking[t.id + ':' + row.key]" class="ac-think">{{ row.text }}</pre>
                  </div>

                  <!-- 单工具：**只有带自定义卡片的画布 MCP 工具**才直接展示卡片；
                   其余全部走默认折叠行（用户口径 2026-10-10：审批有自己的卡片 UI，
                   不该给底层工具再打「卡片」标记把它顶成常驻展开 —— exec_command 这类
                   要恢复成折叠行，对齐 docs/tmp/tool-card-demo-v3.html 的做法）。 -->
                  <template v-else-if="row.type === 'tools' && row.tools.length === 1 && hasCardView(row.tools[0])">
                    <div class="ac-tool-card">
                      <!-- 运行中才给一行转圈（卡片还没内容时的进度指示）。
                       跑完就整行收掉：卡片自己的头行（图标 + 标题 + 角标）已经是头部，
                       再叠一行摘要（如「+1 ~ 0 -0」）与下面的「1 新增 / 0 更新 / 0 删除」纯属重复
                       （用户口径 2026-10-10：删掉那行没意义的文字）。 -->
                      <div v-if="!row.tools[0].settled" class="ac-tool-head">
                        <Loader2 :size="13" class="ac-spin" />
                      </div>
                      <ToolViewBody :view="viewOf(row.tools[0])" :args="row.tools[0].arguments"
                        :output="row.tools[0].output" :name="row.tools[0].name" @preview="previewToolMedia" />
                    </div>
                  </template>
                  <!-- 默认工具（通用）：折叠行 —— 收起 = 箭头 + 名字 + 摘要；展开 = 输入/输出 -->
                  <template v-else-if="row.type === 'tools' && row.tools.length === 1">
                    <div class="ac-tool-fold">
                      <button class="ac-tf-toggle" :aria-expanded="!!openTools[row.tools[0].id]"
                        @click="toggleTool(row.tools[0].id)">
                        <ChevronRight :size="13" class="ac-tf-caret"
                          :class="{ 'is-open': openTools[row.tools[0].id] }" />
                        <code>{{ row.tools[0].name }}</code>
                        <span v-if="toolRowSummary(row.tools[0])" class="ac-tf-summary">{{ toolRowSummary(row.tools[0])
                          }}</span>
                      </button>
                      <div v-if="openTools[row.tools[0].id]" class="ac-tf-body">
                        <ToolViewBody :view="viewOf(row.tools[0])" :args="row.tools[0].arguments"
                          :output="row.tools[0].output" :name="row.tools[0].name" @preview="previewToolMedia" />
                      </div>
                    </div>
                  </template>

                  <!-- 多个工具：折成一组（用户口径：中间没有文字的工具要合并），标题点开看逐个明细 -->
                  <div v-else-if="row.type === 'tools'" class="ac-tool-group">
                    <button class="ac-tg-toggle" :aria-expanded="!!openToolGroups[row.key]"
                      @click="toggleToolGroup(row.key)">
                      <ChevronRight :size="13" class="ac-tf-caret" :class="{ 'is-open': openToolGroups[row.key] }" />
                      {{ toolGroupTitle(row.tools) }}
                    </button>
                    <div v-if="openToolGroups[row.key]" class="ac-tg-body">
                      <div v-for="tool in row.tools" :key="tool.id"
                        :class="hasCardView(tool) ? 'ac-tool-card' : 'ac-tool-fold'">
                        <!-- 有卡片（画布 MCP）→ 直接展示；其余（含要审批的默认工具）→ 折叠行 -->
                        <template v-if="hasCardView(tool)">
                          <div class="ac-tool-head">
                            <!-- 同上：只留运行中的转圈，跑完不再叠一行与卡片自身重复的摘要 -->
                            <Loader2 v-if="!tool.settled" :size="13" class="ac-spin" />
                          </div>
                          <ToolViewBody :view="viewOf(tool)" :args="tool.arguments" :output="tool.output"
                            :name="tool.name" @preview="previewToolMedia" />
                        </template>
                        <template v-else>
                          <button class="ac-tf-toggle" :aria-expanded="!!openTools[tool.id]"
                            @click="toggleTool(tool.id)">
                            <ChevronRight :size="13" class="ac-tf-caret" :class="{ 'is-open': openTools[tool.id] }" />
                            <code>{{ tool.name }}</code>
                            <span v-if="toolRowSummary(tool)" class="ac-tf-summary">{{ toolRowSummary(tool) }}</span>
                          </button>
                          <div v-if="openTools[tool.id]" class="ac-tf-body">
                            <ToolViewBody :view="viewOf(tool)" :args="tool.arguments" :output="tool.output"
                              :name="tool.name" @preview="previewToolMedia" />
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- 用户消息：把正文里出现的 @技能 / @MCP 还原成**标签**（与输入框里那颗 chip 同款），
                 其余文字照常显示。为什么不直接存结构化引用：会话历史里只有纯文本（后端只存
                 getPlainText 的结果），靠"@名字 + 已装清单"回推，刷新/切会话也得到同一份渲染。 -->
                <!-- 默认只显示前 8 行（用户口径 2026-10-15）：长消息夹在 max-height 里，
                 超出的内容点左下角「展开」再看；收起按钮原地换「收起」。 -->
                <template v-if="t.kind === 'user'">
                  <p v-if="t.text" class="ac-user-line" :ref="setUserBubbleBody(t.id)"
                    :class="{ 'is-open': openUserBubbles[t.id] }">
                    <!-- user_steering 块（后台队列自动发的）剥掉标记只显示内文（用户口径 2026-10-15） -->
                    <template v-for="(seg, si) in userSegments(displayUserText(t.text))" :key="si">
                      <!-- 节点标签**可点击聚焦**（节点存在且没被删时）：与输入框里的标签同一交互。
                       用户口径 2026-10-06：对话里出现的节点标签也要能点。 -->
                      <span v-if="seg.type === 'tag'" class="ac-sent-tag"
                        :class="{ 'is-clickable': segClickable(seg) }" :title="segTitle(seg)"
                        :role="segClickable(seg) ? 'button' : undefined"
                        :tabindex="segClickable(seg) ? 0 : undefined" @click="onSegClick(seg)"
                        @keydown.enter.prevent="onSegClick(seg)">
                        <span class="ac-sent-tag-icon" v-html="seg.icon" aria-hidden="true"></span>
                        <span class="ac-sent-tag-label">{{ seg.name }}</span>
                      </span>
                      <span v-else class="ac-user-text">{{ seg.value }}</span>
                    </template>
                  </p>
                  <button v-if="overflowingUser[t.id]" class="ac-user-toggle"
                    :aria-expanded="!!openUserBubbles[t.id]" aria-label="展开完整消息"
                    :title="openUserBubbles[t.id] ? '收起' : '展开'" @click="toggleUserBubble(t.id)">
                    {{ openUserBubbles[t.id] ? '收起' : '展开' }}
                    <ChevronDown v-if="!openUserBubbles[t.id]" :size="13" />
                    <ChevronUp v-else :size="13" />
                  </button>
                </template>
                <!-- 用户消息带的图：按原比例排一行缩略图，点开看大图 -->
                <div v-if="t.kind === 'user' && t.images?.length" class="ac-user-images">
                  <button v-for="(src, ii) in t.images" :key="ii" class="ac-user-image" :aria-label="'查看图片 ' + (ii + 1)"
                    @click="openPreview(src, t.images)">
                    <img :src="src" alt="" />
                  </button>
                </div>
                <!-- 「正在编辑」徽标（用户口径 2026-10-06：语义是正在编辑，不是已编辑；带高亮） -->
                <span v-if="t.editing" class="ac-editing-badge" role="status">
                  <Pencil :size="12" />正在编辑
                  <button class="ac-editing-x" aria-label="取消编辑" @click="agent.cancelEdit()">
                    <X :size="12" />
                  </button>
                </span>
                <!-- 助手消息才走 Markdown。
                 这里**必须**是独立的 v-if，不能接在用户那条的 v-else-if 链上：
                 中间隔着「用户图片」那个 div 时，链会被打断，导致用户消息既渲染标签行、
                 又再渲染一遍原始 Markdown 文本（实测文本重复出现两次，还带出字面 @名字）。 -->
                <!-- 「正在思考」就是个**加载指示**：显示依据 = 输入框按钮的「停止」状态
                 （s.running，用户口径 2026-10-16 二次澄清：按钮状态就是加载状态）。
                 与 t.streaming 解耦：streaming 标记会被 hub 重放/收尾逻辑翻转，
                 而 s.running 由后端 run_state 驱动、刷新后由 openSession 恢复，是唯一真相。 -->
                <p v-if="showPendingOn(t)" class="ac-pending" role="status" aria-live="polite">
                  <!-- 图标是**一段开口的圆弧**（照参考图：3/4 圈转圈），不是整圈的 Loader2 ——
                   整圈转起来几乎看不出在动，开口的弧才有"在转"的观感。 -->
                  <span class="ac-pending-spin" aria-hidden="true"></span>
                  <span>正在思考</span>
                </p>
                <!-- 用户按了终止（用户口径 2026-10-16：对话里要有表示，不能静默收场） -->
                <p v-if="t.aborted" class="ac-stopped" role="status">
                  <CircleSlash :size="13" aria-hidden="true" />
                  <span>已停止</span>
                </p>
                <!-- 过程提示（主要是「已连接 MCP：smart(3 个工具)」这类）**暂时隐藏**。
                 用户口径：不要删除，只是先不显示 —— 每次对话都冒一条、又说不清什么时候会出现，
                 反而干扰阅读；MCP 的真实状态改在下拉里实时看（见 MCP 下拉里的「检测」）。
                 数据仍在 turn.notice 上，想放回来把 SHOW_PROCESS_NOTICE 改 true 即可。 -->
                <p v-if="SHOW_PROCESS_NOTICE && t.notice" class="ac-notice">{{ t.notice }}</p>
                <template v-if="t.error">
                  <p class="ac-error">{{ t.error }}</p>
                </template>
              </div>
              <!-- hover 操作条在**气泡外**（用户口径 2026-10-06 参考图：时间/复制/编辑贴着消息右下角，
               不挤占气泡内边距）。编辑 = 把这条消息回填到底部输入框。 -->
              <div v-if="t.kind === 'user'" class="ac-msg-actions">
                <span class="ac-msg-time" :title="msgTimeTitle(t.ts)">{{ msgTimeText(t.ts) }}</span>
                <button class="ac-msg-btn" :aria-label="copied[t.id] ? '已复制' : '复制消息'" title="复制"
                  @click="copyMessage(t.text, t.id)">
                  <CircleCheck v-if="copied[t.id]" :size="13" class="is-ok" />
                  <Copy v-else :size="13" />
                </button>
                <button class="ac-msg-btn" aria-label="编辑消息（回填到输入框）" title="编辑" @click="beginEditMessage(t)">
                  <Pencil :size="13" />
                </button>
              </div>
            </div>
            <!-- 内联分支分页器（用户口径 2026-10-07）：跟随消息 —— 渲染在这条消息的
             回复块结束处（下一条用户消息之前）。左右箭头切的是**这个位置**的其它版本，
             切过去后不含当前版本后来的消息。 -->
            <div v-if="pagerByAnchor.get(t.id)" class="ac-branch-nav" role="navigation" aria-label="切换分支版本">
              <button class="ac-branch-arrow" :disabled="pagerByAnchor.get(t.id)!.index <= 0" aria-label="上一个版本"
                title="上一个版本"
                @click="pagerTarget(pagerByAnchor.get(t.id)!, -1) !== null && agent.openSession(pagerTarget(pagerByAnchor.get(t.id)!, -1)!)">
                <ChevronLeft :size="14" />
              </button>
              <span class="ac-branch-pos" :title="pagerByAnchor.get(t.id)!.items[pagerByAnchor.get(t.id)!.index].label">
                {{ pagerByAnchor.get(t.id)!.position }} / {{ pagerByAnchor.get(t.id)!.total }}
              </span>
              <button class="ac-branch-arrow"
                :disabled="pagerByAnchor.get(t.id)!.index >= pagerByAnchor.get(t.id)!.total - 1" aria-label="下一个版本"
                title="下一个版本"
                @click="pagerTarget(pagerByAnchor.get(t.id)!, 1) !== null && agent.openSession(pagerTarget(pagerByAnchor.get(t.id)!, 1)!)">
                <ChevronRight :size="14" />
              </button>
            </div>
          </template>
          <!-- 压缩进度 / 结果（用户口径 2026-10-11）：压缩要跑一次模型，几十秒内必须有回音。
           放在消息流末尾而不是顶部：它是"刚发生的事"，跟着最新内容一起看最自然。 -->
          <div v-if="s.compacting" class="ac-compact-note" role="status" aria-live="polite">
            <Loader2 :size="13" class="ac-spin" />
            <span>正在压缩上下文…</span>
          </div>
          <div v-else-if="s.compactNotice" class="ac-compact-note" role="status">
            <Minimize2 :size="14" />
            <span>{{ s.compactNotice }}</span>
            <button class="ac-note-x" aria-label="知道了" @click="s.compactNotice = ''">
              <X :size="12" />
            </button>
          </div>
          <!-- 常驻错误条（用户口径 2026-10-11 的问题 2）：这一轮失败时**必须**看得见。
           为什么要一条独立的条：错误以前只挂在"最后一条助手消息"上 —— 出错时若那条
           还没建出来（请求在 bootstrap 阶段就失败），错误就落在空气里，用户什么也看不到。
           若这条错误已经挂在某条消息上（不重复显示），这条就不画。 -->
          <div v-if="s.lastError && !hasInlineError" class="ac-error-bar" role="alert">
            <AlertCircle :size="14" class="ac-error-bar-icon" />
            <span class="ac-error-bar-text">{{ s.lastError }}</span>
            <button class="ac-note-x" aria-label="关闭错误提示" @click="s.lastError = ''">
              <X :size="12" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ④ 输入区（照参考图：整块圆角 16 的框，里面上编辑器、下工具条） -->
    <div class="ac-composer">
      <!-- 通知提示条（照参考页实测）：只在浏览器还没授权时出现，点「开启」走真的权限申请 -->
      <div v-if="showNotifyTip" class="ac-notify" role="status">
        <BellRing :size="14" class="ac-notify-icon" />
        <span class="ac-notify-text">开启浏览器通知，及时获取最新消息</span>
        <button class="ac-notify-btn" @click="enableNotify">开启</button>
        <button class="ac-notify-close" aria-label="不再提示" @click="notifyDismissed = true">
          <X :size="13" />
        </button>
      </div>
      <!-- 排队列表（设计 §3.6.1）：**紧贴**输入框上缘、宽 80%、靠左；右侧 36px 一列放
           暂停 / 启动按钮（G9）。
           「回到底部」不在这里 —— 它是**随时要用**的（队列空时也要能点），
           所以独立悬浮在消息区右下角（见下面的 .ac-to-bottom）。
           照旧贴着 .ac-input-box —— 即使还没配模型（输入框还在，只是没编辑器）也照画，
           否则队列里的消息会**没有任何入口**能删。 -->
      <!-- 聚合容器（用户口径 2026-10-09）：目标行 + 队列行**同一个容器**，在输入框**外面**。
           宽 90% 居中、紧贴输入框（零间隔、边框重叠 1px）；**只有外层有圆角，内部行一律方角**。 -->
      <div v-if="pending.hasAny" class="ac-pending-box">
        <div class="ac-pending-list" role="list" aria-label="目标与排队消息">
          <!-- 排队消息在上、**目标在最下**（用户口径 2026-10-11）：
                 目标是一个持续进行的循环，队列排它前面 —— 每轮跑完先清队列，
                 队列清空后才轮到目标下一轮。展示顺序跟执行顺序保持一致。 -->
          <!-- 编辑中的那条会**停住整个队列**（G7）：说清楚原因，别让用户以为卡住了 -->
          <VueDraggable :model-value="queue.rows" class="ac-queue-drag" :animation="180"
            ghost-class="ac-queue-row--ghost" chosen-class="ac-queue-row--chosen"
            handle=".ac-queue-lead-swap" @update:model-value="onQueueReorder">
            <div v-for="row in queue.rows" :key="row.id" class="ac-pending-row ac-queue-row" role="listitem"
              :class="{ 'is-editing': row.editing, 'is-sending': row.sending, 'is-hover': hoverRowId === row.id }"
              @pointerenter="hoverRowId = row.id" @pointerleave="hoverRowId === row.id && (hoverRowId = null)">
              <!-- 左侧图标 + 拖拽把手（用户口径 2026-10-16 二次修正）：默认显示**原来的
                   图标**，hover 这一行时才换成拖拽把手 —— 图标不变会显得突兀，要"有变化"。
                   发送中 / 已发送的行没有把手 —— 它们的位置由调度器钉住，不参与排序。 -->
              <span v-if="!row.sending && !row.sent" class="ac-queue-lead-swap" aria-hidden="true">
                <span class="ac-pending-lead is-rest">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 3v12" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                </span>
                <span class="ac-queue-handle" title="拖动调整发送顺序" :aria-label="'拖动 ' + (row.text || '').slice(0, 20)">
                  <GripVertical :size="12" />
                </span>
              </span>
              <span v-else class="ac-pending-lead" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 3v12" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
            </span>
            <!-- 迷你图 + 「+N」：白图与背景同色会看不见，加一圈淡边框（不抢眼）；多于 1 张显示 +N -->
            <img v-if="row.thumbs.length" class="ac-queue-thumb" :src="row.thumbs[0]" alt="" role="button"
              :aria-label="'查看排队图片'" :title="'这条消息带 ' + row.images.length + ' 张图'"
              @click="openPreview(row.thumbs[0], row.images)" />
            <span v-if="row.images.length > 1" class="ac-queue-thumb-more" role="status"
              :title="'共 ' + row.images.length + ' 张图'">+{{ row.images.length - 1 }}</span>
            <span class="ac-queue-text" :title="displayUserText(row.text)">
              <!-- 队列条目也是**用户消息**：@节点 / @技能 标记同样要渲染成标签，
                     否则那串 <ref …> XML 原样露出（用户口径 2026-10-11：气泡/目标/队列三处都要认）。 -->
              <template v-if="row.text">
                <template v-for="(seg, si) in userSegments(displayUserText(row.text))" :key="si">
                  <span v-if="seg.type === 'tag'" class="ac-sent-tag is-compact" :title="segTitle(seg)">{{ seg.name
                    }}</span>
                  <span v-else>{{ seg.value }}</span>
                </template>
              </template>
              <template v-else>（图片）</template>
            </span>
            <!-- 编辑中：队列**整体阻塞**（后端保证不发下一条），行上直接说明，用户不用猜为什么不动 -->
            <span v-if="row.editing" class="ac-queue-flag" role="status">编辑中</span>
            <span v-else-if="row.goal" class="ac-queue-flag is-goal"
              :title="'目标：' + goalMarkText(row.goal.objective, row.goal.budget)">目标</span>
            <span v-if="row.sending" class="ac-queue-flag is-sending">发送中</span>
            <span v-else-if="row.sent" class="ac-queue-flag is-sent">已发送</span>

            <span class="ac-queue-actions">
              <!-- 编辑中：这一条是"停住队列"的那条，行上给一个取消编辑（状态回 queued） -->
              <button v-if="row.editing" class="ac-queue-btn" aria-label="取消编辑这条排队消息" title="取消编辑"
                @click="cancelEditQueue(row.id)">
                <X :size="12" />
              </button>
              <!-- 引导 ↳：跑着时 = 插队（插进当前轮的下一次请求）；没跑时后端直接当一次发送 -->
              <button v-else class="ac-queue-btn" aria-label="引导（插队发送）" title="引导：插到当前这一轮的下一次请求"
                @click="steerItem(row.id)">
                <CornerUpRight :size="12" />
              </button>
              <button class="ac-queue-btn is-danger" aria-label="删除这条排队消息" title="删除" @click="removeItem(row.id)">
                <Trash2 :size="12" />
              </button>
              <!-- ⋯ 只有两项：编辑消息 / 关闭排队（设计 §3.6.2），用目录里的 dropdown -->
              <ThemedDropdown placement="top-end" :offset="6" menu-width="180px" :model-value="rowMenuId === row.id"
                @update:model-value="(v: boolean) => (rowMenuId = v ? row.id : null)">
                <template #trigger>
                  <button class="ac-queue-btn" :aria-expanded="rowMenuId === row.id" aria-label="更多操作">
                    <MoreHorizontal :size="12" />
                  </button>
                </template>
                <template #default="{ close }">
                  <div class="ac-ddmenu" role="menu" aria-label="排队消息操作">
                    <button class="ac-menu-item" role="menuitem" @click="beginEditQueue(row.id); close()">
                      <span class="ac-menu-name">编辑消息</span>
                      <span class="ac-menu-hint">改完发送，位置不变</span>
                    </button>
                    <button class="ac-menu-item" role="menuitem" @click="closeItem(row.id); close()">
                      <span class="ac-menu-name">关闭排队</span>
                      <span class="ac-menu-hint">内容回到输入框，不再自动发</span>
                    </button>
                  </div>
                </template>
              </ThemedDropdown>
            </span>
          </div>
          </VueDraggable>
          <!-- 目标行（**已发送**的目标才进列表；未发送的在输入框内侧）—— 排在**队列之后、最下面**。
                 UI 与队列行刻意不同：强调色底 + 「第 N 轮」+ 已用/总预算 + 暂停/结束。 -->
          <div v-if="goalRow" class="ac-pending-row ac-goal-row" :class="{ 'is-editing': editingGoal }" role="listitem">
            <!-- 左侧图标：hover 时从「目标」变成「编辑」（用户口径 2026-10-09），点它进入编辑 -->
            <!-- 真完成的目标**不需要编辑**（用户口径 2026-10-09）：那时只画一个纯图标、不可点。
                   注意判据是 goalRow.finished（不是 ended）—— 「被中止」仍可编辑/可续跑。 -->
            <button v-if="!goalRow.finished" class="ac-pending-lead ac-goal-lead" type="button"
              :aria-label="editingGoal ? '正在编辑目标' : '编辑目标'" :title="editingGoal ? '正在编辑目标' : '编辑目标'"
              :class="{ 'is-editing': editingGoal }" @click="startEditGoalRow()">
              <!-- 图标尺寸与队列行的 lead 完全一致（14×14，内联 SVG）—— 两行左列才对得齐 -->
              <Target :size="14" class="ac-goal-lead-target" />
              <Pencil :size="14" class="ac-goal-lead-edit" />
            </button>
            <span v-else class="ac-pending-lead" aria-hidden="true">
              <Target :size="14" />
            </span>
            <!-- 目标参考图迷你预览：**放文字前面**（与队列行同位——lead 图标之后、正文之前）。
                   淡边框 + 多图「+N」，与队列缩略图同一套样式（用户口径 2026-10-09）。 -->
            <template v-if="s.goalImages?.length">
              <img class="ac-queue-thumb" :src="s.goalImages[0]" alt="" role="button" :aria-label="'查看目标图片'"
                :title="'这个目标带 ' + s.goalImages.length + ' 张图'" @click="openPreview(s.goalImages[0], s.goalImages)" />
              <span v-if="s.goalImages.length > 1" class="ac-queue-thumb-more" role="status"
                :title="'共 ' + s.goalImages.length + ' 张图'">+{{ s.goalImages.length - 1 }}</span>
            </template>
            <span class="ac-goal-row-text" :title="s.goal?.objective">
              <!-- 目标是**用户消息**：正文里的 @节点 / @技能 标记要跟气泡同一套解析渲染成标签，
                     否则那串 <ref …> XML 会原样露出来（用户实测 2026-10-11）。 -->
              <template v-for="(seg, si) in userSegments(s.goal?.objective ?? '')" :key="si">
                <span v-if="seg.type === 'tag'" class="ac-sent-tag is-compact" :title="segTitle(seg)">{{ seg.name
                  }}</span>
                <span v-else>{{ seg.value }}</span>
              </template>
            </span>
            <span class="ac-goal-flag" :class="goalRow.badge.cls" role="status">{{ goalRow.badge.text }}</span>
            <!-- 编辑目标时在右侧打「正在编辑」标签（与消息/队列编辑同一套黄色语义，用户口径 2026-10-09） -->
            <span v-if="editingGoal" class="ac-editing-badge is-compact" role="status">
              <Pencil :size="11" /><span>正在编辑</span>
            </span>
            <!-- 右侧一组（用户口径 2026-10-09）：迷你图 → 第 N 轮 → 已用/总预算 → 按钮，**整体右对齐**（spacer 顶开）。
                   进度条删掉了 —— 「已用/总预算」数字本身就是进度。 -->
            <span class="ac-goal-round">第 {{ goalRow.round }} 轮</span>
            <!-- 「已用/总预算」一体式（用户口径 2026-10-09）：形如 5.2k/5k，左右两段**各自可点着改**。
                   左边是已用、右边是总预算；两段都能点着改，**回车才生效**。 -->
            <span class="ac-goal-ratio" :title="'已用 / 总预算' + '（点数字可改，回车生效）'">
              <span class="ac-goal-token-val" contenteditable="true" spellcheck="false" role="textbox"
                aria-label="已用 token，点击编辑（回车生效）" @focus="onGoalEditFocus($event)"
                @keydown="onGoalBudgetKeydown($event, $event.target as HTMLElement, 'used')"
                @blur="onGoalBudgetBlur($event)">{{ formatToken(s.goal?.tokensUsed, tokenUnit) }}</span>
              <span class="ac-goal-ratio-sep">/</span>
              <span class="ac-goal-token-val" contenteditable="true" spellcheck="false" role="textbox"
                aria-label="总预算，点击编辑（回车生效）" @focus="onGoalEditFocus($event)"
                @keydown="onGoalBudgetKeydown($event, $event.target as HTMLElement, 'row')"
                @blur="onGoalBudgetBlur($event)">{{ budgetTokenText(s.goal?.budget, tokenUnit) }}</span>
            </span>
            <!-- 暂停 / 播放：**只要目标没真完成就给**（用户口径 2026-10-11）。
                   被中止（aborted）不是完成 —— 那时必须还能点播放接着跑。 -->
            <button v-if="!goalRow.finished" class="ac-goal-btn" :aria-label="s.goalPaused ? '启动目标' : '暂停目标'"
              :title="s.goalPaused ? '启动目标' : '暂停目标'" @click="s.goalPaused ? agent.resumeGoal() : agent.pauseGoal()">
              <Play v-if="s.goalPaused" :size="12" />
              <Pause v-else :size="12" />
            </button>
            <button class="ac-goal-btn" aria-label="结束目标" title="结束目标（不会自动再跑）" @click="agent.endGoal()">
              <X :size="12" />
            </button>
          </div>
        </div>
      </div>
      <div class="ac-input-box">
        <!-- 队列暂停 / 恢复：**骑在队列容器与输入框的分界线上**、水平居中。
             位置口径与参考 HTML 一致 —— 挂在 **composer** 里（不是容器里）：容器要 overflow:hidden
             才能把内部方角按外层圆角裁掉；按钮若放进容器会被一起裁掉半个。 -->
        <!-- 显示条件（用户口径 2026-10-15）：过滤掉「发送中」后还有排着的（或已暂停要恢复）才给 -->
        <button v-if="queue.pauseVisible" class="ac-queue-pause" :class="{ 'is-paused': queue.paused }"
          :aria-label="queue.paused ? '恢复队列' : '暂停队列自动发送'" :title="queue.pauseTitle" @click="toggleQueuePause()">
          <Play v-if="queue.paused" :size="12" />
          <Pause v-else :size="12" />
          <span>{{ queue.paused ? '队列恢复' : '队列暂停' }}</span>
          <span class="ac-queue-pause-cnt">{{ queue.pendingCount }}</span>
        </button>
        <!-- 未发送的目标：**输入框内侧顶部**（用户口径 2026-10-09）。
             标签只写「目标」二字（目标正文就是下面输入框里的内容，不重复）；
             预算行内可编辑（下划线 = CSS text-decoration）；口径开关与取消在右侧。 -->
        <!-- 编辑**正在运行的目标**时不画这张卡片：上面已有目标行（它就是「卡片头部」），
             再画一张就成了两张卡片（用户截图指出的重复）。 -->
        <div v-if="goalMark && !editingGoal" class="ac-goal-mark">
          <Target :size="13" class="ac-goal-icon" />
          <span class="ac-goal-mark-label">目标</span>
          <span class="ac-goal-token">
            <span class="ac-goal-token-prefix">预算</span>
            <span class="ac-goal-token-val" contenteditable="true" spellcheck="false" role="textbox"
              aria-label="总预算，点击编辑" @focus="onGoalEditFocus($event)"
              @keydown="onGoalBudgetKeydown($event, $event.target as HTMLElement, 'mark')"
              @blur="onGoalBudgetBlur($event)">{{ budgetTokenText(goalMark?.budget, tokenUnit) }}</span>
          </span>
          <span class="ac-tb-spacer"></span>
          <button class="ac-goal-btn" aria-label="取消目标（这条按普通消息发）" title="取消目标" @click="clearGoalMark()">
            <X :size="12" />
          </button>
        </div>
        <!-- 「正在编辑」联动标记：**输入框内部最上一行**（用户口径 2026-10-06 参考图箭头位），
             点它滚回那条消息、✕ 取消 —— 与消息上的徽标互为呼应 -->
        <!--    三种编辑（对话消息 / 队列消息 / 目标）**共用这一条**黄色标记（用户口径 2026-10-09）：
               谁在编辑就说谁；三者互斥，所以这里最多出现一条。 -->
        <div v-if="editingKind" class="ac-editing-mark" role="status">
          <Pencil :size="12" />
          <button class="ac-editing-mark-btn" :aria-label="editingKindText" @click="scrollToEditing">{{ editingKindText
            }}</button>
          <span class="ac-editing-mark-spacer"></span>
          <button class="ac-editing-x" aria-label="取消编辑" @click="cancelEditing">
            <X :size="12" />
          </button>
        </div>
        <!-- 待发送的图片：贴在输入框上方，可单张移除；点图本体看全屏预览 -->
        <div v-if="attached.length" class="ac-attach-list">
          <div v-for="(src, i) in attached" :key="i" class="ac-attach">
            <img :src="src" alt="" role="button" :aria-label="'查看图片 ' + (i + 1)" style="cursor: zoom-in"
              @click="openPreview(src, attached)" />
            <button class="ac-attach-del" :aria-label="'移除图片 ' + (i + 1)" @click="removeAttachment(i)">
              <X :size="12" />
            </button>
          </div>
        </div>
        <div class="ac-editor">
          <span v-if="!prompt" class="ac-placeholder" aria-hidden="true">开始你的创作，或者 @ 引用技能 / MCP</span>
          <ProseMirrorEditor v-if="!s.needsModel" ref="editorRef" v-model="prompt" :resources="editorResources"
            @keydown.capture="onEditorKeydown" @paste="onPaste" />
        </div>

        <div class="ac-toolbar">
          <!-- 「+」两项菜单（设计 §3.6.4 / G12）：**目标** / **上传文件**。
               点「目标」直接在输入框上方加标签（预算用全局设置里的默认值），**不弹框**；
               只有点那个标签本身才弹目标编辑框。 -->
          <ThemedDropdown v-model="plusOpen" placement="top-start" :offset="8" menu-width="210px" menu-role="menu">
            <template #trigger>
              <button class="ac-plus" :aria-expanded="plusOpen" aria-label="更多添加">
                <Plus :size="17" />
              </button>
            </template>
            <template #default="{ close }">
              <div class="ac-ddmenu" role="menu" aria-label="添加">
                <button class="ac-menu-item" role="menuitem" @click="addGoalMark(); close()">
                  <span class="ac-menu-title-row">
                    <span class="ac-menu-icon">
                      <Target :size="14" />
                    </span>
                    <span class="ac-menu-name">目标</span>
                  </span>
                  <span class="ac-menu-hint">给这条消息挂一个目标（可改预算）</span>
                </button>
                <button class="ac-menu-item" role="menuitem" @click="pickImages(); close()">
                  <span class="ac-menu-title-row">
                    <span class="ac-menu-icon">
                      <Upload :size="14" />
                    </span>
                    <span class="ac-menu-name">上传文件</span>
                  </span>
                  <span class="ac-menu-hint">选图片，跟这条消息一起发</span>
                </button>
                <!-- 「压缩」（用户口径 2026-10-11）：把历史总结成摘要、腾出上下文。
                     与 @ 菜单里的那一项走同一条命令（agent.compact）—— 两个入口，
                     一处实现，行为只会一起改。压缩只对**已有对话**有意义：
                     没会话时后端会如实拒绝（不装作成功）。 -->
                <button class="ac-menu-item" role="menuitem" :disabled="s.compacting" @click="compactNow(); close()">
                  <span class="ac-menu-title-row">
                    <span class="ac-menu-icon">
                      <Minimize2 :size="14" />
                    </span>
                    <span class="ac-menu-name">压缩</span>
                  </span>
                  <span class="ac-menu-hint">{{ s.compacting ? '正在压缩…' : '把历史总结成摘要，腾出上下文空间' }}</span>
                </button>
              </div>
            </template>
          </ThemedDropdown>
          <input ref="fileInput" class="ac-file" type="file" accept="image/*" multiple aria-hidden="true" tabindex="-1"
            @change="onFilesPicked" />

          <!-- 模式：圆角胶囊 + 下拉（向上弹，贴左对齐） -->
          <ThemedDropdown v-model="modeOpen" placement="top-start" :offset="8" menu-width="220px" menu-role="listbox">
            <template #trigger>
              <button class="ac-pill" :aria-expanded="modeOpen" aria-label="选择创作模式">
                <span class="ac-pill-text">{{ modeLabel }}</span>
                <ChevronDown :size="13" class="ac-pill-caret" />
              </button>
            </template>
            <template #default="{ close }">
              <div class="ac-ddmenu" role="listbox" aria-label="选择创作模式">
                <button v-for="m in promptPresets" :key="m.id" class="ac-menu-item" role="option"
                  :aria-selected="s.activePromptId === m.id" @click="pickMode(m.id, close)">
                  <span class="ac-menu-name">{{ m.name }}</span>
                  <span class="ac-menu-hint">{{ m.builtin ? '内置提示词' : '自建提示词' }}</span>
                </button>
                <!-- 一套都没拉到（后端没起 / 还在加载）：别给空菜单 -->
                <p v-if="!promptPresets.length" class="ac-menu-empty">还没有提示词，去「设置 → Agent → 提示词」加一个</p>
              </div>
            </template>
          </ThemedDropdown>

          <!-- 授权方式：接受审核 / 完全自动授权（与设置→Agent→审批规则 是同一个开关）。
               布局照 docs/demo/agent-select-panels 的「审核」面板：标题 + 计数 + 右侧状态小标签，
               下面两条大选项（图标托 / 标题 + 徽章 / 说明 / 单选圈）。 -->
          <!-- placement=top-end：菜单右缘对按钮右缘（向左铺开）。
               箭头不看 align、只看触发器中心（AxDropdown 里夹进菜单范围），
               所以菜单多宽、往哪边铺，箭头都还指着这个按钮。 -->
          <ThemedDropdown v-model="authOpen" placement="top-end" :offset="8" menu-width="360px" menu-role="listbox">
            <template #trigger>
              <button class="ac-tb-icon" :class="{ 'is-warn': authMode === 'auto' }" :aria-expanded="authOpen"
                :aria-label="'授权方式：' + (authMode === 'ask' ? '接受审核' : '完全自动授权')">
                <component :is="authMode === 'ask' ? Hand : ShieldAlert" :size="16" />
              </button>
            </template>
            <template #default="{ close }">
              <div class="ac-ddmenu ac-review-panel" role="listbox" aria-label="选择授权方式">
                <div class="ac-panel-head">
                  <div class="ac-panel-head-top ac-panel-head-top--review">
                    <div class="ac-panel-heading">
                      <span class="ac-panel-title">审核模式</span>
                      <span class="ac-panel-count">2</span>
                    </div>
                    <span class="ac-review-state">{{ authMode === 'ask' ? '需要确认' : '全部放行' }}</span>
                  </div>
                  <p class="ac-panel-lede">决定工具调用要不要先停下来问你。</p>
                </div>
                <div class="ac-review-body">
                  <div class="ac-review-list" role="radiogroup" aria-label="审核模式">
                    <button v-for="m in AUTH_MODES" :key="m.value" class="ac-review-option" :class="{ 'is-auto': m.value === 'auto' }"
                      type="button" role="radio" :aria-checked="authMode === m.value" @click="setAuthMode(m.value); close()">
                      <span class="ac-option-icon">
                        <component :is="m.icon" :size="16" />
                      </span>
                      <span class="ac-option-copy">
                        <span class="ac-option-title">
                          {{ m.label }}
                          <span class="ac-badge" :class="m.value === 'auto' ? 'is-warn' : 'is-accent'">{{ m.value === 'auto' ? '谨慎' : '推荐' }}</span>
                        </span>
                        <span class="ac-option-desc">{{ m.hint }}</span>
                      </span>
                      <span class="ac-radio" aria-hidden="true"><Check :size="11" /></span>
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </ThemedDropdown>

          <!-- 模型：多供应商场景下可能是几十条，长列表必须限高 + 滚（照参考图） -->
          <!-- 宽度随视图切换：卡片视图紧凑（两列小卡刚好），分栏视图加宽让左栏 + 右侧瓦片都站得住。 -->
          <ThemedDropdown v-model="modelOpen" placement="top-end" :offset="8"
            :menu-width="modelView === 'split' ? '586px' : '320px'"
            menu-max-width="600px" menu-max-height="440px" menu-role="listbox" layout="inner-scroll">
            <template #trigger>
              <button class="ac-tb-icon" :class="{ 'is-on': !!s.model }" :aria-expanded="modelOpen" aria-label="选择模型">
                <Box :size="16" />
              </button>
            </template>
            <template #default="{ close }">
              <div class="ac-ddmenu ac-panel ac-model-panel" :class="{ 'is-search-open': modelSearchOpen, 'is-split': modelView === 'split' }" role="listbox" aria-label="选择模型">
                <div class="ac-panel-head">
                  <div class="ac-panel-head-top">
                    <div class="ac-panel-heading">
                      <span class="ac-panel-title">模型</span>
                      <span class="ac-panel-count">{{ usableModels.length }}</span>
                    </div>
                    <div class="ac-panel-search">
                      <div class="ac-search-inline">
                        <span class="ac-search-icon" aria-hidden="true"><Search :size="14" /></span>
                        <input v-model="modelQuery" class="ac-search-input" type="search" name="ac-model-search"
                          data-ac-search="model" placeholder="搜索模型或平台" aria-label="搜索模型或平台" autocomplete="off" spellcheck="false" />
                        <button v-if="modelQuery" class="ac-search-clear" aria-label="清空搜索" @click="modelQuery = ''">
                          <X :size="12" />
                        </button>
                      </div>
                    </div>
                    <div class="ac-panel-tools">
                      <button class="ac-icon-btn ac-search-toggle" :aria-expanded="modelSearchOpen" aria-label="搜索" @click="togglePanelSearch('model')">
                        <Search :size="16" />
                      </button>
                      <div class="ac-segment" role="group" aria-label="面板布局">
                        <span class="ac-segment-indicator" :class="'is-' + modelView" aria-hidden="true"></span>
                        <button class="ac-segment-btn" :aria-pressed="modelView === 'card'" aria-label="轻卡片" @click="modelView = 'card'">
                          <span class="ac-segment-icon" v-html="ICON_VIEW_GRID"></span>
                          <span class="ac-segment-label">卡片</span>
                        </button>
                        <button class="ac-segment-btn" :aria-pressed="modelView === 'split'" aria-label="分栏" @click="modelView = 'split'">
                          <span class="ac-segment-icon" v-html="ICON_VIEW_SPLIT"></span>
                          <span class="ac-segment-label">分栏</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-if="!usableModels.length" class="ac-menu-empty">没有可用模型（先去设置里配一个）</div>
                <!-- 滚动区：长列表在这里滚，分组头固定在上方不动。
                     ref 挂它是为了「打开时把选中项滚进可视区」（见 scrollSelectedModelIntoView） -->
                <div class="ac-menu-scroll" ref="modelScrollRef">
                  <div class="ac-panel-body ac-panel-scroll">
                  <div v-if="modelView === 'card'">
                    <div v-if="filteredModels.length" class="ac-model-grid">
                      <button v-for="m in filteredModels" :key="m.provider + '/' + m.modelId" class="ac-model-card"
                        role="option" :aria-selected="isModelPicked(m)" @click="pickModel(m, close)">
                        <span class="ac-model-brand" :title="brandNameOf(m)" aria-hidden="true" v-html="brandSvgOf(m)"></span>
                        <span class="ac-model-copy">
                          <span class="ac-model-card-top">
                            <span class="ac-model-id">{{ m.modelId }}</span>
                            <span v-if="m.isDefault" class="ac-badge is-accent">默认</span>
                            <span class="ac-check-mark" aria-hidden="true"><Check :size="11" /></span>
                          </span>
                          <span class="ac-model-meta">
                            <span>{{ brandNameOf(m) }}</span>
                            <span class="ac-dot-sep" aria-hidden="true"></span>
                            <span>{{ modelNote(m) }}</span>
                          </span>
                        </span>
                      </button>
                    </div>
                    <div v-else class="ac-empty-state">
                      <span class="ac-empty-icon"><Search :size="18" /></span>
                      <span class="ac-empty-title">没有找到模型</span>
                      <span class="ac-empty-desc">换个模型名或平台名试试。</span>
                    </div>
                  </div>
                  <div v-else class="ac-split">
                    <aside class="ac-split-rail" aria-label="模型平台">
                      <div class="ac-rail-label">平台</div>
                      <div class="ac-rail-scroll">
                        <button v-for="g in modelPlatformGroups" :key="g.key" class="ac-rail-item"
                          :aria-pressed="modelPlatform === g.key" @click="modelPlatform = g.key">
                          <span v-if="g.key === 'all'" class="ac-rail-icon" aria-hidden="true"><Layers :size="14" /></span>
                          <span v-else class="ac-rail-brand" :title="g.label" aria-hidden="true" v-html="brandSvg(g.key)"></span>
                          <span class="ac-rail-name">{{ g.label }}</span>
                          <span class="ac-rail-count">{{ g.count }}</span>
                        </button>
                      </div>
                    </aside>
                    <div class="ac-split-main">
                      <div class="ac-split-scroll">
                      <div v-if="filteredModels.length" class="ac-model-row-list">
                        <button v-for="m in filteredModels" :key="m.provider + '/' + m.modelId" class="ac-model-row"
                          role="option" :aria-selected="isModelPicked(m)" @click="pickModel(m, close)">
                          <span class="ac-model-brand" :title="brandNameOf(m)" aria-hidden="true" v-html="brandSvgOf(m)"></span>
                          <span class="ac-model-copy">
                            <span class="ac-model-id">{{ m.modelId }}</span>
                            <span class="ac-model-meta">
                              <span>{{ brandNameOf(m) }}</span>
                              <span class="ac-dot-sep" aria-hidden="true"></span>
                              <span>{{ modelNote(m) }}</span>
                            </span>
                          </span>
                          <span class="ac-model-badges">
                            <span v-if="m.isDefault" class="ac-badge is-accent">默认</span>
                          </span>
                          <span class="ac-check-mark" aria-hidden="true"><Check :size="11" /></span>
                        </button>
                      </div>
                      <div v-else class="ac-empty-state">
                        <span class="ac-empty-icon"><Search :size="18" /></span>
                        <span class="ac-empty-title">没有找到模型</span>
                        <span class="ac-empty-desc">换个模型名或平台名试试。</span>
                      </div>
                      </div>
                    </div>
                  </div>
                  </div>
                </div>
                <div class="ac-panel-foot ac-model-foot">
                  <span class="ac-selection-summary">{{ s.model ? '已选 1 个模型' : '未选择模型' }}</span>
                </div>
              </div>
            </template>
          </ThemedDropdown>

          <!-- 技能：每行「图标 + 标题 + 说明」；点一项 = 往输入框插一个标签 -->
          <ThemedDropdown v-if="s.skills.length" v-model="skillOpen" placement="top-end" :offset="8"
            :menu-width="skillView === 'split' ? '586px' : '320px'" menu-max-width="600px"
            menu-max-height="440px" menu-role="listbox" layout="inner-scroll">
            <template #trigger>
              <!-- 不给「已开启」高亮：引用与否以**输入框里的标签**为准（用户口径）。
                   这里再亮一个开关态会变成第二处真相，和「点一下即插入」的语义冲突。 -->
              <button class="ac-tb-icon" :aria-expanded="skillOpen" aria-label="选择技能">
                <WandSparkles :size="16" />
              </button>
            </template>
            <template #default="{ close }">
              <div class="ac-ddmenu ac-panel ac-skill-panel" :class="{ 'is-search-open': skillSearchOpen, 'is-split': skillView === 'split' }"
                role="listbox" aria-label="选择技能">
                <div class="ac-panel-head">
                  <div class="ac-panel-head-top">
                    <div class="ac-panel-heading">
                      <span class="ac-panel-title">技能</span>
                      <span class="ac-panel-count">{{ s.skills.length }}</span>
                    </div>
                    <div class="ac-panel-search">
                      <div class="ac-search-inline">
                        <span class="ac-search-icon" aria-hidden="true"><Search :size="14" /></span>
                        <input v-model="skillQuery" class="ac-search-input" type="search" name="ac-skill-search"
                          data-ac-search="skill" placeholder="搜索技能" aria-label="搜索技能" autocomplete="off" spellcheck="false" />
                        <button v-if="skillQuery" class="ac-search-clear" aria-label="清空搜索" @click="skillQuery = ''">
                          <X :size="12" />
                        </button>
                      </div>
                    </div>
                    <div class="ac-panel-tools">
                      <button class="ac-icon-btn ac-search-toggle" :aria-expanded="skillSearchOpen" aria-label="搜索" @click="togglePanelSearch('skill')">
                        <Search :size="16" />
                      </button>
                      <div class="ac-segment" role="group" aria-label="面板布局">
                        <span class="ac-segment-indicator" :class="'is-' + skillView" aria-hidden="true"></span>
                        <button class="ac-segment-btn" :aria-pressed="skillView === 'card'" aria-label="轻卡片" @click="skillView = 'card'">
                          <span class="ac-segment-icon" v-html="ICON_VIEW_GRID"></span>
                          <span class="ac-segment-label">卡片</span>
                        </button>
                        <button class="ac-segment-btn" :aria-pressed="skillView === 'split'" aria-label="分栏" @click="skillView = 'split'">
                          <span class="ac-segment-icon" v-html="ICON_VIEW_SPLIT"></span>
                          <span class="ac-segment-label">分栏</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="ac-panel-body">
                  <div v-if="skillView === 'card'" class="ac-panel-scroll">
                    <div v-if="filteredSkills.length" class="ac-skill-grid">
                      <button v-for="item in filteredSkills" :key="item.id" class="ac-skill-card" role="option"
                        :aria-pressed="false" :title="item.value" @click="insertRef(item, close)">
                        <span class="ac-skill-thumb" :style="skillCoverStyle(item.name)" aria-hidden="true">
                          <span class="ac-skill-icon" v-html="ICON_SKILL"></span>
                        </span>
                        <span class="ac-skill-copy">
                          <span class="ac-skill-name-row">
                            <span class="ac-skill-name">{{ item.name }}</span>
                            <span v-if="skillMetaOf(item.name).featured" class="ac-badge is-accent">精选</span>
                            <span class="ac-check-mark" aria-hidden="true"><Check :size="11" /></span>
                          </span>
                          <span class="ac-skill-desc">{{ item.value }}</span>
                          <span class="ac-skill-meta">
                            <span>{{ skillMetaOf(item.name).category }}</span>
                            <span class="ac-dot-sep" aria-hidden="true"></span>
                            <span>{{ skillFileCount(item.name) }} 文件</span>
                          </span>
                        </span>
                      </button>
                    </div>
                    <div v-else class="ac-empty-state">
                      <span class="ac-empty-icon"><Search :size="18" /></span>
                      <span class="ac-empty-title">没有找到技能</span>
                      <span class="ac-empty-desc">换个关键词，或清空搜索再试。</span>
                    </div>
                  </div>
                  <div v-else class="ac-split">
                    <aside class="ac-split-rail" aria-label="技能分类">
                      <div class="ac-rail-label">分类</div>
                      <div class="ac-rail-scroll">
                        <button v-for="row in skillCategoryRows" :key="row.name" class="ac-rail-item"
                          :aria-pressed="skillCategory === row.name" @click="skillCategory = row.name">
                          <span class="ac-rail-icon" aria-hidden="true">
                            <component :is="row.name === '全部' ? Layers : row.name === '精选' ? Sparkles : Box" :size="14" />
                          </span>
                          <span class="ac-rail-name">{{ row.name }}</span>
                          <span class="ac-rail-count">{{ row.count }}</span>
                        </button>
                      </div>
                    </aside>
                    <div class="ac-split-main">
                      <div class="ac-split-scroll">
                        <div v-if="filteredSkills.length" class="ac-skill-grid ac-skill-grid--split">
                          <button v-for="item in filteredSkills" :key="item.id" class="ac-skill-tile" role="option"
                            :aria-pressed="false" :title="item.value" @click="insertRef(item, close)">
                            <span class="ac-skill-cover" :style="skillCoverStyle(item.name)" aria-hidden="true">
                              <span class="ac-skill-icon" v-html="ICON_SKILL"></span>
                            </span>
                            <span class="ac-skill-tile-body">
                              <span class="ac-tile-top">
                                <span class="ac-skill-name">{{ item.name }}</span>
                                <span class="ac-check-mark" aria-hidden="true"><Check :size="11" /></span>
                              </span>
                              <span class="ac-skill-desc">{{ item.value }}</span>
                              <span class="ac-skill-meta">
                                <span>{{ skillMetaOf(item.name).category }}</span>
                                <span class="ac-dot-sep" aria-hidden="true"></span>
                                <span>{{ skillFileCount(item.name) }} 文件</span>
                                <span class="ac-dot-sep" aria-hidden="true"></span>
                                <span>{{ skillSize(item.name) }}</span>
                              </span>
                            </span>
                          </button>
                        </div>
                        <div v-else class="ac-empty-state">
                          <span class="ac-empty-icon"><Search :size="18" /></span>
                          <span class="ac-empty-title">没有找到技能</span>
                          <span class="ac-empty-desc">换个关键词，或清空搜索再试。</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="ac-panel-foot">
                  <span class="ac-selection-summary">点击技能会直接插入标签</span>
                </div>
              </div>
            </template>
          </ThemedDropdown>

          <!-- MCP：同上，点一项 = 插入一个标签 -->
          <!-- MCP 暂只有轻卡片一种布局：宽度固定在紧凑档（与卡片视图一致）。 -->
          <ThemedDropdown v-if="s.mcpServers.length" v-model="mcpOpen" placement="top-end" :offset="8"
            menu-width="320px" menu-max-width="600px" menu-max-height="440px" menu-role="listbox" layout="inner-scroll">
            <template #trigger>
              <!-- 同上：MCP 也不做开关态高亮，引用看输入框里的标签 -->
              <button class="ac-tb-icon" :aria-expanded="mcpOpen" aria-label="选择 MCP">
                <Plug :size="16" />
              </button>
            </template>
            <template #default="{ close }">
              <div class="ac-ddmenu ac-panel ac-mcp-panel" :class="{ 'is-search-open': mcpSearchOpen }" role="listbox" aria-label="选择 MCP">
                <div class="ac-panel-head">
                  <div class="ac-panel-head-top">
                    <div class="ac-panel-heading">
                      <span class="ac-panel-title">MCP</span>
                      <span class="ac-panel-count">{{ s.mcpServers.length }}</span>
                    </div>
                    <div class="ac-panel-search">
                      <div class="ac-search-inline">
                        <span class="ac-search-icon" aria-hidden="true"><Search :size="14" /></span>
                        <input v-model="mcpQuery" class="ac-search-input" type="search" name="ac-mcp-search"
                          data-ac-search="mcp" placeholder="搜索服务或工具" aria-label="搜索服务或工具" autocomplete="off" spellcheck="false" />
                        <button v-if="mcpQuery" class="ac-search-clear" aria-label="清空搜索" @click="mcpQuery = ''">
                          <X :size="12" />
                        </button>
                      </div>
                    </div>
                    <div class="ac-panel-tools">
                      <button class="ac-icon-btn ac-search-toggle" :aria-expanded="mcpSearchOpen" aria-label="搜索" @click="togglePanelSearch('mcp')">
                        <Search :size="16" />
                      </button>
                      <!-- 重新检测（全部）：主动连一次，看当前连没连上、有哪些工具 -->
                      <button class="ac-detect-btn" :class="{ 'is-busy': mcpProbing }" :disabled="mcpProbing"
                        :aria-label="mcpProbing ? '正在检测 MCP' : '检测全部 MCP 服务'" :title="mcpProbing ? '正在检测' : '检测全部 MCP 服务'" @click.stop="runMcpProbe">
                        <RefreshCw :size="14" :class="{ 'ac-spin': mcpProbing }" />
                        <span class="ac-detect-label">{{ mcpProbing ? '检测中' : '重新检测' }}</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div class="ac-panel-body">
                  <div class="ac-panel-scroll">
                    <div v-if="filteredMcpResources.length" class="ac-mcp-list">
                      <!-- 卡片是勾选 + 展开两件事：左边的框勾「整个服务」，点标题行展开工具（DEMO 同一条分工） -->
                      <div v-for="item in filteredMcpResources" :key="item.id" class="ac-mcp-item">
                        <div class="ac-mcp-card" :class="{ 'is-picked': mcpPickedServers.has(item.name) }">
                        <button class="ac-pick-box" :aria-pressed="mcpPickedServers.has(item.name)"
                          :aria-label="'引用整个 ' + item.name + ' 服务'" :title="'引用整个 ' + item.name + ' 服务'"
                          @click.stop="toggleMcpServer(item.name)">
                          <Check :size="11" />
                        </button>
                        <button class="ac-mcp-server-main" :title="item.value"
                          :aria-expanded="mcpExpanded.has(item.name) || !!item.toolHits" @click="toggleMcpExpand(item.name)">
                          <span class="ac-server-icon" v-html="ICON_MCP" aria-hidden="true"></span>
                          <span class="ac-server-copy">
                            <span class="ac-server-name">{{ item.name }}</span>
                            <span class="ac-server-desc">{{ mcpServerDesc(item) }}</span>
                          </span>
                        </button>
                        <span class="ac-server-side">
                          <span v-if="mcpStatusOf(item.name)" class="ac-status" :class="mcpStatusOf(item.name)!.ok ? 'is-ok' : 'is-bad'"
                            :title="mcpStatusOf(item.name)!.text">{{ mcpToolCount(item.name) }} 工具</span>
                          <span v-else class="ac-status">{{ mcpTransport(item) }}</span>
                          <span v-if="mcpToolsOf(item.name).length" class="ac-expand-btn" role="button" tabindex="0"
                            :aria-expanded="mcpExpanded.has(item.name) || !!item.toolHits" aria-label="展开工具" title="展开工具"
                            @click.stop="toggleMcpExpand(item.name)" @keydown.enter.stop.prevent="toggleMcpExpand(item.name)">
                            <ChevronDown :size="13" :class="{ 'is-open': mcpExpanded.has(item.name) || !!item.toolHits }" />
                          </span>
                        </span>
                        </div>
                        <!-- 工具行：搜索命中工具时自动展开、只列命中的几条；每行都能单独勾选 -->
                        <div v-if="(mcpExpanded.has(item.name) || item.toolHits) && (item.toolHits || mcpToolsOf(item.name)).length" class="ac-mcp-tools">
                          <button v-for="t in (item.toolHits || mcpToolsOf(item.name))" :key="t.fullName"
                            class="ac-tool-row" :class="{ 'is-picked': mcpPickedTools.has(mcpToolKey(item.name, t.name)) }"
                            :title="t.fullName" :aria-pressed="mcpPickedTools.has(mcpToolKey(item.name, t.name))"
                            @click="toggleMcpTool(item.name, t.name)">
                            <span class="ac-pick-box is-sm" aria-hidden="true"><Check :size="10" /></span>
                            <span class="ac-tool-copy">
                              <span class="ac-tool-name">{{ t.name }}</span>
                              <span class="ac-tool-desc">{{ t.description }}</span>
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                    <div v-else class="ac-empty-state">
                      <span class="ac-empty-icon"><Search :size="18" /></span>
                      <span class="ac-empty-title">没有找到服务或工具</span>
                      <span class="ac-empty-desc">换个关键词，或清空搜索再试。</span>
                    </div>
                    <p v-if="mcpProbeHint" class="ac-panel-note">{{ mcpProbeHint }}</p>
                  </div>
                </div>
                <div class="ac-panel-foot">
                  <!-- 多选 + 确认：勾选只记状态，点这里才真正往输入框插标签 -->
                  <span class="ac-selection-summary">
                    <template v-if="mcpPickTotal">
                      已选 <b class="ac-selected-number">{{ mcpPickedServers.size }}</b> 个服务 ·
                      <b class="ac-selected-number">{{ mcpPickedTools.size }}</b> 个工具
                    </template>
                    <template v-else>未选择服务或工具</template>
                  </span>
                  <button class="ac-confirm-btn" :disabled="!mcpPickTotal" @click="confirmMcpPicks(close)">
                    <Check :size="13" />确认引用
                  </button>
                </div>
              </div>
            </template>
          </ThemedDropdown>

          <span class="ac-tb-spacer"></span>
          <!-- 上下文统计：**回到发送键左侧**（用户口径 2026-10-11：恢复之前的位置）。
               hover 气泡给剩余百分比；有绝对值时把「已用 / 上限」一起标在环旁边
               （只有百分比看不出还剩多少 tokens）。什么都不知道时整块不画。 -->
          <span v-if="s.contextLeft !== null || s.contextUsed !== null" class="ac-ctxwrap">
            <component :is="ThemedTooltip || 'span'"
              :content="ThemedTooltip && s.contextLeft !== null ? '上下文剩余 ' + s.contextLeft + '%' : undefined"
              :placement="ThemedTooltip ? 'top' : undefined">
              <span class="ac-context" role="img"
                :aria-label="s.contextLeft !== null ? '上下文剩余 ' + s.contextLeft + '%' : '上下文用量'">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <circle cx="6" cy="6" r="5.25" stroke="currentColor" stroke-width="1.5" class="ac-ctx-track" />
                  <circle cx="6" cy="6" r="5.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                    :stroke-dasharray="CONTEXT_CIRCUMFERENCE" :stroke-dashoffset="contextArcOffset"
                    transform="rotate(-90 6 6)" />
                </svg>
              </span>
            </component>
          </span>
          <button class="ac-send" :class="{ 'is-running': sendMode === 'stop' }"
            :aria-label="sendMode === 'stop' ? '停止' : '发送'" :disabled="sendMode === 'disabled'"
            @click="sendMode === 'stop' ? agent.stop() : submit()">
            <!-- 三态（设计 G1）：有内容 ⇒ 发送（**跑着也是发送**，点了进队列）；
                 空 + 跑着 ⇒ 红方块「终止」；空 + 空闲 ⇒ 禁用（灰色箭头）。
                 方块用 CSS 画（不受 lucide 线性图标 stroke 影响），颜色随 currentColor。 -->
            <span v-if="sendMode === 'stop'" class="ac-stop-square" aria-hidden="true"></span>
            <ArrowUp v-else :size="17" />
          </button>
        </div>
      </div>
    </div>

    <!-- 关闭 .ac-scroll-wrap（消息区容器；「回到底部」挂在它里面） -->
  </div>

  <!-- 看大图：主题注册的 MediaViewer（Esc / 点遮罩 / 右上角关闭；与全站预览同款交互） -->
  <MediaViewer :item="previewItem" @close="previewImage = null" />
</template>

<style scoped>
/* 数值全部来自 Chrome MCP 对参考页的实测；颜色一律走 --ui-*（实测与本项目暗色主题同值）。 */
/* position: relative 是给「回到底部」的绝对定位做参照（它挂在消息区右下角） */
.ac-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--ui-ink, #f7f7f7);
  /* 展开内容的统一高度上限（用户口径 2026-10-25）：思考过程、工具输入 /
     输出、工具分组、卡片详情共用一个值。不设上限时，长日志会把整段对话
     一路撑长；超出上限后在各自块内滚动，面板高度保持稳定。
     面板本身很矮时按视口收缩，别把输入框挤出可视区。 */
  --ac-expand-max-height: min(360px, 50vh);
}

/* 顶部留白（用户口径 2026-10-07）：第一条消息是内容的第一个元素，
    滚到它时（点「编辑」会 scrollIntoView）它会贴死容器顶 —— 琥珀色描边被
    overflow 裁掉、看起来「顶端被遮住」。给容器顶部留 12px，
    滚到顶时首条消息的描边与圆角都能完整露出来。 */
.ac-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px 0;
}

/* 内容容器：滚动容器里那层稳定的壳（空态与消息流都在里面）。
   它的高度才是真正随消息增长的那个 —— useStickyScroll 盯它做「吐多少都跟到底」。 */
.ac-inner {
  display: flex;
  flex-direction: column;
  user-select: text;
}

/* —— 顶部「更早对话」哨兵（对话分页，用户口径 2026-10-15）——
   颜色/字号按 ui-style-guide 的次要文本口径；它只有内容流顶部一小条，不抢视线。 */
.ac-earlier {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 8px;
  padding: 6px 0 2px;
  font-size: 11px;
  color: var(--ui-ink-mute, #9aa3af);
}
.ac-earlier-loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ac-earlier-hint {
  user-select: none;
}

/* —— 空态（照参考图）—— */
.ac-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding-top: 32px;
}

/* 间距统一交给 .ac-welcome 的 gap（照参考页：整块 gap 20px），这里不再单独留 margin */
.ac-hint-card {
  position: relative;
  width: 100%;
  padding: 10px 28px 10px 12px;
  border-radius: 12px;
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
  font-size: 12px;
  line-height: 1.6;
  color: var(--ui-ink-dim, #919191);
}

.ac-hint-text {
  margin: 0;
}

.ac-hint-text strong {
  color: var(--ui-ink, #f7f7f7);
}

.ac-hint-close {
  position: absolute;
  right: 6px;
  top: 6px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  cursor: pointer;
}

.ac-hint-close:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

/* 主题色白名单: 空态那颗渐变球是品牌装饰（照参考图的三段青渐变），不是主题 UI 色 */
.ac-welcome-orb {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 999px;
  /* 主题色白名单: 空态那颗渐变球是品牌装饰（照参考图的三段青渐变），不是主题 UI 色 */
  background: linear-gradient(160deg, #7dd3fc, #0891b2 55%, #0e7490);
  /* 主题色白名单: 同上（品牌装饰的辉光） */
  box-shadow: 0 0 30px rgb(8 145 178 / 0.45);
}

.ac-welcome-title {
  margin: 0;
  padding: 0 6px;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
  color: var(--ui-ink, #f7f7f7);
}

.ac-suggestions {
  width: 100%;
  display: flex;
  flex-direction: column;
}

/* 建议行照参考页实测：39 高 / 圆角 12 / 内边距 0 12 / 间距 10 / 正文 14px，文字用 60% 白 */
.ac-suggestion {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 39px;
  padding: 0 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background 0.16s ease;
}

.ac-suggestion:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
}

.ac-suggestion span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-suggestion-arrow {
  color: var(--ui-ink-dim, #919191);
}

/* —— 消息（照参考图：用户靠右灰底、助手靠左无底、都无头像、正文 14px）—— */
.ac-msg {
  display: flex;
  margin-bottom: 16px;
}

/* 用户消息间距收紧（用户口径 2026-10-16）：user 气泡自带 actions 行（时间/复制/编辑），
   再叠 16px 下间距，连续气泡之间空得能塞下一条消息 —— 用户要求缩小。
   助手消息保持 16px（阅读节奏不变）。 */
.ac-msg.user {
  margin-bottom: 4px;
}

/* —— 模型分割线（用户口径 2026-10-11）——
   切换模型 = 换一条会话（SDK 的模型钉在会话上），所以画一条横线把"换脑子"这件事说清楚。
   「中间一枚标签、两侧各一条发丝线」：与分支分页器同一族的"分隔"语义，不抢眼但要看得见。
   颜色走 --ui-*（与面板其它线一致）；只动 opacity/transform，不吃 layout。 */
.ac-model-split {
  display: flex;
  align-items: center;
  gap: 8px;
  /* 间距只用 4/6/8/10/12 档（ui-style-guide §2.4） */
  margin: 4px 0 12px;
}

.ac-model-split-line {
  flex: 1;
  min-width: 8px;
  height: 1px;
  background: var(--ui-line, #363636);
}

.ac-model-split-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  /* 模型 id 没有长度上限：标签可缩、名字单行省略，极端窄面板里也不越界 */
  min-width: 0;
  max-width: 100%;
  padding: 2px 8px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 999px;
  background: var(--ui-overlay-solid, #212121);
  color: var(--ui-ink-dim, #919191);
  font-size: 11px;
  line-height: 18px;
}

.ac-model-split-name {
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-ink, #f7f7f7);
}

/* —— 压缩提示 / 错误条（用户口径 2026-10-11）——
   两条都是"刚发生的事"的常驻交代，挂在消息流末尾。错误条用危险色，压缩提示用中性色。 */
.ac-compact-note,
.ac-error-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 4px 0 12px;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 18px;
}

.ac-compact-note {
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
  color: var(--ui-ink-dim, #919191);
}

.ac-error-bar {
  background: color-mix(in srgb, var(--ui-danger, #ef4444) 12%, transparent);
  color: var(--ui-danger, #ef4444);
}

.ac-error-bar-icon {
  flex: none;
  margin-top: 2px;
}

.ac-error-bar-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.ac-note-x {
  flex: none;
  display: grid;
  place-items: center;
  /* 交互目标不得小于 32px（ui-style-guide §5.4）；图标仍按 12 档，靠内边距撑到 32 */
  width: 32px;
  height: 32px;
  margin-left: auto;
  margin-top: -6px;
  margin-bottom: -6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.ac-note-x:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
}

.ac-msg.user {
  justify-content: flex-end;
}

.ac-msg.assistant {
  justify-content: flex-start;
}

.ac-bubble {
  min-width: 0;
}

/* 助手消息占满整行：之前留了 84px 右内边距（照参考图早期版本量到的"正文右缘距面板 84px"），
   但那是把面板宽度量错造成的空档 —— 现在内容区左右各 16px 已经给足呼吸，
   再留 84px 就变成右边一条明显空白（用户实测点名）。 */
.ac-msg.assistant .ac-bubble {
  width: 100%;
}

.ac-msg.user .ac-bubble {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--ui-hover-soft, rgb(255 255 255 / 0.05));
}

/* 用户消息正文：文字与标签在同一行内自然换行 */
.ac-user-line {
  display: block;
  margin: 0;
  font-size: 14px;
  line-height: 24px;
  color: var(--ui-ink, #f7f7f7);
  word-break: break-word;
}

.ac-user-text {
  white-space: pre-wrap;
}

/* 「前 8 行」夹层（用户口径 2026-10-15）：行高 24px × 8 = 192px。
   **常驻**而不是"判定超出后才挂" —— 挂上之前元素没被夹住，
   scrollHeight == clientHeight，超出判定恒为否，折叠永远不生效（真机踩到的鸡生蛋）。
   常驻后正文元素就是测量体：scrollHeight 是完整内容高、clientHeight 是被夹住的高，
   差值超过 1px 即"超出"，左下角给「展开」。没超出的消息 max-height 不影响显示。 */
.ac-user-line {
  max-height: 192px;
  overflow: hidden;
}
.ac-user-line.is-open {
  max-height: none;
}

/* 展开 / 收起：文字 + 箭头，放气泡左下角。圆角 6、12px/600，走样式表的「文本按钮」档。 */
.ac-user-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  margin: 6px 0 0;
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  cursor: pointer;
  transition: background 0.14s ease;
}

.ac-user-toggle:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

/* 操作行在气泡外（右下角、贴气泡下缘）：.ac-msg 是 flex 容器，操作行要跟气泡组成一列 */
.ac-msg.user {
  flex-direction: column;
  align-items: flex-end;
}

/* 已发送的标签：与输入框里那颗 chip 同款外观（图标 + 标题、圆角 6）。
   之所以单独一套类名：输入框里那颗是 ProseMirror 直接造 DOM 的（.ac-tag），
   这颗是 Vue 模板渲染的（.ac-sent-tag）—— 两边选择器作用域不同，但视觉值必须一致。
   底色用 --ui-hover-strong（用户口径 2026-10-06：原来太淡、不好区分）：它亮暗各一档、
   比旧值 --ui-hover-soft 深两三倍；而**旧值正是用户气泡本身的底色**，标签与气泡同色
   所以糊在一起，加深后才分得开。 */
.ac-sent-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 200px;
  height: 22px;
  margin: 0 2px;
  padding: 0 6px 0 4px;
  border-radius: 6px;
  background: var(--ui-hover-strong, rgb(0 0 0 / 0.10));
  vertical-align: bottom;
}

/* 可聚焦的节点标签：给 hover 态与 focus 环（用户口径：对话里的标签也要能点开聚焦） */
.ac-sent-tag.is-clickable {
  cursor: pointer;
  transition: background 0.14s ease;
}

.ac-sent-tag.is-clickable:hover {
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.16));
}

.ac-sent-tag.is-clickable:focus-visible {
  outline: 2px solid var(--ui-accent, #0891b2);
  outline-offset: 1px;
}

.ac-sent-tag-icon {
  display: grid;
  place-items: center;
  flex: none;
  color: var(--ui-ink-dim, #919191);
}

.ac-sent-tag-icon :deep(svg) {
  width: 13px;
  height: 13px;
}

.ac-sent-tag-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  color: var(--ui-ink, #f7f7f7);
}

/* 目标行 / 队列行是**单行 dense 布局**（min-height 36）：标签收小一点，别把行撑高 */
.ac-sent-tag.is-compact {
  height: 18px;
  padding: 0 5px;
  font-size: 11px;
}

/* 用户消息 hover 操作条（时间 · 复制 · 编辑）：右下角浮出，不占布局空间。
   位置参照参考图 2 —— 时间在消息气泡外右下角，按钮跟在旁边。 */
.ac-msg {
  position: relative;
}

.ac-msg.user .ac-bubble {
  position: relative;
}

.ac-msg-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  justify-content: flex-end;
  height: 22px;
  margin-top: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;
}

.ac-msg.user:hover .ac-msg-actions,
.ac-msg-actions:focus-within {
  opacity: 1;
  pointer-events: auto;
}

.ac-msg-time {
  font-size: 11px;
  color: var(--ui-ink-dim, #919191);
  margin-right: 4px;
}

.ac-msg-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  cursor: pointer;
}

.ac-msg-btn:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

.ac-msg-btn .is-ok {
  color: var(--ui-accent, #0891b2);
}

/* 「正在编辑」：消息高亮（琥珀警示语义，与语义色表一致）+ 徽标 + 输入框联动标记。
   高亮只描边不填底，避免盖住用户消息气泡本来的层次。 */
.ac-msg.is-editing .ac-bubble {
  box-shadow: 0 0 0 1.5px var(--ui-warn, #e3a25f);
  border-radius: 12px;
}

.ac-editing-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-end;
  height: 20px;
  margin-top: 4px;
  padding: 0 4px 0 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 16%, transparent);
  color: var(--ui-warn, #e3a25f);
  font-size: 11px;
  font-weight: 600;
}

/* 行内版：不换行（`white-space:nowrap`）—— 否则空间不够时「正在编辑」会被逐字竖排（真机踩到）。
   真挤不下时由文字先省略；图标与标签本体始终在。 */
.ac-editing-badge.is-compact {
  flex: none;
  align-self: center;
  margin-top: 0;
  height: 18px;
  white-space: nowrap;
}

.ac-editing-badge.is-compact span {
  white-space: nowrap;
}

.ac-editing-mark {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: 26px;
  margin: 0;
  padding: 0 4px 0 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 16%, transparent);
  color: var(--ui-warn, #e3a25f);
  font-size: 12px;
  font-weight: 600;
}

.ac-editing-mark-btn {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.ac-editing-mark-btn:hover {
  text-decoration: underline;
}

.ac-editing-mark-spacer {
  flex: 1;
}

.ac-editing-x {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.ac-editing-x:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

.ac-bubble :deep(.md) {
  font-size: 14px;
  line-height: 24px;
  color: var(--ui-ink, #f7f7f7);
}

.ac-bubble :deep(.md .md-p) {
  margin: 0 0 10px;
}

.ac-bubble :deep(.md .md-p:last-child) {
  margin-bottom: 0;
}

.ac-bubble :deep(.md .md-h) {
  margin: 14px 0 8px;
  font-size: 14px;
  font-weight: 700;
}

.ac-bubble :deep(.md .md-list) {
  margin: 6px 0 10px;
  padding-left: 24px;
  list-style: disc outside;
}

.ac-bubble :deep(.md .md-list li) {
  margin: 4px 0;
}

.ac-think-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  font-size: 12px;
  cursor: pointer;
}

/* 原位思考折叠块（用户口径 2026-10-16）：每段思考独立成块、按发生位置展示 */
.ac-think-inline {
  margin: 2px 0 8px;
}

.ac-rot {
  transform: rotate(90deg);
}

.ac-think {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
  font-size: 12px;
  line-height: 20px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  color: var(--ui-ink-dim, #919191);
  font-family: inherit;
  max-height: var(--ac-expand-max-height, min(360px, 50vh));
  overflow-y: auto;
}

/* 等首个 token 的加载行（照参考图）：转圈 + 「正在思考」，整行用次要文字色。 */
.ac-pending {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 24px;
  color: var(--ui-ink-dim, #919191);
}

/* 「已停止」小标（用户口径 2026-10-16）：终止后对话里要有表示 */
.ac-stopped {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 22px;
  color: var(--ui-danger, #ef4444);
}

/* 开口圆弧 = 一个圆 + 透明上边框：转起来能看清缺口在走。
   颜色随 currentColor，所以这行整体改色时图标自动跟随。 */
.ac-pending-spin {
  display: inline-block;
  flex: none;
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ac-rotate 0.8s linear infinite;
}

.ac-tool-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 6px 0;
  font-size: 12px;
  color: var(--ui-ink-dim, #919191);
}

.ac-tool-line code {
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
}

.ac-tool-line-out {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-tool-group {
  margin: 6px 0;
}

.ac-tg-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  font-size: 12px;
  cursor: pointer;
}

.ac-tg-toggle:hover {
  color: var(--ui-ink, #f7f7f7);
}

.ac-tg-body {
  margin-top: 4px;
  padding-left: 10px;
  border-left: 2px solid var(--ui-line, #363636);
  max-height: var(--ac-expand-max-height, min(360px, 50vh));
  overflow-y: auto;
}

/* 可折叠工具行（单工具与组内工具同一套）：收起一行，展开看输入/输出（用户口径 2026-10-06）。
   展开块 max-width 到气泡全宽、pre 自身滚动 —— 「提供最大的范围 + 滚动条」。 */
.ac-tool-fold {
  margin: 4px 0;
}

/* 默认工具行（用户口径 2026-10-08 定稿）：悬停**不加任何背景**，只让左侧折叠箭头变亮。
   早先悬停给整行加 rgba(255,255,255,.06) 的底色 —— 用户明确不要背景条。 */
.ac-tf-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 4px;
  margin: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.ac-tf-toggle:hover {
  color: var(--ui-ink, #f7f7f7);
}

.ac-tf-caret {
  flex: none;
  color: var(--ui-ink-dim, #919191);
}

.ac-tf-toggle:hover .ac-tf-caret {
  color: var(--ui-ink, #f7f7f7);
}

/* 折叠箭头动画（用户口径 2026-10-07）：旋转要有过渡，不是啪一下跳 */
.ac-tf-caret {
  transition: transform 0.18s ease;
}

.ac-tf-caret.is-open {
  transform: rotate(90deg);
}

.ac-tf-toggle code {
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
  /* 工具名没有长度上限（MCP 名可能很长）：限宽单行省略，
     否则整条折叠行会被它撑出气泡（极端长文本复查，2026-10-22）。 */
  flex: 0 1 auto;
  min-width: 0;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-tf-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}

.ac-tf-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0 2px;
  padding: 8px 10px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 10px;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
  max-height: var(--ac-expand-max-height, min(360px, 50vh));
  overflow-y: auto;
}

.ac-tf-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ac-tf-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ui-ink-dim, #919191);
}

.ac-tf-body .ac-tool-args,
.ac-tf-body .ac-tool-out {
  margin: 0;
  max-width: 100%;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 外层已经有统一上限并在滚动：内层 pre 别再叠一层小滚动框，
   否则同一份输入 / 输出会出现两个滚动条（用户口径 2026-10-25）。 */
.ac-tf-body .ac-tool-args,
.ac-tf-body .ac-tool-out,
.ac-tf-body :deep(.tvc-pre),
.ac-tf-body :deep(.tvb-pre) {
  max-height: none;
}

.ac-tool-card {
  margin: 8px 0;
  padding: 6px 8px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 10px;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
}

/* 分组里的**卡片**沿用同一只卡片壳（用户口径 2026-10-07：分界线要好找）；
   收起状态的折叠行不加壳（用户口径 2026-10-08）：单工具长什么样，组里就长什么样 ——
   早先的规则把每条折叠行也包了灰底 + 8px 内边距，收起行被灰底裹住、上下很空。 */
.ac-tg-body .ac-tool-card {
  margin: 6px 0;
  padding: 6px 8px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 10px;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
}

.ac-tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.ac-tool-args,
.ac-tool-out {
  margin: 6px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--ui-ink-dim, #919191);
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.ac-notice {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ui-ink-dim, #919191);
}

.ac-error {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ui-danger, #ef4444);
}

.ac-approval {
  margin: 8px 0 16px;
  padding: 12px 14px;
  border: 1px solid var(--ui-warn, #b45309);
  border-radius: 12px;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
}

.ac-approval-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
}

/* 审批标题带工具名（MCP 名可能很长）：单行省略，别把卡片撑宽 */
.ac-approval-head strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-approval-head svg {
  flex: none;
}

.ac-approval-args {
  margin: 8px 0 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--ui-code-bg, rgb(0 0 0 / 0.25));
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.ac-approval-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ac-spin {
  animation: ac-rotate 0.9s linear infinite;
}

@keyframes ac-rotate {
  to {
    transform: rotate(360deg);
  }
}

.ac-btn {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink, #f7f7f7);
  font-size: 12px;
  cursor: pointer;
}

.ac-btn-primary {
  border-color: transparent;
  background: var(--ui-accent, #0891b2);
  color: var(--ui-primary-ink, #141414);
}

.ac-onboard {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
}

.ac-onboard strong {
  font-size: 15px;
}

.ac-onboard p {
  margin: 0;
  font-size: 13px;
  color: var(--ui-ink-dim, #919191);
}

.ac-onboard-icon {
  color: var(--ui-accent, #0891b2);
}

.ac-onboard-path {
  font-size: 12px;
  opacity: 0.75;
  word-break: break-all;
}

/* 分支分页器（AI 回复结束下面一条）：左箭头 / 第 N / 共 M / 右箭头。
   居中、紧凑、不抢内容视线；到底/到顶的那侧箭头置灰不可点。 */
.ac-branch-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  margin: 4px 0 12px;
}

.ac-branch-arrow {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  cursor: pointer;
}

.ac-branch-arrow:hover:not(:disabled) {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

.ac-branch-arrow:disabled {
  opacity: 0.35;
  cursor: default;
}

.ac-branch-pos {
  min-width: 48px;
  padding: 0 2px;
  text-align: center;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--ui-ink-dim, #919191);
}

/* —— 输入区（照参考图：外块圆角 16 + 1px 边框 + 内边距 8 + 间距 8）—— */
/* position: relative 是给「回到底部」的绝对定位做参照（它浮在输入框正上方右侧） */
.ac-composer {
  position: relative;
  flex: none;
  padding: 4px 8px 12px;
}

/* 通知提示条：照参考页实测 40 高 / 圆角 12 / 强调色 20% 底；底色用 --ui-accent-soft 现算，
   用户改强调色后这里自动跟随，不会出现"主色改了、提示条还是青的"。 */
.ac-notify {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  margin-bottom: 8px;
  padding: 0 6px 0 10px;
  border-radius: 12px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.2));
  color: var(--ui-ink, #f7f7f7);
}

.ac-notify-icon {
  flex: none;
  color: var(--ui-accent, #0891b2);
}

.ac-notify-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.ac-notify-btn {
  flex: none;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--ui-ink, #f7f7f7);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.ac-notify-btn:hover {
  color: var(--ui-accent, #0891b2);
}

.ac-notify-close {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  cursor: pointer;
}

.ac-notify-close:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

.ac-input-box {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 16px;
  background: var(--ui-overlay-solid, #212121);
}

/* —— 「回到底部」：消息区**内部**、底部居中（用户口径 2026-10-09）——
   外层 .ac-scroll-wrap 是定位参照（它固定占满消息区，内容在里面的 .ac-scroll 滚）。 */
/* 注意：包了一层 wrap 之后，**必须也是 flex 容器** —— 里面的 .ac-scroll 靠 flex:1 撑高、
     自己 overflow-y:auto 滚。wrap 若只是普通块级，.ac-scroll 会按内容高度长出去、溢出到输入区，
     表现就是「消息文字压在队列行/输入框上」（真机踩到）。 */
.ac-scroll-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ac-to-bottom {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 12px;
  z-index: 5;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 999px;
  background: var(--ui-overlay-solid, #212121);
  color: var(--ui-ink-dim, #919191);
  cursor: pointer;
  box-shadow: var(--ui-shadow-md, 0 18px 44px rgb(0 0 0 / 0.16));
  transition: color 0.15s ease, transform 0.15s ease;
}

.ac-to-bottom:hover {
  color: var(--ui-ink, #f7f7f7);
  transform: translateX(-50%) translateY(-1px);
}

.ac-to-bottom:focus-visible {
  outline: 2px solid var(--ui-accent, #0891b2);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .ac-to-bottom {
    transition: none;
  }
}

/* —— 聚合容器（目标行 + 队列行，同一个容器）——
   几何（RULES §1）：宽 90% 居中；**紧贴输入框、零间隔**（底部去掉圆角 + 边框重叠 1px）；
   **只有这个外层有圆角，内部行一律方角**；四边 1px 描边。
   它有 .ac-composer 内的正常流定位（position:relative 供「骑线」暂停键参照）。 */
/* 注意：**不能 overflow:hidden** —— 「骑线」的暂停胶囊有一半在容器外，会被裁掉。
     内部行的方角靠 .ac-pending-row 自己 border-radius:0 保证（不依赖裁切）。 */
/* 类名刻意不叫 .ac-pending —— 那个名字被上面的「正在思考」加载行占用了，
     同名会把它的 font-size:14/line-height:24 混进来，把行内文字撑成两行（真机踩到）。 */
/* overflow:hidden **必须有** —— 里面每一行都是矩形（方角），只有容器是圆角；
     不裁切的话行底色会在四个角上「顶破」圆角，露出方块（真机截图看到过）。
     底部两角去圆角 + 与输入框重叠 1px，是为了和输入框拼成一体。 */
/* 宽 90% 居中（用户口径 2026-10-09）：比输入框窄一圈、居中，不铺满整个输入框宽度。 */
.ac-pending-box {
  position: relative;
  width: 90%;
  margin: 0 auto -1px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 14px 14px 0 0;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
  overflow: hidden;
}

/* 极端防护（RULES §9）：容器变窄时，**进度条先让位**，保证目标文案/按钮不被挤没。
     用容器查询而不是媒体查询 —— 让位要看的是「这个容器多宽」，不是「窗口多宽」。 */
.ac-pending-box {
  container-type: inline-size;
}

/*
 * 极端防护（RULES §9）：容器装不下时**按优先级让位** —— 进度条先走，其次状态徽章，
 * 文案与按钮永不让位。真实面板宽约 400（容器 90% ≈ 344），本来就装不下「进度条 + 徽章」。
 * 阈值必须够大到覆盖真实宽度，否则行内元素之和超出容器、最后一个按钮被挤出去（真机量到 +8px 溢出）。
 * 用容器查询而不是媒体查询：要看的是「这个容器多宽」。
 */
@container (max-width: 300px) {
  .ac-goal-bar {
    display: none;
  }
}

@container (max-width: 250px) {
  .ac-goal-flag {
    display: none;
  }
}

.ac-pending-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 行几何与参考 HTML 的 .prow 一致：gap 8、padding 0 8 0 10、min-height 36 */
.ac-pending-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  min-width: 0;
  padding: 0 8px 0 10px;
  border-radius: 0;
}

.ac-pending-row+.ac-pending-row {
  border-top: 1px solid var(--ui-line-soft, #2a2a2a);
}

.ac-pending-row:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
}

.ac-pending-lead {
  flex: none;
  display: grid;
  place-items: center;
  color: var(--ui-ink-mute, #a8a8a8);
}

.ac-queue-row.is-editing {
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 12%, transparent);
}

.ac-queue-row.is-sending {
  opacity: 0.7;
}

.ac-queue-thumb {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  object-fit: cover;
  cursor: zoom-in;
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
}

/* 白图与容器背景同色会「看不见」—— 加一圈低对比发丝边 + 微阴影（用户口径 2026-10-09，
   「边框颜色不能太突出」：用 ink 的 22% 而不是强调色/警示色）。
   主题色白名单: 缩略图那圈微阴影是「无关主题的微弱遮挡环」，亮暗两套主题都要它才看得见白图，与裁剪框描边同类。 */
.ac-queue-thumb,
.ac-goal-ratio~.ac-queue-thumb {
  border: 1px solid color-mix(in srgb, var(--ui-ink, #f7f7f7) 22%, transparent);
  /* 主题色白名单: 同上（那条微阴影本身） */
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.06);
}

.ac-queue-thumb-more {
  flex: none;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: 4px;
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  display: grid;
  place-items: center;
  font-size: 9px;
  font-weight: 700;
  color: var(--ui-ink-dim, #919191);
}

.ac-queue-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
  color: var(--ui-ink, #f7f7f7);
}

.ac-queue-row.is-editing .ac-queue-text {
  color: var(--ui-ink-dim, #919191);
}

.ac-queue-flag {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 18%, transparent);
  color: var(--ui-warn, #e3a25f);
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
}

.ac-queue-flag.is-sending {
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  color: var(--ui-ink-dim, #919191);
}

/* 图标 hover 交换（用户口径 2026-10-16）：默认显示原图标，hover 行换成把手。
   两枚图标同格叠放（grid 同格），用 opacity 切换，尺寸一致不跳动。 */
.ac-queue-lead-swap {
  display: grid;
  place-items: center;
  width: 16px;
  flex: none;
  /* 命中区=整个父元素（用户实测修正：handle 绑在子元素时命中区错位，
     鼠标放在图标上没反应）。拖拽绑定（SortableJS handle）也在父元素上。 */
  height: 20px;
  cursor: grab;
  border-radius: 4px;
}
.ac-queue-lead-swap:active {
  cursor: grabbing;
}
.ac-queue-lead-swap > * {
  grid-area: 1 / 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ac-queue-lead-swap .ac-pending-lead {
  transition: opacity 0.15s ease;
}
.ac-pending-row .ac-queue-lead-swap .ac-queue-handle {
  opacity: 0;
}
.ac-pending-row:hover .ac-queue-lead-swap .ac-queue-handle,
.ac-pending-row.is-hover .ac-queue-lead-swap .ac-queue-handle {
  opacity: 1;
}
.ac-pending-row:hover .ac-queue-lead-swap .ac-pending-lead,
.ac-pending-row.is-hover .ac-queue-lead-swap .ac-pending-lead {
  opacity: 0;
}
.ac-queue-row--ghost {
  opacity: 0.4;
}
.ac-queue-row--chosen {
  background: var(--ui-hover, rgb(255 255 255 / 0.06));
}

.ac-queue-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.ac-queue-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  cursor: pointer;
}

.ac-queue-btn:hover {
  background: var(--ui-hover-strong, rgb(255 255 255 / 0.14));
  color: var(--ui-ink, #f7f7f7);
}

.ac-queue-btn.is-danger:hover {
  background: var(--ui-danger-veil, rgb(239 68 68 / 0.1));
  color: var(--ui-danger, #ef4444);
}

.ac-queue-btn:focus-visible {
  outline: 2px solid var(--ui-accent, #0891b2);
  outline-offset: 1px;
}

/* 队列暂停/恢复：**骑在容器与输入框分界线上**、水平居中。
     它是 .ac-input-box 的子元素（不是容器的）—— 容器 overflow:hidden 会把它裁掉半个；
     挂输入框上、top:0 + translateY(-50%)，正好压在输入框上边框 = 两块的接缝。 */
.ac-queue-pause {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px 0 9px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 999px;
  background: var(--ui-overlay-solid, #212121);
  color: var(--ui-ink-dim, #919191);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: var(--ui-shadow-md, 0 18px 44px rgb(0 0 0 / 0.16));
  cursor: pointer;
  transition: color 0.15s ease;
}

.ac-queue-pause:hover {
  color: var(--ui-ink, #f7f7f7);
  background: linear-gradient(var(--ui-hover-strong, rgb(255 255 255 / 0.15)), var(--ui-hover-strong, rgb(255 255 255 / 0.15))), var(--ui-overlay-solid, #212121);
}

/* 主题色白名单: 暂停态是琥珀实心底，字必须是白 —— 与发送键红色实心底同款口径 */
.ac-queue-pause.is-paused {
  border-color: transparent;
  background: var(--ui-warn, #e3a25f);
  /* 主题色白名单: 同上（琥珀实心底上的白字） */
  color: #fff;
}

.ac-queue-pause-cnt {
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  display: grid;
  place-items: center;
  font-size: 10px;
  color: var(--ui-ink-dim, #919191);
}

/* 主题色白名单: 琥珀实心底上的计数胶囊也走白字（同上） */
.ac-queue-pause.is-paused .ac-queue-pause-cnt {
  /* 主题色白名单: 同上（琥珀实心底上的计数胶囊） */
  background: rgb(255 255 255 / 0.28);
  /* 主题色白名单: 同上（胶囊里的白字） */
  color: #fff;
}

.ac-queue-pause:focus-visible {
  outline: 2px solid var(--ui-accent, #0891b2);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .ac-queue-pause {
    transition: none;
  }
}

/* —— 目标行（**已发送**，在聚合容器里）—— UI 与队列行刻意不同 —— */
/* 目标行用**中性灰阶**（用户口径 2026-10-09：这里用不到主题强调色）——
     靠底色深浅 + 字重与队列行区分，不再染青色。 */
.ac-goal-row {
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
}

.ac-goal-row:hover {
  background: var(--ui-hover-strong, rgb(255 255 255 / 0.15));
}

/* 编辑中的目标行：**统一成黄色**（与消息 / 队列编辑同一套语义，用户口径 2026-10-09）。 */
.ac-goal-row.is-editing {
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 16%, transparent);
}

.ac-goal-row.is-editing:hover {
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 20%, transparent);
}

.ac-goal-row .ac-pending-lead {
  color: var(--ui-ink-dim, #919191);
}

/* 目标行左侧那颗图标：平时画「目标」，hover / 编辑中画「编辑」—— 两枚图标叠在同一格。
     点击进入编辑（进入后按钮带 is-editing，图标保持铅笔，一眼看出「正在编辑目标」）。 */
/* 几何与队列行的 .ac-pending-lead 完全一致：不另设宽高（图标 14×14 决定格子大小），
     不用负 margin、不用绝对定位 —— 那两样会让两行左列的基线对不上（真机量到 13 vs 14）。 */
.ac-goal-lead {
  flex: none;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  cursor: pointer;
}

.ac-goal-lead:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

.ac-goal-lead:focus-visible {
  outline: 2px solid var(--ui-accent, #0891b2);
  outline-offset: 1px;
}

.ac-goal-lead .ac-goal-lead-edit {
  display: none;
}

.ac-goal-lead:hover .ac-goal-lead-target {
  display: none;
}

.ac-goal-lead:hover .ac-goal-lead-edit {
  display: block;
}

.ac-goal-lead.is-editing .ac-goal-lead-target {
  display: none;
}

.ac-goal-lead.is-editing .ac-goal-lead-edit {
  display: block;
}

/* 目标文案：给它一个**可伸展但有下限**的宽度（min-width 太小会被同行的进度条/轮次挤成 0，
     真机踩到「文字只剩 6px」）。flex:1 1 auto + min-width:6em 保证至少能看到一小段。 */
/* 文案是**唯一可压缩**的元素（min-width:0 + flex:1）：装不下时它先缩，绝不让按钮被挤出去。
     但**不能无上限占满** —— flex:1 会让它把进度条挤成 0（真机量到 bar 只有 6px）。
     改成「占比上限」：最多吃容器的 40%，剩余空间自然分给进度条等次要信息。 */
/* 文案 **flex:1**（吃掉剩余空间）：这样右侧一组（图 / 轮次 / 已用/总预算 / 按钮）才会
     **顶到容器右缘**（用户口径：目标行是左右布局，右侧贴右）。
     文案自身 min-width:0 + 省略号 —— 空间不够时它先缩，按钮永不被挤走（RULES §9）。 */
.ac-goal-row-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink, #f7f7f7);
}

.ac-goal-flag {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
  color: var(--ui-ink-dim, #919191);
}

.ac-goal-flag.is-paused {
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 18%, transparent);
  color: var(--ui-warn, #e3a25f);
}

.ac-goal-flag.is-done {
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  color: var(--ui-ink-dim, #919191);
}

.ac-goal-round {
  flex: none;
  font-size: 12px;
  color: var(--ui-ink-dim, #919191);
  white-space: nowrap;
}

/* —— token 数字（预算 / 已用 / 剩余）：前缀 + **可编辑数值**。
   下划线用 CSS text-decoration（不是 border —— 边框会把文字压偏，见 RULES §8）；
   数值用 contenteditable，宽度天然跟着文字走。 */
.ac-goal-token {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink, #f7f7f7);
  white-space: nowrap;
}

.ac-goal-token-prefix {
  flex: none;
  color: var(--ui-ink-dim, #919191);
  font-weight: 600;
}

.ac-goal-token-val {
  flex: none;
  min-width: 2.2ch;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  white-space: pre;
  cursor: text;
  outline: none;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  text-decoration-color: var(--ui-ink-mute, #a8a8a8);
}

.ac-goal-token-val:hover {
  text-decoration-color: var(--ui-ink, #f7f7f7);
}

.ac-goal-token-val:focus {
  text-decoration-style: solid;
  text-decoration-color: var(--ui-ink, #f7f7f7);
}

/* 「已用」只读：不画下划线、不改光标 —— 一眼能区分「这个不能改」 */
.ac-goal-token-val.is-readonly {
  text-decoration: none;
  cursor: default;
}

/* 「已用/总预算」一体式：两个可编辑数字 + 中间一个斜杠，整体一块、样式统一 */
.ac-goal-ratio {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink, #f7f7f7);
  white-space: nowrap;
}

.ac-goal-ratio .ac-goal-token-val {
  min-width: 2.6ch;
  text-align: center;
}

.ac-goal-ratio-sep {
  flex: none;
  padding: 0 1px;
  color: var(--ui-ink-mute, #a8a8a8);
  font-weight: 600;
}

/* —— 未发送目标的标签（**输入框内侧顶部**，用户口径 2026-10-09）—— */
.ac-goal-mark {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  padding: 0 4px 0 8px;
  border-radius: 8px;
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
  color: var(--ui-ink, #f7f7f7);
}

.ac-goal-icon {
  flex: none;
}

/* 标签只写「目标」二字；预算（口径 + 值）紧跟其后，右端留白由 spacer 顶开 */
.ac-goal-mark-label,
.ac-goal-mark .ac-goal-token-prefix,
.ac-goal-mark .ac-goal-token-val {
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
}

.ac-goal-mark .ac-goal-token {
  color: var(--ui-ink, #f7f7f7);
}

.ac-goal-btn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.ac-goal-btn:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
}

.ac-goal-btn:focus-visible {
  outline: 2px solid var(--ui-accent, #0891b2);
  outline-offset: 1px;
}

/* 口径开关的图标：已用 = 实心、剩余 = 空心 */
.ac-goal-btn .is-hollow {
  opacity: 0.55;
}

/* 极端防护（RULES §9）：面板变窄时次要信息逐级让位，操作按钮永不被挤走 */
.ac-goal-row.is-narrow .ac-goal-bar {
  display: none;
}

.ac-editor {
  position: relative;
  min-height: 64px;
  max-height: min(45vh, 15rem);
  overflow-y: auto;
}

.ac-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  font-size: 14px;
  line-height: 24px;
  color: var(--ui-ink-dim, #919191);
  pointer-events: none;
}

.ac-toolbar {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.ac-plus {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  cursor: pointer;
}

.ac-plus:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

/* 原生 file input 只是「被点」的载体，视觉由上面的 + 按钮承担 */
.ac-file {
  display: none;
}

.ac-tb-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  cursor: pointer;
}

.ac-tb-icon:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

.ac-tb-icon.is-on {
  color: var(--ui-accent, #0891b2);
}

/* 授权方式 = 完全自动授权时用警示色（琥珀）：这是唯一需要用户留意的状态，图标染上提醒留意 */
.ac-tb-icon.is-warn {
  color: var(--ui-warn, #e3a25f);
}

.ac-pill {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  height: 32px;
  /* 提示词名是用户自建的（没有长度上限）：胶囊可缩、单行省略，
     保证右侧的授权 / 模型 / 发送按钮永远不被挤出工具条（RULES §9）。 */
  flex: 0 1 auto;
  min-width: 0;
  max-width: 160px;
  padding: 0 4px 0 8px;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: var(--ui-ink, #f7f7f7);
  font-size: 13px;
  cursor: pointer;
}

.ac-pill-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-pill-caret {
  flex: none;
}

.ac-pill:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
}

.ac-tb-spacer {
  flex: 1;
  min-width: 8px;
}

/* 上下文环：照参考页实测占 32×32 的触发区（图标 12×12 居中），图标色 --ui-ink-dim。
   外面再包一层 tooltip 时也要保持这个尺寸，不然工具条按钮的基线会跳。 */
.ac-context {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-right: 2px;
  color: var(--ui-ink-dim, #919191);
  cursor: default;
}

/* —— 上下文统计（用户口径 2026-10-11：恢复到发送键左侧）——
   只留环形进度（hover 气泡给剩余百分比）：环已经表达了用量，旁边再写「已…」
   是重复信息，且 32px 的工具条里放不下 —— 用户口径：有环就不要文字。 */
.ac-ctxwrap {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

/* —— 图片：待发送缩略图 / 已发送缩略图 / 看大图 —— */
/* 待发送（在输入框里，图片上方） */
.ac-attach-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 2px 0;
}

.ac-attach {
  position: relative;
  width: 56px;
  height: 56px;
  flex: none;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 10px;
  overflow: hidden;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
}

.ac-attach img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ac-attach-del {
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 999px;
  background: var(--ui-scrim, rgb(0 0 0 / 0.6));
  color: var(--ui-tip-ink, #fff);
  cursor: pointer;
}

.ac-attach-del:hover {
  background: var(--ui-danger, #ef4444);
}

/* 已发送（在用户气泡里）：按原比例排，点开看大图 */
.ac-user-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ac-user-image {
  display: block;
  width: 96px;
  height: 96px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  overflow: hidden;
  background: transparent;
  cursor: zoom-in;
}

.ac-user-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* 看大图：铺满面板的遮罩（z-index 要在下拉/浮层之上） */
/* 底圈：整圈淡显（照参考页 opacity .25），提供"盘面"感 */
.ac-ctx-track {
  opacity: 0.25;
}

.ac-send {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border: 0;
  border-radius: 12px;
  background: var(--ui-primary-bg, #f7f7f7);
  color: var(--ui-primary-ink, #141414);
  cursor: pointer;
  transition: opacity 0.16s ease;
}

.ac-send:disabled {
  opacity: 0.45;
  cursor: default;
}

.ac-send.is-running {
  background: var(--ui-danger, #ef4444);
  color: var(--ui-primary-ink, #141414);
}

/* 停止键里的实心方块：走 currentColor（与按钮文字色同一套 token），
   不引线框图标，圆角 2 让方角不至于太生硬。 */
.ac-stop-square {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  background: currentColor;
}

/* —— 下拉内容（浮层本体由目录里的 dropdown 提供：定位/翻边/出屏/互斥它负责）——
   层次结构（照参考图）：上下 flex 分栏 ——
     ┌ 分组头（固定，不滚）  标题 + 计数
     ├ 列表区（flex:1，自己滚，滚动条只出在这里）
     │   └ 行卡片：图标托 + 标题/说明 + 选中勾
   浮层用 dropdown 的 layout="inner-scroll"：它只当外框，滚动由下面的列表区负责，
   所以顶部标题天然不滚，不需要 sticky 去补。 */
.ac-ddmenu {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  padding: 2px;
}

/* 分组头：普通 flex 行。它不滚是因为**滚动发生在下面的列表区**，不是靠定位吸住。 */
.ac-menu-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 8px 10px 6px;
}

.ac-menu-head-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink, #f7f7f7);
}

.ac-menu-head-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  color: var(--ui-ink-dim, #919191);
}

/* 分组头右侧的操作（MCP 的「检测」）：把计数推到左边、按钮贴右 */
.ac-menu-head-spacer {
  flex: 1;
  min-width: 4px;
}

.ac-menu-head-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 999px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  font-size: 11px;
  cursor: pointer;
}

.ac-menu-head-btn:hover:not(:disabled) {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

.ac-menu-head-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 每行右侧的检测徽章 */
.ac-menu-card-badge {
  flex: none;
  margin-top: 3px;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
  color: var(--ui-accent-hover, #0e7490);
  font-size: 11px;
  line-height: 15px;
}

.ac-menu-card-badge.is-bad {
  background: var(--ui-danger-veil, rgb(239 68 68 / 0.1));
  color: var(--ui-danger, #ef4444);
}

/* 列表区：**唯一会滚的那层**。flex:1 + min-height:0 才能在限高的浮层里正确收缩 */
.ac-menu-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 2px 2px;
}

/* 行卡片：图标托 + 两行文字 + 选中勾。整行有底色/描边，才有"一条一条"的结构感 */
.ac-menu-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
  text-align: left;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease;
}

.ac-menu-card:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
}

.ac-menu-card[aria-selected='true'] {
  border-color: var(--ui-accent, #0891b2);
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
}

.ac-menu-card-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  color: var(--ui-ink-dim, #919191);
}

.ac-menu-card-icon :deep(svg) {
  width: 15px;
  height: 15px;
}

.ac-menu-card[aria-selected='true'] .ac-menu-card-icon {
  color: var(--ui-accent, #0891b2);
}

.ac-menu-card-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.ac-menu-card-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--ui-ink, #f7f7f7);
}

.ac-menu-card[aria-selected='true'] .ac-menu-card-name {
  color: var(--ui-accent, #0891b2);
  font-weight: 600;
}

.ac-menu-card-hint {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ui-ink-dim, #919191);
}

.ac-menu-card-check {
  flex: none;
  margin-top: 5px;
  color: var(--ui-accent, #0891b2);
}

/* —— 面板化下拉（1:1 复刻 docs/demo/agent-select-panels）——
   结构照 DEMO 的 .panel / .panel-head / .panel-body / .panel-foot：
   头部三格（标题 | 搜索 ≤240 | 工具/视图），中间滚动区（轻卡片或分栏），底部状态行。
   所有非颜色数值（尺寸 / 圆角 / 字号 / 字重 / 间距 / 阴影几何 / 动效曲线）与 DEMO 一字不差；
   颜色一律映射到 --ui-* token，兜底值就是 DEMO 的原色值。
   响应式用容器查询（DEMO 的 @container 阈值原样保留），以面板自身宽度为准。 */

/* 面板本体：抵消 dropdown 外框的 6px 内边距，让头部/底栏的 12px 从面板边沿算起
   （DEMO 的 .panel 没有第二层内边距）。外框（圆角 16 / 描边 / 阴影）由 dropdown 提供。 */
.ac-ddmenu.ac-panel {
  margin: -6px;
  width: calc(100% + 12px);
  /* 最小高度（用户口径 2026-10-30：「分栏 / 卡片两种模式都要有最小高度」）。
     卡片模式只有两三条时别塌成一条窄缝。
     为什么这么小：卡片模式本来就该贴着内容长，托底只为挡住「一条窄缝」；
     真要撑高的是分栏（见 .is-split），两种模式的最小高度不是同一个数。
     外面再套一层 min()：视口极矮时按可用高度收，别把面板顶出屏幕。 */
  min-height: min(232px, calc(100dvh - 32px));
  padding: 0;
  container-type: inline-size;
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.ac-ddmenu.ac-panel.is-split {
  /* 分栏要高过卡片：左栏是竖排分类、右栏是瓦片网格，太矮两边都只剩两行。
     上限压到 420 —— 浮层的 max-height 是 440，再高就会被裁掉（inner-scroll 不出滚动条）。
     下限给到 380：技能分栏只有两张瓦片时也要有「两列都在滚」的样子，不外扩成一条窄带。 */
  min-height: min(clamp(380px, 56vh, 420px), calc(100dvh - 32px));
}

.ac-panel-head {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 12px 8px;
}

.ac-panel-head-top {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 审核面板只有「标题 + 状态标签」两格（DEMO 的 review 头部没有搜索/视图开关）。 */
.ac-panel-head-top--review {
  grid-template-columns: minmax(0, 1fr) auto;
}

.ac-panel-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
}

.ac-panel-title {
  margin: 0;
  font-size: 15px;
  line-height: 1.3;
  font-weight: 700;
  letter-spacing: -0.01em;
  white-space: nowrap;
  color: var(--ui-ink, #111827);
}

.ac-panel-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-dim, #6b7280);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.ac-panel-lede {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ui-ink-dim, #6b7280);
}

/* 审核头部右侧的状态小标签（用户要求：右上角一个状态小标签） */
.ac-review-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
  color: var(--ui-accent-hover, #0e7490);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.ac-panel-tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  flex: none;
}

.ac-panel-search {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
}

/* 搜索条（DEMO 的 .search-inline）：宽屏 max-width 240、高 32、圆角 10、左 10 右 6。 */
.ac-search-inline {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  max-width: 240px;
  height: 32px;
  padding: 0 6px 0 10px;
  border-radius: 10px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  transition: background 0.18s ease;
}

.ac-search-inline:focus-within {
  background: var(--ui-hover, rgba(0, 0, 0, 0.06));
}

.ac-search-icon {
  display: grid;
  place-items: center;
  flex: none;
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-search-input {
  width: 100%;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--ui-ink, #111827);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
}

.ac-search-input::placeholder {
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-search-input::-webkit-search-cancel-button,
.ac-search-input::-webkit-search-decoration {
  -webkit-appearance: none;
  appearance: none;
  display: none;
}

.ac-search-clear {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-mute, #9ca3af);
  cursor: pointer;
}

.ac-search-clear:hover {
  color: var(--ui-ink, #111827);
}

/* 图标按钮（DEMO 的 .icon-btn）：32×32、圆角 8、默认浅底。 */
.ac-icon-btn {
  position: relative;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border: 0;
  border-radius: 8px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-dim, #6b7280);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, transform 0.15s ease;
}

.ac-icon-btn:hover {
  background: var(--ui-hover, rgba(0, 0, 0, 0.06));
  color: var(--ui-ink, #111827);
}

.ac-icon-btn:active {
  transform: scale(0.96);
}

.ac-icon-btn[aria-expanded='true'] {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
  color: var(--ui-accent-hover, #0e7490);
}

/* 窄屏才出现的搜索按钮；宽屏由容器查询隐藏（DEMO 的 .search-toggle）。 */
.ac-search-toggle {
  display: none;
}

/* 分段切换（DEMO 的 .segment）：容器浅底、2px 内衬、两枚 28 高按钮。
   选中块用一条独立的指示条（绝对定位 + 平移），观感与 DEMO 的白底阴影一致。 */
.ac-segment {
  position: relative;
  display: inline-flex;
  flex: none;
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
}

.ac-segment-indicator {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(50% - 3px);
  height: 28px;
  border-radius: 8px;
  background: var(--ui-panel, #fff);
  box-shadow: 0 1px 3px var(--ui-shadow-soft, rgba(0, 0, 0, 0.08));
  transition: transform 0.18s var(--ui-ease-back, cubic-bezier(0.34, 1.56, 0.64, 1));
  pointer-events: none;
}

.ac-segment-indicator.is-split {
  transform: translateX(calc(100% + 2px));
}

.ac-segment-btn {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.18s ease;
}

.ac-segment-btn:hover {
  color: var(--ui-ink, #111827);
}

/* 分段按钮里的线稿图标（DEMO 的 .segment-btn > svg）：14×14、随 currentColor。 */
.ac-segment-icon {
  display: grid;
  place-items: center;
  flex: none;
}

.ac-segment-icon :deep(svg) {
  width: 14px;
  height: 14px;
}

.ac-segment-btn[aria-pressed='true'] {
  color: var(--ui-ink, #111827);
}

/* 重新检测（DEMO 的 .detect-btn）：高 32、左右 8、1px 描边、圆角 8、字号 11。 */
.ac-detect-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 32px;
  padding: 0 8px;
  flex: none;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  background: var(--ui-panel, #fff);
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.ac-detect-btn:hover:not(:disabled) {
  border-color: var(--ui-accent-line, rgba(8, 145, 178, 0.28));
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
  color: var(--ui-accent-hover, #0e7490);
}

.ac-detect-btn:disabled {
  cursor: wait;
  opacity: 0.72;
}

/* 中间区（DEMO 的 .panel-body）：上下 flex 的主内容，自身不滚。 */
.ac-panel-body {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* 滚动区（DEMO 的 .panel-scroll）：2px 12px 12px 内边距，唯一滚动层。 */
.ac-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 2px 12px 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.12)) transparent;
}

.ac-panel-scroll::-webkit-scrollbar,
.ac-rail-scroll::-webkit-scrollbar,
.ac-split-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.ac-panel-scroll::-webkit-scrollbar-thumb,
.ac-rail-scroll::-webkit-scrollbar-thumb,
.ac-split-scroll::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.12));
}

.ac-panel-scroll::-webkit-scrollbar-thumb:hover,
.ac-rail-scroll::-webkit-scrollbar-thumb:hover,
.ac-split-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--ui-scroll-thumb-hover, rgba(0, 0, 0, 0.2));
}

/* —— 审核（DEMO 的 .review-*）—— */
.ac-review-body {
  padding: 2px 12px 12px;
}

.ac-review-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ac-review-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  min-height: 76px;
  padding: 11px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  background: var(--ui-panel, #fff);
  text-align: left;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.ac-review-option:hover {
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
  border-color: var(--ui-line, rgba(0, 0, 0, 0.12));
}

.ac-review-option[aria-checked='true'] {
  border-color: var(--ui-accent-line, rgba(8, 145, 178, 0.28));
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--ui-accent, #0891b2) 8%, transparent),
    color-mix(in srgb, var(--ui-accent, #0891b2) 4%, transparent));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-accent, #0891b2) 4%, transparent);
}

.ac-option-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 9px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-dim, #6b7280);
}

.ac-review-option[aria-checked='true'] .ac-option-icon {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
  color: var(--ui-accent-hover, #0e7490);
}

.ac-review-option.is-auto .ac-option-icon {
  color: var(--ui-warn, #b45309);
}

.ac-review-option.is-auto[aria-checked='true'] .ac-option-icon {
  background: var(--ui-warn-soft, rgba(245, 158, 11, 0.14));
  color: var(--ui-warn, #b45309);
}

.ac-option-copy {
  flex: 1;
  min-width: 0;
  padding-top: 1px;
}

.ac-option-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 600;
  color: var(--ui-ink, #111827);
}

.ac-option-desc {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ui-ink-dim, #6b7280);
}

.ac-badge {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-dim, #6b7280);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.ac-badge.is-accent {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.12));
  color: var(--ui-accent-hover, #0e7490);
}

.ac-badge.is-warn {
  background: var(--ui-warn-soft, rgba(245, 158, 11, 0.14));
  color: var(--ui-warn, #b45309);
}

.ac-radio {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  margin-top: 6px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.2));
  border-radius: 50%;
  background: var(--ui-panel, #fff);
  color: var(--ui-panel, #fff);
  transition: background 0.18s ease, border-color 0.18s ease;
}

.ac-radio svg {
  opacity: 0;
}

.ac-review-option[aria-checked='true'] .ac-radio {
  border-color: var(--ui-accent, #0891b2);
  background: var(--ui-accent, #0891b2);
}

.ac-review-option[aria-checked='true'] .ac-radio svg {
  opacity: 1;
}

/* —— 通用选择卡（DEMO 的 .skill-grid / .skill-card）—— */
.ac-skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 235px), 1fr));
  gap: 8px;
}

.ac-skill-card {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-width: 0;
  min-height: 72px;
  padding: 8px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  background: var(--ui-panel, #fff);
  text-align: left;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.ac-skill-card:hover {
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
  border-color: var(--ui-line, rgba(0, 0, 0, 0.12));
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgba(0, 0, 0, 0.04));
  transform: translateY(-1px);
}

/* 封面（DEMO 的 .skill-thumb）：54×54、圆角 10、按名字 hash 的双色渐变 + 右上高光。 */
.ac-skill-thumb {
  position: relative;
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  flex: none;
  overflow: hidden;
  border-radius: 10px;
  color: var(--ui-primary-ink, rgba(255, 255, 255, 0.94));
  background:
    radial-gradient(circle at 78% 18%, var(--ui-primary-ink, rgba(255, 255, 255, 0.28)), transparent 36%),
    /* 主题色白名单: 技能封面是内容生成的艺术渐变（按名字 hash 的色相），不是界面主题色 */
    linear-gradient(145deg, hsl(var(--cover-h1, 208) 66% 54%), hsl(var(--cover-h2, 250) 62% 40%));
}

.ac-skill-thumb::after {
  content: '';
  position: absolute;
  inset: auto -8px -16px 12px;
  height: 28px;
  border-radius: 50%;
  background: var(--ui-primary-ink, rgba(255, 255, 255, 0.12));
  transform: rotate(-8deg);
}

.ac-skill-icon {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
}

.ac-skill-icon :deep(svg) {
  width: 23px;
  height: 23px;
}

.ac-skill-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.ac-skill-name-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.ac-skill-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  line-height: 1.35;
  font-weight: 600;
  color: var(--ui-ink, #111827);
}

.ac-skill-desc {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 12px;
  line-height: 1.4;
  color: var(--ui-ink-dim, #6b7280);
}

.ac-skill-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  font-size: 10.5px;
  color: var(--ui-ink-mute, #9ca3af);
  white-space: nowrap;
}

.ac-dot-sep {
  width: 1px;
  height: 8px;
  flex: none;
  background: var(--ui-line, rgba(0, 0, 0, 0.08));
}

/* 选中勾（DEMO 的 .check-mark）：17 圆点，选中才放大出现。 */
.ac-check-mark {
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  flex: none;
  border-radius: 50%;
  background: var(--ui-accent, #0891b2);
  color: var(--ui-primary-ink, #fff);
  opacity: 0;
  transform: scale(0.72);
  transition: opacity 0.18s ease, transform 0.18s var(--ui-ease-back, cubic-bezier(0.34, 1.56, 0.64, 1));
}

[aria-pressed='true'] > .ac-check-mark,
[aria-pressed='true'] .ac-skill-name-row > .ac-check-mark,
[aria-pressed='true'] .ac-model-card-top > .ac-check-mark,
[aria-checked='true'] .ac-model-card-top > .ac-check-mark,
[aria-checked='true'] > .ac-check-mark,
[aria-selected='true'] > .ac-check-mark,
[aria-selected='true'] .ac-model-card-top > .ac-check-mark {
  opacity: 1;
  transform: scale(1);
}

/* —— 分栏骨架（DEMO 的 .split / .split-rail / .rail-*）—— */
.ac-split {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.ac-split-rail {
  display: flex;
  flex-direction: column;
  width: 152px;
  flex: none;
  min-height: 0;
  border-right: 1px solid var(--ui-line-soft, rgba(0, 0, 0, 0.06));
  background: var(--ui-thumb-soft, #fafbfc);
}

.ac-rail-label {
  flex: none;
  padding: 8px 12px 5px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-rail-scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 8px 10px;
  /* 左栏独立滚：滚到头也不把动作传给外层（否则外层一滚，右栏跟着整块跑） */
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.12)) transparent;
}

.ac-rail-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 34px;
  flex: none;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.ac-rail-item:hover {
  background: var(--ui-hover, rgba(0, 0, 0, 0.05));
  color: var(--ui-ink, #374151);
}

.ac-rail-item[aria-pressed='true'] {
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #111827);
  font-weight: 600;
  box-shadow: 0 1px 3px var(--ui-shadow-soft, rgba(0, 0, 0, 0.06));
}

.ac-rail-icon {
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  flex: none;
}

.ac-rail-brand {
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  flex: none;
}

.ac-rail-brand :deep(svg) {
  width: 14px;
  height: 14px;
}

.ac-rail-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-rail-count {
  flex: none;
  font-size: 10px;
  font-weight: 600;
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-split-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.ac-split-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px 12px 12px;
  /* 两列各自是一条独立的滚动链：不继承外层、也不把滚动传回外层 */
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.12)) transparent;
}

.ac-skill-grid--split {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 176px), 1fr));
}

/* 分栏封面瓦片（DEMO 的 .skill-tile / .skill-cover） */
.ac-skill-tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  background: var(--ui-panel, #fff);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.ac-skill-tile:hover {
  border-color: var(--ui-line, rgba(0, 0, 0, 0.12));
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgba(0, 0, 0, 0.04));
  transform: translateY(-1px);
}

.ac-skill-tile[aria-pressed='true'] {
  border-color: var(--ui-accent-line, rgba(8, 145, 178, 0.28));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent, #0891b2) 7%, transparent);
}

.ac-skill-cover {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 74px;
  overflow: hidden;
  color: var(--ui-primary-ink, rgba(255, 255, 255, 0.94));
  background:
    radial-gradient(circle at 82% 16%, var(--ui-primary-ink, rgba(255, 255, 255, 0.3)), transparent 34%),
    /* 主题色白名单: 技能封面是内容生成的艺术渐变（按名字 hash 的色相），不是界面主题色 */
    linear-gradient(145deg, hsl(var(--cover-h1, 208) 66% 54%), hsl(var(--cover-h2, 250) 62% 40%));
}

.ac-skill-cover::after {
  content: '';
  position: absolute;
  inset: auto -20px -22px 16px;
  height: 48px;
  border-radius: 50%;
  background: var(--ui-primary-ink, rgba(255, 255, 255, 0.12));
  transform: rotate(-7deg);
}

.ac-skill-cover .ac-skill-icon :deep(svg) {
  width: 26px;
  height: 26px;
}

.ac-skill-tile-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 9px 9px;
}

.ac-tile-top {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.ac-tile-top .ac-skill-name {
  white-space: normal;
}

.ac-tile-top .ac-check-mark {
  width: 15px;
  height: 15px;
  margin-top: 0;
}

.ac-skill-tile .ac-skill-name {
  font-size: 12px;
}

.ac-skill-tile .ac-skill-desc {
  font-size: 11px;
}

.ac-skill-tile .ac-skill-meta {
  font-size: 10px;
}

/* —— 模型（DEMO 的 .model-grid / .model-card / .brand）—— */
.ac-model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 236px), 1fr));
  gap: 8px;
}

.ac-model-card {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  min-height: 58px;
  padding: 7px 9px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  background: var(--ui-panel, #fff);
  text-align: left;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.ac-model-card:hover {
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
  border-color: var(--ui-line, rgba(0, 0, 0, 0.12));
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgba(0, 0, 0, 0.04));
  transform: translateY(-1px);
}

.ac-model-card[aria-checked='true'],
.ac-model-card[aria-selected='true'] {
  border-color: var(--ui-accent-line, rgba(8, 145, 178, 0.28));
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--ui-accent, #0891b2) 7%, transparent),
    color-mix(in srgb, var(--ui-accent, #0891b2) 3%, transparent));
}

/* 品牌图标托（DEMO 的 .brand）：35×35、圆角 9、白底 + 1px 内描边，svg 22×22。 */
.ac-model-brand {
  display: grid;
  place-items: center;
  width: 35px;
  height: 35px;
  flex: none;
  border-radius: 9px;
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #374151);
  box-shadow: inset 0 0 0 1px var(--ui-line-soft, rgba(0, 0, 0, 0.05));
}

.ac-model-brand :deep(svg) {
  width: 22px;
  height: 22px;
}

.ac-model-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.ac-model-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 600 13.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-ink, #111827);
}

.ac-model-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-model-card-top {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

.ac-model-card-top .ac-model-id {
  flex: 1;
}

.ac-model-card .ac-check-mark {
  width: 14px;
  height: 14px;
}

.ac-model-row-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ac-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 54px;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.ac-model-row:hover {
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
  border-color: var(--ui-line-soft, rgba(0, 0, 0, 0.05));
}

.ac-model-row[aria-checked='true'],
.ac-model-row[aria-selected='true'] {
  border-color: var(--ui-accent-line, rgba(8, 145, 178, 0.28));
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
}

.ac-model-row .ac-model-brand {
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
  box-shadow: none;
}

.ac-model-row .ac-check-mark {
  width: 14px;
  height: 14px;
}

.ac-model-badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

/* 模型滚动区：契约要求滚动层是 .ac-menu-scroll，内层 .ac-panel-body 只负责内边距。 */
.ac-model-panel .ac-menu-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  display: block;
  padding: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.12)) transparent;
}

.ac-model-panel .ac-menu-scroll .ac-panel-body {
  overflow: visible;
  padding: 2px 12px 12px;
}

/* 分栏：**外层不再滚**，滚动交给左右两列各自负责（用户口径 2026-10-30，附截图）。
   不这么改的话，外层 .ac-menu-scroll 会把整块面板一起滚：左栏被裁掉半行、右栏的滚动条
   也挂在面板最外缘 —— 两列看着像同一根滚动条，实际谁都没法各自定位。
   做法与外层同一条链：每层都 flex:1 + min-height:0，把高度一路传下去，最后两列才有
   确定的视口高度可滚。 */
.ac-model-panel.is-split .ac-menu-scroll {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ac-model-panel.is-split .ac-menu-scroll .ac-panel-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

/* —— MCP（DEMO 的 .mcp-list / .mcp-card / .status）—— */
.ac-mcp-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.ac-mcp-card {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 7px 8px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  background: var(--ui-panel, #fff);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.ac-mcp-card:hover {
  border-color: var(--ui-line, rgba(0, 0, 0, 0.12));
}

.ac-mcp-card.is-picked {
  border-color: var(--ui-accent-line, rgba(8, 145, 178, 0.28));
  background: linear-gradient(180deg, var(--ui-accent-soft, rgba(8, 145, 178, 0.05)), var(--ui-panel, #fff) 42%);
}

.ac-pick-box {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: none;
  padding: 0;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.18));
  border-radius: 6px;
  background: var(--ui-panel, #fff);
  color: var(--ui-panel, #fff);
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.15s ease;
}

.ac-pick-box:hover {
  border-color: var(--ui-accent, #0891b2);
  transform: scale(1.04);
}

.ac-pick-box.is-sm {
  width: 17px;
  height: 17px;
  border-radius: 5px;
}

.ac-pick-box :deep(svg) {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.ac-pick-box[aria-pressed='true'],
.ac-mcp-card.is-picked .ac-pick-box,
.ac-tool-row.is-picked .ac-pick-box {
  border-color: var(--ui-accent, #0891b2);
  background: var(--ui-accent, #0891b2);
}

.ac-pick-box[aria-pressed='true'] :deep(svg),
.ac-mcp-card.is-picked .ac-pick-box :deep(svg),
.ac-tool-row.is-picked .ac-pick-box :deep(svg) {
  opacity: 1;
}

.ac-mcp-server-main {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.ac-server-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 9px;
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
  color: var(--ui-accent-hover, #0e7490);
}

.ac-server-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.ac-server-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.ac-server-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 600 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-ink, #111827);
}

.ac-server-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-server-side {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
}

.ac-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-dim, #6b7280);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.ac-status::before {
  content: '';
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--ui-ink-mute, #9ca3af);
}

.ac-status.is-ok {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.09));
  color: var(--ui-accent-hover, #0e7490);
}

.ac-status.is-ok::before {
  background: var(--ui-accent, #0891b2);
}

.ac-status.is-bad {
  background: var(--ui-warn-soft, rgba(245, 158, 11, 0.14));
  color: var(--ui-warn, #b45309);
}

.ac-status.is-bad::before {
  background: var(--ui-warn, #b45309);
}

/* 展开工具按钮（DEMO 的 .expand-btn）：无底色小方块，箭头旋转表状态。 */
.ac-expand-btn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-mute, #9ca3af);
  cursor: pointer;
}

.ac-expand-btn:hover {
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink, #111827);
}

.ac-expand-btn :deep(svg) {
  transition: transform 0.18s var(--ui-ease-back, cubic-bezier(0.34, 1.56, 0.64, 1));
}

.ac-expand-btn :deep(svg.is-open) {
  transform: rotate(180deg);
}

/* 工具行列表：缩进对齐到服务名（20 选择框 + 8 间距），描边虚化一圈。 */
.ac-mcp-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0 0 28px;
  padding: 4px;
  border: 1px solid var(--ui-line-soft, rgba(0, 0, 0, 0.05));
  border-radius: 10px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.02));
  max-height: 180px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.ac-tool-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.ac-tool-row:hover {
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgba(0, 0, 0, 0.04));
}

.ac-tool-row.is-picked {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.08));
  box-shadow: none;
}

.ac-tool-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.ac-tool-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 600 11.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-ink, #111827);
}

.ac-tool-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-panel-note {
  margin: 8px 2px 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--ui-ink-mute, #9ca3af);
}

/* —— 底栏（DEMO 的 .panel-foot）：54 高、9 12 内边距、上描边。 —— */
.ac-panel-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  min-height: 54px;
  padding: 9px 12px;
  border-top: 1px solid var(--ui-line-soft, rgba(0, 0, 0, 0.06));
  background: var(--ui-overlay, rgba(255, 255, 255, 0.94));
}

.ac-selection-summary {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
  line-height: 1.35;
}

.ac-model-foot .ac-selection-summary {
  justify-content: flex-start;
}

/* 已选计数：正文色加粗（与 DEMO 的 .selected-number 一致），让「选了几个」一眼看见 */
.ac-selected-number {
  color: var(--ui-ink, #111827);
  font-size: 12px;
  font-weight: 700;
}

/* 确认按钮（DEMO 的 .confirm-btn）：主色实心，未选禁用。 */
.ac-confirm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  flex: none;
  border: 0;
  border-radius: 9px;
  background: var(--ui-accent, #0891b2);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.18s ease, transform 0.15s ease, opacity 0.18s ease;
}

.ac-confirm-btn:hover:not(:disabled) {
  background: var(--ui-accent-hover, #0e7490);
}

.ac-confirm-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.ac-confirm-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

/* —— 空状态（DEMO 的 .empty-state）—— */
.ac-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 190px;
  height: 100%;
  padding: 20px;
  color: var(--ui-ink-mute, #9ca3af);
  text-align: center;
}

.ac-empty-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  margin-bottom: 2px;
  border-radius: 12px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-empty-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink-dim, #6b7280);
}

.ac-empty-desc {
  font-size: 11px;
}

/* —— 容器响应式（阈值与 DEMO 的 @container 完全一致）—— */
@container (max-width: 469px) {
  .ac-panel-head-top {
    grid-template-columns: auto 1fr;
  }

  .ac-panel-search {
    display: none;
  }

  .ac-search-toggle {
    display: grid;
  }

  .ac-panel.is-search-open .ac-panel-search {
    display: flex;
    grid-column: 1 / -1;
    grid-row: 2;
    width: 100%;
    min-width: 0;
    height: 32px;
    animation: ac-search-expand 0.2s var(--ui-ease-back, cubic-bezier(0.34, 1.56, 0.64, 1)) both;
  }

  .ac-panel.is-search-open .ac-panel-search > .ac-search-inline {
    width: 100%;
    max-width: none;
  }

  .ac-panel.is-search-open .ac-search-toggle {
    display: none;
  }
}

@container (min-width: 470px) {
  .ac-search-toggle {
    display: none;
  }

  .ac-panel-search {
    display: flex;
  }
}

/* MCP 多一个检测按钮，空间要求更高；放不下时提前换到第二行（DEMO 原样）。 */
@container (min-width: 470px) and (max-width: 494px) {
  .ac-mcp-panel .ac-panel-head-top {
    grid-template-columns: auto 1fr;
  }

  .ac-mcp-panel .ac-panel-search {
    display: none;
  }

  .ac-mcp-panel .ac-search-toggle {
    display: grid;
  }

  .ac-mcp-panel.is-search-open .ac-panel-search {
    display: flex;
    grid-column: 1 / -1;
    grid-row: 2;
    width: 100%;
    min-width: 0;
    height: 32px;
    animation: ac-search-expand 0.2s var(--ui-ease-back, cubic-bezier(0.34, 1.56, 0.64, 1)) both;
  }

  .ac-mcp-panel.is-search-open .ac-panel-search > .ac-search-inline {
    width: 100%;
    max-width: none;
  }

  .ac-mcp-panel.is-search-open .ac-search-toggle {
    display: none;
  }
}

@container (max-width: 540px) {
  .ac-detect-label {
    display: none;
  }

  .ac-detect-btn {
    width: 32px;
    padding: 0;
  }
}

@container (max-width: 386px) {
  .ac-segment-btn {
    width: 28px;
    padding: 0;
  }

  .ac-segment-label {
    display: none;
  }

  .ac-panel-tools {
    gap: 4px;
  }

  .ac-panel-head {
    padding-left: 10px;
    padding-right: 10px;
  }
}

@container (max-width: 460px) {
  .ac-split {
    flex-direction: column;
  }

  .ac-split-rail {
    width: auto;
    flex: none;
    border-right: 0;
    border-bottom: 1px solid var(--ui-line-soft, rgba(0, 0, 0, 0.06));
  }

  .ac-rail-label {
    display: none;
  }

  .ac-rail-scroll {
    flex-direction: row;
    gap: 5px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 7px 10px;
  }

  .ac-rail-item {
    width: auto;
    height: 30px;
    flex: none;
    gap: 5px;
    padding: 0 8px;
    border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
    border-radius: 7px;
    background: var(--ui-panel, #fff);
  }

  .ac-rail-icon,
  .ac-rail-brand {
    width: 13px;
    height: 13px;
  }

  .ac-rail-brand :deep(svg) {
    width: 13px;
    height: 13px;
  }

  .ac-rail-count {
    display: none;
  }

  .ac-rail-item[aria-pressed='true'] {
    border-color: var(--ui-accent-line, rgba(8, 145, 178, 0.28));
    background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
    color: var(--ui-accent-hover, #0e7490);
    box-shadow: none;
  }

  .ac-split-scroll {
    padding: 9px 10px 10px;
  }

  .ac-skill-grid--split {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 154px), 1fr));
  }
}

@container (max-width: 360px) {
  .ac-panel-head-top {
    gap: 5px;
  }

  .ac-panel-title {
    font-size: 14px;
  }

  .ac-panel-count {
    display: none;
  }

  .ac-skill-grid,
  .ac-model-grid,
  .ac-skill-grid--split {
    grid-template-columns: 1fr;
  }

  .ac-mcp-card {
    gap: 5px;
    padding: 7px 6px;
  }

  .ac-mcp-card .ac-server-icon {
    display: none;
  }

  .ac-server-side .ac-badge {
    display: none;
  }

  .ac-panel-foot {
    padding-left: 10px;
    padding-right: 10px;
  }
}

@keyframes ac-search-expand {
  from {
    opacity: 0;
    transform: scaleX(0.92);
    transform-origin: right center;
  }

  to {
    opacity: 1;
    transform: none;
  }
}

/* 简单两项式下拉（创作模式 / 授权方式）：标题一行 + 说明一行 */
.ac-menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.ac-menu-item:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
}

.ac-menu-item[aria-selected='true'] .ac-menu-name {
  color: var(--ui-accent, #0891b2);
  font-weight: 600;
}

.ac-menu-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--ui-ink, #f7f7f7);
}

.ac-menu-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.ac-menu-title-row .ac-menu-name {
  flex: 1;
  min-width: 0;
}

/* 授权方式两个选项的配色（用户口径 2026-10-03）:
   ask  = 手掌 / **默认无色**（先停一下是常态，不用彩色喊）
   auto = 盾牌+感叹号 / **琥珀**（图标与文字都染，唯一需要留意的那个选项）
   底色是同色 12% 的浅托, 亮暗主题都由 token 现算 */
.ac-menu-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--ui-ink-dim, #919191);
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
}

.ac-menu-icon.is-auto {
  color: var(--ui-warn, #e3a25f);
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 12%, transparent);
}

/* 完全自动授权那一行，文字也跟着图标染成琥珀（用户要求：不要只有图标有色） */
.ac-menu-name.is-auto {
  color: var(--ui-warn, #e3a25f);
}

.ac-menu-item[aria-selected='true'] .ac-menu-name {
  color: var(--ui-ink, #f7f7f7);
}

.ac-menu-check {
  flex: none;
  color: var(--ui-accent, #0891b2);
}

.ac-menu-hint {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ui-ink-dim, #919191);
}

.ac-menu-empty {
  margin: 8px 10px;
  font-size: 12px;
  color: var(--ui-ink-dim, #919191);
}

@media (prefers-reduced-motion: reduce) {

  .ac-spin,
  .ac-pending-spin {
    animation: none;
  }
}
</style>

<!-- 输入框内联标签（.ac-tag / .ac-mrow）由 ProseMirror 直接造 DOM，拿不到 scoped 属性，
     所以这几条必须是非 scoped。类名都带 ac- 前缀，避开与其它插件撞名。 -->
<style>
/* 编辑器最小高度：库默认 120px（.prose-mirror-editor .ProseMirror 与它的一层 wrapper），
   照参考页实测应是 64px（min-height 4rem）—— 不压下来的话整块输入区比目标高 56px。
   只作用在 Agent 面板内（都挂在 .ac-editor 下），不影响底栏等其它调用方。 */
.ac-editor .prose-mirror-editor .ProseMirror,
.ac-editor .prose-mirror-editor>div:first-child {
  min-height: 64px;
}

.prose-mirror-editor .ac-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  /* 名字可能非常长（技能 / MCP / 节点名都没有长度上限）：限宽收住，
     否则一颗标签就能把整行撑出输入框（用户口径 2026-10-11）。
     200px 的取法：一颗标签最多占输入框（约 364px）一半多点，
     同一行还能并排放下第二颗；再宽就在窄面板里顶出去了。 */
  max-width: 200px;
  height: 22px;
  padding: 0 6px 0 4px;
  margin: 0 2px;
  border-radius: 6px;
  /* 与已发送标签同款底色（--ui-hover-strong）：亮暗各一档，比旧的 --ui-hover-soft 明显（用户口径 2026-10-06） */
  background: var(--ui-hover-strong, rgb(0 0 0 / 0.10));
  vertical-align: bottom;
  user-select: none;
  cursor: pointer;
}

/* 编辑器给资源节点默认画一条下划线（.resource-node 的 border-bottom），那是给"文字引用"用的。
   我们的标签自带底色块，再叠一条下划线就成了"带线的胶囊"（实测参考图里没有线）。
   用 .resource-node 一起限定，靠更高的选择器权重压过后加载的库样式。 */
.prose-mirror-editor .ac-tag.resource-node {
  border-bottom: 0;
  padding: 0 6px 0 4px;
  height: 22px;
}

.prose-mirror-editor .ac-tag .ac-tag-icon {
  display: grid;
  place-items: center;
  flex: none;
  color: var(--ui-ink-dim, #919191);
}

.prose-mirror-editor .ac-tag .ac-tag-icon svg {
  width: 13px;
  height: 13px;
}

/* 图标固定、名字让位：`min-width: 0` 不能省 —— flex 子项的默认 min-width 是「内容宽」，
   只写 max-width 的话它会把标签顶回去，省略号永远不出现。 */
.prose-mirror-editor .ac-tag .ac-tag-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  color: var(--ui-ink, #f7f7f7);
}

.prose-mirror-editor .ProseMirror-selectednode.ac-tag,
.prose-mirror-editor .ac-tag.resource-node-selected {
  background: var(--ui-accent, #0891b2);
}

.prose-mirror-editor .ProseMirror-selectednode.ac-tag .ac-tag-label,
.prose-mirror-editor .ac-tag.resource-node-selected .ac-tag-label {
  color: var(--ui-primary-ink, #141414);
}

.prose-mirror-editor .ProseMirror-selectednode.ac-tag .ac-tag-icon,
.prose-mirror-editor .ac-tag.resource-node-selected .ac-tag-icon {
  color: var(--ui-primary-ink, #141414);
}

/* @ 菜单里的行（富行外观与工具栏下拉保持一致） */
/* @ 行：默认只显示**名称**一行；hover / 键盘选中时描述行展开（多出一行，行高自然撑开）。
   描述不再常显 —— 常显会把每行都拉成两行，列表看着发灰又挤（用户口径）。 */
.mention-menu .ac-mrow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mention-menu .ac-mrow-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

.mention-menu .ac-mrow-icon svg {
  width: 14px;
  height: 14px;
}

.mention-menu .ac-mrow-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

/* 名字超长时单行省略：不省略的话行会被名字撑宽（浮层跟着变长），
   而在窄屏上触发翻边后名字又会把描述行挤没（用户口径 2026-10-11）。 */
.mention-menu .ac-mrow-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
  color: var(--ui-ink, #f7f7f7);
}

/* 描述行：默认高度收起（0），hover/active 展开 —— 行高跟着**平滑过渡**，不是啪一下跳出来。
   为什么不用 display:none：display 不参与过渡（none ↔ block 之间没有中间态），
   展开只能是一瞬间的跳变（用户实测报的：「高度变化很突兀」）。
   改成 max-height + opacity 就可以插值；overflow:hidden 让文字在展开过程中被裁切着露出来。 */
.mention-menu .ac-mrow-hint {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 16px;
  color: var(--ui-ink-dim, #919191);
  transition: max-height 0.18s ease, opacity 0.18s ease;
}

.mention-menu .menu-item:hover .ac-mrow-hint,
.mention-menu .menu-item.active .ac-mrow-hint {
  max-height: 16px;
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .mention-menu .ac-mrow-hint {
    transition: none;
  }
}
</style>
