<script setup lang="ts">
/**
 * NodeBottomBar —— 默认底栏皮（themeRegistry 槽 'bottomBar' 的默认赢家）。
 *
 * 职责（计划 Task 5）：
 * - 按当前节点类型列出动作（ctx.get('nodeBar').list）——**不做 tools 自动展开**（§0.3）；
 * - 动作专属面板（action.panel，选中该动作且有面板时渲染在输入框上方）；
 * - 大输入框（needsPrompt 动作才有）；promptBinding:'text' 时输入框= data.text，编辑即写回节点；
 * - fields 一律交给 useUiComponent('toolParamField')（主题可替换目录，换皮零改动）；
 * - 执行按钮（running 禁用+转圈）、info 只读读数、模板下拉；
 * - 没有可用动作时自身返回空（壳的 .v2-slot--bottom 包裹层不算底栏产出）。
 *
 * 服务取值（§0.1）：组件拿到的是根 ctx，一律 ctx.get(...)，不直访 ctx.nodeBar。
 * 节点类型（§0.2）：区域条目只下发 { id, data }，type 要 ctx.get('doc').getNode(id)?.type 取。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  useCanvasRender,
  useGenPanelMetrics,
  useSoleNodeSelected,
  useUiComponent,
} from '@mini-canvas/canvas-render'
import type { ToolParamDef } from '@mini-canvas/kernel'
import type { BarAction } from './barTypes'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
// 设计系统件按名取（§4.5 目录）：换主题插件时这里一行不改
const Select = useUiComponent('select')
const ToolParamField = useUiComponent('toolParamField')
const NodeToolbarButton = useUiComponent('button')

// 单选才显示（与既有三份面板同语义）
const visible = useSoleNodeSelected(props.id)

/** 面板宽度（沿用既有配置项 panelImageWidth，不新增配置键） */
const metrics = useGenPanelMetrics()
const panelStyle = computed<Record<string, string>>(() => ({
  width: metrics.value.imageWidth + 'px',
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

// 面板挂载时若没选中任何动作，选第一条（不触发 onSelect 的初值路径留给 selectAction）
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
watch(
  () => props.data?.text,
  (next) => {
    const text = typeof next === 'string' ? next : ''
    if (promptBinding.value === 'text' && text !== prompt.value) prompt.value = text
  },
)
const promptBinding = computed(() => currentAction.value?.promptBinding ?? 'none')
const needsPrompt = computed(() => currentAction.value?.needsPrompt === true)
const showPrompt = computed(() => needsPrompt.value && promptBinding.value !== 'text')

function onPromptInput(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  prompt.value = v
  if (promptBinding.value === 'text') {
    // 编辑即写回（是作品，走 doc.updateNode 进历史 + 落盘）
    ctx.get('doc').updateNode(props.id, { data: { text: v } })
  }
}

// —— info 只读读数 ——
const infoText = computed(() => {
  const info = currentAction.value?.info
  return info ? info(props.data) : ''
})

// —— 状态（从节点 data.runState 读，覆盖层与底栏同一数据源） ——
import { readRunState } from './runState'
const runState = computed(() => readRunState(props.data))
const running = computed(() => runState.value.status === 'running')
const statusText = computed(() => {
  const rs = runState.value
  if (rs.status === 'error') return rs.message ?? '执行失败'
  if (rs.status === 'done') return '已完成'
  if (rs.status === 'running') return rs.message || '执行中…'
  return ''
})

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

function fieldBasis(p: ToolParamDef): string {
  const span = p.span ?? 1
  return span > 1 ? span * 88 + 'px' : '0px'
}

const ICON_SEND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
</script>

<template>
  <!-- 没有可用动作：自身返回空（不产出底栏 DOM；壳的包裹层不算） -->
  <div v-if="visible && hasActions" class="nb-root nodrag nopan" :style="panelStyle" data-testid="node-bottom-bar" @pointerdown.stop>
    <!-- 动作专属面板（video 剪辑时间轴这类） -->
    <component :is="(currentAction as any).panel" v-if="currentAction?.panel" :id="props.id" :data="props.data" />

    <!-- 大输入框（needsPrompt 才有；promptBinding:'text' 的动作输入框= data.text，由节点内容组件负责编辑，
         所以这里只渲染临时输入） -->
    <div v-if="showPrompt" class="nb-editor nodrag nopan nowheel" @click.stop>
      <input
        class="nb-input"
        :value="prompt"
        :placeholder="'描述你想' + (currentAction?.title || '执行的内容') + '…'"
        @input="onPromptInput"
      />
    </div>

    <!-- 一行控件 -->
    <div class="nb-row">
      <div class="nb-selects">
        <Select
          class="nb-action"
          :model-value="currentId"
          :options="actions.map((a) => ({ label: a.title, value: a.id }))"
          :disabled="running"
          dropdown-width="match"
          :input-id="'nb-action-' + props.id"
          title="选择动作"
          @update:model-value="(v: string | number) => selectAction(String(v))"
        />
        <div
          v-for="p in (currentAction?.fields ?? []) as ToolParamDef[]"
          :key="p.key"
          class="nb-field"
          :title="p.description || p.label || p.key"
          :style="{ flexGrow: 0, flexBasis: fieldBasis(p) }"
        >
          <ToolParamField
            :param="p"
            :model-value="values[p.key]"
            :disabled="running"
            :id-prefix="'nb-field-' + props.id"
            @update:model-value="(v: string | number | boolean) => onFieldChange(p.key, v)"
          />
        </div>
        <div v-if="templates.length" class="nb-field" title="套用预设模板">
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
        <span v-if="statusText" class="nb-status" :class="'is-' + runState.status" role="status">{{ statusText }}</span>
        <NodeToolbarButton v-if="currentAction?.icon && !running" :title="currentAction.title" :icon="currentAction.icon" />
        <button
          class="nb-run"
          :class="{ 'is-running': running }"
          type="button"
          :disabled="!canRun"
          :title="currentAction?.title || '执行'"
          @click.stop="onRun"
        >
          <span v-if="running" class="nb-spinner" aria-hidden="true" />
          <svg v-else class="nb-send-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICON_SEND" />
          <span>{{ running ? '执行中' : '执行' }}</span>
        </button>
      </div>
    </div>

    <!-- 进度条：running 时出现；有百分比按比例，没有走不确定态 -->
    <div v-if="running" class="nb-progress" aria-hidden="true">
      <div
        class="nb-progress-bar"
        :class="{ 'is-indeterminate': runState.progress === undefined }"
        :style="runState.progress === undefined ? undefined : { width: runState.progress + '%' }"
      />
    </div>
  </div>
</template>

<style scoped>
/* 视觉照 docs/design/ui-style-guide.md；位置（贴边/居中/反缩放）由壳的下插槽定位层给。 */
.nb-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  background: var(--ui-overlay-solid, #fff);
  box-shadow: var(--ui-shadow-md, 0 20px 40px rgba(0, 0, 0, 0.08));
}
.nb-editor {
  padding: 8px 10px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
}
.nb-input {
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--ntb-text-strong, #111827);
}
.nb-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.nb-selects {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.nb-field {
  flex: none;
  min-width: 80px;
  max-width: 160px;
}
.nb-field :deep(.sel-trigger) {
  padding: 5px 8px;
  font-size: 12px;
}
.nb-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.nb-info {
  font-size: 11px;
  color: var(--ui-ink-mute, #9ca3af);
  font-variant-numeric: tabular-nums;
}
.nb-status {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
}
.nb-status.is-error {
  color: var(--ui-danger, #ef4444);
}
.nb-status.is-running {
  color: var(--ntb-active-ink, #0e7490);
}
.nb-status.is-done {
  color: var(--ntb-text, #6b7280);
}
.nb-run {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: var(--ui-accent, #0891b2);
  color: var(--ui-tip-ink, #fff);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.15s ease-out, transform 0.15s ease-out;
}
.nb-run:hover:not(:disabled) {
  background: var(--ui-accent-hover, #0e7490);
}
.nb-run:active:not(:disabled) {
  transform: scale(0.97);
}
.nb-run:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.nb-run:focus-visible {
  outline: 2px solid var(--ntb-accent-ring, rgb(8 145 178 / 0.6));
  outline-offset: 1px;
}
.nb-send-icon {
  width: 14px;
  height: 14px;
}
.nb-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--ui-tip-ink, #fff) 45%, transparent);
  border-top-color: var(--ui-tip-ink, #fff);
  border-radius: 999px;
  animation: nb-spin 0.7s linear infinite;
}
@keyframes nb-spin {
  to {
    transform: rotate(360deg);
  }
}
.nb-progress {
  height: 2px;
  margin: -6px 2px 0;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ntb-fill, rgba(0, 0, 0, 0.04));
}
.nb-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: var(--ui-accent, #0891b2);
  transition: width 0.2s ease-out;
}
.nb-progress-bar.is-indeterminate {
  width: 32%;
  animation: nb-slide 1.2s ease-in-out infinite;
}
@keyframes nb-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(320%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .nb-run,
  .nb-progress-bar {
    transition: none !important;
  }
  .nb-spinner,
  .nb-progress-bar.is-indeterminate {
    animation: none;
  }
}
</style>

