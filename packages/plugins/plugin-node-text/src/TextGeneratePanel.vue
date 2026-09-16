<script setup lang="ts">
/**
 * TextGeneratePanel —— 文本节点的底部「生成控制栏」（**仅单选时显示**）。
 *
 * 用户的要求：文本节点底部要跟图片节点同款的"输入框 + 下拉 + 发送"，
 * 因为这里将来要做成 AI 生成 —— 选模型、选思考程度、把结果**直接写回输入框**，
 * 还要能提供模板提示词、并能针对输入框内容提问。
 *
 * 与图片节点面板同架构：**本组件不认识任何模型**。能产出文本的工具由独立工具插件经
 * ctx.tools 注册，面板只做三件事 —— 列出工具、让用户选参数/模板、带上画布上下文调用。
 * 因此"加一个模型"= 装一个工具插件，本文件一行都不用改。
 *
 * 写回语义（区别于图片）：产物是文本 → 写进 data.text（走 graph，可撤销 + 自动落盘），
 * 所以生成结果会直接出现在节点的输入框里，用户可以在其基础上继续改。
 *
 * 视觉照 docs/design/ui-style-guide.md 与设置界面：下拉用项目统一的 Select 组件（不用原生 select）。
 */
import { computed, ref, watch } from 'vue'
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import {
  useCanvasRender,
  useGenPanelMetrics,
  useSoleNodeSelected,
} from '@mini-canvas/canvas-render'
import { NodeToolbarButton, Select, ToolParamField } from '@mini-canvas/plugin-theme-default'
import type { SelectOption } from '@mini-canvas/plugin-theme-default'
import type { ToolDef, ToolParamDef, ToolProgress, ToolResult, ToolService } from '@mini-canvas/kernel'
import {
  buildToolInput,
  collectUpstreamMaterials,
  makeResourceResolver,
  paramDefs,
  paramOptions,
  paramRaw,
  paramValue,
  paramsForTool,
  pickDefaultTool,
  templateOptions,
  templatePrompt,
  toolOptions,
  validateGenInput,
  type UpstreamMaterial,
} from './textPanelSource'
import { summarizeText } from './textStyle'
import type { TextNodeService } from './nodeTextPlugin'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx, renderEdges, renderNodes } = useCanvasRender()
// 单选才显示：多选时所有控制栏（上下）都收起，避免多份面板互相叠
const selected = useSoleNodeSelected(props.id)
const visible = computed(() => selected.value)

/** 面板尺寸类配置（宽度 / 输入框高度；与贴边距离同属「布局/控制栏」） */
const metrics = useGenPanelMetrics()
/** 面板内容尺寸；位置与反缩放由壳的下插槽定位层给（用户要求"定位交给 BaseNode"），本组件不再算 */
const panelStyle = computed<Record<string, string>>(() => ({
  // 宽度来自配置（布局/控制栏 → 文本生成栏宽度），不再写死在 CSS 里
  width: metrics.value.textWidth + 'px',
}))

/** 输入框高度区间（配置驱动；用 CSS 变量喂给 scoped 样式，避免逐处硬编码） */
const editorStyle = computed<Record<string, string>>(() => ({
  '--tg-editor-min': metrics.value.editorMinHeight + 'px',
  '--tg-editor-max': metrics.value.editorMaxHeight + 'px',
}))

// ==================== 输入区 ====================

/** 输入框内容（= 要写回 data.text 的内容） */
const prompt = ref(typeof props.data?.text === 'string' ? props.data.text : '')
const promptDoc = ref<unknown>(undefined)
const editorRef = ref<InstanceType<typeof ProseMirrorEditor> | null>(null)

// 外部改 data.text（撤销/重做/别的插件写回）→ 输入框跟随；编辑中不打断用户
watch(
  () => props.data?.text,
  (next) => {
    const text = typeof next === 'string' ? next : ''
    if (text !== prompt.value) prompt.value = text
  },
)

// ==================== 工具（模型）====================

function toolService(): Pick<ToolService, 'list' | 'invoke'> | undefined {
  return ctx?.tools as Pick<ToolService, 'list' | 'invoke'> | undefined
}

const toolList = ref<ToolDef[]>([])
const selectedTool = ref('')
const params = ref<Record<string, unknown>>({})
const selectedTemplate = ref('')

const currentDef = computed<ToolDef | undefined>(() => toolList.value.find((t) => t.name === selectedTool.value))
const modelOptions = computed<SelectOption[]>(() => toolOptions(toolList.value))
const paramDefsList = computed<ToolParamDef[]>(() => paramDefs(currentDef.value))

/**
 * 参数控件的占位宽度：由工具在 ToolParamDef.span 里声明（默认 1）。
 * span=1 给 0（flex 按内容自适应）；span>1 按倍数给基准宽度。面板不认识参数的业务含义。
 */
function fieldBasis(p: ToolParamDef): string {
  const span = p.span ?? 1
  return span > 1 ? `${span * 88}px` : '0px'
}
const tplOptions = computed<SelectOption[]>(() => templateOptions(currentDef.value, toolList.value))

/**
 * 重读工具列表并保持选中值有效。工具是别的插件在装配期注册的，可能晚于本节点挂载 →
 * 挂载时与每次显示时各读一次，做到"工具刚装上就能在下拉里看到"。
 */
function refreshTools(): void {
  const list = toolService()?.list({ produces: 'text' }) ?? []
  toolList.value = list
  if (!list.some((t) => t.name === selectedTool.value)) selectTool(pickDefaultTool(list))
}

/** 选模型：参数换成该模型自己声明的默认值，并清掉上一个模型的模板选择 */
function selectTool(name: string): void {
  selectedTool.value = name
  params.value = paramsForTool(toolList.value.find((t) => t.name === name))
  selectedTemplate.value = ''
}

function onModelSelect(value: string | number): void {
  selectTool(String(value))
}

/**
 * 参数值回写（通用渲染器 ToolParamField 的唯一出口）。
 * 值保持原类型：下拉给字符串、开关给布尔、数字给数值 —— 一律 String() 会把开关的
 * true 变成 "true" 发给后台，自定义参数组件产出数值时也会被误解。
 */
function onParamChange(key: string, value: string | number | boolean): void {
  params.value = { ...params.value, [key]: value }
}

/** 选模板：把模板提示词填进输入框（用户要的"提供一些模板提示词"） */
function onTemplateSelect(value: string | number): void {
  const id = String(value)
  selectedTemplate.value = id
  const text = templatePrompt(currentDef.value, toolList.value, id)
  if (text) prompt.value = text
}

refreshTools()
watch(visible, (on) => {
  if (on) refreshTools()
})

// ==================== 上游素材 ====================

const materials = computed<UpstreamMaterial[]>(() =>
  collectUpstreamMaterials(renderEdges.value, props.id, (nodeId) => {
    const node = renderNodes.value.find((n) => n.id === nodeId)
    return node ? { type: node.type, data: node.data } : undefined
  }),
)
const editorResources = computed<ResourceItem[]>(() => toEditorResourcesSafe(materials.value))
const resolveResource = computed(() => makeResourceResolver(editorResources.value))

/** 媒体素材点击可看大图（文本框里点 @ 出来的缩略图） */
function toEditorResourcesSafe(ms: ReadonlyArray<UpstreamMaterial>): ResourceItem[] {
  return ms.map((m, i) => {
    const base = { id: m.id, name: m.name || `素材${i + 1}`, category: '素材' }
    if (m.kind === 'text') {
      return {
        ...base,
        value: m.value ?? '',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2"><path d="M4 7V4h16v3"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="8" y1="20" x2="16" y2="20"/></svg>',
      }
    }
    return { ...base, url: m.url, mediaType: m.kind === 'video' ? 'video' : m.kind === 'audio' ? 'audio' : 'image' }
  })
}

// ==================== 发送与生成 ====================

const running = ref(false)
const progress = ref<ToolProgress>({})
const errorText = ref('')
const doneHint = ref('')

/** 字数/行数（保留原状态栏信息） */
const summary = computed(() => summarizeText(props.data?.text))

/* 动作图标（内联 SVG 常量放脚本里，模板保持可读） */
const ICON_DUPLICATE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>'
const ICON_DELETE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>'

function service(): TextNodeService {
  return ctx.get<TextNodeService>('text')
}

const canSend = computed(() => !running.value && !!currentDef.value)

const status = computed(() => {
  if (errorText.value) return { text: errorText.value, tone: 'error' as const }
  if (running.value) return { text: progress.value.message || '生成中…', tone: 'busy' as const }
  if (doneHint.value) return { text: doneHint.value, tone: 'done' as const }
  return { text: '', tone: 'idle' as const }
})

/** 进度条百分比（外部只给阶段时返回 null → 走"不确定态"来回走） */
const progressPercent = computed<number | null>(() => {
  const p = progress.value.progress
  return typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : null
})

async function onSend(): Promise<void> {
  if (!canSend.value) return
  const svc = toolService()
  const def = currentDef.value
  if (!svc || !def) return

  const input = buildToolInput(prompt.value, def, materials.value, params.value)
  const invalid = validateGenInput(prompt.value, def, input.resources?.length ?? 0)
  if (invalid) {
    errorText.value = invalid
    return
  }

  running.value = true
  errorText.value = ''
  doneHint.value = ''
  progress.value = {}

  let result: ToolResult
  try {
    result = await svc.invoke(def.name, input, {
      ctx: { nodeId: props.id },
      onProgress: (p) => {
        progress.value = p
      },
    })
  } catch (err) {
    running.value = false
    errorText.value = err instanceof Error ? err.message : '生成失败，请重试'
    return
  }

  running.value = false
  progress.value = {}

  if (!result.ok) {
    // 失败只显示，不写进 data（写下去会落盘，刷新后变成幽灵报错）
    errorText.value = result.error || '生成失败，请重试'
    return
  }

  const text = typeof result.text === 'string' ? result.text : ''
  if (!text) {
    errorText.value = '生成完成了，但没有拿到文本'
    return
  }
  // 一次写完：走 graph 唯一写入口（可撤销 + 自动落盘），结果直接出现在输入框里
  prompt.value = text
  service().editText(props.id, text)
  doneHint.value = '已写回文本'
}

// ==================== 既有动作（复制 / 删除）====================

function onDuplicate(): void {
  service().duplicateTextNode(props.id)
}
function onDelete(): void {
  ctx.get<{ removeNodes(ids: string[]): number }>('graph').removeNodes([props.id])
}
</script>

<template>
  <div v-if="visible" class="tg-root nodrag nopan" :style="panelStyle" data-testid="text-generate-panel" @pointerdown.stop>
    <!-- 大输入框：支持 @ 引用上游素材（复用统一的富文本编辑器） -->
    <div class="tg-editor nodrag nopan nowheel" :style="editorStyle" @click.stop>
      <ProseMirrorEditor
        ref="editorRef"
        v-model="prompt"
        v-model:prompt-doc="promptDoc"
        :resources="editorResources"
        :resolve-resource="resolveResource"
        placeholder="描述你想生成的内容，@ 引用素材"
        @click.stop
      />
    </div>

    <!-- 工具栏：左侧模型 + 参数 + 模板，右侧状态 + 字数 + 动作 + 发送 -->
    <div class="tg-toolbar">
      <div class="tg-selects">
        <div class="tg-field" :title="currentDef?.description || '选择生成模型'">
          <Select
            :model-value="selectedTool"
            :options="modelOptions"
            :disabled="running || toolList.length === 0"
            placeholder="无可用工具"
            dropdown-width="match"
            :input-id="'tg-model-' + props.id"
            @update:model-value="onModelSelect"
          />
        </div>

        <!-- 参数：完全照工具声明长出来（思考程度/长度/风格/自定义组件…同一机制，本文件不认识它们）。
             交给通用渲染器 ToolParamField：内置控件它自己有，工具想用自定义组件也由它接管。 -->
        <div
          v-for="p in paramDefsList"
          :key="p.key"
          class="tg-field"
          :style="{ flexGrow: 0, flexBasis: fieldBasis(p) }"
          :title="p.description || p.label || p.key"
        >
          <ToolParamField
            :param="p"
            :model-value="paramRaw(params, p.key)"
            :disabled="running"
            :id-prefix="'tg-param-' + props.id"
            @update:model-value="(v: string | number | boolean) => onParamChange(p.key, v)"
          />
        </div>

        <div v-if="tplOptions.length > 0" class="tg-field" title="套用预设提示词">
          <Select
            :model-value="selectedTemplate"
            :options="tplOptions"
            :disabled="running"
            placeholder="模板"
            dropdown-width="match"
            :input-id="'tg-tpl-' + props.id"
            @update:model-value="onTemplateSelect"
          />
        </div>
      </div>

      <div class="tg-actions">
        <span v-if="status.text" class="tg-status" :class="'is-' + status.tone" role="status">{{ status.text }}</span>

        <span class="tg-stat" :title="`${summary.chars} 字 · ${summary.lines} 行`">
          <span class="tg-num">{{ summary.chars }}</span>
          <span class="tg-unit">字</span>
          <span class="tg-dot" aria-hidden="true" />
          <span class="tg-num">{{ summary.lines }}</span>
          <span class="tg-unit">行</span>
        </span>

        <NodeToolbarButton title="复制节点" :icon="ICON_DUPLICATE" @click="onDuplicate" />

        <NodeToolbarButton title="删除节点" variant="danger" :icon="ICON_DELETE" @click="onDelete" />

        <button class="tg-send" :class="{ 'is-running': running }" type="button" :disabled="!canSend" title="发送" @click.stop="onSend">
          <span v-if="running" class="tg-spinner" aria-hidden="true" />
          <svg v-else class="tg-send-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          <span>{{ running ? '生成中' : '发送' }}</span>
        </button>
      </div>
    </div>

    <!-- 进度条：有百分比按比例，外部只给阶段时来回走 -->
    <div v-if="running" class="tg-progress" aria-hidden="true">
      <div
        class="tg-progress-bar"
        :class="{ 'is-indeterminate': progressPercent === null }"
        :style="progressPercent === null ? undefined : { width: progressPercent + '%' }"
      />
    </div>
  </div>
</template>

<style scoped>
/* 只管面板自身的材质与内部排版；位置（贴边/居中/反缩放）由壳的下插槽定位层给。 */
.tg-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 520px;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid var(--line-hair, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  background: var(--canvas-node-panel-surface, #fff);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
}

/* 输入区：与设置面板一致的浅底 + 发丝边 + 内圆角（外圆 12 > 内圆 8） */
.tg-editor {
  padding: 8px 10px;
  border: 1px solid var(--line-hair, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  background: var(--fill-quiet, rgba(0, 0, 0, 0.03));
  transition: background-color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.tg-editor:focus-within {
  background: #fff;
  border-color: rgba(8, 145, 178, 0.6);
}
.tg-editor :deep(.prose-mirror-editor) {
  /* 高度区间来自配置（布局/控制栏 → 生成栏输入框最小/最大高） */
  min-height: var(--tg-editor-min, 64px);
  max-height: var(--tg-editor-max, 220px);
  overflow-y: auto;
  outline: none;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-strong, #111827);
}
.tg-editor :deep(.prose-mirror-editor p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: var(--text-faint, #9ca3af);
  pointer-events: none;
}

/* —— 工具栏 —— */
.tg-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tg-selects {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
/* 下拉字段：复用项目统一 Select（与设置界面同款浮层与 token），只给宽度上限 */
.tg-field {
  flex: none;
  min-width: 80px;
  max-width: 160px;
}
.tg-field :deep(.sel-trigger) {
  padding: 5px 8px;
  font-size: 12px;
}
.tg-field :deep(.sel-arrow) {
  width: 14px;
  height: 14px;
}

.tg-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

/* 状态文案：失败红、进行中青、成功灰 */
.tg-status {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
}
.tg-status.is-error {
  color: #ef4444;
}
.tg-status.is-busy {
  color: #0e7490;
}
.tg-status.is-done {
  color: var(--text-muted, #6b7280);
}

/* 字数读数 */
.tg-stat {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--text-muted, #6b7280);
  font-size: 11px;
  font-weight: 600;
  user-select: none;
}
.tg-num {
  color: var(--text-body, #374151);
  font-variant-numeric: tabular-nums;
}
.tg-unit {
  color: var(--text-faint, #9ca3af);
}
.tg-dot {
  width: 2px;
  height: 2px;
  margin: 0 2px;
  border-radius: 999px;
  background: var(--text-faint, #9ca3af);
}

/* 复制/删除两个图标按钮改用通用 NodeToolbarButton（尺寸/hover/focus/禁用都在那一边） */

/* 主按钮（全界面同一时刻只允许一个实心主按钮 → 只有「发送」是实心青底白字） */
.tg-send {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: #0891b2;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.15s ease-out, transform 0.15s ease-out;
}
.tg-send:hover:not(:disabled) {
  background: #0e7490;
}
.tg-send:active:not(:disabled) {
  transform: scale(0.97);
}
.tg-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tg-send:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}
.tg-send-icon {
  width: 14px;
  height: 14px;
}

/* 进行中的小转圈 */
.tg-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  border-radius: 999px;
  animation: tg-spin 0.7s linear infinite;
}
@keyframes tg-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 进度条 */
.tg-progress {
  height: 2px;
  margin: -6px 2px 0;
  overflow: hidden;
  border-radius: 999px;
  background: var(--fill-subtle, rgba(0, 0, 0, 0.04));
}
.tg-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: #0891b2;
  transition: width 0.2s ease-out;
}
.tg-progress-bar.is-indeterminate {
  width: 32%;
  animation: tg-slide 1.2s ease-in-out infinite;
}
@keyframes tg-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(320%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tg-send,
  .tg-editor,
  .tg-progress-bar {
    transition: none !important;
  }
  .tg-send:active:not(:disabled) {
    transform: none;
  }
  .tg-spinner,
  .tg-progress-bar.is-indeterminate {
    animation: none;
  }
}
</style>
