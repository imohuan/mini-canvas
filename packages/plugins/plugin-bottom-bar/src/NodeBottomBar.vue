<script setup lang="ts">
/**
 * NodeBottomBar —— 默认底栏皮（themeRegistry 槽 bottomBar 的默认赢家）。
 *
 * 版式**照 LibTV 参考逐块复刻**（参考图 + 浏览器实测其真实 DOM 尺寸）：
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ (+参考) (标记) (风格)                              [⤢]   │  ← 一排 pill（h26 圆角胶囊）
 *   │ ┌────┐ ┌────┐                                            │  ← 素材卡常显（48×48，带序号角标）
 *   │ │ 1  │ │ 1  │                                            │
 *   │ └────┘ └────┘                                            │
 *   │ @素材名 这里打字…                                         │  ← 输入**内联**在卡下面（点得进去、能打字、@ 引用）
 *   │ [模型 ▾] │ [16:9·标准画质·2K·1张 ▾]      ⚙ ✨ 15 (↑)      │  ← 底部行；右边圆形发送
 *   └──────────────────────────────────────────────────────────┘
 *
 * 与参考的关键一致点（都是用户明确点出来的）：
 * - 素材卡**直接显示**，不需要先点「参考」；点卡片进入预览；
 * - 输入区在卡下面、内联一行，**可点击可输入**；
 * - 一排 pill 与底部下拉的数值、圆角、间距照参考给。
 *
 * 分工（架构不变）：动作列表 = ctx.get('nodeBar').list；动作的 fields 渲染成下拉；
 * promptBinding:'text' 把输入框接到 data.text；没有可用动作时自身返回空。
 * 服务取值（§0.1）：组件里一律 ctx.get(...)，不直访 ctx.nodeBar。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import { registerItem, type ResourceItem } from 'prosemirror-editor-bundle'
// 素材卡拖拽排序（用户要求：「这个顺序可以进行拖拽改变，用 Vue Draggable Plus，动画效果挺好的」）
import { VueDraggable } from 'vue-draggable-plus'
import {
  useCanvasRender,
  useGenPanelMetrics,
  useSoleNodeSelected,
  useUiComponent,
  RenderEvents,
  LAYERS,
} from '@mini-canvas/canvas-render'
import type { ToolParamDef } from '@mini-canvas/kernel'
import type { BarAction } from './barTypes'
import {
  collectUpstreamMaterials,
  previewListFor,
  makeResourceResolver,
  materialCards,
  nextRefOrder,
  placeRefAtSlot,
  type RefSlotHints,
  resolveMaterialUrls,
  toEditorResources,
  toToolResources,
  type MaterialCard,
  type UpstreamMaterial,
} from './panelSource'
import { readRunState } from './runState'
import { initialPromptText, promptPersistFields } from './promptPersist'
// 参考：进入/退出画布选择态（会话状态在 referenceMode 里，浮层组件消费）
import { exitReference, referenceActive, referenceEpoch, referenceOwner, toggleReference as toggleReferenceMode } from './referenceMode'
// 全屏预览（用户要求：素材卡点开要全屏看，不是缩在底栏里）
import { openPreview } from './mediaPreview'
// AI 按钮（可配置的「翻译 / 提示词优化」等）：清单/模板/请求链路在 aiActions.ts。
import {
  loadAiActions,
  requestAiText,
  resolveAgentBaseUrl,
  normalizeAiActions,
  AI_ACTIONS_CHANGED_EVENT,
  type AiActionsChangedPayload,
  DEFAULT_AI_ICON,
  type AiActionConfig,
} from './aiActions'
// 「看图」@ 素材槽位：标签解析 / 落点判定（纯函数，已单测）
import {
  parseRefSlots,
  judgeSlotDrop,
  dropVerdictMessage,
  hitSlotAtPoint,
  refSlotKey,
  REF_SLOT_META,
  type RefSlotKind,
} from './refSlots'
// 参考区合并 + 缺号校验（纯函数，已单测）
import { mergeRefTiles, findRefGap, uploadToRefSlot, refNameToSlotKey, type TileCardLike } from './refTiles'
// Ctrl 拖资源到参考格：节点媒体判定 / 目标放行（纯函数，已单测）
import { nodeMediaOf } from './refSlotDrag'
import { enterCtrlDragMode, exitCtrlDragMode, registerStartDragHandler } from './ctrlDragMode'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx, renderEdges, renderNodes } = useCanvasRender()
// 设计系统件按名取（§4.5 目录）：换主题插件时这里一行不改
const Select = useUiComponent('select')
const ToolParamField = useUiComponent('toolParamField')
const ToolParamGroup = useUiComponent('toolParamGroup')
const Tooltip = useUiComponent('tooltip')

// 单选才显示（与既有三份面板同语义）
const visible = useSoleNodeSelected(props.id)

/** 面板宽度与输入框高度区间（沿用既有配置项，不新增配置键） */
const metrics = useGenPanelMetrics()
const panelStyle = computed<Record<string, string>>(() => ({
  width: metrics.value.imageWidth + 'px',
}))
const editorStyle = computed<Record<string, string>>(() => ({
  '--nb-min': '20px',
  '--nb-max': metrics.value.editorMaxHeight + 'px',
}))

// —— 节点类型（§0.2：props 没有 type，从 doc 取；订阅 doc 跟随） ——
const doc = computed(() => ctx.tryGet('doc'))
const nodeType = ref<string | undefined>(undefined)
let docOff: (() => void) | null = null
function syncNodeType(): void {
  nodeType.value = doc.value?.getNode(props.id)?.type
}
syncNodeType()
if (doc.value) {
  docOff = doc.value.subscribe(() => syncNodeType())
}
onBeforeUnmount(() => docOff?.())

// —— 动作列表（热装卸后重读） ——
const bar = computed(() => ctx.get<{ list(f?: { type?: string }): BarAction[] }>('nodeBar'))
const actions = ref<BarAction[]>([])
let barFieldOff: { dispose(): void } | null = null
const pluginOffs: Array<{ dispose(): void }> = []
function reloadActions(): void {
  actions.value = bar.value?.list({ type: nodeType.value }) ?? []
}
function watchBarField(): void {
  barFieldOff?.dispose()
  barFieldOff = null
  const field = ctx.registryOf('node/bar')
  if (field && typeof field.subscribe === 'function') {
    // 根 ctx 的 registryOf 视图不带回收器，必须手动 dispose（§0.1）
    barFieldOff = field.subscribe(() => reloadActions())
  }
}
watch(nodeType, reloadActions, { immediate: true })
watchBarField()
pluginOffs.push(ctx.on('ctx:plugin-installed', () => { reloadActions(); watchBarField() }))
pluginOffs.push(ctx.on('ctx:plugin-uninstalled', () => { reloadActions(); watchBarField() }))
onBeforeUnmount(() => {
  barFieldOff?.dispose()
  for (const d of pluginOffs) d.dispose()
})

const hasActions = computed(() => actions.value.length > 0)

/**
 * 模型/动作下拉的选项。
 *
 * 带上 description：下拉浮层里悬停某一行时，名称上移、下方浮现这句话
 * （用户要求「参考我的右键菜单那个 hover 描述动画」——Select 的选项行现在就是这么画的）。
 * 带上 icon：按动作服务的节点类型取该类型的图标（图片/视频/音频），
 * 下拉里每行左侧出一个图标托（用户要求「参考一下它的 UI 图标」，别再是一列光秃秃的文字）。
 */
const actionOptions = computed(() =>
  actions.value.map((a) => ({
    label: a.title,
    value: a.id,
    description: a.description,
    icon: iconOfType(a.types?.[0] ?? nodeType.value),
    // 分组名原样带过去：相邻选项分组不同时下拉里画一条分隔线（与右键菜单的分块同款）。
    // 没声明 group 的动作（旋转 / 下载这类）不参与分组，也就不会凭空多出线。
    group: a.group,
  })),
)

/**
 * 节点类型 → 图标句柄。
 *
 * 单一来源 = 节点类型自己注册的 icon（ctx.nodes.register 的 icon），
 * 取不到再按类型名回落内置 SVG —— 本插件不认识「图片节点长什么样」，
 * 只把类型名翻译成一个图标给下拉用。
 */
function iconOfType(type: string | undefined): unknown {
  if (!type) return undefined
  const reg = ctx.tryGet<{ get(t: string): { icon?: unknown } | undefined }>('nodeRegistry')
  const fromRegistry = reg?.get(type)?.icon
  if (fromRegistry) return fromRegistry
  return FALLBACK_TYPE_ICONS[type]
}

// —— 当前动作与参数 ——
const currentId = ref('')
const currentAction = computed<BarAction | undefined>(() => actions.value.find((a) => a.id === currentId.value))

/**
 * 参数值。**优先用上次留在节点 data 上的那份**（`data.barValues`）。
 * 为什么：用户要求「下次点进来还是上一次提交的数据，不要清空」—— 参数像输入框一样属于
 * 「我正在准备的作品」，不该因为收起再打开就回到默认值。
 */
function plainObject(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : undefined
}
const values = ref<Record<string, unknown>>(plainObject(props.data?.barValues) ?? {})
/** 上次用的是哪个动作（用户要求"再点进来还是上次那套"，动作也要接着上次那个） */
const storedActionId = computed<string | undefined>(() => {
  const raw = plainObject(props.data?.barValues)
  return typeof raw?.actionId === 'string' ? raw.actionId : undefined
})

/**
 * 默认动作：**优先选能输入的那条**（needsPrompt，即生成类），其次才是第一条。
 * 为什么不是直接取第一条：动作按 order 排，即时动作（旋转/下载）order 更小，
 * 于是默认选中一个没有输入框的动作 —— 用户连了素材却看不到输入框（实测反馈）。
 */
function defaultActionId(): string {
  const list = actions.value
  return (list.find((a) => a.needsPrompt === true) ?? list[0])?.id ?? ''
}

/**
 * 首次挂载该选中哪条动作：**优先上次用的那条**（`data.barValues.actionId`）。
 *
 * 用户报的「选了模型/参数，收起控制栏再点开又回默认、配置全没了」根因就在这里：
 * 从前挂载时无条件 `selectAction(defaultActionId())`，从不读节点 data 里那个 actionId；
 * 而底栏一收起（本组件卸载）就会 `persistValues()` 把「默认动作 + 只保留默认动作声明过的参数」
 * 写回节点 —— 于是用户选的模型与它带的参数被真删掉（真机实测复现）。
 *
 * 三条口径（与下面 watch / selectAction 的「接着上次那套」同源）：
 * 1. 没存过 / 存的不是字符串 → 默认第一条（既有行为一个字不变）；
 * 2. 存的动作还在 → 用它，用户的配置恢复；
 * 3. 存的动作找不到了（提供它的插件卸了）→ 回默认第一条，而不是什么都不选。
 */
function initialActionId(): string {
  const remembered = storedActionId.value
  if (remembered && actions.value.some((a) => a.id === remembered)) return remembered
  return defaultActionId()
}

/** select 无 default 取第一项（与内核 resolveToolParams 同口径） */
function defaultsOf(action: BarAction | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of action?.fields ?? []) {
    if (p.default !== undefined) {
      out[p.key] = p.default
      continue
    }
    if (p.type === 'select' && p.options?.length) out[p.key] = p.options[0].value
  }
  return out
}

watch(
  () => actions.value.map((a) => a.id).join('|'),
  () => {
    if (!actions.value.some((a) => a.id === currentId.value)) {
      // 优先回到上次用的那个动作（它还在的话）
      const remembered = storedActionId.value
      const pick = remembered && actions.value.some((a) => a.id === remembered) ? remembered : defaultActionId()
      selectAction(pick)
    }
  },
)

function selectAction(id: string): void {
  const prev = currentAction.value
  if (prev?.onDeselect) prev.onDeselect(props.id)
  currentId.value = id
  // 换动作时**保留**用户已经调过的参数（用户要求：再点进来还是上次那套，不要清空回默认），
  // 但**只保留新动作也声明了的 key** —— 否则旧动作的值会跟着发出去（实测：先选 Dola 视频的
  // model，再切到火山音频，model 还是 "Seedance 2.5"，把正确的 seed-audio-1.0 覆盖掉了）。
  const kept: Record<string, unknown> = {}
  for (const p of (currentAction.value?.fields ?? []) as ToolParamDef[]) {
    if (p.key in values.value) kept[p.key] = values.value[p.key]
  }
  values.value = { ...defaultsOf(currentAction.value), ...kept }
  currentAction.value?.onSelect?.(props.id)
}

// 首次选中：优先恢复正常挂载时在「动作列表」watch 里用的是 storedActionId。
if (hasActions.value && !currentId.value) selectAction(initialActionId())

/**
 * 把当前参数与输入落一份到节点 data，下次点开这个节点时接着用。
 * 走 doc.updateNode（是"我在准备的作品"，进历史 + 落盘）；失败不抛（不该挡住交互）。
 *
 * 提示词：'text' 绑定写 data.text（onPromptUpdate 已即时写，这里不重复），
 * 'none' 绑定写 data.barPrompt —— 这是用户报的「内容消失」的落点。
 */
function persistValues(): void {
  let cleared = false
  let full = ''
  try {
    ctx.get('doc').updateNode(props.id, {
      data: {
        barValues: { ...values.value, actionId: currentId.value },
        // 只有真的存在过输入框（当前动作 needsPrompt）才落提示词：
        // 否则像文本节点（默认动作是「复制/删除」、压根没有输入框）会被写进一个
        // 多余的 barPrompt（它正文在 data.text，不该再复制一份）。
        ...(showEditor.value ? promptPersistFields(promptBinding.value, prompt.value) : {}),
      },
    })
  } catch {
    /* 节点已不在等情况：忽略 */
  }
}

/**
 * 参数落盘**防抖**：拖动滑块会逐帧发 change。
 * 每帧都 doc.updateNode 的话会写几千次历史快照（撤销栈被撑爆、整图 JSON 反复进 localStorage）。
 * 内存里的 values 仍是即时的（界面立刻跟手），只是落盘攒一拍。
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null
function persistValuesSoon(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistValues()
  }, 400)
}
onBeforeUnmount(() => {
  // 卸载前把攒着的那一拍落掉：用户打完字立刻点别处（底栏被收起 → 本组件卸载）时，
  // 400ms 防抖还没到点，不 flush 就会丢掉这次输入 —— 正是用户报的「输入后去操作别的画布，再回来内容没了」。
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  persistValues()
})

// —— 提示词 ——
// 'text' 绑定（文本节点）与 data.text 双向；'none' 绑定（图片生成等）落 data.barPrompt，
// 这样底栏**重新挂载**（切画布/再点节点/任务跑完再回来）后内容还在，发送之后也还在。
// 用户报的「输入内容一下就全消失」根因就是这个：'none' 绑定从没写过节点 data。
const prompt = ref(initialPromptText(props.data))
const promptDoc = ref<unknown>(undefined)
watch(
  () => props.data?.text,
  (next) => {
    const text = typeof next === 'string' ? next : ''
    if (promptBinding.value === 'text' && text !== prompt.value) prompt.value = text
  },
)
// 'none' 绑定下节点 data.barPrompt 被外部改（undo/别的插件）也要跟回来
watch(
  () => props.data?.barPrompt,
  (next) => {
    const text = typeof next === 'string' ? next : ''
    if (promptBinding.value === 'none' && text !== prompt.value) prompt.value = text
  },
)
const promptBinding = computed(() => currentAction.value?.promptBinding ?? 'none')
const needsPrompt = computed(() => currentAction.value?.needsPrompt === true)
/**
 * 当前动作声明的参数（交给 ToolParamGroup 聚成一个下拉）。
 *
 * **过滤掉「风格」类参数**（用户 2026-10-01 明确要求删除）：风格是写在提示词/标签里的文字，
 * 不该作为模型参数出现在底栏 ——「把你这个疯狗给删掉，听不懂吗」。这里做一道与来源无关的
 * 兜底：即便某个模型插件清单里仍声明了 `kind:'style'`，底栏也不再把它渲染成下拉。
 */
const paramDefs = computed<ToolParamDef[]>(() =>
  ((currentAction.value?.fields ?? []) as ToolParamDef[]).filter((p) => p.kind !== 'style'),
)
/** 输入区：needsPrompt 的动作才有 */
const showEditor = computed(() => needsPrompt.value)

/**
 * 输入框内容变化：就地写回节点（是作品，进历史 + 落盘）。
 *
 * - 'text' 绑定（文本节点）：即写 data.text（既有行为，输入框就是节点正文）。
 * - 'none' 绑定（图片生成等）：防抖落 data.barPrompt —— 用户报的「输入后去操作别的画布、
 *   再点回来内容就没了」正是这条从缺：以前 'none' 绑定只存在组件本地 ref 里，底栏一收就没了。
 */
function onPromptUpdate(v: string): void {
  prompt.value = v
  if (promptBinding.value === 'text') {
    ctx.get('doc').updateNode(props.id, { data: { text: v } })
  } else {
    persistValuesSoon()
  }
}

// —— 上游素材（素材卡与 @ 引用共用） ——
/**
 * 用户拖出来的素材顺序（节点 id 序列），存节点 `data.refOrder`。
 *
 * 用户口径（2026-10-12）：「参考图的顺序是如何决定的？好像是根据连接的先后顺序来做的。
 * 我希望这个顺序可以进行拖拽改变。」
 *
 * 为什么落在节点 data（与 barValues / barPrompt 同一个记事本）：它是「这个节点准备怎么出图」
 * 的一部分（第 1 张参考图给谁），不是一个纯 UI 会话态 —— 收起再点开必须还在，落盘之后
 * 刷新、换设备也必须还在。
 */
function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []
}
const refOrder = computed<string[]>(() => stringArray(props.data?.refOrder))

/** 用户指定的槽位（上传/替换到第 N 格时写入 data.refSlot） */
const refSlotHints = computed<RefSlotHints>(() => {
  const raw = props.data?.refSlot
  if (!raw || typeof raw !== 'object') return {}
  const out: RefSlotHints = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = v as { kind?: unknown; index?: unknown }
    if (typeof o?.kind === 'string' && typeof o?.index === 'number') {
      out[id] = { kind: o.kind as RefSlotHints[string]['kind'], index: o.index }
    }
  }
  return out
})

const materials = computed<UpstreamMaterial[]>(() =>
  collectUpstreamMaterials(
    renderEdges.value,
    props.id,
    (nodeId) => {
      const node = renderNodes.value.find((n) => n.id === nodeId)
      return node ? { type: node.type, data: node.data } : undefined
    },
    refOrder.value,
    refSlotHints.value,
  ),
)

/**
 * 只有 resourceId 的素材（新节点）要先 resolve 成当前可显示地址，卡片/缩略图/预览才用得上。
 *
 * 为什么不能拿到素材就直接渲染：resourceId 不是地址（本地是 IndexedDB 的逻辑 id，云端是
 * `<canvasId>/<hash>`），塞进 `<img src>` 一无所有。旧存档有 url 时原样保留，不会多请求。
 *
 * 解析是异步的：先显示已有内容，resolve 回来再换 —— 不阻塞底栏，也不把素材丢掉。
 */
const resolvedMaterials = ref<UpstreamMaterial[]>([])
const materialEpoch = ref(0)
async function refreshResolvedMaterials(): Promise<void> {
  const epoch = ++materialEpoch.value
  const next = await resolveMaterialUrls(materials.value, async (id) => {
    const resources = ctx.tryGet<{ resolve(ref: string): Promise<string | undefined> }>('resources')
    return resources ? resources.resolve(id) : undefined
  })
  // 期间又连了线 / 换了资源：这次结果作废，别把旧素材盖回来
  if (epoch === materialEpoch.value) resolvedMaterials.value = next
}
watch(materials, () => void refreshResolvedMaterials(), { immediate: true })

const shownMaterials = computed(() =>
  resolvedMaterials.value.length === materials.value.length ? resolvedMaterials.value : materials.value,
)
const cards = computed(() => materialCards(shownMaterials.value))
const editorResources = computed<ResourceItem[]>(() => toEditorResources(shownMaterials.value))
const resolveResource = computed(() => makeResourceResolver(editorResources.value))

/**
 * 素材卡拖拽结束后落盘：写**已经排好的那份**（每张卡的 id 顺序），不是「移动指令」。
 *
 * 为什么收下 `next` 而不是自己再算一遍：库在 `update:modelValue` 里给的就是排好的新数组，
 * 而 `cards` 是从 `data.refOrder` 派生的 computed —— 这一帧它**还没变**（要等写盘回灌），
 * 从它身上读会永远读到旧顺序，于是「拖了不动也不存」（实测踩到的坑）。
 * 拿不到数组时（库版本差异/异常）退回渲染中的那份，至少不会写坏。
 *
 * 顺带把顺序收敛成「只留还在的素材」，断开的旧 id 下次不再出现在 refOrder 里。
 * 只有真的变了才写（拖动途中可能触发多次）：没变就不进撤销栈，也不写盘。
 */
function onReorder(next?: MaterialCard[]): void {
  const ids = nextRefOrder(refOrder.value, cards.value, next)
  if (!ids) return
  try {
    ctx.get('doc').updateNode(props.id, { data: { refOrder: ids } })
  } catch {
    /* 节点已不在等情况：忽略 */
  }
}

/** 素材卡点击 → 预览（参考图里卡片点开就是看大图） */
function openCard(card: TileCardLike): void {
  // tile.card（mergeRefTiles 输出）只有 {id,name,url,isText}，没有 kind/value —— 从
  // cards.value（MaterialCard 全量）补全：预览 kind 缺失会让 MediaViewer 认不出媒体
  // 类型 → stage 空白（真机踩过）。找不到（理论上不可能）才用 tile 形状兜底。
  const full = cards.value.find((c) => c.id === card.id)
  const multi = previewListFor(cards.value, full ?? (card as MaterialCard))
  openPreview({
    name: full?.name ?? card.name,
    nodeId: card.id,
    kind: (full?.isText ?? card.isText) ? 'text' : ((full?.kind ?? 'image') as 'image' | 'video' | 'audio'),
    url: full?.url ?? card.url,
    text: full?.value,
    ...(multi ?? {}),
  }, props.id)
}

/**
 * 素材卡右上角的关闭按钮 → **断开「这张素材 → 本节点」那条连线**（与全屏预览里的删除同一条语义）。
 *
 * 用户口径（2026-10-12）：「在右上角区域 hover 时，应该显示一个关闭按钮……点击该按钮后可以
 * 进行关闭，即删除与该图片相关的连接线」。连线没了，卡片自然从底栏消失（卡是边派生的）。
 */
function removeCard(card: TileCardLike): void {
  if (!card) {
    console.warn('[bottom-bar] removeCard: tile.card 为空（格子数据缺 card 字段）')
    return
  }
  ;(window as any).__rmDbg = { cardId: card.id, propsId: props.id, edgeCount: renderEdges.value.length, sample: renderEdges.value.slice(0, 5).map((e) => ({ id: e.id, s: e.source, t: e.target })) }
  const edge = renderEdges.value.find((e) => e.source === card.id && e.target === props.id)
  const doc = ctx.tryGet<{ removeEdges(ids: string[]): number }>('doc')
  if (edge && doc) doc.removeEdges([edge.id])
}

/** 卡片区域 click 委托（捕获阶段）：vue-draggable 移动 DOM 会让子元素 Vue 绑定失联，
 *  所以在容器上统一分发 —— 删除按钮 / 预览按钮 / 待输入格点击都从这里走。 */
function onCardsClickCapture(ev: MouseEvent): void {
  ;(window as any).__capDbg = { target: (ev.target as HTMLElement)?.className?.toString().slice(0, 40), t: Date.now() }
  const target = ev.target as HTMLElement | null
  if (!target) return
  const card = target.closest<HTMLElement>('.nb-card')
  if (!card) return
  const key = card.getAttribute('data-tile-key') ?? ''
  const tile = refTiles.value.find((t) => t.key === key)
  if (target.closest('.nb-remove')) {
    ev.stopPropagation()
    if (tile?.card) removeCard(tile.card)
    return
  }
  if (target.closest('.nb-card-hit')) {
    ev.stopPropagation()
    if (tile?.card) openCard(tile.card)
    return
  }
  // 待输入格：卡片本体点击 = 点上传
  if (tile?.pending && tile.slotKey) {
    ev.stopPropagation()
    pickSlotFile(tile.slotKey)
  }
}

/**
 * 键盘排序（无障碍 + 真实操作可测）：聚焦卡片后 Ctrl+←/Ctrl+→ 左右移动。
 * 走 onReorderTiles 同一条落盘路径 —— 与鼠标拖拽行为完全一致。
 */
function onCardsKeydown(ev: KeyboardEvent): void {
  if (!(ev.ctrlKey || ev.metaKey)) return
  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return
  const card = (ev.target as HTMLElement).closest('.nb-card') as HTMLElement | null
  if (!card) return
  const key = card.getAttribute('data-tile-key') ?? ''
  const cur = refTiles.value.findIndex((t) => t.key === key)
  if (cur < 0) return
  const to = ev.key === 'ArrowLeft' ? cur - 1 : cur + 1
  if (to < 0 || to >= refTiles.value.length) return
  const next = [...refTiles.value]
  const [moved] = next.splice(cur, 1)
  next.splice(to, 0, moved)
  ev.preventDefault()
  ev.stopPropagation()
  onReorderTiles(next.map((t) => ({ key: t.key })))
}

// —— 参考：两态开关（用户实测反馈「点击之后就无法取消」——这里做成开/关切换） ——
const referencing = ref(false)
function syncReference(): void {
  referencing.value = referenceActive() && referenceOwner() === props.id
}
syncReference()
// 会话状态是 module 级 ref：这里不需要订阅，跟住 epoch 变化即可（同一次选择态进入即高亮）
watch(referenceEpoch, syncReference)

/**
 * 点「参考」：两态开关 —— 正在为本节点选参考 → 再点一次退出；否则进入。
 * 用户实测反馈：「点击'参考'按钮之后就无法取消」原来是因为按钮显示态没跟上会话状态。
 * 现在按钮高亮态直接读会话状态，点一下必切换。
 */
function toggleReference(): void {
  toggleReferenceMode(props.id)
  syncReference()
}

// —— 字符计数（与参考图一致：当前/上限） ——
const CHAR_LIMIT = 2000
const charCount = computed(() => prompt.value.length)

// —— info 只读读数（文本节点「12 字 · 3 行」这类） ——
const infoText = computed(() => {
  const info = currentAction.value?.info
  return info ? info(props.data) : ''
})

// —— 状态（从节点 data.runState 读，覆盖层与底栏同一数据源） ——
const runState = computed(() => readRunState(props.data))
const running = computed(() => runState.value.status === 'running')
/** 能不能点发送：还在跑 / 没动作 / **参考序号有缺** 都不行（后两条见 refGap） */
const canRun = computed(() => !running.value && !!currentAction.value && !refGap.value)

/**
 * 参考序号是否连续（用户口径 2026-10-25：「你只传了一张图，并且声明的是\"图片 2\"，这就存在问题…
 * 在这种情况下，是不允许你点击发送按钮的」）。
 *
 * 规则：正文里出现 `@图片N` 时，1..N 必须全部有内容。缺任何一格 = 引用悬空（模型会拿到空引用），
 * 发送按钮禁用并给出明确原因。没写任何 @ 标签时不受影响（普通参考图照旧）。
 */
const refGap = computed(() =>
  findRefGap(
    promptRefSlots.value,
    shownMaterials.value.map((m) => ({ id: m.id, name: m.name, refName: m.refName, url: m.url, isText: m.kind === 'text' })),
  ),
)

const refGapHint = computed(() => {
  const gap = refGap.value
  if (!gap) return ''
  const meta = REF_SLOT_META[gap.kind]
  if (!meta) return ''
  const label = meta.label
  return '还缺' + gap.missing.map((i) => ' ' + label + i).join('、') + '，补上后才能发送'
})

const ICON_WARN =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'



/**
 * 已经提交过 → 收起底栏（像下拉选完就收那样）。
 * 重新出现的方式（三条都留着，用户怎么操作都顺）:
 * ① 再点一下这个节点；② 换选中别的节点再选回来；③ 节点自己开始跑（覆盖层出现时也不需要底栏）。
 * 注意**只收起 UI、不丢状态**：prompt 与参数都还在（参数另有一份落在 data.barValues 上）。
 */
const submitted = ref(false)
function resetSubmitted(): void {
  submitted.value = false
}
if (typeof ctx.on === 'function') {
  const clickOff = ctx.on(RenderEvents.NodeClick, (p: { nodeId?: string }) => {
    if (p?.nodeId === props.id) resetSubmitted()
  })
  pluginOffs.push(clickOff)

}

/** 执行（写盘走 nodeTask → doc.updateNodeRuntime） */
async function onRun(): Promise<void> {
  if (!canRun.value || !currentAction.value) return
  // ★ 防连点：正在跑的期间（runState.status==='running'）按钮已经 disabled，但"从点击到 runState 落盘"
  //   这几百毫秒里仍可能被连点（用户实测：卡的时候连点创建了多个相同任务）。这里再加一道同步闸门 ——
  //   submitted 是同步置位的，第二次点击进不来。服务端还有一道权威闸门（api/jobs 的 409），双保险。
  if (submitted.value || running.value) return
  // 提交前先把参数与输入落好：收起之后再点回来还是这一套（用户要求"不清空"）
  persistValues()
  if (promptBinding.value === 'text') ctx.get('doc').updateNode(props.id, { data: { text: prompt.value } })
  // 收起底栏：像下拉选完那样收起来，专注看节点上的进度覆盖层
  submitted.value = true
  // ★ 把上游连进来的素材一并传下去（不只是 @ 引用的那些）——
  //   用户要求：连了图片/视频/文字就要都上传给后端，没 @ 也要传。
  //   这里用 materials 而不是编辑器里解析出的引用：编辑器只认 @ 过的 token，
  //   而"连进来就算素材"是 v1 既有语义（useUpstreamResources 也是全收）。
await ctx.get<{ run(nodeId: string, actionId: string, input?: unknown): Promise<unknown> }>('nodeTask').run(props.id, currentAction.value.id, {
    prompt: prompt.value,
    values: values.value,
    resources: toToolResources(shownMaterials.value),
  })
  resetSubmitted()
}

function onFieldChange(key: string, v: string | number | boolean): void {
  values.value = { ...values.value, [key]: v }
  persistValuesSoon()
}

/** 参数区：把只读读数拼进「比例·画质·2K·1张」那类紧凑展示（参考图是一串点分） */
const fieldSummary = computed(() => {
  const parts: string[] = []
  // 用**过滤后的** paramDefs（不直接读 fields）：风格参数已按用户要求摘掉，
  // 若读原始 fields，它的默认值会从摘要里漏出来（实测：摘要串里冒出「人像摄影」）。
  for (const p of paramDefs.value) {
    const v = values.value[p.key]
    if (v === undefined || v === '') continue
    const opt = p.options?.find((o) => o.value === v)
    parts.push(opt ? opt.label : String(v))
  }
  return parts.join(' · ')
})

const ICON_EXPAND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
/** 收起（展开态按钮）：把四角箭头反过来朝内 */
const ICON_COLLAPSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
const ICON_SETTINGS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/></svg>'

/** 类型名 → 内置回退图标（节点类型没声明 icon 时用；与各节点插件的图标同款线性 SVG） */
const FALLBACK_TYPE_ICONS: Record<string, string> = {
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="8" y1="20" x2="16" y2="20"/></svg>',
  image:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>',
  video:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 9l4-2v10l-4-2"/></svg>',
  audio:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v4"/><path d="M7 6v12"/><path d="M11 3v18"/><path d="M15 7v10"/><path d="M19 10v4"/></svg>',
}
const ICON_PLUS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
const ICON_TAG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 12.2V5a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>'
const ICON_SEND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'

/**
 * 是否把整个底栏**展开成大弹窗**（用户要求：点右上角「展开」→ 变成 dialog 形式展示同一套 UI）。
 *
 * 为什么用「同一个组件换定位」而不是另写一个弹窗：弹窗里要的是**同一份** UI 与**同一份**状态
 * （素材、输入、模型、参数都一致）。复制一份 DOM 必然两边漂移；这里只是把同一块 `.nb-root`
 * 在展开时 Teleport 到 body、居中并加一层遮罩，内容一个字都不改。
 */
const expanded = ref(false)
function onExpandKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && expanded.value) {
    e.stopPropagation()
    expanded.value = false
  }
}
onMounted(() => window.addEventListener('keydown', onExpandKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onExpandKeydown, true))
/**
 * 全局设置区是否展开。
 *
 * 用户要求：点右侧齿轮**不弹窗**，而是在底栏**下面追加一块区域**显示全局设置
 * （类似底部状态栏慢慢增高，带一条分割线，内容暂用占位文本）。
 */
const settingsOpen = ref(false)

// ===== AI 按钮（可配置的「翻译 / 提示词优化」，用户口径 2026-10-26）=====
//
// - 清单来自云端 KV（config/bottomBarAiActions，没配 = 内置「翻译 / 提示词优化」两条）；
// - 点按钮 → 请求 /api/agent/chat/completion（不带 model = 用 Agent 插件配好的默认渠道），
//   流式返回**直接写进输入框**（替换原正文，AI 输出就是新的提示词）；
// - 「思考」段过滤在 aiActions 里做（think 标签 + reasoning_content 都不留）；
// - 历史**分批**落：500ms 一拍（doc.updateNode 一拍一条，不逐字进撤销栈）；
// - 失败自动重试 3 轮（aiActions 内置退避），全失败提示错误；跑着时按钮转圈并禁点。
const aiActions = ref<AiActionConfig[]>([])
const aiRunningId = ref<string | null>(null)
/**
 * AI 生成分两个阶段（用户口径 2026-10-27）：
 * - starting：已点按钮、还没收到第一帧 —— 输入框**保持原文可读**（只是锁编辑）；
 * - streaming：第一帧已到 —— 这一刻才清空原文，开始流式写入。
 * 为什么不一开始就清：加载可能要好几秒，原文一直空着用户会以为内容丢了。
 */
const aiPhase = ref<'idle' | 'starting' | 'streaming'>('idle')
/** 加载期间输入框禁编辑（starting + streaming 都锁；结束解锁） */
const aiEditorLocked = ref(false)
const aiError = ref('')
let aiAbort: AbortController | null = null
let aiFlushTimer: ReturnType<typeof setTimeout> | null = null
let aiFlushPending = false
let aiLoadSeq = 0

/** 拉一次按钮清单（挂载时调；后到的响应作废先到的） */
async function reloadAiActions(): Promise<void> {
  const seq = ++aiLoadSeq
  // 地址直接取 Agent 插件的配置（用户口径：不要再在这里配一份）
  const base = resolveAgentBaseUrl(ctx)
  try {
    const list = await loadAiActions({ baseUrl: base })
    if (seq === aiLoadSeq) aiActions.value = list
  } catch {
    if (seq === aiLoadSeq) aiActions.value = []
  }
}
reloadAiActions()
const offAiActions = ctx.on('ctx:plugin-installed', () => void reloadAiActions())

/**
 * 设置页保存成功 → **实时生效**（用户口径 2026-10-27：「保存之后并没有实时生效，
 * 只有我重新触发这个下拉菜单它才生效」）。监听广播：
 * - 载荷带清单（**哪怕空数组** = 用户删光/全隐藏）→ 直接采用，**零延迟**；
 * - 没带载荷（别的标签页/别的客户端改的）→ 立即重拉一次云端清单。
 * 两条路径都推进 aiLoadSeq 水位，在途的旧响应作废。
 */
const offAiActionsChanged = ctx.on(AI_ACTIONS_CHANGED_EVENT, (payload?: AiActionsChangedPayload) => {
  // 载荷带清单（哪怕空数组 = 用户把按钮全关/删光）→ 直接采用；
  // 没带（跨标签页广播）→ 立即重拉云端。两种路径都推进水位，作废在途旧响应。
  if (Array.isArray(payload?.actions)) {
    aiLoadSeq += 1
    aiActions.value = normalizeAiActions(payload.actions)
    return
  }
  void reloadAiActions()
})

/** 底栏右侧渲染的 AI 按钮（enabled 才出；icon 缺省给星形） */
const aiButtons = computed(() => aiActions.value.filter((a) => a.enabled).map((a) => ({ ...a, icon: a.icon || DEFAULT_AI_ICON })))

/** 流式写入：改内存 prompt + 排一拍 500ms 批量落盘（编辑器 promptDoc 清掉防顶回） */
function onAiDelta(fullText: string): void {
  prompt.value = fullText
  promptDoc.value = undefined
  scheduleAiFlush()
}

/**
 * 500ms 批量落盘：把当前 prompt 写进节点 data（'text' 绑定写 data.text，
 * 其余写 data.barPrompt）。窗口内的多次 onAiDelta 合并成一拍 —— 用户口径：
 * 「不希望每一个字都写入历史记录，一批一批地写入」。
 */
function scheduleAiFlush(): void {
  aiFlushPending = true
  if (aiFlushTimer) return
  aiFlushTimer = setTimeout(() => {
    aiFlushTimer = null
    if (!aiFlushPending) return
    aiFlushPending = false
    flushAiPrompt()
  }, 500)
}

function flushAiPrompt(): void {
  try {
    const doc = ctx.get<{ updateNode(id: string, patch: { data: Record<string, unknown> }): void }>('doc')
    if (promptBinding.value === 'text') {
      doc.updateNode(props.id, { data: { text: prompt.value } })
    } else {
      doc.updateNode(props.id, { data: promptPersistFields(promptBinding.value, prompt.value) })
    }
  } catch {
    /* 节点已不在等情况：忽略（下一拍还会再写） */
  }
}

/** 点一颗 AI 按钮：渲染模板 → 请求（重试在 aiActions 里）→ 结果已在输入框 */
async function runAiAction(action: AiActionConfig): Promise<void> {
  if (aiRunningId.value) return
  const source = prompt.value
  if (!source.trim()) return
  // 地址取 Agent 插件那份（同源时为空串），模型也由 Agent 的默认渠道决定
  const base = resolveAgentBaseUrl(ctx)
  // 重试轮数：设置面板「常规/底栏」可调（默认 3；坏值回落 3，aiActions 里兜底）
  const retriesRaw = ctx.tryGet<{ get(key: string): string | number | boolean }>('settings')?.get('bottomBarAiRetries')
  const retryRounds = typeof retriesRaw === 'number' && retriesRaw >= 1 ? Math.floor(retriesRaw) : undefined
  aiRunningId.value = action.id
  aiError.value = ''
  aiAbort = new AbortController()
  // 阶段一（starting）：**不清空**——加载期间原文保持可见（用户口径：避免加载时
  // 看不到当前输入内容），只是锁编辑；真正的清空推迟到第一帧到来（onAiDelta 首次调用）。
  aiPhase.value = 'starting'
  aiEditorLocked.value = true
  editorComponentRef.value?.setEditable?.(false)
  let cleared = false
  let full = ''
  try {
    const res = await requestAiText({
      template: action.template,
      vars: {
        prompt: source,
        nodeType: nodeType.value ?? '',
        action: currentAction.value?.title ?? '',
        nodeId: props.id,
      },
      baseUrl: base,
      ...(retryRounds === undefined ? {} : { retryRounds }),
      signal: aiAbort.signal,
      onDelta: (delta) => {
        // 第一帧到了：此刻才清空原文（有真实数据支撑的清空），随后切到 streaming
        if (!cleared) {
          cleared = true
          aiPhase.value = 'streaming'
          prompt.value = ''
          promptDoc.value = undefined
          full = ''
        }
        full += delta
        onAiDelta(full)
      },
    })
    if (res.ok) {
      // 成功收尾兜底：个别 provider 只回完整帧不走 delta 时，上面 cleared 还没置位 ——
      // 这里把正文落成最终文本（onAiDelta 内部会再排批量落盘，这里直接 flush 一次）。
      if (!cleared) {
        cleared = true
        aiPhase.value = 'streaming'
        prompt.value = ''
        promptDoc.value = undefined
        full = ''
      }
      onAiDelta(full)
      flushAiPrompt()
    } else {
      // 失败：starting 阶段原文原样还在（没清过），无需还原；streaming 阶段原文已被
      // 部分输出替换（不可恢复），保留已生成内容，只提示用户重试。
      if (!cleared) {
        prompt.value = source
        promptDoc.value = undefined
      }
      flushAiPrompt()
      aiError.value = res.error
      setTimeout(() => { if (aiError.value === res.error) aiError.value = '' }, 4000)
    }
  } finally {
    aiRunningId.value = null
    aiAbort = null
    aiPhase.value = 'idle'
    aiEditorLocked.value = false
    editorComponentRef.value?.setEditable?.(true)
    if (aiFlushTimer) { clearTimeout(aiFlushTimer); aiFlushTimer = null }
    aiFlushPending = false
  }
}

function cancelAi(): void {
  aiAbort?.abort()
}

onBeforeUnmount(() => {
  // 卸载前把没落的那一拍 flush 掉（流式中途关底栏不丢内容）
  if (aiFlushTimer) { clearTimeout(aiFlushTimer); aiFlushTimer = null }
  if (aiFlushPending) { aiFlushPending = false; flushAiPrompt() }
  aiAbort?.abort()
  offAiActions.dispose()
  offAiActionsChanged.dispose()
})

// ===== 「看图」@ 素材槽位（用户口径 2026-10-25）=====
//
// 输入框里 @图片1 / @音频1 / @音视频1 会变成标签；**没连线也要有槽位**（状态「待输入」），
// 输入框上方同步显示预览格。待输入格可以：拖本地文件、点击上传、按住 Ctrl 拖节点进来。
// 规则在 refSlots.ts（纯函数、已单测），这里只管状态与交互。

/**
 * 参考区**一行**的格子（用户口径 2026-10-25：「它只有一行的输入，你这边重复了」）。
 *
 * **格子身份 = 连线的序号**（2026-10-26 用户口径）：连了 3 条线就是 3 格；
 * 声明了 @图片2 但连线只有 1 条 → 第 2 格显示「待输入」（内容不会跑到「图片3」去）。
 *
 * 为什么不再维护一份本地槽位状态：上一版把「正文声明」和「已连素材」各记一份，
 * 两边互相覆盖 —— 多出没有的格子、声明图片2 内容跑到图片3、正文删了标签格子还在。
 * 现在格子**完全由连线派生**：有连线 = 有内容，没连线 = 待输入，没有第三种状态。
 */
/** refName（图片1）是连线顺序编号 —— mergeRefTiles 靠它对齐「第 N 格 = 第 N 条连线」 */
const refTiles = computed(() =>
  mergeRefTiles(
    promptRefSlots.value,
    shownMaterials.value.map((m) => ({ id: m.id, name: m.name, refName: m.refName, url: m.url, isText: m.kind === 'text' })),
    refOrder.value, // 完整序列（含 slot: 空格）—— 用户拖出来的顺序
  ),
)

/** 正文里的 @ 声明（只用来「标出哪个序号被点了」与算缺号，不产生内容） */
const promptRefSlots = computed(() => parseRefSlots(prompt.value))

/** 错误提示按「序号」记（格子由连线派生，键会随内容变化，不能按 key 存） */
const slotErrors = ref<Record<string, string>>({})
/** 某个待输入格的错误文案（按种类+序号查） */
function slotErrorOf(tile: { slotKey?: string }): string {
  return tile.slotKey ? (slotErrors.value[tile.slotKey] ?? '') : ''
}

/**
 * 一行格子的拖拽排序。
 *
 * 格子 key 有两种：`card:<节点id>`（有连线的内容）与 `slot:<kind>:<n>`（待输入）。
 * 拖完把**有内容的**（card:*）按新顺序写回 data.refOrder —— collectUpstreamMaterials
 * 会按 refOrder 重排连线素材并重新编号，于是待输入格的位置也跟着对齐。
 *
 * 为什么不能从 `t.card` 拿 id：refTiles 是 mergeRefTiles 的输出，那个形状里没有 card
 * 字段（上一版从这里拿，永远是 undefined → 函数一进来就 return → 排序看起来没生效）。
 */
function onReorderTiles(next?: Array<{ key?: string }>): void {
  if (!next || next.length === 0) return
  // **整个序列**（含 slot: 空格）都落盘：空格也参与排序（用户口径 2026-10-26）。
  // slot: 键对 resolveMaterialOrder 是"未列到的 id"，不影响材质排序；但 mergeRefTiles
  // 会用它恢复用户拖出来的完整顺序。
  const ids = next.map((t) => {
    const key = t.key ?? ''
    // card:N 是材质节点 id（id=N）；slot:kind:n 原样保留（mergeRefTiles 靠它恢复顺序）
    return key.startsWith('card:') ? key.slice(5) : key
  }).filter(Boolean)
  if (ids.length === 0) return
  try {
    /**
     * 只写 refOrder（素材显示顺序）。
     *
     * **不要重编 data.refSlot**：那个序号是「用户提示词里的引用位置」（图片3 就指第 3 个参考），
     * 重编等于把卡片顺序强行拉回 1,2,3…，排序看起来完全没生效（真机踩过）。
     * 显示顺序由 refTiles 按 refOrder 排（见 mergeRefTiles 的 displayOrder）。
     */
    ctx.get('doc').updateNode(props.id, { data: { refOrder: ids } })
  } catch {
    /* 节点已不在等情况：忽略 */
  }
}

const editorComponentRef = ref<{
  insertResource?(item: ResourceItem): void
  replaceResource?(item: ResourceItem): boolean
  replaceResourceThumbByName?(name: string, url: string): boolean
  refreshChips?(): void
  /** 动态切可编辑态（AI 生成期间锁输入用；bundle 侧 view.editable 布尔位） */
  setEditable?(next: boolean): void
} | null>(null)

/** 点击槽位：空的 = 选文件上传；已填的 = 把光标带回正文那个标签 */
function pickSlotFile(slotKey: string): void {
  const [kind, indexRaw] = slotKey.split(':')
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = REF_SLOT_META[kind as RefSlotKind].accept
  input.style.display = 'none'
  document.body.appendChild(input)
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) fillSlotFromFile(kind as RefSlotKind, Number(indexRaw), file)
    input.remove()
  })
  input.addEventListener('cancel', () => input.remove())
  input.click()
}

/**
 * 上传 = **在画布上建一个参考节点，再连到本节点**（用户口径 2026-10-25：
 * 「点击上传时，这 4 个上传你需要添加一个参考节点然后进行连接，这样进行上传」）。
 *
 * 为什么不只是把文件塞进本地状态：槽位只是正文里那条 @ 的「指向」。真正喂给模型的是
 * 连线进来的素材（collectUpstreamMaterials 按边收），只改本地状态的话：
 *   刷新就没了、生成时也拿不到这张图。所以必须建节点 + 连边。
 */
async function fillSlotFromFile(kind: RefSlotKind, index: number, file: File): Promise<void> {
  ;(window as any).__upDbg = { step: 'enter', kind, index, name: file.name }
  const verdict = judgeSlotDrop(kind, { file })
  if (!verdict.ok) {
    ;(window as any).__upDbg.step = 'judge-fail'
    setSlotError(index, dropVerdictMessage(kind, verdict))
    return
  }
  const fileDrop = ctx.tryGet<{
    addFiles(files: File[], atFlow: { x: number; y: number } | null): Promise<number>
  }>('file-drop')
  if (!fileDrop) {
    ;(window as any).__upDbg.step = 'no-file-drop'
    setSlotError(index, '当前宿主没有文件落库能力，无法建参考节点')
    return
  }
  const doc = ctx.tryGet<{
    getNode(id: string): { type?: string; data?: Record<string, unknown>; position?: { x: number; y: number }; width?: number } | undefined
    getNodes(): Array<{ id: string; type?: string; data?: Record<string, unknown> }>
    addEdge(input: { source: string; target: string }): string
    updateNode(id: string, patch: { data: Record<string, unknown> }): void
  }>('doc')
  if (!doc) { setSlotError(index, '当前宿主没有连线能力'); return }
  const me = doc.getNode(props.id)
  const base = me?.position ?? { x: 0, y: 0 }
  const w = Number(me?.width) || 320
  try {
    // 建节点 → 还选中 → 等一帧 → 连线 → 按序号排位；顺序在 uploadToRefSlot 里钉死（已单测）
    ;(window as any).__upDbg.step = 'before-upload'
    // 上传前抓一次全部节点 id：pickCreated 用它区分「这次新建的节点」。
    // 不能用 refOrder 当 before —— refOrder 可能含已断线的死 id，会把别的节点误认成新节点
    //（真机踩过：连线连到错误的对象）。
    const idsBeforeUpload = new Set(doc.getNodes().map((n) => n.id))
    const result = await uploadToRefSlot(
      { file, kind, index, targetId: props.id },
      {
        addFiles: (files, at) => {
          ;(window as any).__upDbg.step = 'add-files-called'
          return fileDrop.addFiles(files, at).then((n) => {
            ;(window as any).__upDbg.addFilesResult = n
            return n
          })
        },
        waitTick: () => nextTick(),
        afterCreate: () => {
          // file-drop 建完会把选中改成新节点；底栏挂在原节点上，必须还回去
          try { ctx.tryGet<{ set(ids: string[]): void }>('selection')?.set([props.id]) } catch { /* 忽略 */ }
        },
        addEdge: (source, target) => {
          try { return doc.addEdge({ source, target }) } catch { return null }
        },
        /**
         * 排位用的「当前顺序」：refOrder 可能从没存过（老画布/从未拖过）——
         * 直接拿空数组去 placeRefAtSlot 会把新素材插到第 0 位，于是第 8 格上传的图
         * 跑到了第 1 格（真机踩过）。没存过时用当前实际素材顺序兜底。
         */
        /**
         * 排位用的「当前顺序」：必须**只含仍然连着的素材**。
         * refOrder 里会残留已断开/已删除节点的死 id —— 直接拿去插位会让位置算错，
         * 于是「第 8 格上传」的图跑到第 1 格（真机踩过）。死 id 过滤掉；
         * 过滤后为空就用当前实际素材顺序。
         */
        refOrder: () => {
          const alive = new Set(shownMaterials.value.map((m) => m.id))
          const kept = refOrder.value.filter((id) => alive.has(id))
          return kept.length > 0 ? kept : shownMaterials.value.map((m) => m.id)
        },
        // 占位 id（__slot__N）只用于算位，不落盘（落盘会留下永远不会有人认领的死 id）
        writeOrder: (ids) => {
          doc.updateNode(props.id, { data: { refOrder: ids.filter((id) => !id.startsWith('__slot__')) } })
        },
        pickCreated: () => {
          ;(window as any).__upDbg.step = 'pick-created'
          // 为什么不能到 shownMaterials 里找：素材是**按边**收集的（collectUpstreamMaterials），
          // 而此刻连线还没建 —— 新节点根本不在里面，永远找不到 → 提前 return（这就是
          // 「上传只建节点、没连线」的根因）。这里直接查 doc：file-drop 刚建的那个新节点。
          const freshNode = doc.getNodes().find((n) => !idsBeforeUpload.has(n.id) && n.id !== props.id)
          if (!freshNode) return null
          const d = freshNode.data ?? {}
          const s = (v: unknown) => (typeof v === 'string' && v ? v : '')
          const mediaType = verdict.mediaType
          const url = s(d.imageUrl) || s(d.videoUrl) || s(d.audioUrl)
          const name = s(d.label) || s(d.imageName) || s(d.videoName) || s(d.audioName) || file.name
          return { id: freshNode.id, name, url, mediaType }
        },
        positionFor: (index) => ({ x: base.x - w - 24 - (index - 1) * (w + 24), y: base.y }),
      },
    )
    if (!result.ok) { setSlotError(index, result.error ?? '上传失败'); return }
    // 记住「这张素材属于第 N 格」—— refName 编号以它为准（否则 8 格空着时上传第 8 格
    // 会被编成「图片1」显示到第 1 格，真机踩过）。
    if (result.created?.id) doc.updateNode(props.id, {
      data: { refSlot: { ...((props.data?.refSlot as Record<string, unknown>) ?? {}), [result.created.id]: { kind, index } } },
    })
    // 内容已就位（连线进来了），正文里那颗虚线标签刷新成实线（名字/缩略图）
    refreshSlotChips()
  } catch (err) {
    console.warn('[bottom-bar] 上传参考失败', err)
    setSlotError(index, '上传失败，请重试')
  }
}

/** 错误按「参考序号」记（格子由连线派生，键随内容变），几秒后自动消失 */
function setSlotError(index: number, message: string): void {
  slotErrors.value = { ...slotErrors.value, ['image:' + index]: message, ['video:' + index]: message, ['audio:' + index]: message, ['av:' + index]: message }
  setTimeout(() => {
    const next = { ...slotErrors.value }
    delete next['image:' + index]; delete next['video:' + index]; delete next['audio:' + index]; delete next['av:' + index]
    slotErrors.value = next
  }, 2600)
}

/**
 * 正文标签刷新：内容来自连线（collectUpstreamMaterials）。
 * 两步：① 把每个 ref-slot 的最新 item 登记进编辑器；② 触发整体重渲染。
 */
function refreshSlotChips(): void {
  try {
  if (typeof window === 'undefined') return
  ;(window as any).__chipRuns = ((window as any).__chipRuns || 0) + 1
  ;(window as any).__chipDbg = { runs: (window as any).__chipRuns, tiles: refTiles.value.map((t) => ({ key: t.key, pending: t.pending, name: t.name })), mats: shownMaterials.value.map((m) => ({ id: m.id, refName: m.refName })) }
  // SSR / 编辑器未挂载时跳过（只影响标签 UI，不影响数据）
  if (typeof document === 'undefined') return
  if (!editorComponentRef.value) return
  for (const tile of refTiles.value) {
    try {
    const key = tile.slotKey
    if (tile.pending) {
      // 待输入的格子：把「虚线待输入」的 item 登记进去（tile.url 是空的）
      if (!key) continue
      // key 形如 slot:image:3 / card:174 —— slot: 前缀时种类在第 2 段
      const parts = key.split(':')
      const k = parts[0] === 'slot' ? parts[1] : parts[0]
      const i = parts[0] === 'slot' ? parts[2] : parts[1]
      if (k !== 'image' && k !== 'video' && k !== 'audio') continue
      const label = REF_SLOT_META[k as RefSlotKind]?.label ?? ''
      registerItem({
        // id 必须是 ref-slot:<kind>:<n>（之前用了 'ref-slot:slot:image:3' 这种错 id，
        // 删除资源后正文标签清不回「待输入」——真机踩过）
        id: 'ref-slot:' + k + ':' + i,
        name: label + Number(i),
        category: '素材',
        // 待输入格没有媒体类型 → toDOM 走文本/图标分支（虚线待输入样式）
        mediaType: undefined,
        // 借资源条目的 renderEditor：不带的化 toDOM 走默认分支（@名字样式），
        // 与卡片样式的 chip 并存 = 正文出现两套标签外观（真机踩过）。
        renderEditor: editorResources.value[0]?.renderEditor,
      })
      // 删除/断开后该格回到待输入：正文同名标签的缩略图要清掉（否则还显示旧图）
      editorComponentRef.value?.replaceResourceThumbByName?.(label + Number(i), '')
      continue
    }
    // 已填的格子：key = card:<节点id>，序号与内容来自连线素材
    // 序号从 **refName**（图片N）取，不是 tile.name（那是节点 label，如「拖我B」）——
    // 用显示名找会匹配不上（refNameToSlotKey 认不出「拖我B」）→ 从未调 replaceResource
    //（这就是「上传后连线有了、但正文标签仍是虚线」的根因）
    const refName = shownMaterials.value.find((m) => m.id === tile.key.replace(/^card:/, ''))?.refName
    // refNameToSlotKey 返回的是「槽位键字符串」（image:2），不是对象 —— 拆出 kind/index
    const parsedStr = refNameToSlotKey(refName ?? tile.name, 'image') ?? refNameToSlotKey(refName ?? tile.name, 'video') ?? refNameToSlotKey(refName ?? tile.name, 'audio')
    if (!parsedStr) continue
    const [kind, indexStr] = parsedStr.split(':') as [RefSlotKind, string]
    const index = Number(indexStr)
    const slotKey = kind + ':' + index
    const label = REF_SLOT_META[kind as RefSlotKind]?.label ?? ''
    const item: ResourceItem = {
      id: 'ref-slot:' + kind + ':' + index,
      // 名字必须用 refName（图片N）：正文里按序号引用的是「第 N 格」的 refName，
      // 不是节点标题（真机踩过：排序后缩略图与序号对不上，因为 name 用了 tile.name）
      name: label + index,
      category: '素材',
      url: tile.url,
      mediaType: kind === 'av' ? undefined : (kind as 'image' | 'video' | 'audio'),
    }
    const nodeId = tile.key.replace(/^card:/, '')
    // 同上：带上 renderEditor，保证 chip 外观与资源面板插入的一致
    const resItem = editorResources.value.find((r) => r.id === nodeId)
    if (resItem) item.renderEditor = resItem.renderEditor
    registerItem(item)
    // 用户口径（2026-10-26）：拖卡排序 = 「第 N 格现在放哪张图」→ 正文里名字为
    // 图片N 的标签，缩略图要换成第 N 格当前资源；名字（引用名）绝不能改写。
    // 按 **attrs.name**（用户当前看到的名字）找 chip、只换图 —— 不依赖 refName
    // 回灌时序（真机踩过：tiles 新旧错位导致偏移一位）。
    editorComponentRef.value?.replaceResourceThumbByName?.(item.name, tile.url ?? '')
    // 已填的格子：用 replaceResource 原地替换正文里对应的标签（虚线→实线 + 缩略图）。
    // 正文里这个标签有两种身份：@声明转出来的 attrs.id = ref-slot:image:N；
    // 手工/资源面板插进来的 attrs.id = 上游节点 id（真机踩过：只按 ref-slot 找，
    // 排序后那类标签的缩略图永远不更新）。两个 id 各刷一次，找不到的那次是 no-op。
    // 用户口径（2026-10-26）：排序/替换只更新**缩略图**，标签名字（用户提示词里的
    // 引用名）绝不能被改写 —— name 传 undefined，replaceResource 保留原 attrs.name。
    const replaced = editorComponentRef.value?.replaceResourceThumbByName?.(item.name, tile.url ?? '')
    // 排序/替换影响所有格子的 refName 编号 —— 逐颗改完统一强制重渲染一次
    //（toDOM 读 registry，registry 已在上面更新；只改 attrs 不触发渲染的漏网之鱼由它兜住）。
    editorComponentRef.value?.refreshChips?.()
    ;(window as any).__chipDbg = { runs: (window as any).__chipRuns, name: item.name, url: (tile.url || '').match(/resources\/([a-z0-9.]+)/)?.[1] || 'svg', replaced }
    } catch (err) {
      ;(window as any).__chipErr = { tile: tile.key, msg: String(err), stack: (err as Error)?.stack?.slice(0, 500) }
    }
  }
  } catch (err) {
    // 整体兜底：芯片刷新是纯 UI 增强，绝不能炸掉底栏（真机/单测都踩过 watcher 抛错）
    ;(window as any).__chipErr = { tile: '(outer)', msg: String(err), stack: (err as Error)?.stack?.slice(0, 500) }
  }
}

/** 连线变了（上传/替换/断开/初始载入）→ 正文里对应的标签跟着刷成已填状态。
 *  注意：必须放在 refreshSlotChips / editorComponentRef 定义之后 —— immediate 会同步执行一次，
 *  放前面会踩 const TDZ（真机踩过：ReferenceError before initialization）。 */
// refOrder 也要听：拖拽排序会改 refName 编号（图片2 变图片1），正文里标签的序号/缩略图
// 跟着变 —— 只听 shownMaterials 会漏掉「内容没变、只是换序」的情况（真机踩过）。
// 两拍缓冲：refName 重编号要等 collectUpstreamMaterials 的异步 resolve 链回灌，
// 单拍 nextTick 仍会拿「新格子 × 旧编号」的错配组合（真机踩过：缩略图整体偏移一位）。
watch([shownMaterials, refOrder], () => {
  void nextTick()
    .then(() => typeof requestAnimationFrame === 'function'
      ? new Promise<void>((r) => requestAnimationFrame(() => r()))
      : undefined)
    .then(() => refreshSlotChips())
}, { immediate: true })

// ===== Ctrl 拖资源到参考格（判定在 refSlotDrag.ts，事件绑定在这里） =====

/** Ctrl 拖拽会话（pointerdown 开始，pointerup 结束） */
let ctrlDrag: {
  nodeId: string
  mediaType: 'image' | 'video' | 'audio'
  url: string
  name: string
  /** 正被悬停的参考格 key（is-target 高亮 + 松手替换用） */
  targetTileKey?: string
  ghost?: HTMLElement
} | null = null

function moveGhost(x: number, y: number): void {
  const g = ctrlDrag?.ghost
  // 卡片**左上角对齐鼠标**（用户口径：不能居中 —— 会遮挡鼠标和插槽）
  if (g) { g.style.left = x + 'px'; g.style.top = y + 'px' }
}

/** Ctrl 按下（底栏开着）→ 进入选择态（画布出高亮/角标/提醒，复刻参考选择）。
 *  松开 Ctrl → 退出。选择态与影子拖拽是两个独立层：选择态是「预告」，拖拽是动作。 */
function onCtrlModeKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Control' || ev.repeat) return
  if (!document.querySelector('.nb-overlay')) return
  if (referenceActive()) return // 参考选择态已激活时不叠加 Ctrl 选择态
  if (ev.target instanceof HTMLElement && ev.target.closest('input, textarea, select, [contenteditable="true"]')) return
  enterCtrlDragMode(props.id)
}
function onCtrlModeKeyup(ev: KeyboardEvent): void {
  if (ev.key !== 'Control') return
  exitCtrlDragMode()
}

/** 拖拽启动：由 NodeSelectOverlay 覆盖层经**对象数据通道**调起（props.id/props.data），
 *  不再走 window pointerdown + DOM closest 判定 —— DOM 判定会误触节点选中。 */
function startCtrlDrag(nodeId: string, ev: PointerEvent): void {
  const doc = ctx.tryGet<{ getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined }>('doc')
  const media = nodeMediaOf(doc?.getNode(nodeId))
  if (!media) return
  // 已连到当前节点的资源**禁止拖拽**（用户口径：连线不支持重复连接 —— 它已经在某个
  // 格子里了，再拖到另一格会产生重复连线/抢格冲突）。只放行"还没连进来的"资源。
  if (renderEdges.value.some((e) => e.source === nodeId && e.target === props.id)) return
  ev.preventDefault()
  ev.stopPropagation()
  // 原生 HTML5 拖拽会接管指针（img 默认可拖），pointermove 从此不再派发 → 影子不动。
  // 允许原生 drag 启动（Chrome 对 img 的拖拽不受 pointerdown preventDefault 影响，
  // 强行取消会让拖拽手势整个死掉）—— 影子改由 dragover 事件驱动（真机踩过：
  // 只依赖 pointermove 时真实手势里影子不动）。dragover/drop 在会话监听里处理。
  // 影子 = 缩略图 + 名字（用户口径 2026-10-26：「可以做成图片的缩略图跟随鼠标」）
  const ghost = document.createElement('div')
  ghost.className = 'nb-drag-ghost'
  if (media.url && media.mediaType === 'image') {
    const img = document.createElement('img')
    img.src = media.url
    img.alt = ''
    ghost.appendChild(img)
  } else if (media.url && media.mediaType === 'video') {
    // 视频取首帧当缩略图（静音、不播放、仅显示第一帧画面）
    const video = document.createElement('video')
    video.src = media.url
    video.muted = true
    video.preload = 'metadata'
    video.className = 'nb-drag-ghost-media'
    ghost.appendChild(video)
  } else if (media.mediaType === 'audio') {
    // 音频没有画面 —— 用一个音符图标圆片表达（用户口径：音频简单用图标即可）
    const icon = document.createElement('div')
    icon.className = 'nb-drag-ghost-icon'
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
    ghost.appendChild(icon)
  } else if (media.url) {
    const img = document.createElement('img')
    img.src = media.url
    img.alt = ''
    ghost.appendChild(img)
  }
  document.body.appendChild(ghost)
  ctrlDrag = { nodeId, mediaType: media.mediaType, url: media.url, name: media.name, ghost }
  moveGhost(ev.clientX, ev.clientY)
}

function onCtrlDragPointerMove(ev: PointerEvent): void {
  if (!ctrlDrag) return
  moveGhost(ev.clientX, ev.clientY)
  // 用坐标找鼠标下的格子（不用 ev.target：拖资源时鼠标在画布上，
  // 而参考格在另一个 teleport 层 —— target 永远不会是它）
  const host = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.nb-card') as HTMLElement | null
  const key = host?.dataset.tileKey
  if (ctrlDrag.targetTileKey && ctrlDrag.targetTileKey !== key) {
    document.querySelector('.nb-card[data-tile-key="' + ctrlDrag.targetTileKey + '"]')?.classList.remove('is-target')
    ctrlDrag.targetTileKey = undefined
  }
  if (key && key !== ctrlDrag.targetTileKey) {
    host?.classList.add('is-target')
    ctrlDrag.targetTileKey = key
  }
}

/** 原生 drag 期间的坐标来源：即使 pointermove 被拖拽接管，dragover 仍持续派发。
 *  双通道驱动影子 —— 哪个事件活着用哪个（真机踩过：真实手势里影子不动）。 */
function onCtrlDragOver(ev: DragEvent): void {
  if (!ctrlDrag) return
  ev.preventDefault() // 允许 drop（参考格接收拖放）
  moveGhost(ev.clientX, ev.clientY)
  onCtrlDragPointerMove(ev as unknown as PointerEvent)
}

/** 原生 drop：落点在参考格 → 走替换（与 pointerup 同一条语义） */
function onCtrlDragDrop(ev: DragEvent): void {
  ;(window as any).__dropDbg = { hasSession: !!ctrlDrag, target: (ev.target as HTMLElement)?.closest?.('.nb-card')?.getAttribute('data-tile-key') ?? null }
  if (!ctrlDrag) return
  ev.preventDefault()
  onCtrlDragPointerUp(ev)
}

/** 原生 dragend（无论 drop 成败）：清理影子与高亮 —— pointerup 在 drag 会话里不会来 */
function onCtrlDragEnd(): void {
  if (!ctrlDrag) return
  onCtrlDragPointerUp(new DragEvent('pointerup'))
}

/** pointerup：落在参考格 → 替换该格资源；落在画布上 → 什么都不做（节点留在原处） */
function onCtrlDragPointerUp(ev: PointerEvent | DragEvent): void {
  const drag = ctrlDrag
  ctrlDrag = null
  if (drag?.targetTileKey) document.querySelector('.nb-card[data-tile-key="' + drag.targetTileKey + '"]')?.classList.remove('is-target')
  drag?.ghost?.remove()
  if (!drag || !drag.targetTileKey) return
  // 松手点 = 落在参考格上的（用户松手那一刻鼠标在哪，替换就在哪）
  const dropHost = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.nb-card') as HTMLElement | null
  if (dropHost?.dataset.tileKey) drag.targetTileKey = dropHost.dataset.tileKey
  const tile = refTiles.value.find((t) => t.key === drag.targetTileKey)
  ;(window as any).__upDbg2 = { key: drag.targetTileKey, tileFound: !!tile, slotKey: tile?.slotKey, tileName: tile?.name, allKeys: refTiles.value.map((t) => t.key) }
  if (!tile) return
  let kind: RefSlotKind
  let index: number
  if (tile.slotKey) {
    // 待输入格：slotKey = image:2
    const [k, i] = tile.slotKey.split(':')
    kind = k as RefSlotKind
    index = Number(i)
  } else {
    // **已填格**：slotKey 为空 —— 格子的序号从它当前素材的 refName 取
    //（真机踩过：card 格 slotKey 为空导致替换被提前 return，拖新图替换已填格完全无效）
    // 注意 tile.name 是**节点显示名**（如「图片 14」，带空格）不是 refName —— 解析必失败。
    // refName 要从 shownMaterials 按节点 id 查（图片3 这种带序号的引用名）。
    const matRefName = shownMaterials.value.find((m) => m.id === tile.key.replace(/^card:/, ''))?.refName
    if (!matRefName) return
    const parsed = refNameToSlotKey(matRefName, 'image') ?? refNameToSlotKey(matRefName, 'video') ?? refNameToSlotKey(matRefName, 'audio')
    if (!parsed) return
    const [k, i] = parsed.split(':')
    kind = k as RefSlotKind
    index = Number(i)
  }
  void replaceSlotMaterial(kind, index, { nodeId: drag.nodeId, mediaType: drag.mediaType, url: drag.url, name: drag.name })
}

onMounted(() => {
  registerStartDragHandler(startCtrlDrag)
  window.addEventListener('pointermove', onCtrlDragPointerMove, true)
  window.addEventListener('pointerup', onCtrlDragPointerUp, true)
  window.addEventListener('dragover', onCtrlDragOver, true)
  window.addEventListener('drop', onCtrlDragDrop, true)
  window.addEventListener('dragend', onCtrlDragEnd, true)
  // Ctrl 按下 = 进入选择态（用户口径：与「参考选择」同款 —— 画布节点出高亮/角标/提醒）
  window.addEventListener('keydown', onCtrlModeKeydown, true)
  window.addEventListener('keyup', onCtrlModeKeyup, true)
})
onBeforeUnmount(() => {
  registerStartDragHandler(null)
  // 底栏消失 = 两个选择态都收（用户口径 2026-10-26：覆盖层要跟底栏同步消失）。
  // 参考选择与 Ctrl 拖是挂在节点上的覆盖层，底栏走了它们就失去操作对象。
  exitCtrlDragMode()
  exitReference()
  // 顺带收掉可能残留的鼠标提示（与覆盖层同寿命）
  ctx.tryGet<{ hide(): void }>('tip')?.hide()
  window.removeEventListener('pointermove', onCtrlDragPointerMove, true)
  window.removeEventListener('pointerup', onCtrlDragPointerUp, true)
  window.removeEventListener('dragover', onCtrlDragOver, true)
  window.removeEventListener('drop', onCtrlDragDrop, true)
  window.removeEventListener('dragend', onCtrlDragEnd, true)
  window.removeEventListener('keydown', onCtrlModeKeydown, true)
  window.removeEventListener('keyup', onCtrlModeKeyup, true)
})

/**
 * 把某个参考格的内容**替换**为指定资源（用户口径 2026-10-26：拖资源到槽位 = 替换）。
 *
 * 连线的三种情况：
 *   · 该格已有连线（这条线来自「原序号那个素材」）→ 断开旧线、连新线（序号归属不变）；
 *   · 该格是待输入（这个序号还没有连线）→ 直接连新线；
 *   · 新资源已经在画布上（拖的就是它）→ 不建节点，只动连线；
 *     新资源如果是本地文件（上传路径），先走 file-drop 建节点。
 *
 * 旧资源**不删节点**：删节点是破坏性操作，用户自己决定（这里只换连线归属）。
 */
async function replaceSlotMaterial(
  kind: RefSlotKind,
  index: number,
  source: { nodeId: string; mediaType: 'image' | 'video' | 'audio'; url: string; name: string },
): Promise<void> {
  ;(window as any).__replDbg = { step: 'enter', kind, index, src: source.nodeId }
  const doc = ctx.tryGet<{
    getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined
    addEdge(input: { source: string; target: string }): string
    removeEdges(ids: string[]): number
    getEdges?(): Array<{ id: string; source: string; target: string }>
    updateNode(id: string, patch: { data: Record<string, unknown> }): void
  }>('doc')
  if (!doc) return
  // 该格原本的连线 = 连到本节点、且素材 refName 正好对应这个槽位的那条
  const material = shownMaterials.value.find((m) => refNameToSlotKey(m.refName, kind) === refSlotKey(kind, index))
  const oldEdge = material ? renderEdges.value.find((e) => e.source === material.id && e.target === props.id) : undefined
  // 兜底：renderEdges 回灌慢时用数据层再查一次（同 source+target 的线只有一条）
  const oldEdgeFallback = material ? doc.getEdges?.().find?.((e) => e.source === material.id && e.target === props.id) : undefined
  try {
    const stale = [oldEdge?.id, oldEdgeFallback?.id].filter((x): x is string => !!x)
    if (stale.length) doc.removeEdges(stale)
    doc.addEdge({ source: source.nodeId, target: props.id })
    // 顺序对齐：替换不改变该格的序号（仍排在原来的位置）
    // 同时把**被替换的旧素材**从 refOrder 里清掉（否则它的连线断了但 refOrder 还留着，
    // 下一轮 numberRefNames 会把它编进序号，卡片/正文标签全错位——真机踩过）
    const order = placeRefAtSlot(refOrder.value, kind, index, source.nodeId)
    const oldId = material?.id
    const cleaned = oldId && oldId !== source.nodeId ? order.filter((id) => id !== oldId) : order
    // 槽位归属也跟着换：新素材接管第 N 格，旧素材的 hint 删掉
    const hints = { ...((props.data?.refSlot as Record<string, unknown>) ?? {}) }
    if (oldId) delete hints[oldId]
    hints[source.nodeId] = { kind, index }
    doc.updateNode(props.id, { data: { refOrder: cleaned, refSlot: hints } })
    slotErrors.value = {}
    // 等一拍：shownMaterials 是「按边收集」的 computed，连线刚写入 doc 但渲染层
    // 还没回灌 —— 不等的话这里读到的是**旧素材**（没有刚连线的那格）→ 刷不上去
    // 渲染层的 renderEdges 回灌比 nextTick 晚一拍（宿主在 VueFlow 回调里更新），
    // 只等 nextTick 会读到旧素材（刚连线的那格还是 pending）→ 刷不上去
    await nextTick()
    await new Promise((r) => setTimeout(r, 300))
    refreshSlotChips()
  } catch (err) {
    console.warn('[bottom-bar] 替换参考失败', err)
  }
}



/** 拖放高亮：整排槽位一起亮（用户能看出「可以放在这儿」） */
const slotsDropHot = ref(false)

function onSlotDragOver(_ev: DragEvent): void {
  slotsDropHot.value = true
}

function onSlotDragLeave(_ev: DragEvent): void {
  // 子元素之间移动也会触发 leave；用下一帧再判断，避免闪一下
  setTimeout(() => { slotsDropHot.value = false }, 60)
}

/**
 * 落到槽位：
 *   (a) 本地文件 → 直接看类型（不需要 Ctrl）；
 *   (c) 画布节点 → 必须按住 Ctrl / ⌘，走画布自己的拖拽事件（见下面 beginDropCapture）。
 */
function onSlotDrop(ev: DragEvent, _slot?: unknown): void {
  void _slot
  slotsDropHot.value = false
  const file = ev.dataTransfer?.files?.[0]
  if (!file) return
  // 落点是**真实 DOM 上的格子**：从格子上的键反查它代表哪个参考
  const host = (ev.currentTarget as HTMLElement | null)?.closest('.nb-card') as HTMLElement | null
  const tile = refTiles.value.find((t) => t.key === (host?.dataset.tileKey || ''))
  if (!tile?.slotKey) return
  const kind = tile.slotKey.split(':')[0] as RefSlotKind
  const index = Number(tile.slotKey.split(':')[1])
  void fillSlotFromFile(kind, index, file)
}

const globalRef = ref<HTMLElement | null>(null)

function onGlobalEnter(el: Element): void {
  const h = el as HTMLElement
  h.style.height = '0px'
  h.style.opacity = '0'
  // 强制读一次布局，确保上面写的 0 生效（否则浏览器可能合并成"从 auto 开始"）
  void h.offsetHeight
  h.style.height = h.scrollHeight + 'px'
  h.style.opacity = '1'
}

function onGlobalAfterEnter(el: Element): void {
  const h = el as HTMLElement
  h.style.height = ''
  h.style.opacity = ''
}

function onGlobalLeave(el: Element): void {
  const h = el as HTMLElement
  // 先从 auto 收成具体像素值，才能从该值过渡到 0
  h.style.height = h.scrollHeight + 'px'
  void h.offsetHeight
  h.style.height = '0px'
  h.style.opacity = '0'
}
</script>

<template>
  <!--
    展开时整块 Teleport 到 body、加一层遮罩、居中成大弹窗（用户要求「变成 dialog 的形式，
    展示这里的 UI」）。收起时 Teleport 被禁用、外壳 `display:contents` 完全透明，
    底栏还是原来那条贴在节点下方的浮层 —— 内容与状态一份，只是换了容器与定位。
  -->
  <Teleport to="body" :disabled="!expanded">
  <div
    v-if="visible && hasActions && !submitted"
    class="nb-shell"
    :class="{ 'is-expanded': expanded }"
    :style="expanded ? { zIndex: LAYERS.nodeToolbar + 1 } : undefined"
    @pointerdown.self="expanded = false"
  >
  <div
    class="nb-root nodrag nopan"
    :class="{ 'is-expanded': expanded }"
    :style="expanded ? undefined : panelStyle"
    :role="expanded ? 'dialog' : undefined"
    :aria-modal="expanded ? 'true' : undefined"
    data-testid="node-bottom-bar"
    @pointerdown.stop
  >
    <!-- 一排 pill（参考图顶行：+参考 / 标记）。全屏态整个行不渲染（VueDraggable 的
         force-fallback 会在拖拽后给根元素写内联样式，展开切换时残留的 inline 样式把
         行高塌成 2px、按钮点不到 —— 真机踩过）。全屏按钮独立钉在面板右上角。 -->
    <div v-if="!expanded" class="nb-pills">
      <button
        v-if="!expanded"
        class="nb-pill"
        :class="{ 'is-active': referencing }"
        type="button"
        :title="referencing ? '退出参考选择' : '在画布上选择参考（选一个就连到本节点）'"
        @click.stop="toggleReference"
      >
        <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_PLUS" />
        <span>参考</span>
        <span v-if="cards.length > 0" class="nb-pill-badge">{{ cards.length }}</span>
      </button>
      <button
        v-if="!expanded"
        class="nb-pill is-disabled"
        type="button"
        disabled
        :title="'标记：暂未支持'"
        @click.stop
      >
        <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_TAG" />
        <span>标记</span>
      </button>
    </div>

    <!-- 全屏按钮：钉在面板右上角（不依赖 pills 行） -->
    <button
      class="nb-expand nb-icon-btn"
      type="button"
      :title="expanded ? '收起为浮动底栏' : '展开为大窗口'"
      :aria-label="expanded ? '收起' : '展开'"
      :aria-expanded="expanded"
      @click.stop="expanded = !expanded"
    >
      <span aria-hidden="true" v-html="expanded ? ICON_COLLAPSE : ICON_EXPAND" />
    </button>

    <!--
      参考素材 = **一行**（用户口径 2026-10-25：「它只有一行的输入，你这边重复了」）。
      每一格是同一个「槽位」：
        · 已连线 / 已上传 → 显示图片（与素材卡同款：cover + 轻微模糊）
        · 没有内容 → 虚线「待输入」，点它上传 / 拖文件 / Ctrl 拖节点
      从前把「待输入槽」和「已有素材卡」画成两排，同一个参考就出现两次；现在合并成一条序列。
    -->
    <!-- AI 生成期的流光容器（用户口径 2026-10-27 截图）：框罩住「参考卡列表 + 输入区」
         整块，顶边在卡片列表上方。平时零样式不改布局，仅 is-ai-locking 画描边。 -->
    <div class="nb-ai-frame" :class="{ 'is-ai-locking': aiEditorLocked }">
    <VueDraggable
      v-if="refTiles.length > 0"
      class="nb-cards"
      :class="{ 'is-drop-hot': slotsDropHot }"
      :model-value="refTiles"
      :animation="180"
      ghost-class="nb-card--ghost"
      chosen-class="nb-card--chosen"
      drag-class="nb-card--drag"
      :force-fallback="true"
      @update:model-value="onReorderTiles"
      @click.capture="onCardsClickCapture"
      @keydown="onCardsKeydown"
    >
      <div
        v-for="tile in refTiles"
        :key="tile.key"
        :data-tile-key="tile.key"
        tabindex="0"
        class="nb-card"
        :class="{ 'is-pending': tile.pending }"
        :title="tile.pending ? '待输入：点击上传 / 拖文件进来 / Ctrl 拖节点' : tile.name + '（可拖动调整顺序）'"
        :style="tile.pending ? 'cursor: pointer' : ''"
        @click.stop="tile.pending && tile.slotKey ? pickSlotFile(tile.slotKey) : undefined"
        @dragover.stop.prevent="onSlotDragOver($event)"
        @dragleave.stop="onSlotDragLeave($event)"
        @drop.stop.prevent="onSlotDrop($event, undefined)"
      >
        <span class="nb-card-clip">
          <img
            v-if="tile.url && !tile.pending && !tile.isText"
            class="nb-card-img"
            :src="tile.url"
            :alt="tile.name"
            draggable="false"
          />
          <span v-else-if="tile.pending" class="nb-card-pending">
            <span class="nb-card-plus" aria-hidden="true">+</span>
            <span class="nb-card-pending-label">{{ tile.label }}</span>
            <span class="nb-card-pending-tag">待输入</span>
          </span>
          <span v-else class="nb-card-text">{{ (tile.name || '文')[0] }}</span>
          <span class="nb-card-index">{{ tile.index }}</span>
        </span>
        <span v-if="slotErrorOf(tile)" class="nb-slot-error">{{ slotErrorOf(tile) }}</span>
        <!-- 键盘排序（无障碍 + 自动化可测）：聚焦卡片后 Ctrl+←/→ 移动 -->
        <button
          v-if="!tile.pending"
          class="nb-card-hit"
          type="button"
          :aria-label="'预览素材 ' + tile.name"
        />
        <button
          v-if="!tile.pending"
          class="nb-remove"
          type="button"
          :aria-label="'移除素材 ' + tile.name"
          title="移除素材（断开连线）"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
    </VueDraggable>

    <!-- 动作专属面板（video 剪辑时间轴这类） -->
    <component :is="(currentAction as any).panel" v-if="currentAction?.panel" :id="props.id" :data="props.data" />

    <!-- 输入区：内联在卡下面（点得进去、能打字、@ 引用素材）。
      AI 生成期间：外层 nb-ai-frame 画流光 + 锁编辑；is-ai-streaming = 已在写正文。 -->
    <div v-if="showEditor" class="nb-editor nodrag nopan nowheel" :style="editorStyle">
      <!-- starting 阶段提示（原文还在，只是右上角小字说一句，不遮内容） -->
      <span v-if="aiPhase === 'starting'" class="nb-ai-hint" aria-hidden="true">AI 处理中，即将写入…</span>
      <span v-if="prompt.length === 0 && aiPhase !== 'starting'" class="nb-placeholder" aria-hidden="true">描述你想要的内容，可用 @ 引用素材</span>
      <ProseMirrorEditor
        ref="editorComponentRef"
        v-model="prompt"
        v-model:prompt-doc="promptDoc"
        :resources="editorResources"
        :resolve-resource="resolveResource"
        :editable="!aiEditorLocked"
        @update:model-value="onPromptUpdate"
        @click.stop
      />
    </div>
    </div> <!-- /nb-ai-frame -->

    <!-- 底部行：左模型 + 参数串，右图标·计数·圆形发送（照参考图） -->
    <div class="nb-bottom">
      <div class="nb-selects">
        <div class="nb-field nb-field--action">
          <Select
            :model-value="currentId"
            :options="actionOptions"
            :disabled="running"
            dropdown-width="match"
            dropdown-min-width="300px"
            :input-id="'nb-action-' + props.id"
            title="选择动作 / 模型"
            @update:model-value="(v: string | number) => selectAction(String(v))"
          />
        </div>
        <span class="nb-divider" aria-hidden="true" />
        <!-- 比例等参数：**自己一个下拉**（不塞进模型下拉里，也不藏进"设置"面板）。
             用户要求：「右侧的比例选择也是通过下拉的方式」——左边是插件/动作提供的功能
             （模型 + 参数），都摆在底行上；右边那枚齿轮才是全局设置。 -->
        <div v-if="paramDefs.length > 0" class="nb-field nb-field--params">
          <ToolParamGroup
            :params="paramDefs"
            :values="values"
            :disabled="running"
            :id-prefix="'nb-group-' + props.id"
            @change="onFieldChange"
          />
        </div>
      </div>

      <div class="nb-actions">
        <span v-if="infoText" class="nb-info">{{ infoText }}</span>
        <!-- AI 按钮（可配置）：翻译 / 提示词优化等，清单来自云端 KV；
             点击请求后台 AI，流式结果直接写进输入框（历史 500ms 一批落） -->
        <button
          v-for="ai in aiButtons"
          :key="ai.id"
          class="nb-icon-btn"
          :class="{ 'is-running': aiRunningId === ai.id }"
          type="button"
          :disabled="!showEditor || aiRunningId !== null"
          :title="ai.description || ai.name"
          :aria-label="ai.name"
          @click.stop="runAiAction(ai)"
        >
          <span v-if="aiRunningId === ai.id" class="nb-ai-spinner" aria-hidden="true" />
          <span v-else aria-hidden="true" v-html="ai.icon" />
        </button>
        <span
          v-if="aiError"
          class="nb-ai-error"
          role="alert"
          :title="aiError"
        >{{ aiError }}</span>
        <!-- 全局设置（右侧 = 跟插件/动作无关的全局项）：点它在底栏下面展开一块设置区 -->
        <button
          class="nb-icon-btn"
          :class="{ 'is-on': settingsOpen }"
          type="button"
          :title="settingsOpen ? '收起全局设置' : '展开全局设置'"
          :aria-expanded="settingsOpen"
          aria-label="全局设置"
          @click.stop="settingsOpen = !settingsOpen"
        >
          <span aria-hidden="true" v-html="ICON_SETTINGS" />
        </button>
        <span class="nb-count" :title="'最多 ' + CHAR_LIMIT + ' 字'">{{ charCount }}/{{ CHAR_LIMIT }}</span>
        <!-- 参考序号有缺时：发送按钮左边一个警告图标，hover 出 tooltip 说清楚缺哪一格 -->
        <Tooltip v-if="refGapHint" :content="refGapHint" placement="bottom">
          <span class="nb-gap-hint" role="button" tabindex="0"><span aria-hidden="true" v-html="ICON_WARN" /></span>
        </Tooltip>
        <button
          class="nb-run"
          :class="{ 'is-running': running }"
          type="button"
          :disabled="!canRun || submitted"
          :aria-disabled="!canRun || submitted"
          :title="currentAction?.title || '执行'"
          @click.stop="onRun"
        >
          <span v-if="running" class="nb-spinner" aria-hidden="true" />
          <span v-else class="nb-send-icon" aria-hidden="true" v-html="ICON_SEND" />
        </button>
      </div>
    </div>

    <!-- 全局设置区：**在底栏下面追加的一块**（用户要求：不弹窗、底栏慢慢增高式的展开、
         一条分割线 + 里面显示全局设置）。动画用**高度过渡**让底栏平滑增高（见 script 里的
         onGlobalEnter/Leave：把 height 0↔scrollHeight 显式写好，比 grid-template-rows 稳）。
         内容暂时是占位文本（用户说后期自己做实现）。 -->
    <Transition name="nb-gset" @enter="onGlobalEnter" @after-enter="onGlobalAfterEnter" @leave="onGlobalLeave">
      <div v-if="settingsOpen" ref="globalRef" class="nb-global nodrag nopan nowheel">
        <div class="nb-global-inner">
          <p class="nb-global-title">全局设置</p>
          <p class="nb-global-hint">这里放全局设置（与插件/动作无关）。暂为占位，后续实现。</p>
        </div>
      </div>
    </Transition>

  </div>
  </div>
  </Teleport>
</template>

<style scoped>
/* 视觉照 docs/design/ui-style-guide.md；位置（贴边/居中/反缩放）由壳的下插槽定位层给。
   尺寸照 LibTV 参考实测：面板圆角 16、内边距 8、pill 高 26、素材卡 48、发送按钮 Ø34。 */

/* —— 全局设置区（底栏下面追加的一块；用户要求：不弹窗、底栏慢慢增高式展开） ——
   展开/收起靠**高度过渡**（JS 里把 height 0↔scrollHeight 写好），不是 grid-template-rows：
   后者在部分浏览器不补间、且逐帧改布局，观感就是「一卡一卡」。height 过渡到处都稳。 */
.nb-global {
  overflow: hidden;
  /*
   * 抵消父容器 .nb-root 的 flex gap: 8px。
   *
   * 为什么必须抵消（用户实测："高度缩到 0 之后最后一个过渡很难受"）：flex gap 是**父元素**
   * 在相邻 item 之间留的，不属于本元素的高度 —— 自定义 height 从 H 过渡到 0 时，那 8px gap
   * 一直还在，等 v-if 把本元素摘掉的那一刻 gap 才消失 → 末尾"啪"地跳 8px（实测：346→…→282
   * 停住，然后 282→274）。给一个等量负 margin 把它抵成 0，间距就完全由**本元素内部**承担
   * （见 .nb-global-inner 的 margin-top），跟着 height 一起被裁剪、一起动画，末尾不再跳。
   */
  margin-top: -8px;
}
.nb-global-inner {
  /* 分割线上方的留白（原来由 flex gap 8 + 这里 10 组成；gap 抵消后补足到 18） */
  margin-top: 18px;
  padding-top: 10px;
  /* 与上面内容之间一条分割线（用户要求） */
  border-top: 1px solid var(--ui-line, #e2e5ea);
}
.nb-global-title {
  margin: 0;
  color: var(--ui-ink, #18202b);
  font-size: 13px;
  font-weight: 600;
}
.nb-global-hint {
  margin: 4px 0 0;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
  line-height: 1.6;
}
/* height + opacity 一起过渡；内层轻微上滑，让「长出来」更有层次 */
.nb-gset-enter-active,
.nb-gset-leave-active {
  transition: height 0.26s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.22s ease;
}
.nb-gset-enter-active .nb-global-inner,
.nb-gset-leave-active .nb-global-inner {
  transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
}
.nb-gset-enter-from .nb-global-inner,
.nb-gset-leave-to .nb-global-inner {
  transform: translateY(-6px);
}

/* 外壳：收起时完全透明（display:contents，跟没有一样，保持原浮层布局）；
   展开时铺满视口、居中、加遮罩当大弹窗用（用户要求「变成 dialog 的形式」）。 */
.nb-shell {
  display: contents;
}
.nb-shell.is-expanded {
  position: fixed;
  inset: 0;
  /* 全屏态必须压过节点上/下控制栏（LAYERS.nodeToolbar=500，截图的"上传"按钮就在那层）
     且低于模态（LAYERS.modal）—— 层值统一取自渲染层的层叠带，不写裸数字。 */
  /* z-index 由模板按 LAYERS.nodeToolbar + 1 内联（层值单一出处，见 canvas-render/contracts/layers） */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: var(--ui-scrim, rgb(15 23 42 / 0.35));
  backdrop-filter: blur(2px);
}

/* 展开态：固定尺寸、随视口限高；面板本身仍是同一套内容 */
.nb-root.is-expanded {
  width: min(760px, 100%);
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  box-shadow: var(--ui-shadow-lg, 0 24px 64px rgb(15 23 42 / 0.2));
}
/* 展开态：输入区给足高度（大窗口的意义就是能一次写很多） */
.nb-root.is-expanded .nb-editor {
  --nb-max: 40vh;
}

.nb-root {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  min-width: 360px;
  /* 左右多留一点（用户实测反馈：右侧内容贴到边、看着像出屏）：
     上下 8、左右 12，给一排 pill / 输入区 / 底行都留出可呼吸的边距 */
  padding: 8px 12px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 16px;
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-md, 0 18px 44px rgb(15 23 42 / 0.16));
}

/* —— 一排 pill（参考图顶行） —— */
.nb-pills {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 2px 0 0 2px;
}
.nb-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: var(--ui-chip, rgb(0 0 0 / 0.07));
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.18s ease-out, color 0.18s ease-out;
}
.nb-pill:hover:not(:disabled) {
  background: var(--ui-hover-strong, rgb(0 0 0 / 0.1));
}
.nb-pill--action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.nb-pill:disabled,
.nb-pill.is-disabled {
  /* 用户要求：「标记」暂不支持 → 给一个透明度效果 */
  opacity: 0.38;
  cursor: not-allowed;
}
.nb-pill.is-active {
  background: var(--ui-accent, #1f6dff);
  color: var(--ui-primary-ink, #ffffff);
}
.nb-pill.is-active:hover:not(:disabled) {
  background: var(--ui-accent, #1f6dff);
}
.nb-pill.is-active .nb-pill-badge {
  background: color-mix(in srgb, var(--ui-primary-ink, #ffffff) 24%, transparent);
  color: var(--ui-primary-ink, #ffffff);
}
.nb-pill--action.is-active {
  background: var(--ui-accent-soft, color-mix(in srgb, var(--ui-accent, #0891b2) 12%, transparent));
  color: var(--ui-accent, #0891b2);
}
.nb-pill:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.nb-pill-icon {
  display: inline-flex;
  width: 12px;
  height: 12px;
}
.nb-pill-icon :deep(svg) {
  width: 12px;
  height: 12px;
}
.nb-pill-badge {
  padding: 0 4px;
  border-radius: 999px;
  background: var(--ui-accent-soft, color-mix(in srgb, var(--ui-accent, #0891b2) 12%, transparent));
  color: var(--ui-accent, #0891b2);
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* 展开按钮浮在右上角；右缘与面板内容边（左右 padding 12）对齐 */
.nb-expand {
  position: absolute;
  right: 12px;
  top: 8px;
  /* 全屏态：pills 行隐藏后行高没了 —— 按钮改为钉在面板右上角，不占行 */
  /* 全屏时编辑器宽度溢出到按钮下方 —— 不抬层会被输入框盖住（真机踩过） */
  z-index: 40;
}

.nb-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  /* 32×32 圆角 8：照参考站实测（底行右侧那排图标按钮与它同尺寸） */
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  cursor: pointer;
  transition: background-color 0.18s ease-out, color 0.18s ease-out;
}
.nb-icon-btn:hover {
  background: var(--ui-hover, rgb(0 0 0 / 0.06));
  color: var(--ui-ink, #18202b);
}
.nb-icon-btn--static {
  cursor: default;
}
.nb-icon-btn--static:hover {
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
}
.nb-icon-btn.is-on {
  background: var(--ui-accent-soft, color-mix(in srgb, var(--ui-accent, #0891b2) 12%, transparent));
  color: var(--ui-accent, #0891b2);
}

/* AI 按钮跑动中的小转圈（与发送按钮的 spinner 同款观感，尺寸 14） */
.nb-ai-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--ui-ink-dim, #6b7280) 40%, transparent);
  border-top-color: var(--ui-accent, #0891b2);
  border-radius: 999px;
  animation: nb-spin 0.7s linear infinite;
}

/* AI 失败提示：琥珀短句贴在按钮右侧，4 秒自动消（详情在 title 里） */
.nb-ai-error {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--ui-warn, #b45309);
  cursor: help;
}
.nb-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.nb-icon-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.nb-icon-btn :deep(svg) {
  width: 16px;
  height: 16px;
}

/* —— 素材卡（常显；48×48，序号角标左下；参考图 size-12） —— */

.nb-cards {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  padding-left: 2px;
}
/* 参考格：待输入（虚线） */
.nb-card.is-pending {
  border: 1px dashed color-mix(in srgb, var(--ui-ink, #18202b) 26%, transparent);
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.03));
  cursor: pointer;
}
.nb-card.is-pending:hover {
  border-color: var(--ui-accent, #0891b2);
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
}
.nb-card-pending {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  color: var(--ui-ink-mute, #8c95a3);
}
.nb-card.is-pending:hover .nb-card-pending {
  color: var(--ui-accent, #0891b2);
}
.nb-card-plus {
  font-size: 15px;
  line-height: 1;
}
.nb-card-pending-label {
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}
.nb-card-pending-tag {
  position: absolute;
  left: 3px;
  bottom: 3px;
  padding: 1px 3px;
  border-radius: 4px;
  background: var(--ui-overlay-solid, #fff);
  border: 1px solid color-mix(in srgb, var(--ui-warn, #b45309) 30%, transparent);
  color: var(--ui-warn, #b45309);
  font-size: 8px;
  font-weight: 700;
  line-height: 1.2;
}
/* 待输入格上传/拖入失败的原因：贴在格子下方，几秒自动消失 */
.nb-slot-error {
  position: absolute;
  left: 50%;
  top: calc(100% + 3px);
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 10px;
  color: var(--ui-danger, #ef4444);
  pointer-events: none;
}
/* Ctrl 拖资源悬停到的目标格：描边高亮（待输入/已填通用） */
.nb-card.is-target {
  border-color: var(--ui-accent, #0891b2) !important;
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.12)) !important;
}
/* 参考行整体拖放高亮 */
.nb-cards.is-drop-hot {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.08));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent, #0891b2) 35%, transparent);
  border-radius: 12px;
}

.nb-card {
  position: relative;
  flex: none;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 8px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  /*
   * ⚠️ 卡片自己**不能** overflow:hidden（用户点名提醒）：右上角的关闭按钮有一半在卡片外面，
   * 被裁掉就只剩半个、hover 也点不着。圆角裁剪挪到内层 .nb-card-clip 上做。
   */
  overflow: visible;
  /* 用户要求：素材顺序可以拖拽改变 —— 告诉用户这张卡是可以拎起来挪的 */
  cursor: grab;
  /*
   * ⚠️ 这里**绝不能**给 `transform` 加过渡（用户带截图报的「拖拽跟不上鼠标，有种缩放阻尼感」）：
   * 拖拽库每一帧都在给这张卡写 `transform: matrix(... , tx, 0)`（写进去的值是 1:1 跟手的），
   * 而 `transition: transform` 会把这串逐帧变化的 matrix **补间**起来 —— 移动越快落后越多，
   * 表现就是「鼠标都到那儿了元素才挪一点点」。
   * 缩放改用**独立的 `scale` 属性**（`translate/scale/rotate` 与 `transform` 是两套合成层，
   * 各走各的、互不覆盖），于是卡片既能按下回弹，又不干扰库写的 translate。
   */
  transition: border-color 0.18s ease-out, scale 0.15s ease-out, box-shadow 0.18s ease-out;
}
.nb-card:hover {
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 55%, transparent);
}
.nb-card:active {
  cursor: grabbing;
  scale: 0.96;
}
.nb-card:has(.nb-card-hit:focus-visible) {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
/* 整张卡的可点区（点开全屏预览）。用**原生 button** 拿键盘可达与 Enter/Space，
   外观全透明、铺满卡片 —— 卡片自己因此是 div（里面还有关闭按钮，按钮不能套按钮）。 */
.nb-card-hit {
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  border-radius: inherit;
  background: transparent;
  cursor: inherit;
  outline: none;
}
/*
 * 拖拽三态（Vue Draggable Plus 的 ghost / chosen / drag 三个 class）。
 *
 * 用户要求「他的那个动画效果挺好的」——动画由库自己补间，我们只给「原位置留下的空位」
 * 与「跟着手走的那张」两副面孔：
 * - ghost：原位置的空位（虚线框，提示这里会空出来）；
 * - chosen / drag：拎起来那张（提亮 + 轻微放大 + 投影，看得出「拿在手上了」）。
 */
.nb-card--ghost {
  opacity: 0.4;
  border-style: dashed;
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  background: var(--ui-accent-soft, color-mix(in srgb, var(--ui-accent, #0891b2) 12%, transparent));
}
.nb-card--chosen,
.nb-card--drag {
  cursor: grabbing;
  border-color: var(--ui-accent, #0891b2);
  box-shadow: var(--ui-shadow-md, 0 8px 20px rgb(15 23 42 / 0.24));
  /* 拎起来那张：**只给阴影与描边，绝不给缩放**。
     实测（自己做的对照实验）：给被拖拽的这张卡任何形式的放大（transform: scale 或独立的
     `scale` 属性都一样）都会把库写进来的位移一起放大 —— 独立属性与 `transform` 是
     `translate·rotate·scale·transform` 复合，`scale: 1.06` 会把 translate 的 dx 也乘 1.06，
     拖得越远越偏（量到 mouseDx=300 时位置到 317）。阴影已经足够表达「拿在手上了」。 */
}
.nb-card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* 用户要求：图片本身加模糊（卡片是正方形、cover 铺满）——
     放一点点 scale 是为了 blur 不把卡片四周"啃"出一圈透明边。 */
  transform: scale(1.18);
  filter: blur(1px);
}
/* 内层裁剪：卡片本身的 overflow 必须留 visible（关闭按钮一半在外），
   所以「正方形 + 圆角 + 把图片裁进来」这三件事挪到这一层做。 */
.nb-card-clip {
  position: absolute;
  inset: 0;
  display: block;
  border-radius: inherit;
  overflow: hidden;
}
/* 右上角关闭按钮：**有一半在卡片外**（所以内层这个 inset 是负的），
   默认隐藏，hover / 键盘聚焦才露出；hover 时转成危险色（照 ui-style-guide §5）。 */
.nb-remove {
  position: absolute;
  top: -7px;
  right: -7px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--ui-ink, #18202b);
  color: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-sm, 0 1px 4px rgb(15 23 42 / 0.28));
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease-out, background-color 0.15s ease-out;
}
.nb-remove svg {
  width: 10px;
  height: 10px;
}
.nb-card:hover .nb-remove,
.nb-card:focus-within .nb-remove,
.nb-remove:focus-visible {
  opacity: 1;
  pointer-events: auto;
}
.nb-remove:hover {
  background: var(--ui-danger, #ef4444);
}
.nb-card-text {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 15px;
  font-weight: 700;
}
.nb-card-index {
  position: absolute;
  left: 2px;
  bottom: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ui-ink, #18202b) 72%, transparent);
  color: var(--ui-panel, #fff);
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* —— 输入区（内联在卡下面；点得进去、能打字） —— */
.nb-editor {
  position: relative;
  min-height: 24px;
  padding: 0 2px;
  cursor: text;
  border-radius: 8px;
}

/*
 * AI 生成期间的**流光描边**（用户口径 2026-10-27 截图：框罩住「参考卡列表 + 输入区」
 * 整块，顶边在卡片列表上方）。容器 nb-ai-frame 平时零样式不改布局；is-ai-locking 时
 * ::before 铺 2px 渐变描边 + conic 渐变旋转（@property 让 --ai-sweep 可动画）。
 * 颜色吃 --ui-accent 跟主题走；prefers-reduced-motion 退化为静态描边（全站动效规矩）。
 */
.nb-ai-frame.is-ai-locking {
  /* 与面板内容的间距：流光框不贴文字/卡片（左右 10、上 8、下 6）；负 margin 抵消
     nb-root 的 flex gap，不额外占一行高度。 */
  position: relative;
  margin: -8px -10px -6px;
  padding: 8px 10px 6px;
  border-radius: 12px;
}
.nb-ai-frame.is-ai-locking::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 10px;
  padding: 2px;
  background: conic-gradient(
    from var(--ai-sweep, 0deg),
    transparent 0deg,
    color-mix(in srgb, var(--ui-accent, #0891b2) 85%, transparent) 40deg,
    color-mix(in srgb, var(--ui-accent, #0891b2) 20%, transparent) 90deg,
    transparent 150deg,
    color-mix(in srgb, var(--ui-accent, #0891b2) 55%, transparent) 250deg,
    transparent 330deg
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); /* 主题色白名单: mask 蒙版形状色 */
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); /* 主题色白名单: mask 蒙版形状色 */
  mask-composite: exclude;
  pointer-events: none;
  animation: nb-ai-sweep 2.4s linear infinite;
}
@property --ai-sweep {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
@keyframes nb-ai-sweep {
  to {
    --ai-sweep: 360deg;
  }
}
@media (prefers-reduced-motion: reduce) {
  .nb-ai-frame.is-ai-locking::before {
    animation: none;
    /* 光斑停转：退化为静态的柔和描边 */
    background: color-mix(in srgb, var(--ui-accent, #0891b2) 45%, transparent);
  }
}

/* starting 阶段的顶部小字提示（不遮原文，让用户确认内容还在） */
.nb-ai-hint {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 10px;
  color: var(--ui-accent, #0891b2);
  pointer-events: none;
}
/*
 * 字号/行高/最小高必须写在 **.ProseMirror 本体**上，不能只写在 .prose-mirror-editor 外壳上：
 * bundle 的 `.prose-mirror-editor .ProseMirror` 把这些值直配在正文元素自己身上（16px/120px），
 * 外壳上设的只是「会被继承的值」，永远输给它 —— 底栏要的是 13px 紧凑正文。
 * color/min-height 也一并覆写，理由同上（本体直配 > 外壳继承）。
 * 注意：颜色这件事的**根因**已在 bundle 侧修好（那边的写死 #111 会跟着主题走），
 * 这里保留一条显式声明，是为了底栏自己不去依赖上游默认值。
 */
.nb-editor :deep(.ProseMirror) {
  /* 撑满整块可见输入框（用户实测：绿色框那么大，却只有第一行能点进去聚焦）。
     bundle 里 `.prose-mirror-editor > div:first-child` 有 min-height:120px 决定了整块高度，
     但 .ProseMirror 本体只有一行高（21px）——真正能聚焦/能点的只有那一行。
     这里让正文元素 flex 撑满外壳，于是整块区域都可点、可聚焦。 */
  flex: 1 1 auto;
  min-height: var(--nb-min, 20px) !important;
  outline: none !important;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ui-ink, #18202b);
  word-break: break-word;
}
/* bundle 的中间层（editorRef 容器）：转成纵向 flex 列，正文才能被 flex:1 撑到整块高度。 */
.nb-editor :deep(.prose-mirror-editor > div:first-child) {
  display: flex;
  flex-direction: column;
}
.nb-editor :deep(.prose-mirror-editor) {
  max-height: var(--nb-max, 220px);
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ui-ink, #18202b);
}
/* @ 引用素材的标签：bundle 里写死了深灰字 + 深色下划线，深色主题下同样看不清 */
.nb-editor :deep(.resource-node .label) {
  color: var(--ui-ink, #18202b);
  font-size: 13px;
}
.nb-editor :deep(.resource-node) {
  border-bottom-color: color-mix(in srgb, var(--ui-ink, #18202b) 45%, transparent);
}

/*
 * @ 引用在输入框里的样子：**卡片**（用户要求，替换原来"缩略图 + 下划线"）。
 * 圆角小框 + 缩略图/图标 + 名字，整体贴着文字基线，像一颗内联 chip。
 * 颜色一律走主题变量；尺寸按 13px 正文配。
 */
.nb-editor :deep(.resource-chip) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 160px;
  height: 22px;
  padding: 0 7px 0 3px;
  margin: 0 2px;
  border: 1px solid color-mix(in srgb, var(--ui-ink, #18202b) 18%, transparent);
  border-radius: 6px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.04));
  vertical-align: bottom;
  line-height: 1;
  /* 覆盖编辑器公共样式里那条下划线（卡片不需要它） */
  border-bottom-width: 1px;
}
.nb-editor :deep(.resource-chip-thumb) {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  object-fit: cover;
  flex: none;
  pointer-events: none;
}
.nb-editor :deep(.resource-chip-icon) {
  display: inline-flex;
  align-items: center;
  flex: none;
  width: 16px;
  height: 16px;
}
.nb-editor :deep(.resource-chip-icon svg) {
  width: 14px;
  height: 14px;
}
.nb-editor :deep(.resource-chip-name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink, #18202b);
}
/* 选中态：与文本选区同色（用户口径：和文本选中背景一致，不用黑色） */
.nb-editor :deep(.resource-chip.ProseMirror-selectednode),
.nb-editor :deep(.resource-chip.resource-node-selected) {
  border-color: transparent;
  /* 与文本选区同一个背景变量（用户口径：标签选中和文字选中背景一致，用灰） */
  background: var(--ui-selection-bg, rgb(0 0 0 / 0.18));
}
.nb-placeholder {
  position: absolute;
  top: 0;
  left: 2px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 13px;
  line-height: 1.6;
  pointer-events: none;
  user-select: none;
}

/* —— 底部行（参考图：左模型·参数，右图标·计数·发送） —— */
.nb-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  min-height: 36px;
}
.nb-selects {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
}
.nb-divider {
  flex: none;
  width: 1px;
  height: 14px;
  margin: 0 2px;
  background: var(--ui-line, #e2e5ea);
}
.nb-field {
  flex: none;
  min-width: 0;
}
/* 模型下拉给一个最小宽度（用户实测反馈）：不设的话，模型名稍长就把触发框压成一条窄缝。
   参数下拉**不设**下限 —— 它的摘要本来很短（16:9），按内容宽即可，见 .nb-field--params。 */
.nb-field--action {
  min-width: 148px;
  max-width: 200px;
}
/* 下拉去边框、透明底（参考图的「文字 + ⌄」），hover 才给浅底 */
.nb-field :deep(.sel-trigger) {
  gap: 4px;
  padding: 4px 8px;
  border-color: transparent;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 13px;
  font-weight: 600;
  /* 圆角 8（不是胶囊）：照参考站的模型按钮 */
  border-radius: 8px;
}
.nb-field :deep(.sel-trigger:hover:not(.is-open)) {
  background: var(--ui-chip, rgb(0 0 0 / 0.07));
  color: var(--ui-ink, #18202b);
}
.nb-field :deep(.sel-trigger.is-open) {
  background: var(--ui-chip, rgb(0 0 0 / 0.07));
  border-color: transparent;
  box-shadow: none;
  color: var(--ui-ink, #18202b);
}
.nb-field :deep(.sel-arrow) {
  width: 14px;
  height: 14px;
  color: var(--ui-ink-mute, #8c95a3);
}
/*
 * 参数合并下拉：**按内容自适应宽度**。
 *
 * 用户实测反馈：「你这个比例的下拉，文字就那么长，你给我把按钮搞那么大」——
 * 之前这里写死 min-width:148px 又强制 width:100%，于是 "16:9" 撑成一整条长按钮。
 * 参数摘要本来就短（16:9 / 1:1…），让它随内容收紧、超长才省略即可。
 */
.nb-field--params {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 240px;
}
/* 触发器按内容宽（不拉满），与模型下拉之间保持一个分隔线；箭头仍在文字右侧 */
.nb-field--params :deep(.tpg-root) {
  width: auto;
}
.nb-field--params :deep(.tpg-trigger) {
  width: auto;
}
/*
 * 只有一个普通下拉参数时，ToolParamGroup 会**直接铺出那个下拉**（不再套一层参数面板，
 * 用户口径 2026-10-14：「如果里面只有唯一的一项，并且它是下拉的话，就直接把它做成外部的形式」）。
 * 那时里面是一个普通 Select —— 与左边的模型下拉同款：给一档最小宽，免得长名字（音色）
 * 被压成一条缝，同时仍按内容收缩（不拉满整行）。
 */
.nb-field--params :deep(.tpg-inline) {
  width: auto;
  min-width: 96px;
}

.nb-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.nb-info {
  font-size: 11px;
  color: var(--ui-ink-mute, #8c95a3);
  font-variant-numeric: tabular-nums;
}
.nb-count {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ui-ink-mute, #8c95a3);
}
/* 参考序号缺格提示：小警告图标贴着发送按钮，hover 出鼠标跟随提示（详情走 tip 服务） */
.nb-gap-hint {
  display: inline-flex;
  align-items: center;
  color: var(--ui-warn, #b45309);
  cursor: help;
}

/* 发送按钮：32×32、圆角 12（照参考站；浅色主题下白底深箭头，由 token 决定） */
.nb-run {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 12px;
  background: var(--ui-primary-bg, #1f2937);
  color: var(--ui-primary-ink, #fff);
  cursor: pointer;
  transition: background-color 0.18s ease-out, transform 0.15s ease-out;
}
.nb-run:hover:not(:disabled) {
  background: var(--ui-primary-bg-hover, #111827);
}
.nb-run:active:not(:disabled) {
  transform: scale(0.94);
}
.nb-run:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.nb-run:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 2px;
}
.nb-send-icon {
  display: inline-flex;
  width: 12px;
  height: 12px;
}
.nb-send-icon :deep(svg) {
  width: 12px;
  height: 12px;
}
.nb-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--ui-primary-ink, #fff) 40%, transparent);
  border-top-color: var(--ui-primary-ink, #fff);
  border-radius: 999px;
  animation: nb-spin 0.7s linear infinite;
}
@keyframes nb-spin {
  to {
    transform: rotate(360deg);
  }
}

/* —— 素材预览浮层 —— */
.nb-preview {
  position: absolute;
  left: 8px;
  right: 8px;
  top: 8px;
  bottom: 8px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  border-radius: 12px;
  background: var(--ui-overlay, rgb(255 255 255 / 0.88));
  backdrop-filter: blur(6px);
  overflow: hidden;
}
.nb-preview-img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  object-fit: contain;
}
.nb-preview-text {
  max-width: 100%;
  max-height: 100%;
  margin: 0;
  overflow: auto;
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.nb-preview-close {
  position: absolute;
  right: 8px;
  top: 8px;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 8px;
  background: var(--ui-chip, rgb(0 0 0 / 0.07));
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12px;
  cursor: pointer;
}
.nb-preview-close:hover {
  color: var(--ui-danger, #ef4444);
}

@media (prefers-reduced-motion: reduce) {
  .nb-pill,
  .nb-card,
  .nb-icon-btn,
  .nb-run {
    transition: none !important;
  }
  .nb-card:active,
  .nb-run:active:not(:disabled) {
    /* 缩放走独立的 `scale` 属性（不是 transform）——降级时也要按同一处关掉 */
    scale: none;
  }
  .nb-spinner {
    animation: none;
  }
}
</style>
<style>
/* Ctrl 拖资源的「影子」：跟鼠标走 —— 手建 DOM（document.createElement），必须是
   非 scoped 样式才能命中（scoped 的 data-v 属性选择器匹配不上手建节点，实测踩过：
   影子 position:fixed 全失效，铺成一个看不见的巨大静态块）。 */
.nb-drag-ghost {
  position: fixed;
  z-index: 3000;
  pointer-events: none;
  display: flex;
  align-items: center;
  padding: 0;
  border-radius: 10px;
  /* 只展示资源本身（用户口径：不要标题）—— 图片/视频直接缩略图，音频用图标 */
  overflow: hidden;
  box-shadow: var(--ui-shadow-lg, 0 24px 64px rgb(15 23 42 / 0.35));
  outline: 2px solid var(--ui-accent, #0891b2);
  outline-offset: -1px;
  /* 宽高比不裁切：图片按原始比例缩放，短边≥64、长边≤128（用户口径） */
  max-width: 128px;
}
.nb-drag-ghost img {
  min-width: 64px;
  min-height: 64px;
  max-width: 128px;
  max-height: 128px;
  width: auto;
  height: auto;
  flex: none;
  display: block;
}
.nb-drag-ghost .nb-drag-ghost-media {
  min-width: 64px;
  min-height: 64px;
  max-width: 128px;
  max-height: 128px;
  width: auto;
  height: auto;
  flex: none;
  display: block;
  background: var(--ui-video-stage, #000);
}
.nb-drag-ghost .nb-drag-ghost-icon {
  width: 88px;
  height: 88px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  background: var(--ui-overlay-solid, #fff);
  color: var(--ui-ink, #18202b);
}
.nb-drag-ghost .nb-drag-ghost-icon svg {
  width: 40px;
  height: 40px;
}
</style>
 
 
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); /* 主题色白名单: mask 蒙版形状色 */
