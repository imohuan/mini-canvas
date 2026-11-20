<script setup lang="ts">
/**
 * BottomBarAiSettings —— 设置里「集成 → 智能助手 → 底栏 AI 工具」的整页。
 *
 * 用户口径（2026-11-20）：
 * 1. 配置从「画布 → 布局 → 控制栏」最下面搬到这里，放在「智能助手」下面、「平台」上面；
 * 2. 点「编辑」像 Agent 的模型配置那样**整页换成二级页**（返回按钮回列表）；
 * 3. 模型用下拉选：可以配一个通用模型，也可以每个按钮单独配；
 *    单按钮没配 → 用通用；单按钮配的那颗失效 → 也用通用兜底；
 * 4. 下拉直接复用底栏那件模型面板（BottomBarModelPicker），不再写第二套。
 *
 * 数据：按钮清单存 config/bottomBarAiActions，模型配置存 config/bottomBarAiModels。
 * 保存成功都广播事件，底栏立即生效（不必重挂载）。
 */
import { computed, ref, watch } from 'vue'
import { injectSettingsFieldRenderer, useCanvasRender, useUiComponent } from '@plume-canvas/canvas-render'
import type { SettingsPanelSource } from '@plume-canvas/canvas-render'
import { VueDraggable } from 'vue-draggable-plus'
import {
  loadAiActions,
  saveAiActions,
  normalizeAiActions,
  loadAiModels,
  saveAiModels,
  normalizeAiModelConfig,
  resolveAiActionModel,
  emptyAiModelConfig,
  resolveAgentBaseUrl,
  AI_ACTIONS_CHANGED_EVENT,
  AI_MODELS_CHANGED_EVENT,
  DEFAULT_AI_ACTIONS,
  TEMPLATE_VARS,
  AI_ICON_PRESETS,
  DEFAULT_AI_ICON,
  type AiActionConfig,
  type AiModelConfig,
  type AiModelChoice,
} from './aiActions'
import BottomBarModelPicker from './node-bottom-bar/BottomBarModelPicker.vue'
import { readAgentModels, refreshAgentModels } from './node-bottom-bar/modelPickerBridge'
import { resolveModelRowIcon, type ModelIconServiceLike } from './node-bottom-bar/actionIcon'

/** 关闭（清空）图标：线性 X，跟着按钮继承 currentColor */
const ICON_CLEAR =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'

const { ctx } = useCanvasRender()
/** 页面由设置皮以 page 渲染，会下发 settings 数据源与标准字段控件 */
const props = defineProps<{ settings?: SettingsPanelSource }>()
const SettingsField = injectSettingsFieldRenderer()
const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
const Switch = useUiComponent('Switch')
const Textarea = useUiComponent('Textarea')
const ShadcnSettingsRow = useUiComponent('settingsRow')
const ShadcnSettingsSection = useUiComponent('settingsSection')
const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')

/** 本地编辑副本（保存前不动云端） */
const draft = ref<AiActionConfig[]>(DEFAULT_AI_ACTIONS.map((a) => ({ ...a })))
/** 模型配置副本：通用 + 每个按钮单独指定 */
const modelsDraft = ref<AiModelConfig>(emptyAiModelConfig())
const selectedId = ref(draft.value[0]?.id ?? '')
/** 列表态 / 二级编辑态（用户 2026-11-20：点编辑整页切过去，不是展开一行） */
const editing = ref(false)
const busy = ref(false)
const saved = ref(false)
const error = ref('')
const syncing = ref(true)
/** 云端快照（脏比对的基准） */
const cloudActions = ref<AiActionConfig[]>([])
const cloudModels = ref<AiModelConfig>(emptyAiModelConfig())
let seq = 0

const textarea = ref<HTMLTextAreaElement | null>(null)

const baseUrl = (): string => resolveAgentBaseUrl(ctx)

async function reload(): Promise<void> {
  syncing.value = true
  try {
    const [actions, models] = await Promise.all([
      loadAiActions({ baseUrl: baseUrl() }),
      loadAiModels({ baseUrl: baseUrl() }),
    ])
    draft.value = normalizeAiActions(actions)
    modelsDraft.value = normalizeAiModelConfig(models)
    cloudActions.value = JSON.parse(JSON.stringify(draft.value)) as AiActionConfig[]
    cloudModels.value = JSON.parse(JSON.stringify(modelsDraft.value)) as AiModelConfig
    if (!draft.value.some((a) => a.id === selectedId.value)) selectedId.value = draft.value[0]?.id ?? ''
    error.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    syncing.value = false
  }
}

void reload()

const active = computed(() => draft.value.find((a) => a.id === selectedId.value))
const dirty = computed(
  () =>
    JSON.stringify(draft.value) !== JSON.stringify(cloudActions.value) ||
    JSON.stringify(modelsDraft.value) !== JSON.stringify(cloudModels.value),
)

/** Agent 的模型清单（下拉面板的数据源；没装 Agent 时为空，下拉会退回不可用） */
const agentModels = computed(() => readAgentModels(ctx).models)
watch(editing, (open) => {
  if (open) void refreshAgentModels(ctx)
})

function touch(): void {
  saved.value = false
}

function pick(id: string): void {
  selectedId.value = id
  editing.value = true
}

function backToList(): void {
  editing.value = false
}

function addAction(): void {
  const id = 'action-' + Date.now() + '-' + ++seq
  draft.value.push({ id, name: '新按钮', description: '', icon: DEFAULT_AI_ICON, template: '对下面的内容：\n\n{{prompt}}', enabled: true })
  selectedId.value = id
  editing.value = true
  touch()
}

function removeAction(id: string): void {
  draft.value = draft.value.filter((a) => a.id !== id)
  delete modelsDraft.value.perAction[id]
  if (selectedId.value === id) selectedId.value = draft.value[0]?.id ?? ''
  touch()
}

/**
 * 拖动排序（用户 2026-11-20：不要上下箭头，用 vue-draggable-plus）。
 *
 * 列表顺序就是底栏按钮顺序，所以拖完只改本地副本，点保存才落库。
 * 用受控写法（:model-value + @update:model-value）：sortablejs 只负责“挪”的动画，
 * 真数据始终是 draft，避免两套顺序打架。
 */
function onReorder(next: AiActionConfig[]): void {
  const ids = new Set(draft.value.map((a) => a.id))
  // 只接受同一批条目（防拖拽过程中有增删，回传了不认识的对象）
  if (next.length !== draft.value.length || next.some((a) => !ids.has(a.id))) return
  draft.value = next
  touch()
}

function restoreDefaults(): void {
  draft.value = DEFAULT_AI_ACTIONS.map((a) => ({ ...a }))
  selectedId.value = draft.value[0]?.id ?? ''
  touch()
}

function insertToken(token: string): void {
  const cur = active.value
  if (!cur) return
  const el = textarea.value
  if (!el) {
    cur.template += token
    touch()
    return
  }
  const start = el.selectionStart ?? cur.template.length
  const end = el.selectionEnd ?? start
  cur.template = cur.template.slice(0, start) + token + cur.template.slice(end)
  touch()
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(start + token.length, start + token.length)
  })
}

function pickPresetIcon(svg: string): void {
  const cur = active.value
  if (!cur) return
  cur.icon = svg
  touch()
}

// ==================== 模型 ====================

/** 「能用」= Agent 清单里有它且有密钥；清单为空（没装 Agent / 还在拉）时不判死 */
function usable(choice: AiModelChoice): boolean {
  const list = agentModels.value
  if (!list.length) return true
  const hit = list.find((m) => m.provider === choice.provider && m.modelId === choice.modelId)
  return Boolean(hit?.hasKey)
}

function modelLabel(choice: AiModelChoice | null): string {
  if (!choice) return ''
  const hit = agentModels.value.find((m) => m.provider === choice.provider && m.modelId === choice.modelId)
  return hit?.displayName || choice.modelId
}

/** 模型图标服务（Agent 提供；没装 Agent 时退回本地家族表，绝不空白） */
const iconService = computed(() => ctx.tryGet<ModelIconServiceLike>('modelIcons'))

/**
 * 列表里那颗模型自己的图标（用户 2026-11-20）：
 * 选了具体模型就把平台图标画出来，与下拉面板同一把尺子。
 * 返回 null = 走「通用模型」，那行不画图标（避免和按钮图标混淆）。
 */
function modelIconOf(id: string): { tone: string; svg: string } | null {
  if (!modelsDraft.value.perAction[id]) return null
  const m = effectiveModel(id)
  if (!m) return null
  const hit = agentModels.value.find((x) => x.provider === m.provider && x.modelId === m.modelId)
  return resolveModelRowIcon(m.modelId, m.provider, iconService.value, hit?.displayName)
}

/** 通用模型的下拉当前值：显式配过就显示它；没配过就显示 Agent 当前默认，并标成“跟随” */
const defaultSlot = computed<{ model: AiModelChoice | null; placeholder?: string }>(() => {
  if (modelsDraft.value.default) return { model: modelsDraft.value.default }
  return { model: null, placeholder: '跟随智能助手默认' }
})

function setDefaultModel(m: AiModelChoice): void {
  modelsDraft.value.default = m
  touch()
}

function clearDefaultModel(): void {
  modelsDraft.value.default = null
  touch()
}

function setActionModel(id: string, m: AiModelChoice): void {
  modelsDraft.value.perAction[id] = m
  touch()
}

function clearActionModel(id: string): void {
  delete modelsDraft.value.perAction[id]
  touch()
}

/** 这一行实际会用哪颗（作为下拉的当前值；失效时已经是兜底后的结果） */
function effectiveModel(id: string): AiModelChoice | null {
  return resolveAiActionModel(id, modelsDraft.value, usable)
}

/** 单独配了、但当前用不了 —— 界面上要说清楚“现在走通用模型” */
function isOwnModelBroken(id: string): boolean {
  const own = modelsDraft.value.perAction[id]
  return Boolean(own && !usable(own))
}

async function save(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const [a, m] = await Promise.all([
      saveAiActions(draft.value, { baseUrl: baseUrl() }),
      saveAiModels(modelsDraft.value, { baseUrl: baseUrl() }),
    ])
    if (!a.ok || !m.ok) {
      error.value = a.error ?? m.error ?? '保存失败'
      return
    }
    cloudActions.value = JSON.parse(JSON.stringify(draft.value)) as AiActionConfig[]
    cloudModels.value = JSON.parse(JSON.stringify(modelsDraft.value)) as AiModelConfig
    saved.value = true
    ctx.emit(AI_ACTIONS_CHANGED_EVENT, {
      actions: JSON.parse(JSON.stringify(draft.value)) as AiActionConfig[],
      ...(baseUrl() ? { baseUrl: baseUrl() } : {}),
    })
    ctx.emit(AI_MODELS_CHANGED_EVENT, {
      models: JSON.parse(JSON.stringify(modelsDraft.value)) as AiModelConfig,
      ...(baseUrl() ? { baseUrl: baseUrl() } : {}),
    })
    ctx.tryGet<{ success(message: string): unknown }>('notify')?.success('底栏 AI 工具设置已保存')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="bas">
    <!-- 二级页页头：返回 + 标题（与 Agent 模型接入的“列表 → 编辑”同一种手感） -->
    <header v-if="editing" class="bas-head">
      <Button variant="ghost" size="xs" type="button" class="bas-back" @click="backToList">
        ← 返回按钮列表
      </Button>
      <div class="bas-head-text">
        <h3 class="bas-title">{{ active ? active.name : '编辑按钮' }}</h3>
        <p class="bas-desc">这个按钮的名字、图标、提示词，以及它调用哪颗模型。</p>
      </div>
    </header>

    <p v-if="error" class="bas-error">{{ error }}</p>
    <p v-if="syncing" class="bas-hint">正在读取云端配置…（下面先显示内置默认，读到后自动替换）</p>

    <!-- ==================== 列表态 ==================== -->
    <template v-if="!editing">
      <ShadcnSettingsSection
        title="模型"
        description="没单独配的按钮都走通用模型；单独配的那颗失效时也会回到通用模型。留空 = 用智能助手的默认模型。"
      >
        <ShadcnSettingsRow label="通用模型" description="所有底栏 AI 按钮共用的模型" class="bas-row-item">
          <div class="bas-model-slot">
            <BottomBarModelPicker
              :models="agentModels"
              :model="defaultSlot.model"
              :placeholder="defaultSlot.placeholder"
              @pick="setDefaultModel"
            />
            <!-- 清空 = 回到「跟随智能助手默认」；用图标按钮省地方（用户 2026-11-20） -->
            <TooltipProvider v-if="modelsDraft.default" :delay-duration="220">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="ghost" size="icon-xs" type="button" class="bas-clear"
                    aria-label="清空通用模型，改跟随智能助手默认" @click="clearDefaultModel">
                    <span aria-hidden="true" v-html="ICON_CLEAR" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">跟随智能助手默认</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </ShadcnSettingsRow>
      </ShadcnSettingsSection>

      <ShadcnSettingsSection title="底栏 AI 按钮" description="列表顺序就是底栏按钮顺序；点「编辑」进入设置页。" class="bas-card">
        <div class="bas-quickrow">
          <span class="bas-count">{{ draft.length }} 个</span>
          <Button variant="outline" size="xs" :disabled="syncing" @click="addAction">新增</Button>
          <Button variant="ghost" size="xs" :disabled="syncing" @click="restoreDefaults">恢复默认</Button>
        </div>
        <!-- 拖动排序：把手是左侧图标（悬停出现），行本身不整行可拖，避免误触「编辑」 -->
        <VueDraggable
          class="bas-list"
          role="list"
          :model-value="draft"
          :animation="180"
          handle=".bas-grip"
          ghost-class="bas-row--ghost"
          chosen-class="bas-row--chosen"
          :force-fallback="true"
          @update:model-value="onReorder"
        >
          <div v-for="a in draft" :key="a.id" class="bas-row" role="listitem"
            :class="{ 'is-off': !a.enabled }">
            <span class="bas-grip" title="拖动调整顺序" :aria-label="'拖动 ' + a.name + ' 调整顺序'">
              <span class="bas-grip-icon" aria-hidden="true" />
            </span>
            <span class="bas-icon" aria-hidden="true" v-html="a.icon || DEFAULT_AI_ICON" />
            <span class="bas-name">{{ a.name }}<small v-if="a.builtin" class="bas-builtin">内置</small></span>
            <span class="bas-model" :class="{ 'is-broken': isOwnModelBroken(a.id) }" :title="isOwnModelBroken(a.id) ? '单独配的模型当前不可用，已改用通用模型' : ''">
              <!-- 选了具体模型：图标 + 名字（用户 2026-11-20「模型显示图标」）；没选才写「通用模型」 -->
              <template v-if="modelsDraft.perAction[a.id]">
                <span class="bas-model-badge" aria-hidden="true" v-html="modelIconOf(a.id)?.svg" />
                <span class="bas-model-text">
                  <template v-if="isOwnModelBroken(a.id)">已失效 → </template>{{ modelLabel(effectiveModel(a.id)) || '默认模型' }}
                </span>
              </template>
              <span v-else class="bas-model-text">通用模型</span>
            </span>
            <span class="bas-acts">
              <Button variant="ghost" size="xs" @click="pick(a.id)">编辑</Button>
              <Switch :model-value="a.enabled" :aria-label="a.name + '：显示或隐藏'"
                @update:model-value="a.enabled = $event; touch()" />
              <Button variant="destructive" size="xs" aria-label="删除" @click="removeAction(a.id)">删除</Button>
            </span>
          </div>
        </VueDraggable>
        <p v-if="!draft.length" class="bas-hint">还没有按钮，点「新增」或「恢复默认」。</p>
      </ShadcnSettingsSection>

      <!-- Config 里的标量项跟着这一页走（不靠 section 平铺，页面里自己画） -->
      <ShadcnSettingsSection v-if="SettingsField && props.settings" title="请求" class="bas-card">
        <component
          :is="SettingsField"
          group="集成/底栏 AI 工具"
          field-key="bottomBarAiRetries"
          :settings="props.settings"
        />
      </ShadcnSettingsSection>
    </template>

    <!-- ==================== 二级编辑页 ==================== -->
    <template v-else-if="active">
      <ShadcnSettingsSection title="按钮" class="bas-card">
        <ShadcnSettingsRow label="名称" description="显示在底栏按钮的提示里" class="bas-row-item">
          <Input v-model="active.name" class="bas-input" placeholder="例如：优化提示词" @input="touch()" />
        </ShadcnSettingsRow>
        <!-- 描述可能是一整句：用户 2026-11-20 要求整行 textarea，不挤在 half 宽里 -->
        <ShadcnSettingsRow label="描述" description="鼠标悬停时的小字说明（可留空）" stacked class="bas-row-item">
          <Textarea v-model="active.description" class="bas-textarea" rows="2"
            placeholder="一句话说明这个按钮做什么" @input="touch()" />
        </ShadcnSettingsRow>
      </ShadcnSettingsSection>

      <ShadcnSettingsSection
        title="调用模型"
        description="不选 = 跟随通用模型。只配了一个通用模型时，这里不用动。"
        class="bas-card"
      >
        <ShadcnSettingsRow label="这个按钮的模型" description="选「跟随通用模型」就与上面的通用模型保持一致" class="bas-row-item">
          <div class="bas-model-slot">
            <BottomBarModelPicker
              :models="agentModels"
              :model="modelsDraft.perAction[active.id] ?? null"
              placeholder="跟随通用模型"
              @pick="(m) => setActionModel(active!.id, m)"
            />
            <TooltipProvider v-if="modelsDraft.perAction[active.id]" :delay-duration="220">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="ghost" size="icon-xs" type="button" class="bas-clear"
                    aria-label="清空这个按钮的模型，改跟随通用模型" @click="clearActionModel(active.id)">
                    <span aria-hidden="true" v-html="ICON_CLEAR" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">跟随通用模型</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </ShadcnSettingsRow>
        <p class="bas-hint">
          实际使用：{{ modelLabel(effectiveModel(active.id)) || '智能助手默认模型' }}
          <template v-if="modelsDraft.perAction[active.id] && isOwnModelBroken(active.id)">
            —— 单独配的那颗现在不可用，已回落到通用模型。
          </template>
        </p>
      </ShadcnSettingsSection>

      <ShadcnSettingsSection title="图标" class="bas-card">
        <div class="bas-block">
          <div class="bas-icons" role="radiogroup" aria-label="图标预设">
          <button
            v-for="p in AI_ICON_PRESETS"
            :key="p.key"
            type="button"
            role="radio"
            class="bas-icon-btn"
            :class="{ 'is-on': active.icon === p.svg }"
            :aria-checked="active.icon === p.svg"
            :title="p.label"
            @click="pickPresetIcon(p.svg)"
          >
            <span aria-hidden="true" v-html="p.svg" />
          </button>
          </div>
          <Textarea
            v-model="active.icon"
            class="bas-textarea bas-svg-input"
            rows="2"
            spellcheck="false"
            aria-label="自定义图标 SVG"
            placeholder="也可以贴自己的 SVG（viewBox 0 0 24 24，stroke=currentColor）。留空 = 用默认星星。"
            @input="touch()"
          />
          <div class="bas-svg-preview">
            <span class="bas-label">当前预览</span>
            <span class="bas-icon" aria-hidden="true" v-html="active.icon || DEFAULT_AI_ICON" />
          </div>
        </div>
      </ShadcnSettingsSection>

      <ShadcnSettingsSection title="提示词模板" description="AI 返回的正文会直接替换输入框内容；思考段会被自动过滤。" class="bas-card">
        <div class="bas-block">
          <Textarea ref="textarea" v-model="active.template" class="bas-textarea" rows="10"
            placeholder="写这条按钮的系统提示词…可用 {{prompt}} 等变量" @input="touch()" />
          <div class="bas-chips">
            <button v-for="v in TEMPLATE_VARS" :key="v.token" class="bas-chip" :title="v.description"
              @click="insertToken(v.token)">
              <code>{{ v.token }}</code>
            </button>
          </div>
        </div>
      </ShadcnSettingsSection>
    </template>

    <p v-else class="bas-hint">这个按钮已经不在了，返回列表再选一个。</p>

    <!-- 保存条：固定在滚动容器底部，长表单翻到哪都按得到 -->
    <div class="bas-foot">
      <span v-if="saved" class="bas-ok">已保存 · 底栏即时生效</span>
      <span v-else-if="dirty" class="bas-hint">有未保存的修改</span>
      <span v-else class="bas-hint">与云端一致</span>
      <Button :disabled="busy || !dirty" @click="save">{{ busy ? '保存中…' : '保存' }}</Button>
    </div>
  </div>
</template>

<style scoped>
/* 观感对齐 Agent 设置页（数值照 ui-style-guide；颜色全走 --ui-* token） */
.bas { display: flex; flex-direction: column; gap: 14px; }
/*
 * 卡片上下留白统一（用户 2026-11-20 截图）：
 * 默认设置皮的卡片正文只有 2px 上下 padding，第一行和最后一行会贴着边框 ——
 * 这里统一补一圈，所有卡片（列表 / 编辑 / 请求）看起来一致。
 * 行自身的 10px 上下内边距仍保留，所以视觉上是「卡片边框 → 8px → 行」。
 */
.bas :deep(.shadcn-settings-section__body) { padding: 8px 16px; }
.bas-row-item { min-width: 0; }
/* 卡片里不属于「行」的内容块（图标区 / 提示词模板）：上下留白 + 全宽 */
.bas-block { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; min-width: 0; }
.bas-head { display: flex; flex-direction: column; gap: 6px; padding-bottom: 8px; position: sticky; top: 0; z-index: 2; background: var(--ui-panel, #fff); }
.bas-back { align-self: flex-start; margin-left: -8px; padding-inline: 8px; color: var(--ui-ink-dim, #6b7280); }
.bas-head-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.bas-title { margin: 0; font-size: 14px; font-weight: 700; color: var(--ui-ink, #18202b); }
.bas-desc { margin: 0; font-size: 11px; line-height: 1.55; color: var(--ui-ink-dim, #6b7280); }
.bas-hint { margin: 0; font-size: 10px; color: var(--ui-ink-dim, #6b7280); }
.bas-error { margin: 0; padding: 8px 10px; border: 1px solid var(--ui-danger, #ef4444); border-radius: 8px; font-size: 12px; color: var(--ui-danger, #ef4444); }
.bas-ok { font-size: 10px; color: var(--ui-accent, #0891b2); }
.bas-quickrow { display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding: 4px 0; }
.bas-count { margin-right: auto; font-size: 10px; color: var(--ui-ink-dim, #6b7280); }
.bas-list { display: flex; flex-direction: column; }
.bas-row { display: grid; grid-template-columns: 16px 24px minmax(0, 0.9fr) minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--ui-line-soft, #eef0f4); }
.bas-row--ghost { opacity: 0.45; }
.bas-row--chosen { background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); }
/* 拖拽把手：平时淡淡的，悬停整行才明显；图标用两条竖线画（不引额外依赖） */
.bas-grip { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 24px; color: var(--ui-ink-mute, #9ca3af); opacity: 0.45; cursor: grab; transition: opacity 0.12s ease; }
.bas-row:hover .bas-grip { opacity: 1; }
.bas-grip:active { cursor: grabbing; }
.bas-grip-icon { width: 8px; height: 12px; background-image: radial-gradient(circle, currentColor 1px, transparent 1.2px); background-size: 4px 4px; background-position: 0 0; }
.bas-row.is-off { opacity: 0.55; }
.bas-icon { display: inline-flex; width: 16px; height: 16px; color: var(--ui-ink-dim, #6b7280); }
.bas-icon :deep(svg) { width: 100%; height: 100%; }
.bas-name { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; color: var(--ui-ink, #18202b); }
.bas-builtin { font-size: 9px; padding: 0 5px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 999px; color: var(--ui-ink-dim, #6b7280); }
.bas-model { min-width: 0; font-size: 11px; color: var(--ui-ink-dim, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bas-model { display: inline-flex; align-items: center; gap: 6px; }
.bas-model-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bas-model-badge { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 16px; height: 16px; border-radius: 4px; background: var(--ui-hover-soft, rgb(0 0 0 / 0.05)); color: var(--ui-ink-dim, #6b7280); }
.bas-model-badge :deep(svg), .bas-model-badge :deep(img) { width: 12px; height: 12px; display: block; }
.bas-model.is-broken { color: var(--ui-warn, #b45309); }
.bas-acts { display: flex; align-items: center; gap: 4px; }
.bas-model-slot { display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; justify-content: flex-end; }
.bas-clear { flex: none; color: var(--ui-ink-mute, #8c95a3); }
.bas-clear:hover { color: var(--ui-ink, #18202b); }
.bas-clear svg { width: 14px; height: 14px; display: block; }
.bas-input { width: 100%; max-width: 320px; }
.bas-label { font-size: 11px; color: var(--ui-ink-dim, #6b7280); }
.bas-textarea { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: var(--ui-panel, #fff); color: var(--ui-ink, #18202b); font-size: 12px; outline: none; font-family: inherit; line-height: 1.6; resize: vertical; }
.bas-icons { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 0 6px; }
.bas-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: transparent; color: var(--ui-ink-dim, #6b7280); cursor: pointer; }
.bas-icon-btn.is-on { border-color: var(--ui-accent, #0891b2); background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); color: var(--ui-accent, #0891b2); }
.bas-icon-btn :deep(svg) { width: 15px; height: 15px; }
.bas-svg-input { margin-top: 4px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; }
.bas-svg-preview { display: flex; align-items: center; gap: 8px; padding-top: 6px; }
.bas-chips { display: flex; flex-wrap: wrap; gap: 4px; padding-top: 6px; }
.bas-chip { height: 22px; padding: 0 8px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 999px; background: transparent; color: var(--ui-ink-dim, #6b7280); font-size: 10px; cursor: pointer; }
.bas-chip:hover { border-color: var(--ui-ink-mute, #8c95a3); color: var(--ui-ink, #18202b); }
.bas-chip code { font-family: var(--font-mono, ui-monospace, monospace); }
.bas-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; position: sticky; bottom: 0; z-index: 1; padding: 8px 0; background: var(--ui-panel, #fff); border-top: 1px solid var(--ui-line-soft, #eef0f4); }
.bas-foot .bas-hint, .bas-foot .bas-ok { margin-right: auto; }
</style>
