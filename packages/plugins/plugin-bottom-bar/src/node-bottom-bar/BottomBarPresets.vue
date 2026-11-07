<script setup lang="ts">
/**
 * 底栏「预设提示词」按钮 + 面板（用户 2026-11-06 图 1 / 图 2）。
 *
 * 只做一件事：把用户自己攒的几句常用提示词存起来，点一下填进输入框。
 * 数据存在本机 localStorage（promptPresets.ts），不碰云端配置。
 *
 * 为什么单独一个组件、一套 nbp- 类名：
 * 底栏的 BottomBarActions / 样式表正在被另一个任务改，这里尽量自成一块，
 * 只在底行借一个插槽把按钮放进去，减少两边同时改同一段代码的机会。
 *
 * 插入方式（用户口径「可以添加一些自己的提示词」）：输入框为空就直接填入；
 * 已有内容就接在后面，不覆盖用户正在写的东西。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { NotifyContract } from '@mini-canvas/canvas-base'
import {
  addPreset,
  createTypedPreset,
  filterPresets,
  presetBucketOf,
  presetEnabled,
  removePreset,
  type PresetBucket,
  type PromptPreset,
} from '../promptPresets'
import { loadPresets, savePresets } from '../presetStore'
import { resolveAgentBaseUrl } from '../aiActions'
import type { ToolParamDef } from '@mini-canvas/kernel'
import { modelIconOf, type ModelIcon } from './modelIcons'
import { ICON_BOOKMARK, ICON_PLUS, ICON_SEARCH, ICON_TRASH } from './presetIcons'

const props = defineProps<{
  /** 输入框不可用时（没有输入框 / AI 生成中）也不允许插入 */
  disabled: boolean
  /**
   * 当前节点类型（text / image / video / audio …）。
   * 预设按类型分开存（用户 2026-11-07：不同平台 / 类型的预设是分开的）。
   */
  nodeType?: string
  /** 当前模式有没有可填入的位置；没有时按钮仍显示，但点击要给明确提示 */
  hasTarget?: boolean
  /** 本节点当前可用的动作 id（判断「指定模型」的预设是否禁用） */
  availableIds?: string[]
  /** 供用户挑选的模型清单（id + 名字 + 参数定义），新建预设时用 */
  modelChoices?: Array<{
    id: string
    title: string
    params: ToolParamDef[]
    /** provider 在动作声明里带的模板（只读，跟动作一起上下线） */
    templates?: Array<{ id: string; name: string; prompt: string; description?: string; values?: Record<string, unknown> }>
  }>
  /** 当前下拉里选中的动作 id（新建预设默认对准它） */
  currentId?: string
}>()

const emit = defineEmits<{
  /** 用户点了某条预设：把正文放进输入框（已有内容时接在后面） */
  apply: [content: string]
  /** 应用一条「带模型 / 参数」的预设：调用方负责切模型 + 写参数 */
  applyPreset: [preset: PromptPreset]
}>()

const { ctx } = useCanvasRender()
const notify = ctx.tryGet<NotifyContract>('notify')

/** 面板标题旁的类型标签（文本预设 / 图片预设…）：同一台电脑上每类各一份清单 */
const TYPE_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  panorama: '全景',
  group: '分组',
}
const typeLabel = computed(() => {
  const t = String(props.nodeType ?? '').trim().toLowerCase()
  return t ? (TYPE_LABELS[t] ?? t) : ''
})

const Button = useUiComponent('Button')
const Popover = useUiComponent('Popover')
const PopoverContent = useUiComponent('PopoverContent')
const PopoverTrigger = useUiComponent('PopoverTrigger')
const InputGroup = useUiComponent('InputGroup')
const InputGroupAddon = useUiComponent('InputGroupAddon')
const InputGroupButton = useUiComponent('InputGroupButton')
const InputGroupInput = useUiComponent('InputGroupInput')
const ScrollArea = useUiComponent('ScrollArea')
const Tabs = useUiComponent('Tabs')
const TabsList = useUiComponent('TabsList')
const TabsTrigger = useUiComponent('TabsTrigger')
/** 适用模型面板 = Agent 的 ChoicePicker（图2那套卡片/分栏），取不到时回退简版菜单 */
const AgentChoicePicker = useUiComponent('agentChoicePicker')
const Label = useUiComponent('Label')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const Dialog = useUiComponent('Dialog')
const DialogContent = useUiComponent('DialogContent')
const DialogDescription = useUiComponent('DialogDescription')
const DialogFooter = useUiComponent('DialogFooter')
const DialogHeader = useUiComponent('DialogHeader')
const DialogTitle = useUiComponent('DialogTitle')
const Input = useUiComponent('Input')
const Textarea = useUiComponent('Textarea')

const open = ref(false)
const query = ref('')
/** 首次打开才读取；之后新增/删除都直接改这份内存副本，避免每次开关都读一遍 */
const loaded = ref(false)
const presets = ref<PromptPreset[]>([])

/**
 * provider 带来的预设（来自动作声明的 templates）。
 *
 * 它们是**只读**的：跟着 provider 文件走，用户删不掉 —— 删了下次装载又回来，
 * 反而制造「删了又出现」的困惑。要改就去改 provider 文件。
 */
const providerPresets = computed<PromptPreset[]>(() => {
  const out: PromptPreset[] = []
  for (const m of props.modelChoices ?? []) {
    for (const t of m.templates ?? []) {
      if (!t || typeof t.prompt !== 'string') continue
      const content = t.prompt.trim()
      if (!content) continue
      out.push({
        id: 'provider:' + m.id + ':' + t.id,
        name: t.name || t.id,
        content,
        createdAt: 0,
        actionId: m.id,
        source: 'provider',
        ...(t.values && Object.keys(t.values).length > 0 ? { values: { ...t.values } } : {}),
      })
    }
  }
  return out
})

/** 面板里显示的完整清单：provider 的在前，用户自己的在后 */
const allPresets = computed(() => [...providerPresets.value, ...presets.value])
/** 存在哪儿：后台 / 本机（面板底部一句话说明，用户不用猜） */
const where = ref<'cloud' | 'local'>('local')
const loadError = ref('')
/** 五个分类：provider / 通用 / 指定模型 / 当前模型 / 禁用 */
type TabKey = 'provider' | 'general' | 'model' | 'current' | 'disabled'
const tab = ref<TabKey>('current')
const canApply = computed(() => {
  const ids = new Set(props.availableIds ?? [])
  return (p: PromptPreset) => presetEnabled(p, ids)
})

/** 当前分类下的条目（搜索再筛一层） */
const inTab = computed(() => {
  const ids = new Set(props.availableIds ?? [])
  // 禁用页单独看：只收当前节点用不了的那批（通用预设永远可用，不会出现在这里）
  if (tab.value === 'disabled') {
    return allPresets.value.filter((p) => !presetEnabled(p, ids))
  }
  return allPresets.value.filter((p) => {
    const bucket: PresetBucket = presetBucketOf(p)
    if (tab.value === 'provider') return bucket === 'provider'
    if (tab.value === 'general') return bucket === 'general'
    if (tab.value === 'model') return bucket === 'model'
    // current：当前模型的 + 通用的（用户口径：这个分类里通用也算）
    return bucket === 'general' || (bucket === 'model' && presetEnabled(p, ids))
  })
})

const filtered = computed(() => {
  const list = filterPresets(inTab.value, query.value)
  // 禁用页本身就是筛过的，其它页把用不了的藏掉
  return tab.value === 'disabled' ? list : list.filter((p) => canApply.value(p))
})

/** 全部清单里的禁用条数（页签上显示，避免用户以为丢了） */
const disabledCount = computed(() => filterPresets(allPresets.value, query.value).filter((p) => !canApply.value(p)).length)

/**
 * 没有内容的页签**不渲染**（用户 2026-11-07：没有 provider / 没有禁用就不显示对应 tab）。
 * 当前页签被隐藏时自动跳回「当前模型」，避免停在一个不存在的页签上。
 */
const hasProviderTab = computed(() => providerPresets.value.length > 0)
const hasDisabledTab = computed(() => disabledCount.value > 0)
watch([hasProviderTab, hasDisabledTab], () => {
  if (tab.value === 'provider' && !hasProviderTab.value) tab.value = 'current'
  if (tab.value === 'disabled' && !hasDisabledTab.value) tab.value = 'current'
})

/**
 * 列表高度：**固定**，不跟条数变（用户 2026-11-07：切换页签时高度跳来跳去）。
 *
 * 以前按条数算高度（弹层贴着内容），代价是切页签 / 搜索时面板一跳一跳。
 * 而且高度要钉在**整个内容区**上：列表态和空态都用同一块地皮（用户 2026-11-07
 * 第二轮反馈：有数据和空数据切换时高度也在变 —— 空态自身的 min-height 和列表
 * 高度对不上）。条目多时靠 ScrollArea 内部滚动。
 */
const LIST_HEIGHT = '256px'
const bodyStyle = computed<Record<string, string>>(() => ({ height: LIST_HEIGHT }))

const baseUrl = (): string => resolveAgentBaseUrl(ctx)

async function reload(): Promise<void> {
  const r = await loadPresets({ baseUrl: baseUrl(), nodeType: props.nodeType })
  presets.value = r.list
  where.value = r.fromCloud ? 'cloud' : 'local'
  loadError.value = r.error ?? ''
  loaded.value = true
}

// 打开面板时同步一次：用户可能在另一个标签页改过（storage 事件不保证）
watch(open, (isOpen) => {
  if (!isOpen) return
  void reload()
  query.value = ''
})

async function persist(): Promise<boolean> {
  const r = await savePresets(presets.value, { baseUrl: baseUrl(), nodeType: props.nodeType })
  where.value = r.where
  if (!r.ok) {
    notify?.error('预设保存失败', { description: r.error ?? '存储不可用' })
    return false
  }
  // 后台失败但本机存住了：仍然生效，只是要告诉用户存在哪
  if (r.where === 'local' && r.error) notify?.info('预设暂存在本机', { description: r.error })
  return true
}

function use(preset: PromptPreset): void {
  // 点了用不了的预设要给明确提示，不能静默什么都不发生
  if (!canApply.value(preset)) {
    notify?.info('当前节点用不了这个模型', { description: '这份预设仍会保留，换到对应模型的节点即可使用' })
    return
  }
  // 没有输入框可填的模式（音频等）：仍可以打开面板、管理预设，
  // 但点「使用」要给明确提示，不能静默什么都不发生（用户 2026-11-07：所有类型都有预设按钮）。
  if (props.hasTarget === false) {
    notify?.info('当前模式没有可填入的位置', { description: '这份预设已保存，切换到有输入框的模式即可使用' })
    return
  }
  // 带模型 / 参数的预设交给调用方切模型与写参数；纯提示词仍走原来的插入
  if (preset.actionId || preset.values) emit('applyPreset', preset)
  else if (preset.content.trim()) emit('apply', preset.content)
  open.value = false
}

function remove(id: string): void {
  // provider 的预设是只读的：删了下次装载还会回来，别让用户白删一次
  if (id.startsWith('provider:')) {
    notify?.info('provider 自带的预设不能删', { description: '要改请改 provider 文件里的 templates' })
    return
  }
  presets.value = removePreset(presets.value, id)
  void persist()
}

// —— 新建对话框 ——
const creating = ref(false)
const draftName = ref('')
const draftContent = ref('')
/** 新建时选的目标模型（空串 = 通用，不绑模型） */
const draftActionId = ref('')
/** 新建时挑的参数值（用模型自己的参数定义渲染，跟下拉里同一套控件） */
const draftValues = ref<Record<string, unknown>>({})
const nameInput = ref<{ $el?: HTMLElement } | null>(null)

const canSaveDraft = computed(() => draftContent.value.trim().length > 0)

/** 新建弹窗里当前模型的可视化参数定义 */
const draftParams = computed<ToolParamDef[]>(() => {
  const hit = (props.modelChoices ?? []).find((m) => m.id === draftActionId.value)
  return hit?.params ?? []
})

const ToolParamGroup = useUiComponent('toolParamGroup')

/** 新建弹窗里「适用模型」触发器上的文字 */
const draftModelLabel = computed(() => {
  if (!draftActionId.value) return '通用（所有模型）'
  return labelOfAction(draftActionId.value)
})

/**
 * 适用模型面板复用底栏那套卡片/分栏选择器（用户 2026-11-07 第二轮：
 * 要的是图2那个带搜索、卡片、分栏的面板，不是简单菜单）。
 * Agent 未装（取不到组件）时回退到底栏同款的简版 DropdownMenu。
 */
const draftModelIcon = computed<ModelIcon | null>(() => {
  if (!draftActionId.value) return null
  const hit = (props.modelChoices ?? []).find((m) => m.id === draftActionId.value)
  return hit ? modelIconOf(hit.title) : null
})

/** 弹窗里的模型选项：图标（底栏同源）+ 名称 + id */
const draftModelOptions = computed(() =>
  (props.modelChoices ?? []).map((m) => ({ id: m.id, title: m.title, icon: modelIconOf(m.title) })),
)

const agentPickerReady = computed(() => Boolean(AgentChoicePicker.value))

/** ChoicePicker 的一行：id / 标题 / 副标题 / 图标 */
const choiceItems = computed(() =>
  draftModelOptions.value.map((o) => ({
    id: o.id,
    title: o.title,
    subtitle: '预设可用模型',
    platform: o.title,
    isDefault: o.id === draftActionId.value,
  })),
)

/** 换模型：旧参数按新模型重置，避免把 A 模型的参数写进 B 模型 */
function onDraftModelChange(id: string): void {
  draftActionId.value = id
  const next: Record<string, unknown> = {}
  for (const p of draftParams.value) if (p.default !== undefined) next[p.key] = p.default
  draftValues.value = next
}

function onDraftFieldChange(key: string, v: string | number | boolean): void {
  draftValues.value = { ...draftValues.value, [key]: v }
}

function startCreate(): void {
  draftName.value = ''
  draftContent.value = ''
  // 新建时默认对准「当前选中的模型」：用户多半就是为它建预设
  draftActionId.value = (props.availableIds ?? []).includes(props.currentId ?? '')
    ? (props.currentId ?? '')
    : ''
  const defaults: Record<string, unknown> = {}
  for (const p of draftParams.value) if (p.default !== undefined) defaults[p.key] = p.default
  draftValues.value = defaults
  /*
   * 打开新建弹窗前先收起预设面板（用户 2026-11-07 截图）。
   *
   * 光关 open 还不够：面板是 Teleport 到 body 的菜单层（--ui-layer-menu，100002），
   * 对话框在下面一档（--ui-layer-dialog，100000）。关闭动画期间节点仍在 body 上，
   * 会盖住刚打开的弹窗 —— 所以模板里再给 PopoverContent 挂 v-if="!creating"，
   * 让它在这几百毫秒里直接不渲染。也符合「同屏只开一个浮层」的规矩。
   */
  open.value = false
  creating.value = true
  void nextTick(() => {
    // Input 是组件，$el 才是原生元素；拿不到就退回 querySelector（同屏只有一个新建框）
    const el =
      (nameInput.value?.$el as HTMLElement | undefined)
      ?? (document.querySelector('.nbp-dialog input') as HTMLInputElement | null)
    el?.focus?.()
  })
}

function saveDraft(): void {
  if (!canSaveDraft.value) return
  const preset = createTypedPreset({
    name: draftName.value,
    content: draftContent.value,
    ...(draftActionId.value ? { actionId: draftActionId.value } : {}),
    ...(Object.keys(draftValues.value).length > 0 ? { values: draftValues.value } : {}),
  })
  // 新建的内容直接填进输入框，省一步「再点一次」；用户明确要的就是「能加自己的提示词」
  presets.value = addPreset(presets.value, preset)
  void persist().then((ok) => {
    if (!ok) return
    creating.value = false
    if (preset.actionId || preset.values) emit('applyPreset', preset)
    else emit('apply', preset.content)
    open.value = false
    notify?.success('已使用新预设', { description: preset.name })
  })
}

/** 列表里内容预览：换行压成空格，避免一条预设把面板撑得很高 */
function previewOf(content: string): string {
  return content.replace(/\s+/g, ' ').trim()
}

/** 模型 id → 给人看的名字（找不到就退回 id 尾段，总比空白强） */
function labelOfAction(id: string): string {
  const hit = (props.modelChoices ?? []).find((m) => m.id === id)
  return hit?.title ?? id
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        class="nb-icon-btn nbp-trigger"
        :class="{ 'is-active': open }"
        type="button"
        :disabled="disabled"
        title="预设提示词"
        aria-label="预设提示词"
        aria-haspopup="dialog"
        :aria-expanded="open"
        data-testid="bar-presets"
        @click.stop
      >
        <span aria-hidden="true" v-html="ICON_BOOKMARK" />
      </Button>
    </PopoverTrigger>

    <!--
      新建弹窗打开时**整块卸载**面板（用户 2026-11-07 截图：弹窗被面板压住）。

      为什么单靠 open=false 不够：面板在菜单层（100002），新建弹窗在对话框层（100000），
      关闭动画期间节点还挂在 body 上，这几百毫秒里它仍会盖在弹窗上面。
      直接不渲染，就不存在两个浮层重叠的窗口期。
    -->
    <PopoverContent
      v-if="!creating"
      align="start"
      side="top"
      class="nbp-pop"
      :arrow="false"
      :body-lock="false"
      :disable-outside-pointer-events="false"
      @open-auto-focus.prevent
    >
      <div class="nbp-head">
        <span class="nbp-title">预设</span>
        <!-- 类型标签：用户要能一眼看出各类型的清单是分开的（2026-11-07） -->
        <span v-if="typeLabel" class="nbp-type">{{ typeLabel }}</span>
        <span class="nbp-count">{{ presets.length }} 条</span>
      </div>

      <!-- 五个分类：provider 自带 / 通用 / 指定模型 / 当前模型 / 禁用（2026-11-07：开关换成独立页签） -->
      <Tabs :model-value="tab" class="nbp-tabs" @update:model-value="(v: unknown) => (tab = (String(v) || 'current') as TabKey)">
        <TabsList variant="line" size="sm">
          <!--
            provider / 禁用两页**按内容显隐**（用户 2026-11-07）：没有 provider 模板、
            没有禁用预设时不渲染对应页签，页面里只留确实有东西的分类。
          -->
          <TabsTrigger v-if="hasProviderTab" value="provider">平台模板</TabsTrigger>
          <TabsTrigger value="general">通用</TabsTrigger>
          <TabsTrigger value="model">指定模型</TabsTrigger>
          <TabsTrigger value="current">当前模型</TabsTrigger>
          <TabsTrigger v-if="hasDisabledTab" value="disabled">
            禁用<span v-if="disabledCount > 0" class="nbp-tabcount">{{ disabledCount }}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div class="nbp-searchrow">
        <InputGroup class="nbp-search">
          <InputGroupAddon align="inline-start">
            <span class="nbp-searchicon" aria-hidden="true" v-html="ICON_SEARCH" />
          </InputGroupAddon>
          <InputGroupInput
            :model-value="query"
            type="search"
            placeholder="搜索预设…"
            aria-label="搜索预设"
            @update:model-value="(v: string | number) => (query = String(v))"
            @keydown.stop
            @keydown.esc.stop="open = false"
          />
          <InputGroupAddon v-if="query" align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="清空搜索" @click="query = ''">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <Button variant="outline" size="sm" class="nbp-new" type="button" @click.stop="startCreate">
          <span class="nbp-new-icon" aria-hidden="true" v-html="ICON_PLUS" />
          <span>新建</span>
        </Button>
      </div>

      <div class="nbp-body" :style="bodyStyle">
        <ScrollArea v-if="loaded && filtered.length > 0" class="nbp-list">
          <button
            v-for="p in filtered"
            :key="p.id"
            class="nbp-item"
            :class="{ 'is-disabled': !canApply(p) }"
            type="button"
            :title="canApply(p) ? '填入：' + p.name : '当前节点用不了这个模型，预设已禁用'"
            @click.stop="use(p)"
          >
            <span class="nbp-item-text">
              <span class="nbp-item-name">
                {{ p.name }}
                <span v-if="p.source === 'provider'" class="nbp-tag">平台模板</span>
                <span v-if="p.actionId" class="nbp-tag">{{ labelOfAction(p.actionId) }}</span>
                <span v-if="p.values" class="nbp-tag">含参数</span>
              </span>
              <span class="nbp-item-preview">{{ previewOf(p.content) }}</span>
            </span>
            <span
              v-if="p.source !== 'provider'"
              class="nbp-del"
              role="button"
              tabindex="0"
              :aria-label="'删除预设 ' + p.name"
              :title="'删除 ' + p.name"
              @click.stop="remove(p.id)"
              @keydown.enter.stop.prevent="remove(p.id)"
            >
              <span aria-hidden="true" v-html="ICON_TRASH" />
            </span>
          </button>
        </ScrollArea>

        <div v-else class="nbp-empty">
          <span class="nbp-empty-icon" aria-hidden="true" v-html="ICON_BOOKMARK" />
          <p v-if="query.trim()">没有匹配「{{ query.trim() }}」的预设</p>
          <p v-else-if="tab === 'disabled'">没有禁用的预设：当前节点选中的模型都能用</p>
          <p v-else>暂无预设，点击「新建」创建第一个预设</p>
        </div>
      </div>

      <p class="nbp-hint">{{ where === 'cloud' ? '预设保存在后台，换台电脑也在' : '预设暂存在这台电脑的浏览器里' }}</p>
      <p v-if="loadError" class="nbp-hint is-bad">{{ loadError }}</p>
    </PopoverContent>
  </Popover>

  <Dialog v-model:open="creating">
    <DialogContent class="nbp-dialog" :show-close-button="false">
      <!--
        正文必须多包一层：组件库 host.css 对 [data-slot='dialog-content'] 强制
        padding:0 / gap:0 !important（全站弹窗共用这条规矩）。内边距写在外层会被吃掉，
        标题与输入框就贴到面板边上 —— 用户 2026-11-07 截图里的样子。
      -->
      <div class="nbp-dialog-body">
        <DialogHeader class="nbp-dialog-head">
          <DialogTitle class="nbp-dialog-title">新建预设</DialogTitle>
          <DialogDescription class="nbp-dialog-desc">选模型、调参数、写提示词；保存后一起应用</DialogDescription>
        </DialogHeader>

        <div class="nbp-field">
          <Label for="nbp-preset-name" class="nbp-label">预设名称</Label>
          <Input
            id="nbp-preset-name"
            ref="nameInput"
            v-model="draftName"
            class="nbp-input"
            placeholder="请输入预设名称"
            maxlength="40"
            @keydown.stop
            @keydown.enter.prevent="saveDraft"
          />
        </div>

        <div class="nbp-field">
          <Label for="nbp-preset-content" class="nbp-label">预设内容</Label>
          <Textarea
            id="nbp-preset-content"
            v-model="draftContent"
            class="nbp-textarea"
            rows="5"
            placeholder="请输入预设内容…"
            @keydown.stop
            @keydown.enter.stop
          />
        </div>

        <!-- 绑定模型：留空 = 全局通用；选了就只在该模型可用时启用 -->
        <div class="nbp-field">
          <Label class="nbp-label">适用模型</Label>
          <!-- 底栏同款：卡片 / 分栏面板（Agent 的 ChoicePicker，即底栏那个图2面板） -->
          <DropdownMenu v-if="agentPickerReady">
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="nb-model-trigger nbp-model-trigger"
                aria-haspopup="menu"
                aria-label="适用模型"
                :title="draftModelLabel"
              >
                <span v-if="draftModelIcon" class="nb-model-badge" :data-tone="draftModelIcon.tone" aria-hidden="true" v-html="draftModelIcon.svg" />
                <span class="nb-model-trigger-label">{{ draftModelLabel }}</span>
                <svg class="nb-model-trigger-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="bottom"
              class="nb-model-menu nb-agent-choice-menu nb-agent-choice-menu--dialog"
              :style="{ width: 'min(520px, calc(100vw - 24px))', height: 'min(380px, calc(100dvh - 320px))' }"
            >
              <AgentChoicePicker
                :items="choiceItems"
                :current-id="draftActionId"
                title="适用模型"
                rail-label="平台"
                placeholder="搜索模型或平台"
                empty-text="没有匹配的模型"
                @pick="(item: { id: string }) => onDraftModelChange(item.id)"
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <!-- 简版回退：Agent 未装时仍是「图标 + 名称 + 勾」的菜单 -->
          <DropdownMenu v-else>
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="nb-model-trigger nbp-model-trigger"
                aria-haspopup="menu"
                aria-label="适用模型"
                :title="draftModelLabel"
              >
                <span v-if="draftModelIcon" class="nb-model-badge" :data-tone="draftModelIcon.tone" aria-hidden="true" v-html="draftModelIcon.svg" />
                <span class="nb-model-trigger-label">{{ draftModelLabel }}</span>
                <svg class="nb-model-trigger-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="bottom" class="nb-model-menu">
              <DropdownMenuItem
                data-state="checked"
                @select="onDraftModelChange('')"
              >
                <span class="nb-model-badge" data-tone="text" aria-hidden="true"
                  v-html="modelIconOf('通用文本').svg" />
                <span class="nb-model-item-label">通用（所有模型）</span>
                <svg v-if="!draftActionId" class="nb-model-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m5 12 4 4L19 6" />
                </svg>
              </DropdownMenuItem>
              <DropdownMenuItem
                v-for="o in draftModelOptions"
                :key="o.id"
                :data-state="o.id === draftActionId ? 'checked' : undefined"
                @select="onDraftModelChange(o.id)"
              >
                <span class="nb-model-badge" :data-tone="o.icon.tone" aria-hidden="true" v-html="o.icon.svg" />
                <span class="nb-model-item-label">{{ o.title }}</span>
                <svg v-if="o.id === draftActionId" class="nb-model-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m5 12 4 4L19 6" />
                </svg>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <!-- 参数：用模型自己的参数定义渲染，和下拉里同一套控件 -->
        <div v-if="draftParams.length > 0" class="nbp-field">
          <Label class="nbp-label">参数</Label>
          <ToolParamGroup
            :params="draftParams"
            :values="draftValues"
            placeholder="默认参数"
            id-prefix="nbp-draft"
            @change="onDraftFieldChange"
          />
        </div>

        <DialogFooter class="nbp-dialog-foot">
          <Button variant="outline" type="button" @click="creating = false">取消</Button>
          <Button variant="default" type="button" :disabled="!canSaveDraft" @click="saveDraft">保存</Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style src="./prompt-presets.css"></style>
<style src="./bottom-bar-choice-menu.css"></style>
