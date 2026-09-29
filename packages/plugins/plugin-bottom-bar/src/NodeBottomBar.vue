<script setup lang="ts">
/**
 * NodeBottomBar —— 默认底栏皮（themeRegistry 槽 bottomBar 的默认赢家）。
 *
 * 版式完全复刻用户给的 LibTV 参考（截图见对话）：
 *
 *   ┌───────────────────────────────────────────────┐
 *   │ [+ 参考]                              [⤢]     │  ← 顶部行：左素材 chip，右展开
 *   │                                               │
 *   │  描述你想要的内容，可用 @ 引用素材              │  ← 大输入框（撑满剩余高度）
 *   │                                               │
 *   │ [🎚 模型 ▾] [中文·24k·wav ▾]  [文A]  0/2000 (↑) │  ← 底部行
 *   └───────────────────────────────────────────────┘
 *
 * 分工（保持既有架构不变）：
 * - 动作列表 = ctx.get('nodeBar').list({ type })（模型类动作由节点插件经 publishToolActions 发布）；
 * - 动作的 fields 渲染成下拉（包括「模型」这类下拉本身）；
 * - promptBinding:'text' 的动作把输入框接到 data.text（编辑即写回，是作品）；
 * - 执行按钮是右下角圆形箭头按钮（参考图样式），running 时变转圈；
 * - 动作专属 panel（视频剪辑时间轴）渲染在顶部行与大输入框之间；
 * - 没有可用动作时自身返回空（壳的 .v2-slot--bottom 包裹层不算底栏产出）。
 *
 * 服务取值（§0.1）：组件拿到的是根 ctx，一律 ctx.get(...)，不直访 ctx.nodeBar。
 * 节点类型（§0.2）：区域条目只下发 { id, data }，type 要 ctx.get('doc').getNode(id)?.type 取。
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

// 单选才显示（与既有三份面板同语义）
const visible = useSoleNodeSelected(props.id)

/** 面板宽度与输入框高度区间（沿用既有配置项，不新增配置键） */
const metrics = useGenPanelMetrics()
const panelStyle = computed<Record<string, string>>(() => ({
  width: metrics.value.imageWidth + 'px',
}))
const editorStyle = computed<Record<string, string>>(() => ({
  '--nb-min': metrics.value.editorMinHeight + 'px',
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
const templateId = ref('')

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
      selectAction(actions.value[0]?.id ?? '')
    }
  },
)

function selectAction(id: string): void {
  const prev = currentAction.value
  if (prev?.onDeselect) prev.onDeselect(props.id)
  currentId.value = id
  templateId.value = ''
  values.value = defaultsOf(currentAction.value)
  currentAction.value?.onSelect?.(props.id)
}

// 面板挂载时若没选中任何动作，选第一条
if (hasActions.value && !currentId.value) selectAction(actions.value[0].id)

const templates = computed(() => currentAction.value?.templates ?? [])

function onTemplateSelect(v: string | number): void {
  const id = String(v)
  templateId.value = id
  const tpl = templates.value.find((t) => t.id === id)
  if (tpl?.prompt) prompt.value = tpl.prompt
}

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
/** 大输入框：needsPrompt 的动作才有 */
const showEditor = computed(() => needsPrompt.value)
/** 输入框占位文案（参考图风格：一句话说明能写什么 + @ 引用提示；固定文案，不拼动作名以免读起来别扭） */
const editorPlaceholder = '描述你想要的内容，可用 @ 引用素材'

/** 输入框内容变化：promptBinding:'text' 就地写回节点（是作品，进历史 + 落盘） */
function onPromptUpdate(v: string): void {
  prompt.value = v
  if (promptBinding.value === 'text') {
    ctx.get('doc').updateNode(props.id, { data: { text: v } })
  }
}

// —— 上游素材（顶部「+ 参考」chip 与 @ 引用共用） ——
const materials = computed<UpstreamMaterial[]>(() =>
  collectUpstreamMaterials(renderEdges.value, props.id, (nodeId) => {
    const node = renderNodes.value.find((n) => n.id === nodeId)
    return node ? { type: node.type, data: node.data } : undefined
  }),
)
const cards = computed(() => materialCards(materials.value))
const editorResources = computed<ResourceItem[]>(() => toEditorResources(materials.value))
const resolveResource = computed(() => makeResourceResolver(editorResources.value))
const showMaterials = ref(false)
function toggleMaterials(): void {
  showMaterials.value = !showMaterials.value
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

const ICON_EXPAND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
const ICON_PLUS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
const ICON_SEND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'
const ICON_TRANSLATE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h7"/><path d="M7 3v2c0 4-2 7-5 8"/><path d="M5 9c1 3 3 5 6 6"/><path d="M14 20l4-9 4 9"/><path d="M15.5 17h5"/></svg>'
</script>

<template>
  <div
    v-if="visible && hasActions"
    class="nb-root nodrag nopan"
    :style="panelStyle"
    data-testid="node-bottom-bar"
    @pointerdown.stop
  >
    <!-- 顶部行：左「+ 参考」chip，右展开 -->
    <div class="nb-top">
      <button
        class="nb-chip"
        type="button"
        :title="cards.length > 0 ? '查看已连接的素材' : '把节点连进来当素材，或在输入框里用 @ 引用'"
        :aria-expanded="showMaterials"
        @click.stop="toggleMaterials"
      >
        <span class="nb-chip-icon" aria-hidden="true" v-html="ICON_PLUS" />
        <span>参考</span>
        <span v-if="cards.length > 0" class="nb-chip-count">{{ cards.length }}</span>
      </button>
      <button class="nb-icon-btn" type="button" title="展开编辑" aria-label="展开编辑">
        <span aria-hidden="true" v-html="ICON_EXPAND" />
      </button>
    </div>

    <!-- 素材行（点「参考」展开） -->
    <div v-if="showMaterials" class="nb-materials">
      <span v-if="cards.length === 0" class="nb-materials-hint">把图片/文本/视频连进来，或用 @ 引用</span>
      <span v-for="card in cards" :key="card.id" class="nb-mat" :title="card.name">
        <img v-if="card.url && !card.isText" class="nb-mat-img" :src="card.url" :alt="card.name" />
        <span v-else class="nb-mat-text">{{ card.name }}</span>
      </span>
    </div>

    <!-- 动作专属面板（video 剪辑时间轴这类） -->
    <component :is="(currentAction as any).panel" v-if="currentAction?.panel" :id="props.id" :data="props.data" />

    <!-- 大输入框：撑满剩余高度 -->
    <div v-if="showEditor" class="nb-editor nodrag nopan nowheel" :style="editorStyle" @click.stop>
      <!-- placeholder 自绘：编辑器自带的占位符在本仓库未实现（bundle 只声明了 prop 没消费），
           所以这里用一层覆盖文本，有内容即隐（点击穿透到编辑器）。 -->
      <span v-if="prompt.length === 0" class="nb-placeholder" aria-hidden="true">{{ editorPlaceholder }}</span>
      <ProseMirrorEditor
        v-model="prompt"
        v-model:prompt-doc="promptDoc"
        :resources="editorResources"
        :resolve-resource="resolveResource"
        @update:model-value="onPromptUpdate"
        @click.stop
      />
    </div>

    <!-- 底部行：左模型/参数下拉，右翻译·计数·发送 -->
    <div class="nb-bottom">
      <div class="nb-selects">
        <div class="nb-field nb-field--action">
          <Select
            :model-value="currentId"
            :options="actions.map((a) => ({ label: a.title, value: a.id }))"
            :disabled="running"
            dropdown-width="match"
            :input-id="'nb-action-' + props.id"
            title="选择动作"
            @update:model-value="(v: string | number) => selectAction(String(v))"
          />
        </div>
        <div
          v-for="p in (currentAction?.fields ?? []) as ToolParamDef[]"
          :key="p.key"
          class="nb-field"
          :title="p.description || p.label || p.key"
        >
          <ToolParamField
            :param="p"
            :model-value="values[p.key]"
            :disabled="running"
            :id-prefix="'nb-field-' + props.id"
            @update:model-value="(v: string | number | boolean) => onFieldChange(p.key, v)"
          />
        </div>
        <div v-if="templates.length" class="nb-field" title="套用预设提示词">
          <Select
            :model-value="templateId"
            :options="templates.map((t) => ({ label: t.name, value: t.id }))"
            :disabled="running"
            placeholder="模板"
            dropdown-width="match"
            :input-id="'nb-tpl-' + props.id"
            @update:model-value="onTemplateSelect"
          />
        </div>
      </div>

      <div class="nb-actions">
        <span v-if="infoText" class="nb-info">{{ infoText }}</span>
        <button class="nb-icon-btn" type="button" title="翻译提示词" aria-label="翻译提示词">
          <span aria-hidden="true" v-html="ICON_TRANSLATE" />
        </button>
        <span class="nb-count" :title="'最多 ' + CHAR_LIMIT + ' 字'">
          <span class="nb-count-num">{{ charCount }}</span>
          <span class="nb-count-sep">/</span>
          <span class="nb-count-max">{{ CHAR_LIMIT }}</span>
        </span>
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
  </div>
</template>

<style scoped>
/* 视觉照 docs/design/ui-style-guide.md；位置（贴边/居中/反缩放）由壳的下插槽定位层给。
   尺寸对齐用户给的 LibTV 参考：面板圆角 16、底部行高 44、圆形发送按钮 Ø34-40。 */
.nb-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  min-height: 220px;
  padding: 10px 12px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 16px;
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-md, 0 18px 44px rgb(15 23 42 / 0.16));
}

/* —— 顶部行 —— */
.nb-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
/* 左「+ 参考」chip：浅底、圆角 8、12px/600（参考图约 48×24） */
.nb-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: var(--ui-chip, rgb(0 0 0 / 0.07));
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.18s ease-out;
}
.nb-chip:hover {
  background: var(--ui-hover-strong, rgb(0 0 0 / 0.1));
}
.nb-chip:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.nb-chip-icon {
  display: inline-flex;
  width: 12px;
  height: 12px;
}
.nb-chip-icon :deep(svg) {
  width: 12px;
  height: 12px;
}
.nb-chip-count {
  padding: 0 4px;
  border-radius: 999px;
  background: var(--ui-accent-soft, color-mix(in srgb, var(--ui-accent, #0891b2) 12%, transparent));
  color: var(--ui-accent, #0891b2);
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* 图标按钮：26px 命中区，图标 14 */
.nb-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
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
.nb-icon-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.nb-icon-btn :deep(svg) {
  width: 14px;
  height: 14px;
}

/* —— 素材行 —— */
.nb-materials {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  max-height: 60px;
  overflow-x: auto;
  overflow-y: hidden;
}
.nb-materials-hint {
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
  white-space: nowrap;
}
.nb-mat {
  flex: none;
  display: inline-flex;
  align-items: center;
  max-width: 120px;
  height: 26px;
  padding: 0 8px;
  border-radius: 8px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
}
.nb-mat-img {
  width: 26px;
  height: 26px;
  margin-right: 4px;
  border-radius: 6px;
  object-fit: cover;
}
.nb-mat-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* —— 大输入框（撑满剩余高度） —— */
.nb-editor {
  flex: 1;
  min-height: 0;
  padding: 2px;
  overflow-y: auto;
}
/* 自绘 placeholder：绝对定位在编辑区左上，有点击穿透 */
.nb-editor {
  position: relative;
}
.nb-placeholder {
  position: absolute;
  top: 2px;
  left: 2px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 13px;
  line-height: 1.6;
  pointer-events: none;
  user-select: none;
}
.nb-editor :deep(.prose-mirror-editor) {
  min-height: var(--nb-min, 64px);
  max-height: var(--nb-max, 220px);
  overflow-y: auto;
  outline: none;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ui-ink, #18202b);
}
.nb-editor :deep(.prose-mirror-editor p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: var(--ui-ink-mute, #8c95a3);
  pointer-events: none;
}

/* —— 底部行 —— */
.nb-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 40px;
  /* 没有大输入框时（如「旋转」这类即时动作）把底部行推到底，版式仍与参考图一致 */
  margin-top: auto;
}
.nb-selects {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.nb-field {
  flex: none;
  min-width: 0;
}
/* 模型下拉（第一个）比参数下拉略宽，贴近参考图的层级 */
.nb-field--action {
  max-width: 190px;
}
/* 下拉统一样式：无边框、透明底、hover 浅底（参考图的「⌄」文字按钮风格） */
.nb-field :deep(.sel-trigger) {
  gap: 4px;
  padding: 6px 8px;
  border-color: transparent;
  background: transparent;
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  font-weight: 600;
}
.nb-field :deep(.sel-trigger:hover:not(.is-open)) {
  background: var(--ui-hover, rgb(0 0 0 / 0.06));
}
.nb-field :deep(.sel-trigger.is-open) {
  background: var(--ui-panel-active, #e8eaf0);
  border-color: transparent;
  box-shadow: none;
}
.nb-field :deep(.sel-arrow) {
  width: 14px;
  height: 14px;
  color: var(--ui-ink-mute, #8c95a3);
}

.nb-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.nb-info {
  font-size: 11px;
  color: var(--ui-ink-mute, #8c95a3);
  font-variant-numeric: tabular-nums;
}
.nb-count {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ui-ink-mute, #8c95a3);
}
.nb-count-num {
  color: var(--ui-ink-dim, #6b7280);
}

/* 圆形执行按钮（参考图是白底箭头；本项目强调色 token 决定浅深主题下的观感） */
.nb-run {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
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
  width: 16px;
  height: 16px;
}
.nb-send-icon :deep(svg) {
  width: 16px;
  height: 16px;
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

/* —— 状态提示（错误/完成） —— */
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

@media (prefers-reduced-motion: reduce) {
  .nb-run,
  .nb-chip,
  .nb-icon-btn {
    transition: none !important;
  }
  .nb-run:active:not(:disabled) {
    transform: none;
  }
  .nb-spinner {
    animation: none;
  }
}
</style>
