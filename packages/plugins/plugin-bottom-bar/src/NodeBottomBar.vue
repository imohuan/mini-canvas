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
defineOptions({ inheritAttrs: false })
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import { registerItem, type ResourceItem } from 'prosemirror-editor-bundle'
// 标签识别规则外置（用户 2026-10-27）：认什么写法由插件决定，编辑器只提供通道
import { registerTagSpec } from 'prosemirror-editor-bundle'
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
  bottomBarTagSpecFor,
  previewListFor,
  makeResourceResolver,
  materialCards,
  nextRefOrder,
  placeChipAt,
  resolveMaterialUrls,
  toEditorResources,
  toToolResources,
  type MaterialCard,
  type UpstreamMaterial,
} from './panelSource'
import { readRunState } from './runState'
import { initialPromptDoc, initialPromptText, promptDocPersistFields, promptPersistFields } from './promptPersist'
// 参考：进入/退出画布选择态（会话状态在 referenceMode 里，浮层组件消费）
import { exitReference, referenceActive, referenceEpoch, referenceOwner, toggleReference as toggleReferenceMode } from './referenceMode'
import { resolveBottomBarShown } from './bottomBarOverlay'
// 全屏预览（用户要求：素材卡点开要全屏看，不是缩在底栏里）
import { openPreview } from './mediaPreview'
import { peekVideoThumb, ensureVideoThumb } from './videoThumbCache'
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
  refChipsFromDoc,
  refNodeChipId,
  refNameChipId,
  nodeIdOfChip,
  nameOfChip,
  judgeSlotDrop,
  dropVerdictMessage,
  hitSlotAtPoint,
  REF_SLOT_META,
  type RefSlotKind,
} from './refSlots'
// 参考区合并 + 失效校验（纯函数，已单测）
import {
  mergeRefTiles,
  invalidRefHint,
  nextChipOrder,
  nameFromFileName,
  targetOfTile,
  uniqueNodeName,
  uploadToRefSlot,
  formatVideoDuration,
  videoOverLimit,
  type RefTarget,
  type RefTile,
  type TileCardLike,
} from './refTiles'
// Ctrl 拖资源到参考格：节点媒体判定 / 目标放行（纯函数，已单测）
import { nodeMediaOf } from './refSlotDrag'
import { judgeSlotHover } from './refSlotDrag'
import { canEnterCtrlDragMode, ctrlBlockedByEditable, enterCtrlDragMode, exitCtrlDragMode, registerStartDragHandler } from './ctrlDragMode'
import {
  clearCtrlSuppression,
  ctrlSuppressed,
  enterCtrlDragMode as unifiedEnterCtrlDragMode,
  exitCtrlDragMode as unifiedExitCtrlDragMode,
} from './selectionMode'

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
  // 与节点上已存的动作一致（含“没存过而这就是默认动作”的情况）时跳过：
  // 防止“选中节点 → 底栏挂载 → 选中集清空 → 底栏卸载”这条链路把**默认动作**写进
  // data.barValues（真实后果：新建文本节点后，页面上点一下空白处，撤销栈凭空多一条
  // “barValues.actionId=text.duplicate”，用户按一次 Ctrl+Z 撤销的不是自己的操作）。
  // 读 props.data 的**当前值**（Overlay 的 doc 订阅会在写盘后重读），既做“与现值一致就别再写”的
  // 防抖，也避免用挂载时刻的旧快照误判。
  const rawStored = ctx.tryGet<{
    getNode(id: string): { data?: Record<string, unknown> } | undefined
  }>('doc')?.getNode(props.id)?.data?.barValues as Record<string, unknown> | undefined
  const storedAction = storedActionId.value
  const onlyActionId =
    !rawStored || (Object.keys(rawStored).length > 0 && Object.keys(rawStored).every((k) => k === 'actionId'))
  if (storedAction === currentId.value && onlyActionId) {
    return
  }
  // 首次写入也只写“真正有内容”的动作：没有输入框的即时动作（复制/删除）在无参数时
  // 不落 barValues —— 否则每选中一次节点都会凭空多一条撤销记录（e2e 实测 2026-10-27）。
  if (!showEditor.value && Object.keys(values.value).length === 0) {
    return
  }
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
        /**
         * 富文本快照（用户 2026-10-27 报：「重开底栏后，文本转出来的标签变回文字」）。
         * 只存纯文本的话，重开时只能按文本重建，待输入标签认不出来 → 退化成文字，
         * 那串文字还会被当成「声明了第 N 格」，凭空长出一排空槽。存 JSON 才能原样还原。
         */
        ...(showEditor.value && promptDoc.value ? promptDocPersistFields(promptDoc.value) : {}),
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
// —— 提示词 ——
// 'text' 绑定（文本节点）与 data.text 双向；'none' 绑定（图片生成等）落 data.barPrompt，
// 这样底栏**重新挂载**（切画布/再点节点/任务跑完再回来）后内容还在，发送之后也还在。
// 用户报的「输入内容一下就全消失」根因就是这个：'none' 绑定从没写过节点 data。
const prompt = ref(initialPromptText(props.data))
/**
 * 富文本快照：**优先用它恢复**（用户 2026-10-27 报「重开底栏后标签变成文字」）。
 *
 * 纯文本恢复认不出「待输入」标签（@图片10 在连线表里查不到），标签就会退化成文字。
 * 存一份 doc JSON，重开时标签还是标签，也不会被误当成声明了第 10 格。
 */
const promptDoc = ref<unknown>(initialPromptDoc(props.data))
/**
 * 卸载前把攒着的那一拍落掉：用户打完字立刻点别处（底栏被收起 → 本组件卸载）时，
 * 400ms 防抖还没到点，不 flush 就会丢掉这次输入。
 *
 * 必须放在 prompt / promptDoc 之后：放前面会在卸载时读到未初始化的 ref（TDZ），
 * 整段保存抛错、富文本快照永远写不进去（真机踩过：重开还是纯文本）。
 */
onBeforeUnmount(() => {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  persistValues()
})


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
 * 用户拖出来的**卡片顺序**（标签 id 序列），存节点 `data.refOrder`。
 *
 * 用户口径（2026-10-12 / 2026-10-28）：顺序可以拖拽改变，只影响发给模型的先后，
 * **不影响标签绑定的对象**（标签认节点 id，排序改不了它）。
 *
 * 为什么落在节点 data：它是「这个节点准备怎么出图」的一部分，收起再点开、刷新、换设备都要在。
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
/** 视频缩略图：模块级缓存（跨挂载复用，拖拽不重截）。**一张图**管卡片/标签/hover */
const videoThumbTick = ref(0) // 取到新帧时 +1，驱动模板重算

function videoThumbOf(url: string | undefined): string | undefined {
  return peekVideoThumb(url)
}

/**
 * 参考卡该显示哪张图（用户 2026-10-28）。
 *
 * - 图片 / 文本类：直接用 url；
 * - 视频：mp4 地址不能当 img src（会渲染成空白），用插件取到的帧图（宽 ≤1080，CSS 缩小显示）；
 *   还没取到 → 返回空串，卡片回退成类型图标。
 * - 音频：没有可视化封面，返回空串 → 类型图标。
 */
function cardImageOf(tile: { url?: string; kind?: string | null }): string {
  void videoThumbTick.value // 依赖 tick：取到新帧时模板重算
  if (!tile.url) return ''
  if (tile.kind === 'video') return videoThumbOf(tile.url) ?? ''
  if (tile.kind === 'audio') return ''
  return tile.url
}

/**
 * 卡片图片的「没出来」状态（用户 2026-10-29：图没加载出来时给加载 UI，不要留空白）。
 *
 * loading：图正在取（转圈）；broken：取失败（显示「资源走丢」）。
 * 图片 load 成功就把这张卡从两张表里摘掉，恢复成正常缩略图。
 *
 * 注意：这两个表在模板里会被用到，而 watch 依赖 refTiles（定义在更后面），
 * 所以**监听器**放在 refTiles 之后注册（放这里会踩 TDZ，单测直接炸）。
 */
const loadingTiles = ref<Record<string, boolean>>({})
const brokenTiles = ref<Record<string, boolean>>({})
/** 已经确认加载成功的卡片（按卡片键记；防止素材重算后又进加载态） */
const imageReady = ref<Record<string, boolean>>({})

function clearBrokenTile(key: string): void {
  if (loadingTiles.value[key]) {
    const next = { ...loadingTiles.value }
    delete next[key]
    loadingTiles.value = next
  }
  if (brokenTiles.value[key]) {
    const next = { ...brokenTiles.value }
    delete next[key]
    brokenTiles.value = next
  }
  /**
   * 图真的出来了 → 记住这张卡已经 OK（用户 2026-10-29：加载完还转圈）。
   * 后面素材重算时凭这个记号跳过加载态。
   */
  imageReady.value = { ...imageReady.value, [key]: true }
}

function markBrokenTile(key: string): void {
  if (!loadingTiles.value[key]) return
  brokenTiles.value = { ...brokenTiles.value, [key]: true }
}

function videoProvider(): ((videoUrl: string, maxWidth?: number) => Promise<string | null>) | undefined {
  const svc = ctx.tryGet<{ captureThumb?(videoUrl: string, maxWidth?: number): Promise<string | null> }>('video')
  return svc?.captureThumb ? svc.captureThumb.bind(svc) : undefined
}

async function ensureVideoThumbs(): Promise<void> {
  const capture = videoProvider()
  if (!capture) return
  const urls = new Set<string>()
  for (const m of shownMaterials.value) {
    if (m.kind === 'video' && m.url) urls.add(m.url)
  }
  for (const url of urls) {
    if (peekVideoThumb(url)) continue
    const thumb = await ensureVideoThumb(url, capture)
    if (thumb) videoThumbTick.value += 1
  }
  /**
   * 视频帧取不到（浏览器不给解码 / 跨域 / 服务没回）：把这类卡标记成「走丢」，
   * 不要留一个永远转圈的加载态（用户 2026-10-29：没加载出来就给加载 UI，
   * 但取不到也要给出结论）。
   */
  for (const t of refTiles.value) {
    if (t.kind !== 'video') continue
    if (!t.url) continue
    if (loadingTiles.value[t.key] && !peekVideoThumb(t.url)) {
      brokenTiles.value = { ...brokenTiles.value, [t.key]: true }
    }
  }
}

/**
 * hover 预览用**同一张**帧图（用户 2026-10-28 第三轮：别再单独截一张）。
 * 缓存里已经有 1080 宽的大图，直接返回；没取到就现场取一次（同一份缓存）。
 */
async function ensureFullVideoThumb(url: string): Promise<string | undefined> {
  const hit = peekVideoThumb(url)
  if (hit) return hit
  const thumb = await ensureVideoThumb(url, videoProvider())
  if (thumb) videoThumbTick.value += 1
  return thumb ?? undefined
}
const shownMaterials = computed(() =>
  resolvedMaterials.value.length === materials.value.length ? resolvedMaterials.value : materials.value,
)
// 视频缩略图：必须放在 shownMaterials 之后（immediate 会同步执行，放前面会踩 TDZ）
watch(shownMaterials, () => void ensureVideoThumbs(), { immediate: true })
/**
 * 帧图取到后，@ 下拉/卡片要跟着换图。
 *
 * 为什么要单独听 tick：菜单是**按位置复用**的（同一个 menu-item 从「mp4 地址」换成
 * 「帧图」时 Vue 认为只是改了 props），若没有一次显式的数组更新，编辑器那边不会重渲染。
 * tick 变化 → editorResources 重算（新数组）→ 编辑器 watch(resources) 刷新菜单。
 */
watch(videoThumbTick, () => {
  void editorResources.value
})
const cards = computed(() => materialCards(shownMaterials.value))
/**
 * @ 下拉 / 卡片用的资源项。
 *
 * 第三个参数传「视频取帧」回调：视频行的缩略图必须是帧图（mp4 塞 `<img>` 会空白）。
 * 这里读缓存、不触发截帧（截帧由 ensureVideoThumbs 统一预热），避免下拉每开一次都解码。
 */
const editorResources = computed<ResourceItem[]>(() => {
  // tick 必须在**这里**读：放在 renderItem 回调里读不到（回调是渲染期才执行的，
  // 那时早过了依赖收集）。读在这里，首帧截好后整份资源数组重算 → 编辑器
  // 的 watch(props.resources) 收到新数组 → @ 下拉立刻换上帧图。
  void videoThumbTick.value
  return toEditorResources(shownMaterials.value, undefined, (url) => videoThumbOf(url))
})
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

/** 卡片点击 → 预览（参考图里卡片点开就是看大图） */
function openCard(card: TileCardLike): void {
  // 卡片只带最小形状；从 cards.value（MaterialCard 全量）补 kind/value：
  // 预览 kind 缺失会让 MediaViewer 认不出媒体类型 → stage 空白（真机踩过）。
  const full = cards.value.find((c) => c.id === card.id)
  const multi = previewListFor(cards.value, full ?? (card as MaterialCard))
  const kind = full?.isText ? 'text' : ((full?.kind ?? 'image') as 'image' | 'video' | 'audio')
  const url = full?.url ?? card.url
  /**
   * 全屏预览给**原始地址**：视频要能播（塞一张截图进去，播放器只会报「视频加载失败」）。
   * 「要看一帧原始截图」是 **hover** 的诉求，走 item.hoverPreview（见 refreshSlotChips）。
   */
  openPreview({
    name: full?.name ?? card.name,
    nodeId: card.id,
    kind,
    url,
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
function removeCard(nodeId: string): void {
  if (!nodeId) return
  /**
   * 用户 2026-10-29 重新定下的语义：**只断开连线**，绝不删提示词里的标签。
   *
   * 历史：上一版这里也只断线，但卡片仍挂在正文标签上，于是删完立刻变「失效红卡」
   * 继续留在原处 —— 用户以为删不掉。现在配套的规则是：
   *   · 关闭按钮 = 只断线（提示词一个字不动，标签自然变失效）；
   *   · 想彻底清掉 = 顶部「清理失效」（或自己在输入框删标签）。
   */
  const doc = ctx.tryGet<{
    removeEdges(ids: string[]): number
    getEdges?(): Array<{ id: string; source: string; target: string }>
  }>('doc')
  if (!doc) return
  /**
   * 先查渲染层的边，**再兜一次数据层**（用户 2026-10-29 报「点关闭没反应」）：
   * renderEdges 是 VueFlow 回灌的视图态，刚拖拽/刚连线那一拍可能还不全；
   * 视图态里没找到就直接问 doc，否则按钮看起来点了却没断开。
   */
  const ids = new Set<string>()
  for (const e of renderEdges.value) if (e.source === nodeId && e.target === props.id) ids.add(e.id)
  if (ids.size === 0) {
    for (const e of doc.getEdges?.() ?? []) if (e.source === nodeId && e.target === props.id) ids.add(e.id)
  }
  if (ids.size > 0) doc.removeEdges([...ids])
}

/**
 * 卡片区域 click 委托（捕获阶段）：vue-draggable 移动 DOM 会让子元素 Vue 绑定失联，
 * 所以在容器上统一分发 —— 删除按钮 / 预览按钮 / 待输入格点击都从这里走。
 *
 * **拖拽后吞点击**（用户 2026-10-29 报「关闭按钮点不动」）：拖拽库 force-fallback
 * 模式下，一次拖拽结束后下一次 click 会被它全局吞掉（Sortable 的 click eater）。
 * 对策：click 里区分「这次 pointer 序列刚拖完一张卡」——拖完的第一次点击不视为
 * 按钮点击，也不交给预览（那本来就是拖拽的余波），只有正常点击才走删除/预览。
 */
/** 最近一次真实拖拽结束的时刻与坐标（onReorderTiles / 拖拽库回调时更新） */
let lastDragEndAt = 0
let lastDragEndX = -1
let lastDragEndY = -1
/** 拖拽库的 end 回调：记录「刚拖完」（拖拽余波的那次 click 不当按钮点击） */
function onDragEndMark(payload: Event): void {
  lastDragEndAt = Date.now()
  const oe = (payload as { originalEvent?: MouseEvent | TouchEvent } | undefined)?.originalEvent
  const point = oe && 'clientX' in oe ? oe : (oe as TouchEvent | undefined)?.changedTouches?.[0]
  lastDragEndX = point?.clientX ?? -1
  lastDragEndY = point?.clientY ?? -1
}
/** click 是否属于刚结束的那次拖拽（300ms 内、同位置附近） */
function clickAfterDrag(ev: MouseEvent): boolean {
  if (Date.now() - lastDragEndAt > 350) return false
  const dx = Math.abs(ev.clientX - lastDragEndX)
  const dy = Math.abs(ev.clientY - lastDragEndY)
  return dx < 6 && dy < 6
}
/**
 * 关闭按钮走 **pointerdown**（用户 2026-10-29 报「点关闭没反应」）。
 *
 * 为什么不能只靠 click：拖拽库（Sortable）在 fallback 拖拽结束后会全局吞掉**下一次 click**
 * （它的 click eater 用 stopImmediatePropagation，比元素上的监听更早）。
 * pointerdown 不在它吞的范围内，所以删除动作放在这里最稳；
 * 键盘（Enter/Space）触发的 click 没有 pointerdown，下面的 click 分支继续兜。
 */
let removeViaPointerAt = 0
function onRemovePointerDown(tile: RefTile): void {
  if (!tile.nodeId) return
  removeViaPointerAt = Date.now()
  removeCard(tile.nodeId)
}
function onCardsClickCapture(ev: MouseEvent): void {
  ;(window as any).__capDbg = { target: (ev.target as HTMLElement)?.className?.toString().slice(0, 40), t: Date.now() }
  // 已经由 pointerdown 删掉了（同一个手势的后续 click）：不重复处理
  if (Date.now() - removeViaPointerAt < 600) {
    ev.stopPropagation()
    ev.preventDefault()
    return
  }
  if (clickAfterDrag(ev)) {
    ev.stopPropagation()
    ev.preventDefault()
    return
  }
  const target = ev.target as HTMLElement | null
  if (!target) return
  const card = target.closest<HTMLElement>('.nb-card')
  if (!card) return
  const key = card.getAttribute('data-tile-key') ?? ''
  const tile = refTiles.value.find((t) => t.key === key)
  if (target.closest('.nb-remove')) {
    ev.stopPropagation()
    /**
     * 正常点击走 click；但如果这颗按钮在 pointerdown 已经删过（见 onRemovePointerDown），
     * 这里不再重复删（重复删会对着已消失的边报错）。
     */
    if (tile?.nodeId && Date.now() - removeViaPointerAt > 600) removeCard(tile.nodeId)
    return
  }
  // 待绑定卡：卡片本体点击 = 点上传
  if (tile?.pending) {
    ev.stopPropagation()
    pickSlotFile(tile)
    return
  }
  /**
   * 有内容的卡：**整张卡都能点开预览**（用户 2026-10-28：「除了右上角关闭按钮，
   * 点哪里都应该进全屏」）。以前只认那个铺满的透明按钮 —— 它被缩略图/序号角标盖住的
   * 位置，点击会落到那些元素上，于是「时灵时不灵」。现在只要不在关闭按钮里就开预览。
   */
  if (tile && !tile.invalid) {
    ev.stopPropagation()
    openCard({
      id: tile.nodeId ?? tile.key,
      name: tile.label,
      kind: tile.kind ?? 'image',
      ...(tile.url ? { url: tile.url } : {}),
    })
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
const canRun = computed(() => !running.value && !!currentAction.value && !invalidHint.value)

/**
 * 参考序号是否连续（用户口径 2026-10-25：「你只传了一张图，并且声明的是\"图片 2\"，这就存在问题…
 * 在这种情况下，是不允许你点击发送按钮的」）。
 *
 * 规则：正文里出现 `@图片N` 时，1..N 必须全部有内容。缺任何一格 = 引用悬空（模型会拿到空引用），
 * 发送按钮禁用并给出明确原因。没写任何 @ 标签时不受影响（普通参考图照旧）。
 */
/**
 * 失效引用提示（用户 2026-10-28）：绑定的节点被删 / 被断开 / 老格式标签 → 禁止发送。
 * 文案由纯函数生成，卡片行与发送按钮旁共用同一份。
 */
const invalidHint = computed(() => invalidRefHint(refTiles.value))
/** 失效的卡片（「清理失效」按钮与提示文案共用） */
const invalidTiles = computed(() => refTiles.value.filter((t) => t.invalid))

/**
 * 「清理失效」（用户 2026-10-29）：删掉输入框里对应的失效标签，卡片随之消失。
 *
 * 这是**唯一**会删提示词内容的操作，所以：
 *   · 只在真有失效卡时才出现；
 *   · 先确认（用户写下的文字不该被一次误点抹掉）；
 *   · 只删失效那几颗，别的标签与正文一个字不动。
 */
function clearInvalidRefs(): void {
  const ids = invalidTiles.value.map((t) => t.key).filter(Boolean)
  if (ids.length === 0) return
  const ok = typeof window === 'undefined'
    ? true
    : window.confirm('会从提示词里删除 ' + ids.length + ' 个失效引用（正文其它内容不动），继续？')
  if (!ok) return
  const removed = editorComponentRef.value?.removeRefChips?.(ids) === true
  if (!removed) return
  // 编辑器已发 update:promptDoc（异步回填）：等一拍再清 refOrder 里这些死键
  void nextTick().then(() => {
    const alive = new Set(promptChips.value.map((c) => c.id))
    const order = refOrder.value.filter((k) => alive.has(k))
    try {
      ctx.get('doc').updateNode(props.id, { data: { refOrder: order } })
    } catch { /* 节点已不在：忽略 */ }
    refreshSlotChips()
  })
}

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

/**
 * 底栏本体是否真的显示（与模板 v-if 同一份条件）。
 * Ctrl 选择态只认这个 —— 不能认画布上的 `.nb-overlay` 外壳：
 * 可视化节点没有任何底栏动作，外壳仍在、本体不渲染（用户 2026-10-27 报的误触）。
 *
 * 放在 submitted 之后定义：computed 初始化时就会读依赖，放前面会踩 TDZ。
 */
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

{
  // debug
  // aiPhase.value = "starting"
  // aiEditorLocked.value = true
}

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

// ===== 参考标签 / 参考卡片（用户 2026-10-28 定案：认节点、认名称）=====
//
// 卡片 = 正文里的一颗标签；标签记的是**节点 id**，显示的是**节点名称**。
// 空壳卡片（手打还没绑定）拖入节点 = 添加；有内容的卡片拖入节点 = 替换（换绑，名字跟着换）。
// 序号角标只用来观察当前顺序，不参与任何判定。

/** 正文里的参考标签（只认富文本标签节点；手打的 @名字 文字不算） */
const promptChips = computed(() => refChipsFromDoc(promptDoc.value))

/** 参考区卡片行（顺序 = refOrder；绑定失效的会标 invalid，禁止发送） */
const refTiles = computed(() =>
  mergeRefTiles(
    promptChips.value,
    shownMaterials.value.map((m) => ({
      id: m.id,
      name: m.name,
      kind: m.kind === 'image' || m.kind === 'video' || m.kind === 'audio' || m.kind === 'text' ? m.kind : 'image',
      url: m.url,
      value: m.value,
      ...(m.duration ? { duration: m.duration } : {}),
    })),
    refOrder.value,
  ),
)

/**
 * 卡片出现（或图地址变了）就进入加载态；**13 秒**既不 load 也不 error 也按失败处理
 * （与生成历史墙同口径：不留永远转圈的假象）。
 *
 * 必须放在 refTiles 之后：immediate 会当场读 refTiles，放前面就是 TDZ。
 */
watch(
  () => refTiles.value.map((t) => [t.key, cardImageOf(t)].join('|')).join(','),
  () => {
    const next: Record<string, boolean> = {}
    for (const t of refTiles.value) {
      /**
       * 只有**视频**才需要「等帧图」的加载态（用户 2026-10-29）：
       * 图片 / 音频 / 文本要么立刻有图、要么直接给类型图标，转圈反而像出 bug。
       */
      if (t.kind !== 'video') continue
      if (!cardImageOf(t)) continue
      if (brokenTiles.value[t.key]) continue
      /**
       * 帧图已经取到就不再进加载态（用户 2026-10-29：「图都出来了还转圈」）：
       * 素材重算（resolve / 排序 / 换帧）会让这个 watch 重跑；若一律置 true，
       * 浏览器复用缓存的帧图不再触发 load，就永远关不掉转圈。
       */
      if (t.url && videoThumbOf(t.url)) continue
      next[t.key] = true
    }
    loadingTiles.value = next
    for (const key of Object.keys(next)) {
      setTimeout(() => {
        if (loadingTiles.value[key]) {
          brokenTiles.value = { ...brokenTiles.value, [key]: true }
        }
      }, 13000)
    }
  },
  { immediate: true },
)


/** 错误提示按卡片键记（拖拽/上传失败的即时提示） */
const slotErrors = ref<Record<string, string>>({})
/** 某张卡片的错误文案 */
function slotErrorOf(tile: { key: string }): string {
  return slotErrors.value[tile.key] ?? ''
}

/**
 * 卡片提示文案（用户 2026-10-29：hover / 拖拽都要有 tooltip，不要浏览器原生 title）。
 *
 * 三种状态说清楚「这是什么 / 现在能不能用」：
 *   · 失效：原名 + 引用已失效（在提示词里删掉，或用「清理失效」）；
 *   · 空壳：名称 + 待添加；
 *   · 正常：名称 + 类型 + 时长（视频）。
 */
function cardTooltip(tile: RefTile): string {
  if (tile.invalid) return '「' + tile.label + '」引用已失效'
  if (tile.pending) return '「' + tile.label + '」待添加：拖节点或点它上传'
  const kindLabel =
    tile.kind === 'video' ? '视频'
    : tile.kind === 'audio' ? '音频'
    : tile.kind === 'text' ? '文本'
    : tile.kind === 'image' ? '图片' : '素材'
  const duration = tile.kind === 'video' ? formatVideoDuration(tile.duration) : ''
  return '「' + tile.label + '」' + kindLabel + (duration ? ' · ' + duration : '') + '（可拖动调整顺序）'
}

/**
 * 卡片的 hover 提示：走主题 Tooltip（用户 2026-10-29）。
 *
 * 为什么不用原生 title：浏览器会延迟 1 秒、样式灰扑扑，跟整体 UI 不搭。
 * 这里用一个受控 Tooltip（只包一张卡），hover 哪张就显示哪张的文案；
 * 拖拽时指针被拖拽库接管，hover 不触发 —— 那条路走 tip 服务（见 startCtrlDrag）。
 */
const hoverCard = ref<RefTile | null>(null)
/** Tooltip 的定位锚点（跟着鼠标下那张卡走） */
const cardTipAnchor = ref<HTMLElement | null>(null)
function moveTipAnchor(tile: RefTile): void {
  const el = cardTipAnchor.value
  const card = document.querySelector<HTMLElement>('.nb-shell .nb-card[data-tile-key="' + tile.key + '"]')
  if (!el || !card) return
  const r = card.getBoundingClientRect()
  /**
   * 锚点**盖满这张卡**（不是 1px 的点）：主题 Tooltip 是按触发元素矩形算位置的，
   * 尺寸对得上，气泡才会正好贴在卡片下方、水平居中。
   * 它 pointer-events:none，不挡卡片的点击 / 拖拽；hover 事件由卡片自己转发。
   */
  el.style.left = Math.round(r.left) + 'px'
  el.style.top = Math.round(r.top) + 'px'
  el.style.width = Math.round(r.width) + 'px'
  el.style.height = Math.round(r.height) + 'px'
}
function onCardEnter(tile: RefTile): void {
  hoverCard.value = tile
  moveTipAnchor(tile)
  /**
   * 把 hover 转给 Tooltip 自己的触发器（用户 2026-10-29：要主题 Tooltip，不要原生 title）。
   * 卡片不能直接包在 Tooltip 里：拖拽库要求直接子元素就是卡片，多包一层会破坏排序。
   * 所以这里用锚点当替身，收到 hover 就替它把 mouseenter 发一遍。
   */
  void nextTick().then(() => {
    const dot = cardTipAnchor.value
    /**
     * mouseenter **不冒泡**：必须派发给 Tooltip 自己的根节点（.tlt-root），
     * 派给里面的 dot 是没用的（Vue 的 @mouseenter 挂在根上）。
     */
    const root = dot?.closest('.tlt-root')
    root?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
  })
}
function onCardLeave(tile: RefTile): void {
  if (hoverCard.value?.key === tile.key) hoverCard.value = null
  cardTipAnchor.value?.closest('.tlt-root')
    ?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
}

/**
 * 卡片行拖拽排序（用户 2026-10-28：序号角标只做观察，排序**不影响**标签绑定）。
 *
 * 落盘的是**标签 id 序列**（ref-node:<id> / ref-name:<名>）：它只决定发给模型的先后，
 * 标签仍然指着同一个节点，名字也不会变。这是「拖拽不影响标签」的实现点。
 */
function onReorderTiles(next?: Array<{ key?: string }>): void {
  const ids = nextChipOrder(refOrder.value, refTiles.value, next)
  if (!ids) return
  try {
    ctx.get('doc').updateNode(props.id, { data: { refOrder: ids } })
  } catch {
    /* 节点已不在等情况：忽略 */
  }
}

const editorComponentRef = ref<{
  insertResource?(item: ResourceItem): void
  replaceResource?(item: ResourceItem): boolean
  /** 按 id 列表换缩略图（只用于清理旧图；新模型下标签名字跟着节点走，不再按序号换） */
  replaceResourceThumbByIds?(ids: readonly string[], url: string): boolean
  refreshChips?(): void
  /** 把正文里的 @名称 文字转成参考标签（「标记」按钮调用） */
  markRefSlots?(): number
  /** 按标签 id 删除正文里的参考标签（「清理失效」用，用户 2026-10-29） */
  removeRefChips?(ids: readonly string[]): boolean
  /** 读出正文纯文本（转换后立即同步到 prompt，避免落库的还是旧文本） */
  exportText?(): string
  /** 动态切可编辑态（AI 生成期间锁输入用；bundle 侧 view.editable 布尔位） */
  setEditable?(next: boolean): void
} | null>(null)

/** 点空壳卡片：选一个本地文件，建节点并绑定到这张卡（添加） */
function pickSlotFile(tile: RefTile): void {
  const target = targetOfTile(tile)
  const kind: RefSlotKind = tile.kind ?? 'any'
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = REF_SLOT_META[kind].accept
  input.style.display = 'none'
  document.body.appendChild(input)
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) void fillSlotFromFile(kind, file, target)
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
async function fillSlotFromFile(kind: RefSlotKind, file: File, target?: RefTarget): Promise<void> {
  const errKey = target?.previousChipId ?? ''
  const verdict = judgeSlotDrop(kind, { file })
  if (!verdict.ok) {
    setSlotError(errKey, dropVerdictMessage(kind, verdict))
    return
  }
  const fileDrop = ctx.tryGet<{
    addFiles(files: File[], atFlow: { x: number; y: number } | null): Promise<number>
  }>('file-drop')
  if (!fileDrop) {
    setSlotError(errKey, '当前宿主没有文件落库能力，无法建参考节点')
    return
  }
  const doc = ctx.tryGet<{
    getNode(id: string): { type?: string; data?: Record<string, unknown>; position?: { x: number; y: number }; width?: number } | undefined
    getNodes(): Array<{ id: string; type?: string; data?: Record<string, unknown> }>
    addEdge(input: { source: string; target: string }): string
    updateNode(id: string, patch: { data: Record<string, unknown> }): void
  }>('doc')
  if (!doc) { setSlotError(errKey, '当前宿主没有连线能力'); return }
  const me = doc.getNode(props.id)
  const base = me?.position ?? { x: 0, y: 0 }
  const w = Number(me?.width) || 320
  try {
    // 上传前抓一次全部节点 id：pickCreated 用它区分「这次新建的节点」。
    const idsBeforeUpload = new Set(doc.getNodes().map((n) => n.id))
    const result = await uploadToRefSlot(
      { file, targetId: props.id },
      {
        addFiles: (files, at) => fileDrop.addFiles(files, at),
        waitTick: () => nextTick(),
        afterCreate: () => {
          // file-drop 建完会把选中改成新节点；底栏挂在原节点上，必须还回去
          try { ctx.tryGet<{ set(ids: string[]): void }>('selection')?.set([props.id]) } catch { /* 忽略 */ }
        },
        addEdge: (source, target) => {
          try { return doc.addEdge({ source, target }) } catch { return null }
        },
        pickCreated: () => {
          // 为什么不能到 shownMaterials 里找：素材是**按边**收集的（collectUpstreamMaterials），
          // 而此刻连线还没建 —— 新节点根本不在里面，永远找不到 → 提前 return（这就是
          // 「上传只建节点、没连线」的根因）。这里直接查 doc：file-drop 刚建的那个新节点。
          const freshNode = doc.getNodes().find((n) => !idsBeforeUpload.has(n.id) && n.id !== props.id)
          if (!freshNode) return null
          const d = freshNode.data ?? {}
          const s = (v: unknown) => (typeof v === 'string' && v ? v : '')
          const url = s(d.imageUrl) || s(d.videoUrl) || s(d.audioUrl)
          /**
           * 名称取**真实文件名**（用户 2026-10-28：标签要用名称，别再是「图片 3」）。
           * file-drop 建节点时写的是类型默认名，这里改成文件名并保证画布内唯一
           * （名称唯一是标签能按名字匹配的前提）。
           */
          const taken = doc.getNodes()
            .filter((n) => n.id !== freshNode.id)
            .map((n) => (typeof n.data?.label === 'string' ? n.data.label : ''))
          const name = uniqueNodeName(nameFromFileName(file.name), taken)
          try { doc.updateNode(freshNode.id, { data: { label: name } }) } catch { /* 忽略 */ }
          return { id: freshNode.id, name, url }
        },
        positionFor: () => ({ x: base.x - w - 24, y: base.y }),
      },
    )
    if (!result.ok) { setSlotError(errKey, result.error ?? '上传失败'); return }
    // 标签换成新节点：添加 / 替换同一条路（用户 2026-10-28：替换后名字跟着新节点走）
    if (result.created) bindChipToNode(target, result.created.id, result.created.name)
    refreshSlotChips()
  } catch (err) {
    console.warn('[bottom-bar] 上传参考失败', err)
    setSlotError(errKey, '上传失败，请重试')
  }
}

/**
 * 把正文里的标签**换绑**到某个节点（用户 2026-10-28：添加 / 替换同一条路）。
 *
 * - 空壳卡（ref-name:名字）→ 换成 ref-node:<id>，名字变节点名（添加）；
 * - 已有内容的卡（ref-node:旧id）→ 换成 ref-node:<新id>，名字跟着换（替换）。
 *
 * 为什么必须改 id：标签的身份就是「绑定了谁」，只改显示名下次刷新会被旧节点拉回去。
 */
function bindChipToNode(target: RefTarget | undefined, nodeId: string, name: string): void {
  const material = shownMaterials.value.find((m) => m.id === nodeId)
  const item: ResourceItem = {
    id: refNodeChipId(nodeId),
    name,
    category: '素材',
    ...(material ? { chipKind: material.kind as 'image' | 'video' | 'audio' | 'text' } : {}),
    ...(material?.url ? { url: material.url } : {}),
    ...(material?.value ? { value: material.value } : {}),
    ...(target?.previousChipId ? { previousId: target.previousChipId } : {}),
  }
  const replaced = target?.previousChipId
    ? editorComponentRef.value?.replaceResource?.(item) === true
    : false
  // 正文里没有这颗标签（例如从 @ 下拉直接拖进来）：补一颗，别让用户以为拖丢了
  if (!replaced) editorComponentRef.value?.insertResource?.(item)
  // 顺序：新标签顶替旧标签的位置（没有旧标签就追加）
  const order = placeChipAt(refOrder.value, target?.previousChipId, nodeId)
  try {
    ctx.get('doc').updateNode(props.id, { data: { refOrder: order } })
  } catch { /* 节点已不在等情况：忽略 */ }
}

/** 错误按卡片键记，几秒后自动消失 */
function setSlotError(key: string, message: string): void {
  if (!key) return
  slotErrors.value = { ...slotErrors.value, [key]: message }
  setTimeout(() => {
    const next = { ...slotErrors.value }
    delete next[key]
    slotErrors.value = next
  }, 2600)
}

/**
 * 「标记」按钮：把输入框里手写的 @图片1 / @视频2 这类**文字**转成素材标签
 *（用户口径 2026-10-27：文字不自动解析，只有点这个按钮才解析）。
 *
 * 转完再刷一遍标签外观：新标签的缩略图 / 待输入虚线来自注册表。
 */
function markRefSlotsInPrompt(): void {
  const ed = editorComponentRef.value
  if (!ed?.markRefSlots) return
  const count = ed.markRefSlots()
  if (count <= 0) return
  /**
   * 编辑器转完后正文变了，但底栏的 prompt 是**另一份 ref**（v-model 回填有时序延迟）。
   * 这里直接按新正文同步一次：否则落库的仍是转换前的 @图片1 纯文本，
   * 重开底栏又变回文字（真机踩过）。
   */
  // 等一拍：编辑器 dispatch 之后 v-model 的回填是异步的，此刻读 prompt 还是旧值
  void nextTick().then(() => {
    const nextText = ed.exportText?.()
    if (typeof nextText === 'string' && nextText !== prompt.value) prompt.value = nextText
    persistValues()
    refreshSlotChips()
  })
}
/**
 * 粘贴图片：走和点击上传**同一条**路（用户口径 2026-10-27）。
 *
 * 三步缺一不可：
 *   ① fillSlotFromFile：建节点 + 连参考线（复用现成链路）；
 *   ② 在光标处插入标签（refreshChips 只刷已有标签，**不会新建**）；
 *   ③ 刷新外观（新标签拿到缩略图 / 待输入虚线）。
 *
 * 返回 false 时编辑器走默认粘贴（例如粘的是文本、或宿主没有建节点能力）。
 */
async function onPasteFiles(
  files: File[],
  ctx: { insert(item: ResourceItem): void },
): Promise<boolean> {
  const image = files.find((f) => f.type.startsWith('image/'))
  if (!image) return false
  /**
   * 顺序对调（用户 2026-10-28 报「粘贴后没插入标签」）：
   * **先插标签，再异步建节点连线。**
   *
   * 为什么不能反过来：fillSlotFromFile 内部会把选中还给原节点并触发底栏刷新，
   * 编辑器的 view 可能在异步间隙被销毁——等我们再调 ctx.insert 时 dispatch 直接抛错，
   * 异常被编辑器的 void handler(...) 吞掉，于是「节点有了、连线有了，标签没有」。
   * 先插标签时编辑器一定还活着（用户刚粘贴完焦点就在这里）。
   */
  const pendingName = image.name || '粘贴的图片'
  const pendingId = refNameChipId(pendingName)
  ctx.insert({ id: pendingId, name: pendingName, category: '素材' })
  // 建节点 + 连线放后台：不阻塞标签插入
  void fillSlotFromFile('image', image, { previousChipId: pendingId, pendingName })
    .then(() => refreshSlotChips())
    .catch(() => { /* 上传失败不回滚标签（用户可手动删）；错误已在 slotErrors 提示 */ })
  return true
}


/**
 * 正文标签刷新（用户 2026-10-28：标签认节点、显示节点名称）。
 *
 * 卡片行已经算好了每颗标签「现在该是什么样」：
 *   - 已绑定：名字 = 节点名（节点改名后自动跟上）、类型 = 节点真实类型、缩略图 = 节点资源；
 *   - 待绑定：统一资源图标；
 *   - 失效：灰掉（禁止发送）。
 * 这里把这份外观登记进编辑器，并把**名字变化同步进文档**（导出给模型的提示词才跟着变）。
 */
function refreshSlotChips(): void {
  try {
  if (typeof window === 'undefined') return
  ;(window as any).__chipRuns = ((window as any).__chipRuns || 0) + 1
  // SSR / 编辑器未挂载时跳过（只影响标签 UI，不影响数据）
  if (typeof document === 'undefined') return
  if (!editorComponentRef.value) return
  for (const tile of refTiles.value) {
    try {
      if (tile.invalid) {
        // 失效：只改外观（灰掉），文档里的身份保留 —— 用户删掉或重新拖入即可
        registerItem({
          id: tile.key,
          name: tile.label,
          category: '素材',
          invalid: true,
          /**
           * 失效标签**不许再带着旧缩略图/类型**（用户 2026-10-29：图片 18 / 泳装少女
           * 已经失效，输入框里却还显示旧缩略图，看着像还在用）。
           * 不给 url、不给 chipKind：渲染出来就是灰掉 + 通用资源图标。
           */
          chipKind: undefined,
          url: '',
        })
        // 文档里那颗标签的属性也要清掉旧图和类型（否则下次重渲染又从 attrs 里捡回来）
        editorComponentRef.value?.replaceResource?.({
          id: tile.key,
          name: tile.label,
          category: '素材',
          invalid: true,
          chipKind: undefined,
          url: '',
        })
        continue
      }
      if (tile.pending || !tile.nodeId) {
        // 待绑定：统一资源图标（不猜类型，用户 2026-10-28 口径）
        registerItem({
          id: tile.key,
          name: tile.label,
          category: '素材',
        })
        continue
      }
      const kind = tile.kind ?? undefined
      const url = kind === 'video' ? (videoThumbOf(tile.url) ?? '') : (tile.url ?? '')
      const item: ResourceItem = {
        id: refNodeChipId(tile.nodeId),
        name: tile.label,
        category: '素材',
        ...(kind ? { chipKind: kind } : {}),
        ...(url ? { url } : {}),
        ...(tile.value ? { value: tile.value } : {}),
        ...(kind === 'video' && tile.url
          ? { hoverPreview: () => ensureFullVideoThumb(tile.url as string) }
          : {}),
      }
      registerItem(item)
      // 名字/缩略图同步进文档：导出的提示词、复制出去的内容都跟着节点走
      editorComponentRef.value?.replaceResource?.({
        ...item,
        name: tile.label,
      })
    } catch (err) {
      ;(window as any).__chipErr = { tile: tile.key, msg: String(err), stack: (err as Error)?.stack?.slice(0, 500) }
    }
  }
  // 外观变了（名字/缩略图/失效态）→ 让 ProseMirror 重画一次
  editorComponentRef.value?.refreshChips?.()
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
  // 与 SlotMedia 同形（text 也能拖，见 nodeMediaOf；text 只有名字没有媒体地址）
  mediaType: 'image' | 'video' | 'audio' | 'text'
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

/** Ctrl 按下（**本节点的底栏真的显示**）→ 进入选择态（画布出高亮/角标/提醒，复刻参考选择）。
 *  松开 Ctrl → 退出。选择态与影子拖拽是两个独立层：选择态是「预告」，拖拽是动作。
 *  注意：不能查 `.nb-overlay` —— 它是画布级外壳，任何单选节点都有；可视化节点没有
 *  底栏动作、本体不渲染，但外壳照样在，查外壳就会误触（用户 2026-10-27 实测）。 */
function onCtrlModeKeydown(ev: KeyboardEvent): void {
  /**
   * 可编辑区保护：输入框里的 Ctrl 是文本快捷键，不该抢。
   *
   * 但**底栏自己的输入框要放行**（用户 2026-10-28 实测）：点节点后正文编辑器会自动聚焦，
   * 若一并拦掉，底栏开着按 Ctrl 永远进不了拖拽模式 —— 用户看到的就是「按 Ctrl 没反应」。
   * 底栏输入框在独立浮层里，进拖拽不会吞掉 Ctrl+A 这类文本快捷键（我们也不 preventDefault）。
   */
  const el = ev.target instanceof HTMLElement ? ev.target : null
  const editableTarget = ctrlBlockedByEditable({
    inEditable: !!el?.closest('input, textarea, select, [contenteditable="true"]'),
    inBottomBar: !!el?.closest('.nb-root, .nb-overlay'),
  })
  if (!canEnterCtrlDragMode({
    key: ev.key,
    repeat: ev.repeat,
    barShown: barShown.value,
    editableTarget,
  })) return
  //「返回节点」刚把拖拽收掉、Ctrl 还没松 → 这一路 keydown 不再自动拉回拖拽（松手自动解除）
  if (ctrlSuppressed()) return
  // 按住 Ctrl 时已在参考模式 → 只临时切到拖拽（参考保留在下面，松手自动回来）
  clearCtrlSuppression()
  unifiedEnterCtrlDragMode(props.id)
}
function onCtrlModeKeyup(ev: KeyboardEvent): void {
  if (ev.key !== 'Control') return
  clearCtrlSuppression()
  unifiedExitCtrlDragMode()
}

/** 拖拽启动：由 NodeSelectOverlay 覆盖层经**对象数据通道**调起（props.id/props.data），
 *  不再走 window pointerdown + DOM closest 判定 —— DOM 判定会误触节点选中。 */
function startCtrlDrag(nodeId: string, ev: PointerEvent): void {
  const doc = ctx.tryGet<{ getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined }>('doc')
  const media = nodeMediaOf(doc?.getNode(nodeId))
  if (!media) return
  // text 没有媒体地址可填格（nodeMediaOf 的 text 分支只带名字）—— Ctrl 拖不放行
  if (media.mediaType === 'text') return
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
  /**
   * 拖拽悬停时**每经过一个格子都按类型判断**（用户 2026-10-28）：
   * 匹配 → 高亮（is-target）；不匹配 → 不高亮，并出 tip 说明格子收什么、拖的是什么。
   */
  if (key && key !== ctrlDrag.targetTileKey) {
    const tile = refTiles.value.find((t) => t.key === key)
    const slotKind = (tile?.kind ?? 'any') as RefSlotKind
    const verdict = judgeSlotHover({ kind: slotKind ?? 'image', media: ctrlDrag.mediaType })
    if (!verdict.ok) ctx.get<{ show(m: string): void; hide(): void }>('tip').show(verdict.hint)
    else ctx.tryGet<{ hide(): void }>('tip')?.hide()
  }
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
  // Ctrl 拖也是一次「拖拽余波」来源：落点附近的下一次 click 不当作按钮点击
  if (drag) {
    lastDragEndAt = Date.now()
    lastDragEndX = ev.clientX
    lastDragEndY = ev.clientY
  }
  if (drag?.targetTileKey) document.querySelector('.nb-card[data-tile-key="' + drag.targetTileKey + '"]')?.classList.remove('is-target')
  drag?.ghost?.remove()
  if (!drag || !drag.targetTileKey) return
  // 松手点 = 落在参考格上的（用户松手那一刻鼠标在哪，替换就在哪）
  const dropHost = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.nb-card') as HTMLElement | null
  if (dropHost?.dataset.tileKey) drag.targetTileKey = dropHost.dataset.tileKey
  const tile = refTiles.value.find((t) => t.key === drag.targetTileKey)
  /**
   * 松手前**最后一道闸**（用户 2026-10-28）：落点卡片类型不匹配 → 只给提示，不落。
   * 空壳卡（`any`）什么都收；已绑定卡按节点真实类型判断。
   */
  if (tile) {
    const slotKind = (tile.kind ?? 'any') as RefSlotKind
    const verdict = judgeSlotHover({ kind: slotKind, media: drag.mediaType })
    if (!verdict.ok) {
      ctx.get<{ show(m: string): void; hide(): void }>('tip').show(verdict.hint)
      return
    }
  }
  if (!tile) return
  // 添加 / 替换同一条路：把这张卡换绑到拖进来的节点（名字自动跟着换）
  void bindTileToNode(tile, drag.nodeId, drag.name)
}

onMounted(() => {
  // 把底栏的标签规格交给编辑器（用户 2026-10-27：标签实现交给插件，编辑器不再写死规则）
  /**
   * 标签规格按**名称**识别（用户 2026-10-28）。
   *
   * 传一个 getter：素材随连线/改名变化，scan 每次执行时现取，
   * 不能把挂载那一刻的数组冻进去（否则新连进来的节点永远 @ 不出来）。
   */
  registerTagSpec(bottomBarTagSpecFor(() => shownMaterials.value))
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
  // 卸掉自己的标签规格，避免影响别的插件/编辑器的默认行为
  registerTagSpec(null)
  // 底栏消失 = 两个选择态都收（用户口径 2026-10-26：覆盖层要跟底栏同步消失）。
  // 参考选择与 Ctrl 拖是挂在节点上的覆盖层，底栏走了它们就失去操作对象。
  unifiedExitCtrlDragMode()
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
async function bindTileToNode(tile: RefTile, nodeId: string, name: string): Promise<void> {
  const target = targetOfTile(tile)
  const doc = ctx.tryGet<{
    getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined
    addEdge(input: { source: string; target: string }): string
    removeEdges(ids: string[]): number
    getEdges?(): Array<{ id: string; source: string; target: string }>
    updateNode(id: string, patch: { data: Record<string, unknown> }): void
  }>('doc')
  if (!doc) return
  try {
    /** 要断开的线：同一节点重复连进来的 + 被替换掉的旧节点那条 */
    const stale: string[] = []
    for (const e of renderEdges.value) {
      if (e.target !== props.id) continue
      if (e.source === nodeId) stale.push(e.id)
      else if (target.oldNodeId && e.source === target.oldNodeId) stale.push(e.id)
    }
    if (stale.length) doc.removeEdges([...new Set(stale)])
    // 空壳卡（没有旧节点）与替换都要把新节点连进来；已经连着就不重复连
    if (target.oldNodeId !== nodeId) {
      try { doc.addEdge({ source: nodeId, target: props.id }) } catch { /* 已存在等：忽略 */ }
    }
    // 正文标签换绑 + 改名字（用户 2026-10-28 的核心诉求）
    bindChipToNode(target, nodeId, name)
    slotErrors.value = {}
    // 等一拍：素材按边收集，连线刚写入 doc、渲染层还没回灌（真机踩过）
    await nextTick()
    await new Promise((r) => setTimeout(r, 300))
    refreshSlotChips()
  } catch (err) {
    console.warn('[bottom-bar] 绑定参考失败', err)
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
  if (!tile) return
  // 拖文件到卡片 = 绑定到这张卡（空卡是添加、有内容是替换）
  void fillSlotFromFile(tile.kind ?? 'any', file, targetOfTile(tile))
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
    v-if="barShown"
    class="nb-shell"
    :class="{ 'is-expanded': expanded }"
    :style="expanded ? { zIndex: LAYERS.nodeToolbar + 1 } : undefined"
    @pointerdown.self="expanded = false"
  >
    <div
      class="nb-root nodrag nopan"
      :class="{ 'is-expanded': expanded, 'is-ai-locking': aiEditorLocked }"
      :style="expanded ? undefined : panelStyle"
      :role="expanded ? 'dialog' : undefined"
      :aria-modal="expanded ? 'true' : undefined"
      data-testid="node-bottom-bar"
      @pointerdown.stop
    >
    <!--
      卡片 hover 提示（用户 2026-10-29）：用主题 Tooltip，不用浏览器原生 title。
      只包外壳一行 —— 放在卡片列表的**紧邻父级**，位置按鼠标下那张卡算。
    -->
    <div class="nb-card-tip-anchor" aria-hidden="true">
      <Tooltip
        :content="hoverCard ? cardTooltip(hoverCard) : ''"
        :disabled="!hoverCard"
        placement="bottom"
      >
        <span ref="cardTipAnchor" class="nb-card-tip-dot" />
      </Tooltip>
    </div>
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
        class="nb-pill"
        type="button"
        :title="'标记：把输入框里的 @图片1 这类文字转成素材标签'"
        data-testid="bar-mark"
        @click.stop="markRefSlotsInPrompt"
      >
        <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_TAG" />
        <span>标记</span>
      </button>
      <!--
        「清理失效」（用户 2026-10-29）：唯一会动**提示词**的批量操作。
        只在真有失效卡片时出现；点之前二次确认（删的是用户写下的引用文字）。
      -->
      <button
        v-if="!expanded && invalidTiles.length > 0"
        class="nb-pill nb-pill--danger"
        type="button"
        data-testid="bar-clear-invalid"
        @click.stop="clearInvalidRefs"
      >
        <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_TAG" />
        <span>清理失效</span>
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
      filter=".nb-remove"
      :prevent-on-filter="false"
      @end="onDragEndMark"
      @update:model-value="onReorderTiles"
      @click.capture="onCardsClickCapture"
      @keydown="onCardsKeydown"
    >
      <div
        v-for="tile in refTiles"
        :key="tile.key"
        :data-tile-key="tile.key"
        :data-tile-name="tile.label"
        tabindex="0"
        class="nb-card"
        :class="{ 'is-pending': tile.pending, 'is-invalid': tile.invalid }"
        :style="tile.pending ? 'cursor: pointer' : ''"
        :aria-label="cardTooltip(tile)"
        @pointerenter="onCardEnter(tile)"
        @pointerleave="onCardLeave(tile)"
        @click.stop="tile.pending ? pickSlotFile(tile) : undefined"
        @dragover.stop.prevent="onSlotDragOver($event)"
        @dragleave.stop="onSlotDragLeave($event)"
        @drop.stop.prevent="onSlotDrop($event, undefined)"
      >
        <span class="nb-card-clip">
          <img
            v-if="cardImageOf(tile) && !tile.pending"
            class="nb-card-img"
            :src="cardImageOf(tile)"
            :alt="tile.label"
            draggable="false"
            :data-broken="brokenTiles[tile.key] ? '1' : undefined"
            @load="clearBrokenTile(tile.key)"
            @error="markBrokenTile(tile.key)"
          />
          <!-- 图还没出来（加载中 / 走丢）：盖住缩略图，露出下面的类型图标 + 转圈/提示 -->
          <span
            v-if="!tile.pending && cardImageOf(tile) && loadingTiles[tile.key]"
            class="nb-card-media-state"
            :class="{ 'is-broken': brokenTiles[tile.key] }"
            aria-hidden="true"
          >
            <span class="nb-card-media-spinner" v-if="!brokenTiles[tile.key]" />
            <span v-else class="nb-card-media-lost">!</span>
          </span>
          <span v-else-if="tile.pending" class="nb-card-pending">
            <!-- 待绑定：统一资源图标（用户 2026-10-28：手打的 @名字 无从判断类型） -->
            <span class="nb-card-placeholder" data-kind="resource" aria-hidden="true" />
            <!-- “+” 保留：这格的主要操作是点它上传，必须让用户看得出可以点 -->
            <span class="nb-card-plus" aria-hidden="true">+</span>
          </span>
          <!--
            有内容但没有可用图 → **只给音频/文本**出居中类型图标（用户 2026-10-29）。
            图片没图只有一种情况：视频帧还没取到时会先走 fallback —— 那时给视频图标。
          -->
          <span
            v-else-if="tile.kind === 'audio' || tile.kind === 'text' || tile.kind === 'video'"
            class="nb-card-fallback"
            :data-kind="tile.kind"
            aria-hidden="true"
          />
          <!--
            类型角标（用户 2026-10-28：卡片分不清是图片还是视频）。
            2026-10-29 收紧：**只有视频**挂角标 —— 图片的缩略图本身就是它，
            音频/文本挂个图标反而看不懂（用户报的「空白正方形」就是图片角标）。
          -->
          <span
            v-if="!tile.pending && tile.kind === 'video'"
            class="nb-card-kind"
            :data-kind="tile.kind"
            title="视频"
            aria-hidden="true"
          />
          <!--
            视频时长（用户 2026-10-29）：右下角小字「分:秒」，取代原来的视频小图标。
            超过 60 秒用警示色（用户：这边限制 60 秒以内，超了要醒目提醒）。
          -->
          <span
            v-if="!tile.pending && tile.kind === 'video' && formatVideoDuration(tile.duration)"
            class="nb-card-duration"
            :class="{ 'is-over': videoOverLimit(tile.duration) }"
            :title="videoOverLimit(tile.duration) ? '视频超过 60 秒上限' : '视频时长'"
          >{{ formatVideoDuration(tile.duration) }}</span>
          <span class="nb-card-index">{{ tile.index }}</span>
          <!-- 拖拽悬停时显示名称（用户 2026-10-28：卡片只有序号看不出是谁） -->
          <span class="nb-card-namebar">{{ tile.pending ? tile.label + ' · 待添加' : tile.label }}</span>
        </span>
        <span v-if="slotErrorOf(tile)" class="nb-slot-error">{{ slotErrorOf(tile) }}</span>
        <!-- 键盘排序（无障碍 + 自动化可测）：聚焦卡片后 Ctrl+←/→ 移动 -->
        <button
          v-if="!tile.pending"
          class="nb-card-hit"
          type="button"
          :aria-label="'预览素材 ' + tile.label"
        />
        <button
          v-if="!tile.pending"
          class="nb-remove"
          type="button"
          :aria-label="'移除素材 ' + tile.label"
          title="移除素材（断开连线）"
          @pointerdown.stop.prevent="onRemovePointerDown(tile)"
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
      <span v-if="prompt.length === 0 && aiPhase === 'idle'" class="nb-placeholder" aria-hidden="true">描述你想要的内容，可用 @ 引用素材</span>
      <ProseMirrorEditor
        ref="editorComponentRef"
        v-model="prompt"
        v-model:prompt-doc="promptDoc"
        :resources="editorResources"
        :resolve-resource="resolveResource"
        :editable="!aiEditorLocked"
        :on-paste-files="onPasteFiles"
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
        <!-- TODO: 占时关闭 全局设置（右侧 = 跟插件/动作无关的全局项）：点它在底栏下面展开一块设置区 -->
        <!-- <button
          class="nb-icon-btn"
          :class="{ 'is-on': settingsOpen }"
          type="button"
          :title="settingsOpen ? '收起全局设置' : '展开全局设置'"
          :aria-expanded="settingsOpen"
          aria-label="全局设置"
          @click.stop="settingsOpen = !settingsOpen"
        >
          <span aria-hidden="true" v-html="ICON_SETTINGS" />
        </button> -->
        <span class="nb-count" :title="'最多 ' + CHAR_LIMIT + ' 字'">{{ charCount }}/{{ CHAR_LIMIT }}</span>
        <!-- 有失效引用时：发送按钮左边一个警告图标，hover 出 tooltip 说清楚哪一个失效 -->
        <div class="nb-warn">
          <Tooltip v-if="invalidHint" :content="invalidHint" placement="bottom">
            <span class="nb-gap-hint" role="button" tabindex="0"><span aria-hidden="true" v-html="ICON_WARN" /></span>
          </Tooltip>
        </div>
        
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
  /* 面板底色必须一直在（用户点名：基础背景是白色）。此前被误删导致整体透明，
     暗色画布下整个面板透出画布背景 —— 与流光无关，常态就要有。 */
  background: var(--ui-panel, #fff);
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
/* 默认图片占位图标（用户口径 2026-10-27：没有图片时显示图片图标） */
.nb-card-placeholder {
  display: grid;
  place-items: center;
  opacity: 0.9;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
/* 有内容但没图（视频未取到帧 / 音频 / 文本）→ 居中显示类型图标 */
.nb-card-fallback {
  position: absolute;
  inset: 0;
  margin: auto;
  display: block;
  width: 18px;
  height: 18px;
  color: color-mix(in srgb, var(--ui-ink, #18202b) 45%, transparent);
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
/* 四类型占位图标（用户 2026-10-28：卡片空态也要区分类型） */
.nb-card-placeholder[data-kind='image'] {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='16' rx='2.5'/%3E%3Ccircle cx='8.5' cy='9.5' r='1.6'/%3E%3Cpath d='m21 15-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 20'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='16' rx='2.5'/%3E%3Ccircle cx='8.5' cy='9.5' r='1.6'/%3E%3Cpath d='m21 15-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 20'/%3E%3C/svg%3E");
}
.nb-card-placeholder[data-kind='video'] {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='6' width='12' height='12' rx='2'/%3E%3Cpath d='m15 10 6-4v12l-6-4z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='6' width='12' height='12' rx='2'/%3E%3Cpath d='m15 10 6-4v12l-6-4z'/%3E%3C/svg%3E");
}
.nb-card-placeholder[data-kind='audio'] {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 18V6l10-2v12'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='16' cy='16' r='3'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 18V6l10-2v12'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='16' cy='16' r='3'/%3E%3C/svg%3E");
}
.nb-card-placeholder[data-kind='text'] {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 7V4h16v3'/%3E%3Cpath d='M12 4v16'/%3E%3Cpath d='M8 20h8'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 7V4h16v3'/%3E%3Cpath d='M12 4v16'/%3E%3Cpath d='M8 20h8'/%3E%3C/svg%3E");
}

/*
 * 有内容但无图时的类型图标（与空槽同一套形状，颜色略淡）。
 * 2026-10-29：image 规则保留（video 帧图没就绪时兜底用），
 * 但模板只在 audio/text/video 时渲染 fallback，图片永远走缩略图 —— 不再有「空白方块」。
 */
.nb-card-fallback[data-kind='image'] {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='16' rx='2.5'/%3E%3Ccircle cx='8.5' cy='9.5' r='1.6'/%3E%3Cpath d='m21 15-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 20'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='16' rx='2.5'/%3E%3Ccircle cx='8.5' cy='9.5' r='1.6'/%3E%3Cpath d='m21 15-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 20'/%3E%3C/svg%3E");
}
.nb-card-fallback[data-kind='video'] {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='6' width='12' height='12' rx='2'/%3E%3Cpath d='m15 10 6-4v12l-6-4z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='6' width='12' height='12' rx='2'/%3E%3Cpath d='m15 10 6-4v12l-6-4z'/%3E%3C/svg%3E");
}
.nb-card-fallback[data-kind='audio'] {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 18V6l10-2v12'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='16' cy='16' r='3'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 18V6l10-2v12'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='16' cy='16' r='3'/%3E%3C/svg%3E");
}
.nb-card-fallback[data-kind='text'] {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 7V4h16v3'/%3E%3Cpath d='M12 4v16'/%3E%3Cpath d='M8 20h8'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 7V4h16v3'/%3E%3Cpath d='M12 4v16'/%3E%3Cpath d='M8 20h8'/%3E%3C/svg%3E");
}

/*
 * 类型角标：右下角一个小白图标 + 半透明底（用户 2026-10-28：卡片分不清图片还是视频）。
 * 图片不挂（缩略图本身就是它）；视频 / 音频 / 文本挂自己的图标。
 */
.nb-card-kind {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background-color: var(--ui-scrim, rgb(0 0 0 / 0.55));
  /* 图标用 mask，颜色取白色（深底上才看得清） */
  color: var(--ui-tip-ink, #fff);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: 10px 10px;
  mask-size: 10px 10px;
  pointer-events: none;
  /* 用两层叠出「深底 + 白图标」：background 是底色，mask 挖出图标形状太复杂，
     改成伪元素画图标更直接 */
}
.nb-card-kind::after {
  content: '';
  position: absolute;
  inset: 2px;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
.nb-card-kind[data-kind='video']::after {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='6' width='12' height='12' rx='2'/%3E%3Cpath d='m15 10 6-4v12l-6-4z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='6' width='12' height='12' rx='2'/%3E%3Cpath d='m15 10 6-4v12l-6-4z'/%3E%3C/svg%3E");
}
.nb-card-kind[data-kind='audio']::after {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 18V6l10-2v12'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='16' cy='16' r='3'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 18V6l10-2v12'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='16' cy='16' r='3'/%3E%3C/svg%3E");
}
.nb-card-kind[data-kind='text']::after {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 7V4h16v3'/%3E%3Cpath d='M12 4v16'/%3E%3Cpath d='M8 20h8'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 7V4h16v3'/%3E%3Cpath d='M12 4v16'/%3E%3Cpath d='M8 20h8'/%3E%3C/svg%3E");
}
.nb-card-placeholder svg {
  width: 16px;
  height: 16px;
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
/**
 * Tooltip 锚点（用户 2026-10-29）：一个 1px 的不可见点，hover 时挪到那张卡的中线，
 * 由主题 Tooltip 按它算气泡位置。放这里而不是包住每张卡，是因为拖拽库要求
 * 直接子元素就是卡片，多一层包裹会破坏排序命中。
 */
.nb-card-tip-anchor {
  position: fixed;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 100001;
}
.nb-card-tip-dot {
  /* 触发器铺满锚点（锚点尺寸 = 卡片矩形），Tooltip 按它算位置 */
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
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
/**
 * 卡片图片没出来时的加载层（用户 2026-10-29：没加载出来就给加载 UI）。
 *
 * - 加载中：半透明底 + 转圈；
 * - 加载失败：半透明底 + 感叹号，并写「资源走丢」在 title 里。
 * 都盖在缩略图位置上，尺寸与卡片一致，不推动布局。
 */
.nb-card-media-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.03));
}
.nb-card-media-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--ui-ink, #18202b) 18%, transparent);
  border-top-color: var(--ui-accent, #0891b2);
  animation: nb-card-spin 0.9s linear infinite;
}
.nb-card-media-lost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ui-ink, #18202b) 55%, transparent);
  color: var(--ui-panel, #fff);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}
.nb-card-media-state.is-broken {
  background: color-mix(in srgb, var(--ui-danger, #ef4444) 8%, transparent);
}
@keyframes nb-card-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .nb-card-media-spinner {
    animation: none;
  }
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
  /**
   * 命中区放大（用户 2026-10-29 报「点不动」）：
   * 视觉仍是 16px 圆点，但用 ::before 把可点范围撑到 24px ——
   * 卡角只有 48px，16px 的圆点又一半在卡外，鼠标稍偏就点到画布或缩略图上。
   * 放大用伪元素（不占布局），视觉尺寸不变。
   */
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--ui-ink, #18202b);
  color: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-sm, 0 1px 4px rgb(15 23 42 / 0.28));
  cursor: pointer;
  opacity: 0;
  /* 视觉默认隐藏，但**始终可点**：隐藏态如果连指针都不接，
     鼠标从卡片外靠近时那几像素的缝会落到画布上（真机踩过）。 */
  pointer-events: auto;
  transition: opacity 0.15s ease-out, background-color 0.15s ease-out;
}
.nb-remove::before {
  content: '';
  position: absolute;
  inset: -5px;
  border-radius: 999px;
}
.nb-remove svg {
  width: 10px;
  height: 10px;
  pointer-events: none;
}
.nb-card:hover .nb-remove,
.nb-card:focus-within .nb-remove,
.nb-remove:focus-visible {
  opacity: 1;
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
  z-index: 3;
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
  transition: opacity 0.15s ease-out;
}

/**
 * 视频时长角标（用户 2026-10-29：右下角显示分:秒，字小一点）。
 * 与序号角标错开：时长在右下、序号在左下，互不打架。
 * 超过 60 秒用警示色（用户：超过要醒目提醒）。
 */
.nb-card-duration {
  position: absolute;
  right: 2px;
  bottom: 2px;
  z-index: 3;
  padding: 0 3px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ui-ink, #18202b) 72%, transparent);
  color: var(--ui-panel, #fff);
  font-size: 8px;
  font-weight: 700;
  line-height: 12px;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.nb-card-duration.is-over {
  background: var(--ui-warn, #b45309);
  color: var(--ui-panel, #fff);
}

/*
 * 卡片名称条（用户 2026-10-28：卡片只有序号，拖拽时看不出这张是谁）。
 *
 * 平时透明（不抢缩略图）；hover / 拖拽悬停 / 键盘聚焦时从底部浮起，
 * 显示这张卡当前绑定的节点名称（空卡显示「名称 · 待添加」）。
 * 只动 opacity/transform（设计规范：不动画 width/height）。
 */
.nb-card-namebar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 2px 4px;
  border-radius: 0 0 6px 6px;
  background: color-mix(in srgb, var(--ui-ink, #18202b) 78%, transparent);
  color: var(--ui-panel, #fff);
  font-size: 9px;
  font-weight: 600;
  line-height: 12px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity 0.15s ease-out, transform 0.15s ease-out;
}
.nb-card:hover .nb-card-namebar,
.nb-card:focus-within .nb-card-namebar,
.nb-card.is-target .nb-card-namebar,
.nb-card--ghost .nb-card-namebar {
  opacity: 1;
  transform: translateY(0);
}
/**
 * 名称条出现时**藏掉左下角序号**（用户 2026-10-29：两者叠在一起看不清）。
 * 同一时刻只显示一个信息：要么序号（平时），要么名称（hover / 拖拽 / 失效）。
 */
.nb-card:hover .nb-card-index,
.nb-card:focus-within .nb-card-index,
.nb-card.is-target .nb-card-index,
.nb-card--ghost .nb-card-index {
  opacity: 0;
}

/* 失效引用：灰掉 + 斜纹，明示「这颗标签指向的节点已经不在了」 */
.nb-card.is-invalid {
  border-color: color-mix(in srgb, var(--ui-danger, #ef4444) 45%, transparent);
}
.nb-card.is-invalid .nb-card-namebar {
  background: color-mix(in srgb, var(--ui-danger, #ef4444) 82%, transparent);
  opacity: 1;
  transform: translateY(0);
}
.nb-editor :deep(.resource-chip--invalid) {
  opacity: 0.55;
  text-decoration: line-through;
}

/* 待绑定（手打的 @名字，还没拖节点）：统一资源图标 */
.nb-card-placeholder[data-kind='resource'],
.nb-card-fallback[data-kind='resource'] {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='4'/%3E%3Cpath d='M8 12h8'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='4'/%3E%3Cpath d='M8 12h8'/%3E%3C/svg%3E");
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
 * AI 生成期间的**流光描边**（用户口径 2026-10-27 截图）：画在**面板最外缘**，
 * 位置 = 用户红框处。::before 铺 2px conic 渐变描边旋转（@property 让 --ai-sweep 可动画）。
 * 颜色吃 --ui-accent 跟主题走；prefers-reduced-motion 退化为静态描边（全站动效规矩）。
 *
 * 落点（用户口径 2026-10-27 截图）：画在**面板最外缘** —— nb-ai-frame 内部容器已删，
 * 改为 `.nb-root.is-ai-locking::before`（面板本体），描边沿面板圆角 16px 走一圈，
 * 位置就是用户红框画的地方。内容区不再有任何额外框。
 */
.nb-root.is-ai-locking::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 16px;
  /*
   * 流光环：整面 conic 渐变 + 负 z-index 垫在内容**下面**。
   * 为什么不用 mask：rolldown 会把 `mask` 简写展开成一串 longhand，并在那次合并里
   * **丢掉 padding: 2px** —— 双层 mask 全重合，整面被 mask 盖死、什么都看不见
   * （2026-10-27 解剖产物确认）。负 z-index 方案不依赖任何简写，压缩后行为一致。
   */
  z-index: -2;
  background: conic-gradient(
    from var(--ai-sweep, 0deg),
    transparent 0deg,
    color-mix(in srgb, var(--ui-accent, #0891b2) 85%, transparent) 40deg,
    color-mix(in srgb, var(--ui-accent, #0891b2) 20%, transparent) 90deg,
    transparent 150deg,
    color-mix(in srgb, var(--ui-accent, #0891b2) 55%, transparent) 250deg,
    transparent 330deg
  );
  pointer-events: none;
  animation: nb-ai-sweep 2.4s linear infinite;
}
.nb-root.is-ai-locking::after {
  /*
   * 内层遮罩：把 ::before 的渐变中间盖掉，只留 2px 外圈；同样是负 z-index（-1），
   * 压在流光上面、内容下面。**不响应指针**，顶部参考列表/底部下拉照常可点
   * （用户口径 2026-10-27：加载中只有输入框不可操作）。
   */
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 14px;
  background: var(--ui-panel, #fff);
  z-index: -1;
  pointer-events: none;
}

/*
 * 负 z-index 的两层要能被内容盖住：给面板建一个"隔离"的层叠上下文。
 * 用 isolation 而不是给每个子元素塞 position:relative + z-index（那会动到参考列表/
 * 下拉的定位与点击，用户口径：加载中只有输入框不可操作，其余照常可用）。
 */
.nb-root.is-ai-locking {
  isolation: isolate;
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
  .nb-root.is-ai-locking::before {
    animation: none;
    /* 光斑停转：退化为静态的柔和描边 */
    background: color-mix(in srgb, var(--ui-accent, #0891b2) 45%, transparent);
  }
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
  /* 与 .prose-mirror-editor 的 1.75 保持一致（chip 高 20px 需要 ≥22px 行框） */
  line-height: 1.75;
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
  /**
   * 行高（用户 2026-10-29：两行标签的底部重合）：chip 高 20px，
   * 1.75 × 13 ≈ 22.8px 的行框能完整包住它；1.6 时 20.8px 会重叠。
   */
  line-height: 1.75;
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
  gap: 0px;
  max-width: 160px;
  /**
   * 行高重合修复（用户 2026-10-29）：chip 高 22px，而 .ProseMirror 的 line-height
   * 是 1.6 × 13px ≈ 20.8px —— 两行 chip 的盒子互相重叠（第二行压住第一行底部）。
   * vertical-align: bottom 让 22px 的盒子向下沉到基线之下，同样会压住下一行。
   * 改成「chip 自身 20px 高 + vertical-align: middle」，放进 1.75 的行高里刚好放下。
   */
  height: 20px;
  padding: 0 7px 0 3px;
  margin: 0 2px;
  border: 1px solid color-mix(in srgb, var(--ui-ink, #18202b) 18%, transparent);
  border-radius: 6px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.04));
  vertical-align: middle;
  line-height: 1;
  /* 覆盖编辑器公共样式里那条下划线（卡片不需要它） */
  border-bottom-width: 1px;
}
/*
 * 图标与缩略图**叠在同一个格子里**（用户 2026-10-29：图挂了左边就空白）。
 *
 * 结构：图标（底，代表类型）+ 缩略图（盖在上面，加载成功才可见）+ 名字。
 * 两者都占 14×14，用 grid 叠放，所以加载前后**布局不跳**。
 */
.nb-editor :deep(.resource-chip) {
  /* 让图标/缩略图共用同一格：图标先占位，图片绝对定位盖上去 */
  position: relative;
}
.nb-editor :deep(.resource-chip-thumb),
.nb-editor :deep(.resource-chip-icon) {
  width: 14px;
  height: 14px;
  flex: none;
}
.nb-editor :deep(.resource-chip-thumb) {
  position: absolute;
  left: 3px;
  top: 50%;
  transform: translateY(-50%);
  border-radius: 4px;
  object-fit: cover;
  pointer-events: none;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.04));
}
.nb-editor :deep(.resource-chip-icon) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
/* 缩略图还没加载好：图标位转一圈，告诉用户「正在取图」（用户 2026-10-29 要求） */
.nb-editor :deep(.resource-chip-icon.is-loading) {
  opacity: 0.45;
}
.nb-editor :deep(.resource-chip-icon.is-loading)::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--ui-ink, #18202b) 22%, transparent);
  border-top-color: var(--ui-accent, #0891b2);
  animation: nb-chip-spin 0.9s linear infinite;
}
/* 图片已盖住图标：底图不再转圈 */
.nb-editor :deep(.resource-chip-icon.is-covered) {
  opacity: 0;
}
@keyframes nb-chip-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .nb-editor :deep(.resource-chip-icon.is-loading)::after {
    animation: none;
  }
}
/**
 * 图标用 mask 画（用户 2026-10-28）：DOMOutputSpec 不解析 innerHTML 属性（会被当成
 * 普通属性写上 DOM），所以 spec 里不能塞 svg 字符串 —— 这里用 mask + data-icon 渲染，
 * 图标形状由 CSS 保证，任何渲染路径（HTMLElement / DOMOutputSpec）结果一致。
 */
.nb-editor :deep(.resource-chip-icon[data-icon]) {
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
/* 四种类型各自的图标（用户 2026-10-28：图片/视频/音频/文本各有默认图标） */
.nb-editor :deep(.resource-chip-icon[data-icon='image']) {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='16' rx='2.5'/%3E%3Ccircle cx='8.5' cy='9.5' r='1.6'/%3E%3Cpath d='m21 15-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 20'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='16' rx='2.5'/%3E%3Ccircle cx='8.5' cy='9.5' r='1.6'/%3E%3Cpath d='m21 15-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 20'/%3E%3C/svg%3E");
}
.nb-editor :deep(.resource-chip-icon[data-icon='video']) {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='6' width='12' height='12' rx='2'/%3E%3Cpath d='m15 10 6-4v12l-6-4z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='6' width='12' height='12' rx='2'/%3E%3Cpath d='m15 10 6-4v12l-6-4z'/%3E%3C/svg%3E");
}
.nb-editor :deep(.resource-chip-icon[data-icon='audio']) {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 18V6l10-2v12'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='16' cy='16' r='3'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 18V6l10-2v12'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='16' cy='16' r='3'/%3E%3C/svg%3E");
}
.nb-editor :deep(.resource-chip-icon[data-icon='text']) {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 7V4h16v3'/%3E%3Cpath d='M12 4v16'/%3E%3Cpath d='M8 20h8'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 7V4h16v3'/%3E%3Cpath d='M12 4v16'/%3E%3Cpath d='M8 20h8'/%3E%3C/svg%3E");
}
/*
 * 待绑定标签（手打的 @名字，还没拖节点进来）：统一「资源」图标。
 * 用户 2026-10-28 定案：这时无从判断类型，不许猜 —— 绑定后才换成真实类型图标。
 */
.nb-editor :deep(.resource-chip-icon[data-icon='resource']) {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='4'/%3E%3Cpath d='M8 12h8'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='4'/%3E%3Cpath d='M8 12h8'/%3E%3C/svg%3E");
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
  padding: 0px 10px;
  line-height: 32px;
  color: var(--ui-ink-mute, #8c95a3);
}

.nb-warn {
  padding-right: 10px;
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
<style>
/* starting 阶段的小字提示（用户口径：放**输入框右下角**）——不遮原文，跟随输入区。
   必须放非 scoped 块：提示 span 挂在 .nb-editor 内、由 v-if 控制，scoped 属性选择器
   对 v-if 重建的节点时序不稳；这里用类名直配（.nb-ai-hint 全站唯一，无冲突面）。 */
.nb-ai-hint {
  position: absolute;
  right: 4px;
  bottom: 2px;
  font-size: 10px;
  color: var(--ui-accent, #0891b2);
  pointer-events: none;
}
</style>
  /* 面板底色必须一直在（用户点名：基础背景是白色）。此前被误删导致整体透明，
     暗色画布下整个面板透出画布背景 —— 与流光无关，常态就要有。 */
  background: var(--ui-panel, #fff);
