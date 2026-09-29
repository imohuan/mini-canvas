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
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import {
  useCanvasRender,
  useGenPanelMetrics,
  useSoleNodeSelected,
  useUiComponent,
} from '@mini-canvas/canvas-render'
import type { ToolParamDef } from '@mini-canvas/kernel'
import type { BarAction } from './barTypes'
import {
  collectUpstreamMaterials,
  makeResourceResolver,
  materialCards,
  toEditorResources,
  type UpstreamMaterial,
} from './panelSource'
import { readRunState } from './runState'

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

// —— 当前动作与参数 ——
const currentId = ref('')
const currentAction = computed<BarAction | undefined>(() => actions.value.find((a) => a.id === currentId.value))
const values = ref<Record<string, unknown>>({})

/**
 * 默认动作：**优先选能输入的那条**（needsPrompt，即生成类），其次才是第一条。
 * 为什么不是直接取第一条：动作按 order 排，即时动作（旋转/下载）order 更小，
 * 于是默认选中一个没有输入框的动作 —— 用户连了素材却看不到输入框（实测反馈）。
 */
function defaultActionId(): string {
  const list = actions.value
  return (list.find((a) => a.needsPrompt === true) ?? list[0])?.id ?? ''
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
      selectAction(defaultActionId())
    }
  },
)

function selectAction(id: string): void {
  const prev = currentAction.value
  if (prev?.onDeselect) prev.onDeselect(props.id)
  currentId.value = id
  values.value = defaultsOf(currentAction.value)
  currentAction.value?.onSelect?.(props.id)
}

if (hasActions.value && !currentId.value) selectAction(defaultActionId())

// —— 提示词（promptBinding:'text' 时与 data.text 双向绑定） ——
const prompt = ref(typeof props.data?.text === 'string' ? props.data.text : '')
const promptDoc = ref<unknown>(undefined)
watch(
  () => props.data?.text,
  (next) => {
    const text = typeof next === 'string' ? next : ''
    if (promptBinding.value === 'text' && text !== prompt.value) prompt.value = text
  },
)
const promptBinding = computed(() => currentAction.value?.promptBinding ?? 'none')
const needsPrompt = computed(() => currentAction.value?.needsPrompt === true)
/** 当前动作声明的参数（交给 ToolParamGroup 聚成一个下拉） */
const paramDefs = computed<ToolParamDef[]>(() => (currentAction.value?.fields ?? []) as ToolParamDef[])
/** 输入区：needsPrompt 的动作才有 */
const showEditor = computed(() => needsPrompt.value)

/** 输入框内容变化：promptBinding:'text' 就地写回节点（是作品，进历史 + 落盘） */
function onPromptUpdate(v: string): void {
  prompt.value = v
  if (promptBinding.value === 'text') {
    ctx.get('doc').updateNode(props.id, { data: { text: v } })
  }
}

// —— 上游素材（素材卡与 @ 引用共用） ——
const materials = computed<UpstreamMaterial[]>(() =>
  collectUpstreamMaterials(renderEdges.value, props.id, (nodeId) => {
    const node = renderNodes.value.find((n) => n.id === nodeId)
    return node ? { type: node.type, data: node.data } : undefined
  }),
)
const cards = computed(() => materialCards(materials.value))
const editorResources = computed<ResourceItem[]>(() => toEditorResources(materials.value))
const resolveResource = computed(() => makeResourceResolver(editorResources.value))

/** 素材卡点击 → 预览（参考图里卡片点开就是看大图） */
const previewCard = ref<(typeof cards.value)[number] | null>(null)
function openCard(card: (typeof cards.value)[number]): void {
  previewCard.value = card
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
const canRun = computed(() => !running.value && !!currentAction.value)

/** 执行（写盘走 nodeTask → doc.updateNodeRuntime） */
async function onRun(): Promise<void> {
  if (!canRun.value || !currentAction.value) return
  await ctx.get<{ run(nodeId: string, actionId: string, input?: unknown): Promise<unknown> }>('nodeTask').run(props.id, currentAction.value.id, {
    prompt: prompt.value,
    values: values.value,
  })
}

function onFieldChange(key: string, v: string | number | boolean): void {
  values.value = { ...values.value, [key]: v }
}

/** 参数区：把只读读数拼进「比例·画质·2K·1张」那类紧凑展示（参考图是一串点分） */
const fieldSummary = computed(() => {
  const parts: string[] = []
  for (const p of (currentAction.value?.fields ?? []) as ToolParamDef[]) {
    const v = values.value[p.key]
    if (v === undefined || v === '') continue
    const opt = p.options?.find((o) => o.value === v)
    parts.push(opt ? opt.label : String(v))
  }
  return parts.join(' · ')
})

const ICON_EXPAND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
const ICON_PLUS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
const ICON_TAG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 12.2V5a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>'
const ICON_STYLE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4.1 12.9a2 2 0 0 0 0 2.8l4.2 4.2a2 2 0 0 0 2.8 0L22 9"/><path d="M14 7l3 3"/><path d="M8.5 13.5v6"/><path d="M5.5 16.5h6"/></svg>'
const ICON_SEND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'
const ICON_TRANSLATE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h7"/><path d="M7 3v2c0 4-2 7-5 8"/><path d="M5 9c1 3 3 5 6 6"/><path d="M14 20l4-9 4 9"/><path d="M15.5 17h5"/></svg>'
const ICON_SLIDERS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>'
const ICON_SPARKLE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M18 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>'
</script>

<template>
  <div
    v-if="visible && hasActions"
    class="nb-root nodrag nopan"
    :style="panelStyle"
    data-testid="node-bottom-bar"
    @pointerdown.stop
  >
    <!-- 一排 pill（参考图顶行：+参考 / 标记 / 风格；动作也在这里成排，选中高亮） -->
    <div class="nb-pills">
      <button class="nb-pill" type="button" :title="'已连接 ' + cards.length + ' 个素材，输入框里可用 @ 引用'" @click.stop>
        <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_PLUS" />
        <span>参考</span>
        <span v-if="cards.length > 0" class="nb-pill-badge">{{ cards.length }}</span>
      </button>
      <button class="nb-pill" type="button" title="标记" @click.stop>
        <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_TAG" />
        <span>标记</span>
      </button>
      <button class="nb-pill" type="button" title="风格" @click.stop>
        <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_STYLE" />
        <span>风格</span>
      </button>
      <button class="nb-expand nb-icon-btn" type="button" title="展开" aria-label="展开">
        <span aria-hidden="true" v-html="ICON_EXPAND" />
      </button>
    </div>

    <!-- 素材卡：**直接显示**（不用点「参考」），48×48 带序号角标，点开预览 -->
    <div v-if="cards.length > 0" class="nb-cards">
      <button
        v-for="(card, i) in cards"
        :key="card.id"
        class="nb-card"
        type="button"
        :title="card.name"
        @click.stop="openCard(card)"
      >
        <img v-if="card.url && !card.isText" class="nb-card-img" :src="card.url" :alt="card.name" />
        <span v-else class="nb-card-text">{{ (card.name || '文')[0] }}</span>
        <span class="nb-card-index">{{ i + 1 }}</span>
      </button>
    </div>

    <!-- 动作专属面板（video 剪辑时间轴这类） -->
    <component :is="(currentAction as any).panel" v-if="currentAction?.panel" :id="props.id" :data="props.data" />

    <!-- 输入区：内联在卡下面（点得进去、能打字、@ 引用素材） -->
    <div v-if="showEditor" class="nb-editor nodrag nopan nowheel" :style="editorStyle">
      <span v-if="prompt.length === 0" class="nb-placeholder" aria-hidden="true">描述你想要的内容，可用 @ 引用素材</span>
      <ProseMirrorEditor
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
            :options="actions.map((a) => ({ label: a.title, value: a.id }))"
            :disabled="running"
            dropdown-width="match"
            :input-id="'nb-action-' + props.id"
            title="选择动作 / 模型"
            @update:model-value="(v: string | number) => selectAction(String(v))"
          />
        </div>
        <span class="nb-divider" aria-hidden="true" />
        <!-- 参数收成**一个合并下拉**（参考图：16:9 · 标准画质 · 2K · 1张 ⌄） -->
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
        <button class="nb-icon-btn" type="button" title="高级参数" aria-label="高级参数">
          <span aria-hidden="true" v-html="ICON_SLIDERS" />
        </button>
        <button class="nb-icon-btn" type="button" title="翻译提示词" aria-label="翻译提示词">
          <span aria-hidden="true" v-html="ICON_TRANSLATE" />
        </button>
        <span class="nb-icon-btn nb-icon-btn--static" :title="fieldSummary || '生成参数'">
          <span aria-hidden="true" v-html="ICON_SPARKLE" />
        </span>
        <span class="nb-count" :title="'最多 ' + CHAR_LIMIT + ' 字'">{{ charCount }}/{{ CHAR_LIMIT }}</span>
        <button
          class="nb-run"
          :class="{ 'is-running': running }"
          type="button"
          :disabled="!canRun"
          :title="currentAction?.title || '执行'"
          @click.stop="onRun"
        >
          <span v-if="running" class="nb-spinner" aria-hidden="true" />
          <span v-else class="nb-send-icon" aria-hidden="true" v-html="ICON_SEND" />
        </button>
      </div>
    </div>

    <!-- 状态提示（错误/完成），贴右下 -->
    <div v-if="!running && runState.status !== 'idle'" class="nb-status-row">
      <span class="nb-status" :class="'is-' + runState.status" role="status">
        {{ runState.status === 'error' ? (runState.message || '执行失败') : '已完成' }}
      </span>
    </div>

    <!-- 素材预览（点卡片进入） -->
    <div v-if="previewCard" class="nb-preview" @click.stop="previewCard = null">
      <img v-if="previewCard.url && !previewCard.isText" class="nb-preview-img" :src="previewCard.url" :alt="previewCard.name" />
      <pre v-else class="nb-preview-text">{{ previewCard.value || previewCard.name }}</pre>
      <button class="nb-preview-close" type="button" title="关闭预览" @click.stop="previewCard = null">✕</button>
    </div>
  </div>
</template>

<style scoped>
/* 视觉照 docs/design/ui-style-guide.md；位置（贴边/居中/反缩放）由壳的下插槽定位层给。
   尺寸照 LibTV 参考实测：面板圆角 16、内边距 8、pill 高 26、素材卡 48、发送按钮 Ø34。 */
.nb-root {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  min-width: 360px;
  padding: 8px;
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
/* 展开按钮浮在右上角（参考图 right-2 top-2，28×28） */
.nb-expand {
  position: absolute;
  right: 8px;
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
.nb-card {
  position: relative;
  flex: none;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 8px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.18s ease-out, transform 0.15s ease-out;
}
.nb-card:hover {
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 55%, transparent);
}
.nb-card:active {
  transform: scale(0.96);
}
.nb-card:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.nb-card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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
  min-height: var(--nb-min, 20px) !important;
  outline: none !important;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ui-ink, #18202b);
  word-break: break-word;
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
.nb-field--action {
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
/* 参数合并下拉：允许收缩，超长省略（不然会把底行挤爆、模型名被裁） */
.nb-field--params {
  flex: 0 1 auto;
  min-width: 0;
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

/* —— 状态提示 —— */
.nb-status-row {
  display: flex;
  justify-content: flex-end;
}
.nb-status {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
}
.nb-status.is-error {
  color: var(--ui-danger, #ef4444);
}
.nb-status.is-done {
  color: var(--ui-ink-mute, #8c95a3);
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
    transform: none;
  }
  .nb-spinner {
    animation: none;
  }
}
</style>
