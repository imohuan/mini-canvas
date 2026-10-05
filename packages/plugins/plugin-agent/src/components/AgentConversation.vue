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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowUp, ChevronDown, ChevronRight, X, Loader2, Sparkles, Plus, Box,
  WandSparkles, Plug, BellRing, ShieldCheck, Zap, CircleCheck,
  RefreshCw, Hand, ShieldAlert,
} from 'lucide-vue-next'
import { useUiComponent, useCanvasRender } from '@mini-canvas/canvas-render'
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import { useAgent } from '../useAgent.js'
import { useStickyScroll } from '../useStickyScroll.js'
import { skillResources, mcpResources, nodeResources, type CanvasNodeRow, ICON_SKILL, ICON_MCP, ICON_NODE } from '../agentResources.js'
import AgentMarkdown from './AgentMarkdown.vue'

const agent = useAgent()
const s = agent.state

/** 画布上下文：节点 @ 引用与「点标签聚焦节点」都要它（doc / viewport / nodeLayout） */
const { ctx } = useCanvasRender()

/**
 * 上下文环的几何常量（照参考页实测：viewBox 12×12、半径 5.25、描边 1.5）。
 * 周长直接由 r 算，不写死数字 —— 以后想调大小只改半径，弧长自动跟上。
 */
const CONTEXT_R = 5.25
const CONTEXT_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_R

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

/** 点缩略图看大图（再点关掉）。放个简单遮罩就够，不引弹窗组件 */
const previewImage = ref<string | null>(null)

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
const editorRef = ref<InstanceType<typeof ProseMirrorEditor> | null>(null)
const openThinking = ref<Record<string, boolean>>({})
/** 顶部那条「我能帮你做很多事」提示；点 ✕ 后本次打开不再显示 */
const hintDismissed = ref(false)
/** 各下拉各自开合（互斥由 dropdown 自己保证：同屏只留一个） */
const modeOpen = ref(false)
const authOpen = ref(false)
const modelOpen = ref(false)
const skillOpen = ref(false)
const mcpOpen = ref(false)

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
/** 服务名 → 检测结果（只存展示需要的两样：好没好 + 一句说明） */
const mcpStatus = ref<Record<string, { ok: boolean; text: string }>>({})

function mcpStatusOf(name: string): { ok: boolean; text: string } | null {
  return mcpStatus.value[name] ?? null
}

async function runMcpProbe(): Promise<void> {
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
    await agent.reconnectMcp()
    const r = await agent.probeMcp()
    const next: Record<string, { ok: boolean; text: string }> = {}
    for (const sv of r.servers) {
      const ok = sv.status === 'completed'
      next[sv.name] = { ok, text: ok ? sv.tools + ' 个工具' : (sv.error || sv.status || '连接失败') }
    }
    mcpStatus.value = next
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

onMounted(() => {
  void agent.refresh()
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
const { scrollToBottom: stickToBottom } = useStickyScroll({
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

/** @ 下拉候选：画布节点 + 已装技能 + 已配 MCP（同一套标签外观、同一个标记格式） */
const editorResources = computed<ResourceItem[]>(() => [
  ...nodeResources(nodeList.value, s.canvasId, focusNode),
  ...skillResources(s.skills),
  ...mcpResources(s.mcpServers),
])

/**
 * 右键菜单「引用到 Agent」→ 把那个节点插成标签。
 *
 * 命令在插件上下文里执行、输入框在这里，服务是唯一共享通道：命令只往 state.pendingNodeRef
 * 写一句「引用这个 id」，组件看见就插标签并清掉（见 agentPlugin 的 agent:reference-node）。
 */
function insertPendingNodeRef(): void {
  const nodeId = s.pendingNodeRef
  if (!nodeId) return
  syncNodes()
  // 节点可能刚被删：拿不到就只清待办，不插半截东西
  const item = nodeResources(nodeList.value, s.canvasId, focusNode).find((x) => x.id === 'node:' + nodeId)
  if (item) void nextTick(() => editorRef.value?.insertResource(item))
  agent.clearNodeRef()
}
// 两条路都要覆盖：
//   · 面板已开着 → 右键命令只改 state，watch 触发；
//   · 面板本来关着 → 命令会 show()，组件此刻才挂载，onMounted 补上这一次（watch 非 immediate，
//     挂载前设的值它收不到）。onMounted 跑在子组件挂载之后，editorRef 已就绪。
watch(() => s.pendingNodeRef, () => insertPendingNodeRef())
onMounted(() => insertPendingNodeRef())

/** 往输入框插一个标签（点下拉里的一项 = 插 chip，不切开关），插完就收起下拉 */
function insertRef(item: ResourceItem, close: () => void): void {
  editorRef.value?.insertResource(item)
  close()
}

function submit(): void {
  const text = prompt.value.trim()
  const pics = [...attached.value]
  // 只有图、没打字也算合法的一条（"这图里是什么"这种问法很常见）
  if ((!text && !pics.length) || s.running) return
  prompt.value = ''
  attached.value = []
  modeOpen.value = modelOpen.value = skillOpen.value = mcpOpen.value = authOpen.value = false
  void agent.send(text, pics.length ? pics : undefined)
  // 自己发的消息必须能看见：无视之前的吸附状态，直接到底。
  // （用户如果先往上翻着看历史，然后发一句 —— 不这样做就会看不到自己刚发的内容。）
  void nextTick(() => stickToBottom())
}

function toggleThinking(id: string): void {
  openThinking.value[id] = !openThinking.value[id]
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (previewImage.value) {
    previewImage.value = null
    return
  }
  modeOpen.value = modelOpen.value = skillOpen.value = mcpOpen.value = authOpen.value = false
}

/** 只有带密钥的模型能选 */
const usableModels = computed(() => s.models.filter((m) => m.hasKey))
function pickModel(m: { provider: string; modelId: string }, close: () => void): void {
  agent.setModel(m.provider, m.modelId)
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
  agent.setActivePrompt(id)
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
  { value: 'ask', label: '接受审核', hint: '命中规则的工具先问你', icon: Hand, tone: 'plain' },
  { value: 'auto', label: '完全自动授权', hint: '所有工具直接放行，不打扰', icon: ShieldAlert, tone: 'auto' },
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
 * 为什么要这一段：后端只存纯文本（`getPlainText()` 把引用写成 `@名字 `），所以历史里
 * 没有结构化引用可读；但「装了哪些技能 / MCP」我们本地就有 —— 按名字回推即可还原成
 * 与输入框里那颗 chip 完全同款的标签。
 *
 * 匹配规则：按名单**从长到短**扫，避免 `@art` 先命中而把 `@artist` 截断；
 * 名字后必须是词边界（空格 / 标点 / 行尾），否则 `@archifyX` 会被误判成 `@archify`。
 */
interface UserSegment { type: 'text' | 'tag'; value: string; name: string; category: string; icon: string }

const userSegments = (text: string): UserSegment[] => {
  const refs: Array<{ name: string; category: string; icon: string }> = [
    // 节点引用也还原成标签（历史里发过的节点引用照样看得出是引用，不是普通文字）
    ...nodeList.value.map((n) => ({ name: n.name, category: '节点', icon: ICON_NODE })),
    ...s.skills.map((sk) => ({ name: sk.name, category: '技能', icon: ICON_SKILL })),
    ...s.mcpServers.map((m) => ({ name: m.name, category: 'MCP', icon: ICON_MCP })),
  ]
  if (!refs.length || !text.includes('@')) return [{ type: 'text', value: text, name: '', category: '', icon: '' }]
  // 长的名字排前面：`@代码评审` 要先于 `@代码` 试。
  refs.sort((a, b) => b.name.length - a.name.length)
  const out: UserSegment[] = []
  let rest = text
  while (rest.length) {
    let hit: { name: string; category: string; icon: string; at: number } | null = null
    for (const ref of refs) {
      const at = rest.indexOf('@' + ref.name)
      if (at === -1) continue
      const after = rest.charAt(at + 1 + ref.name.length)
      // 名字后不是词边界 → 只是巧合的前缀，跳过
      if (after && !/[\s,，。.、;；:：!！?？)\]}>"'」』]/.test(after)) continue
      if (!hit || at < hit.at) hit = { ...ref, at }
    }
    if (!hit) {
      out.push({ type: 'text', value: rest, name: '', category: '', icon: '' })
      break
    }
    if (hit.at > 0) out.push({ type: 'text', value: rest.slice(0, hit.at), name: '', category: '', icon: '' })
    out.push({ type: 'tag', value: '@' + hit.name, name: hit.name, category: hit.category, icon: hit.icon })
    rest = rest.slice(hit.at + 1 + hit.name.length)
  }
  return out
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
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
    <div v-else ref="scroller" class="ac-scroll" role="log" aria-live="polite">
      <!-- 稳定的**内容容器**：空态与消息流都在它里面。
           为什么必须有一层稳定的壳：ResizeObserver 只能盯住一个具体的 DOM 节点，
           而空态与消息流是 v-if/v-else 互换的（挂载时看到的那个节点随后会被换掉），
           盯它就会盯到已被丢弃的节点上 —— 内容再长也不触发。 -->
      <div class="ac-inner">
      <!-- 空态：中心欢迎 + 三行建议（照参考图） -->
      <div v-if="!s.turns.length" class="ac-welcome">
        <div v-if="!hintDismissed" class="ac-hint-card">
          <p class="ac-hint-text"><strong>我能帮你做很多事</strong>，比如回答问题、写文章、编剧本、生成图片/视频/音频…</p>
          <button class="ac-hint-close" aria-label="我知道了" @click="dismissHint"><X :size="13" /></button>
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
        <div v-else class="ac-msg" :class="t.kind">
          <div class="ac-bubble">
            <button v-if="t.thinking" class="ac-think-toggle" @click="toggleThinking(t.id)">
              <ChevronRight :size="12" :class="{ 'ac-rot': openThinking[t.id] }" />思考过程
            </button>
            <pre v-if="t.thinking && openThinking[t.id]" class="ac-think">{{ t.thinking }}</pre>

            <div v-for="tool in t.tools.filter((x) => x.card)" :key="tool.id" class="ac-tool-card">
              <div class="ac-tool-head">
                <!-- 转圈只认 settled：没有它就还在跑。
                     早先按有没有 output 判断，导致「跑完但没输出」的工具刷新后永远转圈。 -->
                <Loader2 v-if="!tool.settled" :size="13" class="ac-spin" /><strong>{{ tool.name }}</strong>
              </div>
              <pre class="ac-tool-args">{{ tool.arguments }}</pre>
              <pre v-if="tool.output" class="ac-tool-out">{{ tool.output }}</pre>
            </div>
            <div v-for="tool in t.tools.filter((x) => !x.card)" :key="tool.id" class="ac-tool-line">
              <code>{{ tool.name }}</code>
              <span v-if="tool.output" class="ac-tool-line-out">{{ tool.output.slice(0, 80) }}</span>
            </div>

            <!-- 用户消息：把正文里出现的 @技能 / @MCP 还原成**标签**（与输入框里那颗 chip 同款），
                 其余文字照常显示。为什么不直接存结构化引用：会话历史里只有纯文本（后端只存
                 getPlainText 的结果），靠"@名字 + 已装清单"回推，刷新/切会话也得到同一份渲染。 -->
            <p v-if="t.kind === 'user'" class="ac-user-line">
              <template v-for="(seg, si) in userSegments(t.text)" :key="si">
                <span v-if="seg.type === 'tag'" class="ac-sent-tag" :title="seg.category + '：' + seg.name">
                  <span class="ac-sent-tag-icon" v-html="seg.icon" aria-hidden="true"></span>
                  <span class="ac-sent-tag-label">{{ seg.name }}</span>
                </span>
                <span v-else class="ac-user-text">{{ seg.value }}</span>
              </template>
            </p>
            <!-- 用户消息带的图：按原比例排一行缩略图，点开看大图 -->
            <div v-if="t.kind === 'user' && t.images?.length" class="ac-user-images">
              <button v-for="(src, ii) in t.images" :key="ii" class="ac-user-image" :aria-label="'查看图片 ' + (ii + 1)"
                @click="previewImage = src">
                <img :src="src" alt="" />
              </button>
            </div>
            <!-- 助手消息才走 Markdown。
                 这里**必须**是独立的 v-if，不能接在用户那条的 v-else-if 链上：
                 中间隔着「用户图片」那个 div 时，链会被打断，导致用户消息既渲染标签行、
                 又再渲染一遍原始 Markdown 文本（实测文本重复出现两次，还带出字面 @名字）。 -->
            <AgentMarkdown v-if="t.kind !== 'user' && t.text" :text="t.text" />
            <!-- 等模型首个 token 时显示「正在思考」的加载行（照参考图：转圈 + 文字）。
                 此前这里是一根闪烁的方块（学光标），用户点名要换成这种带文案的加载态。 -->
            <p v-if="t.streaming && t.kind === 'assistant' && !t.text" class="ac-pending" role="status" aria-live="polite">
              <!-- 图标是**一段开口的圆弧**（照参考图：3/4 圈转圈），不是整圈的 Loader2 ——
                   整圈转起来几乎看不出在动，开口的弧才有"在转"的观感。 -->
              <span class="ac-pending-spin" aria-hidden="true"></span>
              <span>正在思考</span>
            </p>
            <!-- 过程提示（主要是「已连接 MCP：smart(3 个工具)」这类）**暂时隐藏**。
                 用户口径：不要删除，只是先不显示 —— 每次对话都冒一条、又说不清什么时候会出现，
                 反而干扰阅读；MCP 的真实状态改在下拉里实时看（见 MCP 下拉里的「检测」）。
                 数据仍在 turn.notice 上，想放回来把 SHOW_PROCESS_NOTICE 改 true 即可。 -->
            <p v-if="SHOW_PROCESS_NOTICE && t.notice" class="ac-notice">{{ t.notice }}</p>
            <p v-if="t.error" class="ac-error">{{ t.error }}</p>
          </div>
        </div>
      </template>
      </div>
    </div>

    <!-- ④ 输入区（照参考图：整块圆角 16 的框，里面上编辑器、下工具条） -->
    <div class="ac-composer">
      <!-- 通知提示条（照参考页实测）：只在浏览器还没授权时出现，点「开启」走真的权限申请 -->
      <div v-if="showNotifyTip" class="ac-notify" role="status">
        <BellRing :size="14" class="ac-notify-icon" />
        <span class="ac-notify-text">开启浏览器通知，及时获取最新消息</span>
        <button class="ac-notify-btn" @click="enableNotify">开启</button>
        <button class="ac-notify-close" aria-label="不再提示" @click="notifyDismissed = true"><X :size="13" /></button>
      </div>
      <div class="ac-input-box">
        <!-- 待发送的图片：贴在输入框上方，可单张移除 -->
        <div v-if="attached.length" class="ac-attach-list">
          <div v-for="(src, i) in attached" :key="i" class="ac-attach">
            <img :src="src" alt="" />
            <button class="ac-attach-del" :aria-label="'移除图片 ' + (i + 1)" @click="removeAttachment(i)"><X :size="12" /></button>
          </div>
        </div>
        <div class="ac-editor">
          <span v-if="!prompt" class="ac-placeholder" aria-hidden="true">开始你的创作，或者 @ 引用技能 / MCP</span>
          <ProseMirrorEditor
            v-if="!s.needsModel"
            ref="editorRef"
            v-model="prompt"
            :resources="editorResources"
            @keydown.enter.exact.prevent="submit"
            @paste="onPaste"
          />
        </div>

        <div class="ac-toolbar">
          <!-- 附件：选了图就等这条消息一起发（data URL，服务端转给 SDK 的图片消息） -->
          <button class="ac-plus" aria-label="添加图片" @click="pickImages()"><Plus :size="17" /></button>
          <input ref="fileInput" class="ac-file" type="file" accept="image/*" multiple aria-hidden="true" tabindex="-1" @change="onFilesPicked" />

          <!-- 模式：圆角胶囊 + 下拉（向上弹，贴左对齐） -->
          <ThemedDropdown v-model="modeOpen" placement="top-start" :offset="8" menu-width="220px" menu-role="listbox">
            <template #trigger>
              <button class="ac-pill" :aria-expanded="modeOpen" aria-label="选择创作模式">
                {{ modeLabel }}<ChevronDown :size="13" />
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

          <!-- 授权方式：接受审核 / 完全自动授权（与设置→Agent→审批规则 是同一个开关） -->
          <ThemedDropdown v-model="authOpen" placement="top-start" :offset="8" menu-width="240px" menu-role="listbox">
            <template #trigger>
              <button class="ac-tb-icon" :class="{ 'is-warn': authMode === 'auto' }" :aria-expanded="authOpen"
                :aria-label="'授权方式：' + (authMode === 'ask' ? '接受审核' : '完全自动授权')">
                <component :is="authMode === 'ask' ? Hand : ShieldAlert" :size="16" />
              </button>
            </template>
            <template #default="{ close }">
              <div class="ac-ddmenu" role="listbox" aria-label="选择授权方式">
                <button v-for="m in AUTH_MODES" :key="m.value" class="ac-menu-item" role="option"
                  :aria-selected="authMode === m.value" @click="setAuthMode(m.value); close()">
                  <span class="ac-menu-title-row">
                    <!-- 图标与文字同染一个语义色（只"完全自动授权"上琥珀；"接受审核"走默认无色） -->
                    <span class="ac-menu-icon" :class="'is-' + m.tone"><component :is="m.icon" :size="14" /></span>
                    <span class="ac-menu-name" :class="'is-' + m.tone">{{ m.label }}</span>
                    <CircleCheck v-if="authMode === m.value" :size="14" class="ac-menu-check" />
                  </span>
                  <span class="ac-menu-hint">{{ m.hint }}</span>
                </button>
                <p class="ac-menu-empty">要问哪些工具，去「设置 → Agent → 审批规则」配。</p>
              </div>
            </template>
          </ThemedDropdown>

          <!-- 模型：多供应商场景下可能是几十条，长列表必须限高 + 滚（照参考图） -->
          <ThemedDropdown v-model="modelOpen" placement="top-start" :offset="8" menu-width="300px" menu-max-width="320px"
            menu-max-height="320px" menu-role="listbox" layout="inner-scroll">
            <template #trigger>
              <button class="ac-tb-icon" :class="{ 'is-on': !!s.model }" :aria-expanded="modelOpen"
                aria-label="选择模型"><Box :size="16" /></button>
            </template>
            <template #default="{ close }">
              <div class="ac-ddmenu" role="listbox" aria-label="选择模型">
                <!-- 分组头（照参考图：标题 + 计数），让"这是哪一类"一眼可见 -->
                <div v-if="usableModels.length" class="ac-menu-head">
                  <span class="ac-menu-head-title">模型</span>
                  <span class="ac-menu-head-count">{{ usableModels.length }}</span>
                </div>
                <div v-if="!usableModels.length" class="ac-menu-empty">没有可用模型（先去设置里配一个）</div>
                <!-- 滚动区：长列表在这里滚，分组头固定在上方不动 -->
                <div class="ac-menu-scroll">
                  <button v-for="m in usableModels" :key="m.provider + '/' + m.modelId" class="ac-menu-card"
                    role="option" :aria-selected="s.model?.modelId === m.modelId" @click="pickModel(m, close)">
                    <span class="ac-menu-card-icon"><Box :size="15" /></span>
                    <span class="ac-menu-card-text">
                      <span class="ac-menu-card-name">{{ m.modelId }}</span>
                      <span class="ac-menu-card-hint">{{ m.provider }}{{ m.isDefault ? ' · 默认' : '' }}</span>
                    </span>
                    <CircleCheck v-if="s.model?.modelId === m.modelId" :size="15" class="ac-menu-card-check" />
                  </button>
                </div>
              </div>
            </template>
          </ThemedDropdown>

          <!-- 技能：每行「图标 + 标题 + 说明」；点一项 = 往输入框插一个标签 -->
          <ThemedDropdown v-if="s.skills.length" v-model="skillOpen" placement="top-start" :offset="8"
            menu-width="320px" menu-max-width="340px" menu-max-height="340px" menu-role="listbox" layout="inner-scroll">
            <template #trigger>
              <!-- 不给「已开启」高亮：引用与否以**输入框里的标签**为准（用户口径）。
                   这里再亮一个开关态会变成第二处真相，和「点一下即插入」的语义冲突。 -->
              <button class="ac-tb-icon" :aria-expanded="skillOpen"
                aria-label="选择技能"><WandSparkles :size="16" /></button>
            </template>
            <template #default="{ close }">
              <div class="ac-ddmenu" role="listbox" aria-label="选择技能">
                <div class="ac-menu-head">
                  <span class="ac-menu-head-title">技能</span>
                  <span class="ac-menu-head-count">{{ s.skills.length }}</span>
                </div>
                <div class="ac-menu-scroll">
                  <button v-for="item in skillResources(s.skills)" :key="item.id" class="ac-menu-card"
                    role="option" :aria-selected="false" :title="item.value" @click="insertRef(item, close)">
                    <span class="ac-menu-card-icon" v-html="ICON_SKILL" aria-hidden="true"></span>
                    <span class="ac-menu-card-text">
                      <span class="ac-menu-card-name">{{ item.name }}</span>
                      <span v-if="item.value" class="ac-menu-card-hint">{{ item.value }}</span>
                    </span>
                  </button>
                </div>
              </div>
            </template>
          </ThemedDropdown>

          <!-- MCP：同上，点一项 = 插入一个标签 -->
          <ThemedDropdown v-if="s.mcpServers.length" v-model="mcpOpen" placement="top-start" :offset="8"
            menu-width="320px" menu-max-width="340px" menu-max-height="340px" menu-role="listbox" layout="inner-scroll">
            <template #trigger>
              <!-- 同上：MCP 也不做开关态高亮，引用看输入框里的标签 -->
              <button class="ac-tb-icon" :aria-expanded="mcpOpen"
                aria-label="选择 MCP"><Plug :size="16" /></button>
            </template>
            <template #default="{ close }">
              <div class="ac-ddmenu" role="listbox" aria-label="选择 MCP">
                <div class="ac-menu-head">
                  <span class="ac-menu-head-title">MCP</span>
                  <span class="ac-menu-head-count">{{ s.mcpServers.length }}</span>
                  <span class="ac-menu-head-spacer"></span>
                  <!-- 实时检测：主动连一次，看当前连没连上、有哪些工具。
                       为什么要它：SDK 的 MCP 是懒连接的（每开一条会话才连一次），
                       消息流里那条「已连接 MCP」提示已经隐藏，状态得有个地方能看。 -->
                  <button class="ac-menu-head-btn" :disabled="mcpProbing"
                    :aria-label="mcpProbing ? '正在检测 MCP' : '检测 MCP 连接'"
                    @click.stop="runMcpProbe">
                    <Loader2 v-if="mcpProbing" :size="12" class="ac-spin" />
                    <RefreshCw v-else :size="12" />
                    {{ mcpProbing ? '检测中' : '检测' }}
                  </button>
                </div>
                <div class="ac-menu-scroll">
                  <button v-for="item in mcpResources(s.mcpServers)" :key="item.id" class="ac-menu-card"
                    role="option" :aria-selected="false" :title="item.value" @click="insertRef(item, close)">
                    <span class="ac-menu-card-icon" v-html="ICON_MCP" aria-hidden="true"></span>
                    <span class="ac-menu-card-text">
                      <span class="ac-menu-card-name">{{ item.name }}</span>
                      <span v-if="item.value" class="ac-menu-card-hint">{{ item.value }}</span>
                    </span>
                    <!-- 检测结果：每行右侧一个小徽章（连上几个工具 / 失败） -->
                    <span v-if="mcpStatusOf(item.name)" class="ac-menu-card-badge"
                      :class="{ 'is-bad': !mcpStatusOf(item.name)!.ok }"
                      :title="mcpStatusOf(item.name)!.text">{{ mcpStatusOf(item.name)!.text }}</span>
                  </button>
                  <p v-if="mcpProbeHint" class="ac-menu-empty">{{ mcpProbeHint }}</p>
                </div>
              </div>
            </template>
          </ThemedDropdown>

          <span class="ac-tb-spacer"></span>
          <!-- 上下文剩余：照参考页实测做成一枚环形 SVG（12×12 viewBox、r=5.25、描边 1.5）。
               底圈整圈淡显（25% 透明），上面叠一段**已用**弧（剩余百分比 = 空出来的那段）——
               所以弧长 = 已用比例，剩余越多圈越空。hover 出提示气泡。 -->
          <!-- 目录里没有 tooltip 时退回普通 span 包一层：环照常显示，只是少了提示气泡。
               （不这么写的话，换一套没登记 tooltip 的主题会让整个环消失 —— 那是可见的功能退化。） -->
          <component
            :is="ThemedTooltip || 'span'"
            v-if="s.contextLeft !== null"
            :content="ThemedTooltip ? '上下文剩余 ' + s.contextLeft + '%' : undefined"
            :placement="ThemedTooltip ? 'top' : undefined"
          >
            <span class="ac-context" role="img" :aria-label="'上下文剩余 ' + s.contextLeft + '%'">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="6" cy="6" r="5.25" stroke="currentColor" stroke-width="1.5" class="ac-ctx-track" />
                <circle cx="6" cy="6" r="5.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                  :stroke-dasharray="CONTEXT_CIRCUMFERENCE" :stroke-dashoffset="contextArcOffset"
                  transform="rotate(-90 6 6)" />
              </svg>
            </span>
          </component>
          <button
            class="ac-send"
            :class="{ 'is-running': s.running }"
            :aria-label="s.running ? '停止' : '发送'"
            :disabled="!s.running && !prompt.trim() && !attached.length"
            @click="s.running ? agent.stop() : submit()"
          >
            <Loader2 v-if="s.running" :size="17" class="ac-spin" />
            <ArrowUp v-else :size="17" />
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- 看大图：点任意处关掉（Esc 也可以，见 onKeydown） -->
  <div v-if="previewImage" class="ac-lightbox" role="dialog" aria-modal="true" aria-label="图片预览" @click="previewImage = null">
    <img :src="previewImage" alt="" />
    <button class="ac-lightbox-close" aria-label="关闭预览" @click.stop="previewImage = null"><X :size="16" /></button>
  </div>
</template>

<style scoped>
/* 数值全部来自 Chrome MCP 对参考页的实测；颜色一律走 --ui-*（实测与本项目暗色主题同值）。 */
.ac-root { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--ui-ink, #f7f7f7); }
.ac-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 16px; }
/* 内容容器：滚动容器里那层稳定的壳（空态与消息流都在里面）。
   它的高度才是真正随消息增长的那个 —— useStickyScroll 盯它做「吐多少都跟到底」。 */
.ac-inner { display: flex; flex-direction: column; }

/* —— 空态（照参考图）—— */
.ac-welcome { display: flex; flex-direction: column; align-items: center; gap: 20px; padding-top: 32px; }
/* 间距统一交给 .ac-welcome 的 gap（照参考页：整块 gap 20px），这里不再单独留 margin */
.ac-hint-card { position: relative; width: 100%; padding: 10px 28px 10px 12px; border-radius: 12px; background: var(--ui-veil, rgb(255 255 255 / 0.06)); font-size: 12px; line-height: 1.6; color: var(--ui-ink-dim, #919191); }
.ac-hint-text { margin: 0; }
.ac-hint-text strong { color: var(--ui-ink, #f7f7f7); }
.ac-hint-close { position: absolute; right: 6px; top: 6px; display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 6px; background: transparent; color: var(--ui-ink-dim, #919191); cursor: pointer; }
.ac-hint-close:hover { background: var(--ui-hover, rgb(255 255 255 / 0.1)); color: var(--ui-ink, #f7f7f7); }
/* 主题色白名单: 空态那颗渐变球是品牌装饰（照参考图的三段青渐变），不是主题 UI 色 */
.ac-welcome-orb { width: 44px; height: 44px; flex: none; border-radius: 999px; background: linear-gradient(160deg, #7dd3fc, #0891b2 55%, #0e7490); box-shadow: 0 0 30px rgb(8 145 178 / 0.45); }
.ac-welcome-title { margin: 0; padding: 0 6px; font-size: 16px; font-weight: 500; line-height: 24px; color: var(--ui-ink, #f7f7f7); }
.ac-suggestions { width: 100%; display: flex; flex-direction: column; }
/* 建议行照参考页实测：39 高 / 圆角 12 / 内边距 0 12 / 间距 10 / 正文 14px，文字用 60% 白 */
.ac-suggestion { display: flex; align-items: center; gap: 10px; width: 100%; height: 39px; padding: 0 12px; border: 0; border-radius: 12px; background: transparent; color: var(--ui-ink-dim, #919191); font-size: 14px; text-align: left; cursor: pointer; transition: background 0.16s ease; }
.ac-suggestion:hover { background: var(--ui-hover, rgb(255 255 255 / 0.1)); }
.ac-suggestion span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-suggestion-arrow { color: var(--ui-ink-dim, #919191); }

/* —— 消息（照参考图：用户靠右灰底、助手靠左无底、都无头像、正文 14px）—— */
.ac-msg { display: flex; margin-bottom: 16px; }
.ac-msg.user { justify-content: flex-end; }
.ac-msg.assistant { justify-content: flex-start; }
.ac-bubble { min-width: 0; }
/* 助手消息占满整行：之前留了 84px 右内边距（照参考图早期版本量到的"正文右缘距面板 84px"），
   但那是把面板宽度量错造成的空档 —— 现在内容区左右各 16px 已经给足呼吸，
   再留 84px 就变成右边一条明显空白（用户实测点名）。 */
.ac-msg.assistant .ac-bubble { width: 100%; }
.ac-msg.user .ac-bubble { max-width: 85%; padding: 12px 16px; border-radius: 12px; background: var(--ui-hover-soft, rgb(255 255 255 / 0.05)); }
/* 用户消息正文：文字与标签在同一行内自然换行 */
.ac-user-line { display: block; margin: 0; font-size: 14px; line-height: 24px; color: var(--ui-ink, #f7f7f7); word-break: break-word; }
.ac-user-text { white-space: pre-wrap; }
/* 已发送的标签：与输入框里那颗 chip 同款外观（图标 + 标题、圆角 6、底色同 --ui-hover-soft）。
   之所以单独一套类名：输入框里那颗是 ProseMirror 直接造 DOM 的（.ac-tag），
   这颗是 Vue 模板渲染的（.ac-sent-tag）—— 两边选择器作用域不同，但视觉值必须一致。 */
.ac-sent-tag { display: inline-flex; align-items: center; gap: 4px; height: 22px; margin: 0 2px; padding: 0 6px 0 4px; border-radius: 6px; background: var(--ui-hover-soft, rgb(255 255 255 / 0.08)); vertical-align: bottom; }
.ac-sent-tag-icon { display: grid; place-items: center; color: var(--ui-ink-dim, #919191); }
.ac-sent-tag-icon :deep(svg) { width: 13px; height: 13px; }
.ac-sent-tag-label { font-size: 12px; font-weight: 500; line-height: 1; color: var(--ui-ink, #f7f7f7); white-space: nowrap; }
.ac-bubble :deep(.md) { font-size: 14px; line-height: 24px; color: var(--ui-ink, #f7f7f7); }
.ac-bubble :deep(.md .md-p) { margin: 0 0 10px; }
.ac-bubble :deep(.md .md-p:last-child) { margin-bottom: 0; }
.ac-bubble :deep(.md .md-h) { margin: 14px 0 8px; font-size: 14px; font-weight: 700; }
.ac-bubble :deep(.md .md-list) { margin: 6px 0 10px; padding-left: 24px; list-style: disc outside; }
.ac-bubble :deep(.md .md-list li) { margin: 4px 0; }

.ac-think-toggle { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 6px; padding: 0; border: 0; background: transparent; color: var(--ui-ink-dim, #919191); font-size: 12px; cursor: pointer; }
.ac-rot { transform: rotate(90deg); }
.ac-think { margin: 0 0 10px; padding: 8px 10px; border-radius: 10px; background: var(--ui-veil, rgb(255 255 255 / 0.06)); font-size: 12px; line-height: 20px; white-space: pre-wrap; color: var(--ui-ink-dim, #919191); font-family: inherit; }
/* 等首个 token 的加载行（照参考图）：转圈 + 「正在思考」，整行用次要文字色。 */
.ac-pending { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 14px; line-height: 24px; color: var(--ui-ink-dim, #919191); }
/* 开口圆弧 = 一个圆 + 透明上边框：转起来能看清缺口在走。
   颜色随 currentColor，所以这行整体改色时图标自动跟随。 */
.ac-pending-spin { display: inline-block; flex: none; width: 14px; height: 14px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: ac-rotate 0.8s linear infinite; }
.ac-tool-line { display: flex; align-items: baseline; gap: 6px; margin: 6px 0; font-size: 12px; color: var(--ui-ink-dim, #919191); }
.ac-tool-line code { padding: 2px 6px; border-radius: 6px; background: var(--ui-veil, rgb(255 255 255 / 0.06)); }
.ac-tool-line-out { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-tool-card { margin: 8px 0; padding: 10px 12px; border: 1px solid var(--ui-line, #363636); border-radius: 12px; background: var(--ui-veil, rgb(255 255 255 / 0.04)); }
.ac-tool-head { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.ac-tool-args, .ac-tool-out { margin: 6px 0 0; font-size: 12px; white-space: pre-wrap; word-break: break-all; color: var(--ui-ink-dim, #919191); font-family: ui-monospace, Menlo, Consolas, monospace; }
.ac-notice { margin: 6px 0 0; font-size: 12px; color: var(--ui-ink-dim, #919191); }
.ac-error { margin: 6px 0 0; font-size: 12px; color: var(--ui-danger, #ef4444); }
.ac-approval { margin: 8px 0 16px; padding: 12px 14px; border: 1px solid var(--ui-warn, #b45309); border-radius: 12px; background: var(--ui-veil, rgb(255 255 255 / 0.04)); }
.ac-approval-head { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.ac-approval-args { margin: 8px 0 10px; padding: 8px 10px; border-radius: 8px; background: var(--ui-code-bg, rgb(0 0 0 / 0.25)); font-size: 12px; white-space: pre-wrap; word-break: break-all; font-family: ui-monospace, Menlo, Consolas, monospace; }
.ac-approval-actions { display: flex; align-items: center; gap: 8px; }
.ac-spin { animation: ac-rotate 0.9s linear infinite; }
@keyframes ac-rotate { to { transform: rotate(360deg); } }
.ac-btn { height: 30px; padding: 0 12px; border: 1px solid var(--ui-line, #363636); border-radius: 8px; background: transparent; color: var(--ui-ink, #f7f7f7); font-size: 12px; cursor: pointer; }
.ac-btn-primary { border-color: transparent; background: var(--ui-accent, #0891b2); color: var(--ui-primary-ink, #141414); }
.ac-onboard { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center; }
.ac-onboard strong { font-size: 15px; }
.ac-onboard p { margin: 0; font-size: 13px; color: var(--ui-ink-dim, #919191); }
.ac-onboard-icon { color: var(--ui-accent, #0891b2); }
.ac-onboard-path { font-size: 12px; opacity: 0.75; word-break: break-all; }

/* —— 输入区（照参考图：外块圆角 16 + 1px 边框 + 内边距 8 + 间距 8）—— */
.ac-composer { flex: none; padding: 4px 8px 12px; }
/* 通知提示条：照参考页实测 40 高 / 圆角 12 / 强调色 20% 底；底色用 --ui-accent-soft 现算，
   用户改强调色后这里自动跟随，不会出现"主色改了、提示条还是青的"。 */
.ac-notify { display: flex; align-items: center; gap: 8px; height: 40px; margin-bottom: 8px; padding: 0 6px 0 10px; border-radius: 12px; background: var(--ui-accent-soft, rgb(8 145 178 / 0.2)); color: var(--ui-ink, #f7f7f7); }
.ac-notify-icon { flex: none; color: var(--ui-accent, #0891b2); }
.ac-notify-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.ac-notify-btn { flex: none; padding: 0 6px; border: 0; background: transparent; color: var(--ui-ink, #f7f7f7); font-size: 13px; font-weight: 600; cursor: pointer; }
.ac-notify-btn:hover { color: var(--ui-accent, #0891b2); }
.ac-notify-close { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--ui-ink-dim, #919191); cursor: pointer; }
.ac-notify-close:hover { background: var(--ui-hover, rgb(255 255 255 / 0.1)); color: var(--ui-ink, #f7f7f7); }
.ac-input-box { display: flex; flex-direction: column; gap: 8px; padding: 8px; border: 1px solid var(--ui-line, #363636); border-radius: 16px; background: var(--ui-overlay-solid, #212121); }
.ac-editor { position: relative; min-height: 64px; max-height: min(45vh, 15rem); overflow-y: auto; }
.ac-placeholder { position: absolute; top: 0; left: 0; font-size: 14px; line-height: 24px; color: var(--ui-ink-dim, #919191); pointer-events: none; }
.ac-toolbar { display: flex; align-items: center; gap: 3px; min-width: 0; }
.ac-plus { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border: 0; border-radius: 8px; background: transparent; color: var(--ui-ink-dim, #919191); cursor: pointer; }
.ac-plus:hover { background: var(--ui-hover, rgb(255 255 255 / 0.1)); color: var(--ui-ink, #f7f7f7); }
/* 原生 file input 只是「被点」的载体，视觉由上面的 + 按钮承担 */
.ac-file { display: none; }
.ac-tb-icon { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--ui-ink-dim, #919191); cursor: pointer; }
.ac-tb-icon:hover { background: var(--ui-hover, rgb(255 255 255 / 0.1)); color: var(--ui-ink, #f7f7f7); }
.ac-tb-icon.is-on { color: var(--ui-accent, #0891b2); }
/* 授权方式 = 完全自动授权时用警示色（琥珀）：这是唯一需要用户留意的状态，图标染上提醒留意 */
.ac-tb-icon.is-warn { color: var(--ui-warn, #e3a25f); }
.ac-pill { display: inline-flex; align-items: center; gap: 1px; height: 32px; padding: 0 4px 0 8px; border: 0; border-radius: 9999px; background: transparent; color: var(--ui-ink, #f7f7f7); font-size: 13px; cursor: pointer; white-space: nowrap; }
.ac-pill:hover { background: var(--ui-hover, rgb(255 255 255 / 0.1)); }
.ac-tb-spacer { flex: 1; min-width: 8px; }
/* 上下文环：照参考页实测占 32×32 的触发区（图标 12×12 居中），图标色 --ui-ink-dim。
   外面再包一层 tooltip 时也要保持这个尺寸，不然工具条按钮的基线会跳。 */
.ac-context { display: grid; place-items: center; width: 32px; height: 32px; margin-right: 2px; color: var(--ui-ink-dim, #919191); cursor: default; }

/* —— 图片：待发送缩略图 / 已发送缩略图 / 看大图 —— */
/* 待发送（在输入框里，图片上方） */
.ac-attach-list { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 2px 0; }
.ac-attach { position: relative; width: 56px; height: 56px; flex: none; border: 1px solid var(--ui-line, #363636); border-radius: 10px; overflow: hidden; background: var(--ui-veil, rgb(255 255 255 / 0.04)); }
.ac-attach img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ac-attach-del { position: absolute; top: 2px; right: 2px; display: grid; place-items: center; width: 18px; height: 18px; border: 0; border-radius: 999px; background: var(--ui-scrim, rgb(0 0 0 / 0.6)); color: var(--ui-tip-ink, #fff); cursor: pointer; }
.ac-attach-del:hover { background: var(--ui-danger, #ef4444); }
/* 已发送（在用户气泡里）：按原比例排，点开看大图 */
.ac-user-images { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.ac-user-image { display: block; width: 96px; height: 96px; padding: 0; border: 0; border-radius: 10px; overflow: hidden; background: transparent; cursor: zoom-in; }
.ac-user-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* 看大图：铺满面板的遮罩（z-index 要在下拉/浮层之上） */
.ac-lightbox { position: fixed; inset: 0; z-index: 100000; display: grid; place-items: center; padding: 24px; background: var(--ui-scrim, rgb(0 0 0 / 0.6)); cursor: zoom-out; }
.ac-lightbox img { max-width: 100%; max-height: 100%; border-radius: 12px; box-shadow: var(--ui-shadow-lg, 0 24px 64px rgb(0 0 0 / 0.55)); }
.ac-lightbox-close { position: absolute; top: 12px; right: 12px; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: var(--ui-tip, rgb(0 0 0 / 0.9)); color: var(--ui-tip-ink, #fff); cursor: pointer; }
/* 底圈：整圈淡显（照参考页 opacity .25），提供"盘面"感 */
.ac-ctx-track { opacity: 0.25; }
.ac-send { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border: 0; border-radius: 12px; background: var(--ui-primary-bg, #f7f7f7); color: var(--ui-primary-ink, #141414); cursor: pointer; transition: opacity 0.16s ease; }
.ac-send:disabled { opacity: 0.45; cursor: default; }
.ac-send.is-running { background: var(--ui-danger, #ef4444); color: var(--ui-primary-ink, #141414); }

/* —— 下拉内容（浮层本体由目录里的 dropdown 提供：定位/翻边/出屏/互斥它负责）——
   层次结构（照参考图）：上下 flex 分栏 ——
     ┌ 分组头（固定，不滚）  标题 + 计数
     ├ 列表区（flex:1，自己滚，滚动条只出在这里）
     │   └ 行卡片：图标托 + 标题/说明 + 选中勾
   浮层用 dropdown 的 layout="inner-scroll"：它只当外框，滚动由下面的列表区负责，
   所以顶部标题天然不滚，不需要 sticky 去补。 */
.ac-ddmenu { display: flex; flex-direction: column; min-height: 0; flex: 1; padding: 2px; }

/* 分组头：普通 flex 行。它不滚是因为**滚动发生在下面的列表区**，不是靠定位吸住。 */
.ac-menu-head { display: flex; align-items: center; gap: 8px; flex: none; padding: 8px 10px 6px; }
.ac-menu-head-title { font-size: 12px; font-weight: 600; color: var(--ui-ink, #f7f7f7); }
.ac-menu-head-count { min-width: 18px; padding: 0 5px; border-radius: 999px; background: var(--ui-chip, rgb(255 255 255 / 0.1)); font-size: 10px; line-height: 16px; text-align: center; color: var(--ui-ink-dim, #919191); }
/* 分组头右侧的操作（MCP 的「检测」）：把计数推到左边、按钮贴右 */
.ac-menu-head-spacer { flex: 1; min-width: 4px; }
.ac-menu-head-btn { display: inline-flex; align-items: center; gap: 4px; flex: none; height: 22px; padding: 0 8px; border: 1px solid var(--ui-line, #363636); border-radius: 999px; background: transparent; color: var(--ui-ink-dim, #919191); font-size: 11px; cursor: pointer; }
.ac-menu-head-btn:hover:not(:disabled) { background: var(--ui-hover, rgb(255 255 255 / 0.1)); color: var(--ui-ink, #f7f7f7); }
.ac-menu-head-btn:disabled { opacity: 0.6; cursor: default; }
/* 每行右侧的检测徽章 */
.ac-menu-card-badge { flex: none; margin-top: 3px; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 6px; border-radius: 999px; background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); color: var(--ui-accent-hover, #0e7490); font-size: 10px; line-height: 15px; }
.ac-menu-card-badge.is-bad { background: var(--ui-danger-veil, rgb(239 68 68 / 0.1)); color: var(--ui-danger, #ef4444); }

/* 列表区：**唯一会滚的那层**。flex:1 + min-height:0 才能在限高的浮层里正确收缩 */
.ac-menu-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 0 2px 2px; }

/* 行卡片：图标托 + 两行文字 + 选中勾。整行有底色/描边，才有"一条一条"的结构感 */
.ac-menu-card { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 9px 10px; border: 1px solid transparent; border-radius: 10px; background: var(--ui-veil, rgb(255 255 255 / 0.04)); text-align: left; cursor: pointer; transition: background 0.14s ease, border-color 0.14s ease; }
.ac-menu-card:hover { background: var(--ui-hover, rgb(255 255 255 / 0.1)); }
.ac-menu-card[aria-selected='true'] { border-color: var(--ui-accent, #0891b2); background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); }
.ac-menu-card-icon { display: grid; place-items: center; flex: none; width: 26px; height: 26px; border-radius: 8px; background: var(--ui-chip, rgb(255 255 255 / 0.1)); color: var(--ui-ink-dim, #919191); }
.ac-menu-card-icon :deep(svg) { width: 15px; height: 15px; }
.ac-menu-card[aria-selected='true'] .ac-menu-card-icon { color: var(--ui-accent, #0891b2); }
.ac-menu-card-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.ac-menu-card-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--ui-ink, #f7f7f7); }
.ac-menu-card[aria-selected='true'] .ac-menu-card-name { color: var(--ui-accent, #0891b2); font-weight: 600; }
.ac-menu-card-hint { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 11px; line-height: 1.5; color: var(--ui-ink-dim, #919191); }
.ac-menu-card-check { flex: none; margin-top: 5px; color: var(--ui-accent, #0891b2); }

/* 简单两项式下拉（创作模式 / 授权方式）：标题一行 + 说明一行 */
.ac-menu-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 8px 10px; border: 0; border-radius: 8px; background: transparent; text-align: left; cursor: pointer; }
.ac-menu-item:hover { background: var(--ui-hover, rgb(255 255 255 / 0.1)); }
.ac-menu-item[aria-selected='true'] .ac-menu-name { color: var(--ui-accent, #0891b2); font-weight: 600; }
.ac-menu-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--ui-ink, #f7f7f7); }
.ac-menu-title-row { display: flex; align-items: center; gap: 6px; width: 100%; }
.ac-menu-title-row .ac-menu-name { flex: 1; min-width: 0; }
/* 授权方式两个选项的配色（用户口径 2026-10-03）:
   ask  = 手掌 / **默认无色**（先停一下是常态，不用彩色喊）
   auto = 盾牌+感叹号 / **琥珀**（图标与文字都染，唯一需要留意的那个选项）
   底色是同色 12% 的浅托, 亮暗主题都由 token 现算 */
.ac-menu-icon { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; color: var(--ui-ink-dim, #919191); background: var(--ui-chip, rgb(255 255 255 / 0.1)); }
.ac-menu-icon.is-auto { color: var(--ui-warn, #e3a25f); background: color-mix(in srgb, var(--ui-warn, #e3a25f) 12%, transparent); }
/* 完全自动授权那一行，文字也跟着图标染成琥珀（用户要求：不要只有图标有色） */
.ac-menu-name.is-auto { color: var(--ui-warn, #e3a25f); }
.ac-menu-item[aria-selected='true'] .ac-menu-name { color: var(--ui-ink, #f7f7f7); }
.ac-menu-check { flex: none; color: var(--ui-accent, #0891b2); }
.ac-menu-hint { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ui-ink-dim, #919191); }
.ac-menu-empty { margin: 8px 10px; font-size: 12px; color: var(--ui-ink-dim, #919191); }
@media (prefers-reduced-motion: reduce) { .ac-spin, .ac-pending-spin { animation: none; } }
</style>

<!-- 输入框内联标签（.ac-tag / .ac-mrow）由 ProseMirror 直接造 DOM，拿不到 scoped 属性，
     所以这几条必须是非 scoped。类名都带 ac- 前缀，避开与其它插件撞名。 -->
<style>
/* 编辑器最小高度：库默认 120px（.prose-mirror-editor .ProseMirror 与它的一层 wrapper），
   照参考页实测应是 64px（min-height 4rem）—— 不压下来的话整块输入区比目标高 56px。
   只作用在 Agent 面板内（都挂在 .ac-editor 下），不影响底栏等其它调用方。 */
.ac-editor .prose-mirror-editor .ProseMirror,
.ac-editor .prose-mirror-editor > div:first-child { min-height: 64px; }
.prose-mirror-editor .ac-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 6px 0 4px;
  margin: 0 2px;
  border-radius: 6px;
  background: var(--ui-hover-soft, rgb(255 255 255 / 0.08));
  vertical-align: bottom;
  user-select: none;
  cursor: pointer;
}
/* 编辑器给资源节点默认画一条下划线（.resource-node 的 border-bottom），那是给"文字引用"用的。
   我们的标签自带底色块，再叠一条下划线就成了"带线的胶囊"（实测参考图里没有线）。
   用 .resource-node 一起限定，靠更高的选择器权重压过后加载的库样式。 */
.prose-mirror-editor .ac-tag.resource-node { border-bottom: 0; padding: 0 6px 0 4px; height: 22px; }
.prose-mirror-editor .ac-tag .ac-tag-icon { display: grid; place-items: center; color: var(--ui-ink-dim, #919191); }
.prose-mirror-editor .ac-tag .ac-tag-icon svg { width: 13px; height: 13px; }
.prose-mirror-editor .ac-tag .ac-tag-label { font-size: 12px; font-weight: 500; line-height: 1; color: var(--ui-ink, #f7f7f7); white-space: nowrap; }
.prose-mirror-editor .ProseMirror-selectednode.ac-tag,
.prose-mirror-editor .ac-tag.resource-node-selected { background: var(--ui-accent, #0891b2); }
.prose-mirror-editor .ProseMirror-selectednode.ac-tag .ac-tag-label,
.prose-mirror-editor .ac-tag.resource-node-selected .ac-tag-label { color: var(--ui-primary-ink, #141414); }
.prose-mirror-editor .ProseMirror-selectednode.ac-tag .ac-tag-icon,
.prose-mirror-editor .ac-tag.resource-node-selected .ac-tag-icon { color: var(--ui-primary-ink, #141414); }
/* @ 菜单里的行（富行外观与工具栏下拉保持一致） */
/* @ 行：默认只显示**名称**一行；hover / 键盘选中时描述行展开（多出一行，行高自然撑开）。
   描述不再常显 —— 常显会把每行都拉成两行，列表看着发灰又挤（用户口径）。 */
.mention-menu .ac-mrow { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mention-menu .ac-mrow-icon { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border-radius: 6px; background: var(--ui-chip, rgb(255 255 255 / 0.1)); color: var(--ui-ink, #f7f7f7); }
.mention-menu .ac-mrow-icon svg { width: 14px; height: 14px; }
.mention-menu .ac-mrow-text { display: flex; flex-direction: column; min-width: 0; }
.mention-menu .ac-mrow-name { font-size: 13px; line-height: 18px; color: var(--ui-ink, #f7f7f7); }
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
.mention-menu .menu-item.active .ac-mrow-hint { max-height: 16px; opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .mention-menu .ac-mrow-hint { transition: none; }
}
</style>
