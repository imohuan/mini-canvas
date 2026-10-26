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
  resolveMaterialUrls,
  toEditorResources,
  toToolResources,
  type MaterialCard,
  type UpstreamMaterial,
} from './panelSource'
import { readRunState } from './runState'
import { initialPromptText, promptPersistFields } from './promptPersist'
// 参考：进入/退出画布选择态（会话状态在 referenceMode 里，浮层组件消费）
import { referenceActive, referenceEpoch, referenceOwner, toggleReference as toggleReferenceMode } from './referenceMode'
// 全屏预览（用户要求：素材卡点开要全屏看，不是缩在底栏里）
import { openPreview } from './mediaPreview'
// 右侧图标按钮里"改提示词"的小动作（翻译提示词）
import { hasTranslateInstruction, toggleTranslateInstruction } from './promptActions'
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
import { mergeRefTiles, findRefGap, uploadToRefSlot, refNameToSlotKey } from './refTiles'
// Ctrl 拖资源到参考格：节点媒体判定 / 目标放行（纯函数，已单测）
import { nodeMediaOf, isDraggableTarget } from './refSlotDrag'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx, renderEdges, renderNodes } = useCanvasRender()
// 设计系统件按名取（§4.5 目录）：换主题插件时这里一行不改
const Select = useUiComponent('select')
const ToolParamField = useUiComponent('toolParamField')
const ToolParamGroup = useUiComponent('toolParamGroup')

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

const materials = computed<UpstreamMaterial[]>(() =>
  collectUpstreamMaterials(
    renderEdges.value,
    props.id,
    (nodeId) => {
      const node = renderNodes.value.find((n) => n.id === nodeId)
      return node ? { type: node.type, data: node.data } : undefined
    },
    refOrder.value,
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
function openCard(card: MaterialCard): void {
  // 多张同类素材：把地址列成 list 交给 MediaViewer —— 预览里就有 ← / → 切换与页码。
  const multi = previewListFor(cards.value, card)
  // 全屏预览：用户要求「要的是全屏，是整个视图」
  openPreview({
    name: card.name,
    nodeId: card.id,
    kind: card.isText ? 'text' : (card.kind as 'image' | 'video' | 'audio'),
    url: card.url,
    text: card.value,
    ...(multi ?? {}),
  }, props.id)
}

/**
 * 素材卡右上角的关闭按钮 → **断开「这张素材 → 本节点」那条连线**（与全屏预览里的删除同一条语义）。
 *
 * 用户口径（2026-10-12）：「在右上角区域 hover 时，应该显示一个关闭按钮……点击该按钮后可以
 * 进行关闭，即删除与该图片相关的连接线」。连线没了，卡片自然从底栏消失（卡是边派生的）。
 */
function removeCard(card: MaterialCard): void {
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
  const label = REF_SLOT_META[gap.kind].label
  return '还缺' + gap.missing.map((i) => ' ' + label + i).join('、') + '，补上后才能发送'
})


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
const ICON_TRANSLATE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h7"/><path d="M7 3v2c0 4-2 7-5 8"/><path d="M5 9c1 3 3 5 6 6"/><path d="M14 20l4-9 4 9"/><path d="M15.5 17h5"/></svg>'
const ICON_SPARKLE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M18 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>'

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
/** 翻译提示词：有没有加过那句"翻成英文"的指令（按钮高亮态） */
const translated = computed(() => hasTranslateInstruction(prompt.value))
function toggleTranslate(): void {
  // 程序化改文本时必须**清掉 promptDoc**：编辑器在 [modelValue, promptDoc] 变化时，
  // 只要 promptDoc 还在就优先用它的旧 JSON 还原 —— 那会把这次追加的指令直接顶回去
  // （实测：用户先打过字、promptDoc 已生成，再点「翻译」文字纹丝不动）。
  // 清掉之后编辑器走「纯文本恢复」路径，按新的 modelValue 重建正文。
  promptDoc.value = undefined
  onPromptUpdate(toggleTranslateInstruction(prompt.value))
}
/**
 * 全局设置区是否展开。
 *
 * 用户要求：点右侧齿轮**不弹窗**，而是在底栏**下面追加一块区域**显示全局设置
 * （类似底部状态栏慢慢增高，带一条分割线，内容暂用占位文本）。
 */
const settingsOpen = ref(false)

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
  const ids = next
    .map((t) => (t.key ?? '').replace(/^card:/, ''))
    .filter((id) => id && !id.includes(':')) // slot:image:2 这种不是节点 id
  if (ids.length === 0) return
  try {
    ctx.get('doc').updateNode(props.id, { data: { refOrder: ids } })
  } catch {
    /* 节点已不在等情况：忽略 */
  }
}

const editorComponentRef = ref<{
  insertResource?(item: ResourceItem): void
  replaceResource?(item: ResourceItem): boolean
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
        refOrder: () => refOrder.value,
        writeOrder: (ids) => doc.updateNode(props.id, { data: { refOrder: ids } }),
        pickCreated: (before) => {
          ;(window as any).__upDbg.step = 'pick-created'
          // 为什么不能到 shownMaterials 里找：素材是**按边**收集的（collectUpstreamMaterials），
          // 而此刻连线还没建 —— 新节点根本不在里面，永远找不到 → 提前 return（这就是
          // 「上传只建节点、没连线」的根因）。这里直接查 doc：file-drop 刚建的那个新节点。
          const freshNode = doc.getNodes().find((n) => !before.has(n.id) && n.id !== props.id)
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
  // SSR / 编辑器未挂载时跳过（只影响标签 UI，不影响数据）
  if (typeof document === 'undefined') return
  if (!editorComponentRef.value) return
  for (const tile of refTiles.value) {
    const key = tile.slotKey
    if (tile.pending) {
      // 待输入的格子：把「虚线待输入」的 item 登记进去（tile.url 是空的）
      if (!key) continue
      // key 形如 slot:image:3 / card:174 —— slot: 前缀时种类在第 2 段
      const parts = key.split(':')
      const k = parts[0] === 'slot' ? parts[1] : parts[0]
      const i = parts[0] === 'slot' ? parts[2] : parts[1]
      if (k !== 'image' && k !== 'video' && k !== 'audio') continue
      const label = REF_SLOT_META[k as RefSlotKind].label
      registerItem({
        id: 'ref-slot:' + key,
        name: label + Number(i),
        category: '素材',
        mediaType: k === 'av' ? undefined : (k as 'image' | 'video' | 'audio'),
      })
      continue
    }
    // 已填的格子：key = card:<节点id>，序号与内容来自连线素材
    // 序号从 **refName**（图片N）取，不是 tile.name（那是节点 label，如「拖我B」）——
    // 用显示名找会匹配不上（refNameToSlotKey 认不出「拖我B」）→ 从未调 replaceResource
    //（这就是「上传后连线有了、但正文标签仍是虚线」的根因）
    const refName = shownMaterials.value.find((m) => m.id === tile.key.replace(/^card:/, ''))?.refName
    const parsed = refNameToSlotKey(refName ?? tile.name, 'image') ?? refNameToSlotKey(refName ?? tile.name, 'video') ?? refNameToSlotKey(refName ?? tile.name, 'audio')
    if (!parsed) continue
    const kind = parsed.kind
    const index = parsed.index
    const slotKey = kind + ':' + index
    const label = REF_SLOT_META[kind as RefSlotKind].label
    const item: ResourceItem = {
      id: 'ref-slot:' + parsed.kind + ':' + parsed.index,
      name: tile.name || label + tile.index,
      category: '素材',
      url: tile.url,
      mediaType: kind === 'av' ? undefined : (kind as 'image' | 'video' | 'audio'),
    }
    registerItem(item)
    // 已填的格子：用 replaceResource 原地替换正文里对应的标签（虚线→实线 + 缩略图）
    const replaced = editorComponentRef.value?.replaceResource?.(item)
    void replaced
  }
}

/** 连线变了（上传/替换/断开/初始载入）→ 正文里对应的标签跟着刷成已填状态。
 *  注意：必须放在 refreshSlotChips / editorComponentRef 定义之后 —— immediate 会同步执行一次，
 *  放前面会踩 const TDZ（真机踩过：ReferenceError before initialization）。 */
watch(shownMaterials, () => refreshSlotChips(), { immediate: true })

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
  if (g) { g.style.left = x + 12 + 'px'; g.style.top = y + 12 + 'px' }
}

/** pointerdown（捕获）：底栏开着 + Ctrl + 鼠标下是图片/视频/音频节点 → 进入拖资源模式。
 *  在捕获阶段拦掉，画布收不到这次按下 —— Ctrl 拖资源**不会**顺带选中节点。 */
function onCtrlDragPointerDown(ev: PointerEvent): void {
  if (!(ev.ctrlKey || ev.metaKey)) return
  if (!isDraggableTarget(ev.target)) return
  if (!document.querySelector('.nb-overlay')) return
  const el = (ev.target as HTMLElement).closest('.vue-flow__node') as HTMLElement | null
  const nodeId = el?.getAttribute('data-id')
  if (!nodeId) return
  const doc = ctx.tryGet<{ getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined }>('doc')
  const media = nodeMediaOf(doc?.getNode(nodeId))
  if (!media) return
  ev.preventDefault()
  ev.stopPropagation()
  // 影子 = 缩略图 + 名字（用户口径 2026-10-26：「可以做成图片的缩略图跟随鼠标」）
  const ghost = document.createElement('div')
  ghost.className = 'nb-drag-ghost'
  if (media.url && media.mediaType === 'image') {
    const img = document.createElement('img')
    img.src = media.url
    img.alt = ''
    ghost.appendChild(img)
  }
  const label = document.createElement('span')
  label.textContent = media.name
  ghost.appendChild(label)
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

/** pointerup：落在参考格 → 替换该格资源；落在画布上 → 什么都不做（节点留在原处） */
function onCtrlDragPointerUp(ev: PointerEvent): void {
  const drag = ctrlDrag
  ctrlDrag = null
  if (drag?.targetTileKey) document.querySelector('.nb-card[data-tile-key="' + drag.targetTileKey + '"]')?.classList.remove('is-target')
  drag?.ghost?.remove()
  if (!drag || !drag.targetTileKey) return
  // 松手点 = 落在参考格上的（用户松手那一刻鼠标在哪，替换就在哪）
  const dropHost = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.nb-card') as HTMLElement | null
  if (dropHost?.dataset.tileKey) drag.targetTileKey = dropHost.dataset.tileKey
  const tile = refTiles.value.find((t) => t.key === drag.targetTileKey)
  if (!tile?.slotKey) return
  const kind = tile.slotKey.split(':')[0] as RefSlotKind
  const index = Number(tile.slotKey.split(':')[1])
  void replaceSlotMaterial(kind, index, { nodeId: drag.nodeId, mediaType: drag.mediaType, url: drag.url, name: drag.name })
}

onMounted(() => {
  window.addEventListener('pointerdown', onCtrlDragPointerDown, true)
  window.addEventListener('pointermove', onCtrlDragPointerMove, true)
  window.addEventListener('pointerup', onCtrlDragPointerUp, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onCtrlDragPointerDown, true)
  window.removeEventListener('pointermove', onCtrlDragPointerMove, true)
  window.removeEventListener('pointerup', onCtrlDragPointerUp, true)
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
  const doc = ctx.tryGet<{
    getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined
    addEdge(input: { source: string; target: string }): string
    removeEdges(ids: string[]): number
  }>('doc')
  if (!doc) return
  // 该格原本的连线 = 连到本节点、且素材 refName 正好对应这个槽位的那条
  const material = shownMaterials.value.find((m) => refNameToSlotKey(m.refName, kind) === refSlotKey(kind, index))
  const oldEdge = material ? renderEdges.value.find((e) => e.source === material.id && e.target === props.id) : undefined
  try {
    if (oldEdge) doc.removeEdges([oldEdge.id])
    doc.addEdge({ source: source.nodeId, target: props.id })
    // 顺序对齐：替换不改变该格的序号（仍排在原来的位置）
    const order = placeRefAtSlot(refOrder.value, kind, index, source.nodeId)
    doc.updateNode(props.id, { data: { refOrder: order } })
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
function onSlotDrop(ev: DragEvent, slot: RefSlot): void {
  void slot
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
    <!-- 一排 pill（参考图顶行：+参考 / 标记 / 风格；动作也在这里成排，选中高亮） -->
    <div class="nb-pills">
      <button
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
      <!-- 标记：功能尚未实现，置灰（用户要求：给一个透明度效果表示不支持） -->
      <button class="nb-pill is-disabled" type="button" disabled :title="'标记：暂未支持'" @click.stop>
        <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_TAG" />
        <span>标记</span>
      </button>
      <!-- 风格：不在这里做（用户要求 pass 掉）。团队的风格是写在提示词里的文字，
           后期会变成输入框里的一个 tag，而不是这里的第二类参考图。 -->
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
    </div>

    <!--
      参考素材 = **一行**（用户口径 2026-10-25：「它只有一行的输入，你这边重复了」）。
      每一格是同一个「槽位」：
        · 已连线 / 已上传 → 显示图片（与素材卡同款：cover + 轻微模糊）
        · 没有内容 → 虚线「待输入」，点它上传 / 拖文件 / Ctrl 拖节点
      从前把「待输入槽」和「已有素材卡」画成两排，同一个参考就出现两次；现在合并成一条序列。
    -->
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
    >
      <div
        v-for="tile in refTiles"
        :key="tile.key"
        :data-tile-key="tile.key"
        class="nb-card"
        :class="{ 'is-pending': tile.pending }"
        :title="tile.pending ? '待输入：点击上传 / 拖文件进来 / Ctrl 拖节点' : tile.name + '（可拖动调整顺序）'"
        :style="tile.pending ? 'cursor: pointer' : ''"
        @click.stop="tile.pending && tile.slotKey ? pickSlotFile(tile.slotKey) : undefined"
        @dragover.stop.prevent="onSlotDragOver($event)"
        @dragleave.stop="onSlotDragLeave($event)"
        @drop.stop.prevent="onSlotDrop($event)"
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

    <!-- 输入区：内联在卡下面（点得进去、能打字、@ 引用素材） -->
    <div v-if="showEditor" class="nb-editor nodrag nopan nowheel" :style="editorStyle">
      <span v-if="prompt.length === 0" class="nb-placeholder" aria-hidden="true">描述你想要的内容，可用 @ 引用素材</span>
      <ProseMirrorEditor
        ref="editorComponentRef"
        v-model="prompt"
        v-model:prompt-doc="promptDoc"
        :resources="editorResources"
        :resolve-resource="resolveResource"
        @update:model-value="onPromptUpdate"
        @click.stop
      />
    </div>

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
        <button
          class="nb-icon-btn"
          :class="{ 'is-on': translated }"
          type="button"
          :disabled="!showEditor"
          :title="translated ? '取消翻译指令' : '让模型用英文输出（在提示词里追加一句指令）'"
          aria-label="翻译提示词"
          @click.stop="toggleTranslate"
        >
          <span aria-hidden="true" v-html="ICON_TRANSLATE" />
        </button>
        <span class="nb-icon-btn nb-icon-btn--static" :title="fieldSummary || '生成参数'">
          <span aria-hidden="true" v-html="ICON_SPARKLE" />
        </span>
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
        <!-- 参考序号有缺时，在发送按钮左边说清楚缺哪一格（不然用户只看到按钮点不动） -->
        <span v-if="refGapHint" class="nb-gap-hint" :title="refGapHint">{{ refGapHint }}</span>
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
  z-index: 95;
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
/* Ctrl 拖资源时的「影子」：跟鼠标走，提示用户正拿着一个资源 */
.nb-drag-ghost {
  position: fixed;
  z-index: 1000;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px 4px 4px;
  border-radius: 8px;
  background: var(--ui-overlay-solid, #fff);
  border: 1px solid var(--ui-accent, #0891b2);
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  font-weight: 600;
  box-shadow: var(--ui-shadow-md, 0 8px 20px rgb(15 23 42 / 0.24));
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nb-drag-ghost img {
  width: 34px;
  height: 34px;
  border-radius: 5px;
  object-fit: cover;
  flex: none;
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
/* 选中态：跟主题强调色走 */
.nb-editor :deep(.resource-chip.ProseMirror-selectednode),
.nb-editor :deep(.resource-chip.resource-node-selected) {
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  background: var(--ui-accent-soft, color-mix(in srgb, var(--ui-accent, #0891b2) 12%, transparent));
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
/* 参考序号缺格提示：贴着发送按钮，短、能截断（详情在 title 里） */
.nb-gap-hint {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ui-warn, #b45309);
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
 
 
