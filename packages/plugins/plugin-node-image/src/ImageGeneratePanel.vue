<script setup lang="ts">
/**
 * ImageGeneratePanel —— 图片节点底部「生成图片」控制栏（**仅选中时显示**）。
 *
 * 版式照 v1 的 ImageBottomToolbar：上面一行上游素材小卡片（点开看大图 / 末尾 + 加素材）、
 * 中间一个大输入框（支持 @ 引用素材）、下面模型与参数下拉 + 发送按钮。
 *
 * 与 v1 最大的不同：**本面板不认识任何模型**。能出图的工具由独立工具插件经内核 ctx.tools 注册，
 * 面板只做三件事 —— 列出工具、让用户选参数、带上画布上下文调用。所以"加一个模型"= 装一个工具插件，
 * 本文件一行都不用改（比例/分辨率下拉也是照工具声明的 params 自动长出来的，不是写死的两个下拉）。
 *
 * 定位：浮在卡片下缘之外（绝对定位，不参与节点 flex 布局 → 不会把节点撑高），
 * 自己按 1/zoom 反缩放，屏幕尺寸恒定；离卡片下边多远由设置面板的
 * 「布局/控制栏 → 下控制栏偏移」决定（useToolbarOffsets 读配置并订阅变化，改完立刻生效）。
 *
 * 视觉照 docs/design/ui-style-guide.md：四档灰阶 / 发丝边 / 8-10px 圆角 / 32px 交互目标 /
 * 青色主按钮 / focus-visible 青环 / 动效 150-240ms 且带 prefers-reduced-motion 降级。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import {
  useCanvasRender,
  useGenPanelMetrics,
  useSoleNodeSelected,
  useToolbarOffsets,
  toolbarOffsetStyle,
} from '@mini-canvas/canvas-render'
import type { ToolDef, ToolParamDef, ToolProgress, ToolService } from '@mini-canvas/kernel'
import { addSourceNode, createImageOps, downloadImageNode, readImageSummary, rotateImage } from './imageOps'
import { readImageFitLimits } from './imageFit'
import { readImageSize } from './imageTransform'
import { runImageGeneration } from './imageRun'
import {
  collectUpstreamMaterials,
  makeResourceResolver,
  materialCards,
  panelStatusText,
  paramDefs,
  paramOptions,
  paramRaw,
  paramValue,
  paramsForTool,
  pickDefaultTool,
  templateOptions,
  templatePrompt,
  toEditorResources,
  toolOptions,
  type MaterialCard,
  type UpstreamMaterial,
} from './panelSource'
import { Select, ToolParamField } from '@mini-canvas/plugin-theme-default'
import type { SelectOption } from '@mini-canvas/plugin-theme-default'

/** 可见时能让外部传的只有 id/data（段组件契约），与顶部条一致 */
const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx, renderEdges, renderNodes, viewport } = useCanvasRender()
// 单选才显示：多选时若每个节点都弹一份面板会互相叠（对齐 v1 NodeToolbar 的"恰好选中一个"语义）
const selected = useSoleNodeSelected(props.id)

const visible = computed(() => selected.value)

/** 下控制栏离卡片下边的距离（设置面板可调；改完立即生效，卸载自动退订） */
const offsets = useToolbarOffsets()

/** 面板尺寸类配置（宽度等；与贴边距离同属「布局/控制栏」，改完立即生效） */
const metrics = useGenPanelMetrics()

/** 反缩放：抵住画布缩放，让面板在屏幕上大小恒定（与顶部条/底部条同一套做法） */
const zoom = computed(() => Math.max(viewport.value?.zoom || 1, 0.01))
const panelStyle = computed<Record<string, string>>(() => ({
  // 贴边距离来自配置（对象展开合并：不能把下面的反缩放 transform 覆盖掉）
  ...toolbarOffsetStyle('bottom', offsets.value.bottom),
  // 宽度也来自配置（布局/控制栏 → 图片生成栏宽度），不再写死在 CSS 里
  width: metrics.value.imageWidth + 'px',
  // 水平居中 + 反缩放合并在同一个 transform 里：样式表里只写其中一个都会把另一个顶掉
  transform: 'translateX(-50%) scale(' + (1 / zoom.value) + ')',
  transformOrigin: 'center top',
}))

/** 读/写句柄：读 nodeStore、写 graph（唯一写入口 → 进历史 + 落盘） */
const ops = createImageOps(ctx)

// ==================== 工具（模型）====================

/**
 * 取工具服务：内核内置了 'tools'（ctx.tools 恒在，见内核 core/capabilities.ts）。
 * 仍做一次存在性判断：极简宿主/单测里可能只桩了 ctx.get，面板据此显示"没有可用工具"的空态而不是崩掉。
 */
function toolService(): Pick<ToolService, 'list' | 'invoke'> | undefined {
  return ctx?.tools as Pick<ToolService, 'list' | 'invoke'> | undefined
}

/** 会话里"能出图"的工具（= 模型下拉的选项）。非响应式数据源，靠 refreshTools 主动重读。 */
const toolList = ref<ToolDef[]>([])
/** 当前选中的工具名 */
const selectedTool = ref('')
/** 用户在参数下拉里选的值（键 = 工具声明的 ToolParamDef.key） */
const params = ref<Record<string, unknown>>({})

const currentDef = computed<ToolDef | undefined>(() => toolList.value.find((t) => t.name === selectedTool.value))
const modelOptions = computed<SelectOption[]>(() => toolOptions(toolList.value))
const paramDefsList = computed<ToolParamDef[]>(() => paramDefs(currentDef.value))

/**
 * 参数控件的占位宽度：由工具在 ToolParamDef.span 里声明（默认 1）。
 * span=1 时给 0（让 flex 按内容自适应，一排短下拉不会互相挤）；span>1 时按倍数给基准宽度，
 * 让"提示词增强"这类长参数占得更宽。面板不认识具体参数是什么，只认这个数字。
 */
function fieldBasis(p: ToolParamDef): string {
  const span = p.span ?? 1
  return span > 1 ? `${span * 96}px` : '0px'
}
/** 模板下拉选项（来自工具声明；没有模板时该下拉整块不渲染） */
const tplOptions = computed<SelectOption[]>(() => templateOptions(currentDef.value, toolList.value))
/** 当前选中的模板 id（选中即把模板提示词填进输入框） */
const selectedTemplate = ref('')

/**
 * 重读工具列表并保持选中值有效。
 * 工具是别的插件在装配期注册的，注册时机可能晚于本节点挂载 → 挂载时与每次选中时各读一次，
 * 保证"工具刚装上就能在下拉里看到"，而不是要刷新页面。
 */
function refreshTools(): void {
  const list = toolService()?.list({ produces: 'image' }) ?? []
  toolList.value = list
  if (!list.some((t) => t.name === selectedTool.value)) {
    selectTool(pickDefaultTool(list))
  }
}

/** 选模型：同时把参数换成该模型自己声明的默认值（上一个模型的参数不会带过来） */
function selectTool(name: string): void {
  selectedTool.value = name
  params.value = paramsForTool(currentDef.value)
}

/** 选模型（Select 组件回调）：同时把参数换成该模型自己声明的默认值，并清掉上一个模型的模板选择 */
function onModelSelect(value: string | number): void {
  selectTool(String(value))
  selectedTemplate.value = ''
}

/**
 * 参数值回写（通用渲染器 ToolParamField 的唯一出口）。
 *
 * 值**保持原类型**：下拉给字符串、开关给布尔、数字给数字 —— 自定义参数组件可能产出
 * 布尔或数值，一律 String() 会把开关的 true 变成 "true" 发给后台，这是错的。
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

// setup 期就读一次（而不是等 onMounted）：工具是装配期就注册好的，读它是纯同步取值；
// 放在 setup 里能让"首帧就有模型下拉"，SSR 渲染（无生命周期）也能如实反映工具列表。
refreshTools()
watch(visible, (on) => {
  if (on) refreshTools()
})

// ==================== 上游素材 ====================

/** 连进本节点的素材（图片/文本/视频）：素材行、@ 引用、生成输入共用这一份 */
const materials = computed<UpstreamMaterial[]>(() =>
  collectUpstreamMaterials(renderEdges.value, props.id, (nodeId) => {
    const node = renderNodes.value.find((n) => n.id === nodeId)
    return node ? { type: node.type, data: node.data } : undefined
  }),
)

const cards = computed<MaterialCard[]>(() => materialCards(materials.value))

/** 编辑器资源项：@ 引用候选（点击缩略图看大图） */
const editorResources = computed<ResourceItem[]>(() => toEditorResources(materials.value, onPreviewMaterial))
const resolveResource = computed(() => makeResourceResolver(editorResources.value))

/** 全屏看图：临时往 body 挂一层遮罩，点击或 Esc 关闭（不写节点 data，也不进历史） */
let closePreview: (() => void) | null = null

function onPreviewMaterial(m: UpstreamMaterial): void {
  if (!m.url) return
  previewImage(m.url)
}

function previewImage(url: string): void {
  if (typeof document === 'undefined' || closePreview) return
  const layer = document.createElement('div')
  layer.style.cssText =
    'position:fixed;inset:0;background:rgba(15,23,42,.72);z-index:100000;display:flex;align-items:center;justify-content:center;cursor:zoom-out'
  const img = document.createElement('img')
  img.src = url
  img.style.cssText = 'max-width:92vw;max-height:90vh;object-fit:contain;border-radius:12px'
  layer.appendChild(img)
  const close = (): void => {
    layer.remove()
    document.removeEventListener('keydown', onKey)
    closePreview = null
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }
  layer.addEventListener('click', close)
  document.addEventListener('keydown', onKey)
  document.body.appendChild(layer)
  closePreview = close
}

// 组件卸载（节点被删/面板收起）时，若大图还开着要一并收掉：否则遮罩会留在页面上、Esc 也失效
onBeforeUnmount(() => closePreview?.())

/** 点素材卡片：图片看大图，文本/视频不弹图（避免弹一个空白遮罩） */
function onCardClick(card: MaterialCard): void {
  if (card.url && !card.isText) previewImage(card.url)
}

// ==================== 加素材（+ 号）====================

const fileInput = ref<HTMLInputElement | null>(null)

function onAdd(): void {
  fileInput.value?.click()
}

/**
 * 选完本地图片 → 建一个上游图片节点并连到本节点（不是替换本节点的图，那是顶部条的上传）。
 * 位置由 addSourceNode 按本节点算（摆在左边），失败时什么都不留。
 */
async function onAddFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // 先清空 input：同一个文件二次选择也要能触发 change
  input.value = ''
  if (!file || running.value) return
  await addSourceNode(ops, props.id, file)
}

// ==================== 输入框 ====================

const prompt = ref('')
const promptDoc = ref<unknown>(null)
const editorRef = ref<InstanceType<typeof ProseMirrorEditor> | null>(null)

/** 拦截 Delete/Backspace：不然在输入框里删字会把整个节点删掉（VueFlow 的删除键） */
function onEditorKeydown(e: KeyboardEvent): void {
  if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation()
}

/** 点输入区空白处也把光标送进编辑器（v1 同款手感：不用精确点中文字行） */
function onEditorAreaClick(): void {
  editorRef.value?.focusEnd()
}

// ==================== 发送与生成 ====================

const running = ref(false)
/** 失败文案：只活在本组件里，**不写回节点 data**（错误是本次会话的状态，落盘后刷新会变成幽灵报错） */
const errorText = ref('')
const progress = ref<ToolProgress>({})

const status = computed(() =>
  panelStatusText({
    running: running.value,
    error: errorText.value,
    message: progress.value.message,
    progress: progress.value.progress,
    toolCount: toolList.value.length,
  }),
)

/** 进度条宽度：外部只给阶段（没有百分比）时回落成不确定态动画 */
const progressPercent = computed<number | null>(() => {
  const p = progress.value.progress
  if (typeof p !== 'number' || !Number.isFinite(p)) return null
  return Math.max(0, Math.min(100, p))
})

/** 发送门：没工具 / 生成中都不给点（不给"点了没反应"的按钮） */
const canSend = computed(() => toolList.value.length > 0 && !running.value)

/**
 * 点发送：组装 → 调用 → 写回，全部由 imageRun 里的纯逻辑负责（本函数只做"接线 + 转状态"）。
 *
 * 分工的原因：那三步的规矩（不浪费外部调用、失败不落盘、写回一次到位）都能在 node 里直接断言，
 * 放在组件里就只能靠肉眼看。组件这里只剩"调用前后把 running/error 摆对"。
 */
async function onSend(): Promise<void> {
  if (!canSend.value) return
  const svc = toolService()
  if (!svc) return

  running.value = true
  errorText.value = ''
  progress.value = {}

  const result = await runImageGeneration(
    {
      nodeId: props.id,
      prompt: prompt.value,
      def: currentDef.value,
      materials: materials.value,
      params: params.value,
      onProgress: (p) => {
        progress.value = p
      },
    },
    {
      // 工具调用的运行上下文：把本节点 id 透传出去（异步任务/进度写回要用）
      invokeTool: (name, input, opts) => svc.invoke(name, input, { ctx: { nodeId: opts.nodeId }, onProgress: opts.onProgress }),
      readData: (nodeId) =>
        ctx.get<{ getNode(id: string): { data: Record<string, unknown> } | undefined } | undefined>('nodeStore')
          ?.getNode(nodeId)?.data ?? props.data,
      // 第三个参数是"本次写回要同步的卡片尺寸"（由 imageRun 算好传入）。
      // 它必须和 data 进同一个 patch：内核按一次 updateNode 记一条历史，
      // 拆成两次写会让用户按一次撤销只退回半步（图换了、尺寸没退）。
      writeData: (nodeId, data, size?: { w: number; h: number }) =>
        ctx
          .get<
            | {
                updateNode(
                  id: string,
                  patch: { data: Record<string, unknown>; size?: { w: number; h: number } },
                ): void
              }
            | undefined
          >('graph')
          ?.updateNode(nodeId, size ? { data, size } : { data }),
      // 出图后卡片尺寸也按同一套上限（配置改完下一次生成即生效）
      fitLimits: () => readImageFitLimits(ctx),
      measure: (url) => readImageSize(url),
    },
  )

  if (!result.ok) errorText.value = result.error || '生成失败，请重试'
  running.value = false
  progress.value = {}
}

// ==================== 保留的既有能力（旋转 / 下载）====================
// 与顶部条的上传/裁剪入口同属"图片本身的加工"，放在本文件是延续原先底部栏的职责；
// 生成与加工互不干扰，可以共存。

const busy = ref(false)
const hasImage = computed(() => typeof props.data?.imageUrl === 'string' && props.data.imageUrl !== '')
const summary = computed(() => readImageSummary(props.data))

/**
 * 下载按钮的悬停说明：把文件名与「宽×高 · 大小」挂在这里。
 * 生成面板的版式按 v1 走（没有专门的元信息行），但文件名/尺寸是用户会问的东西，
 * 挂在"对这张图做操作"的按钮上最自然，也不占地方（title 同时是读屏可读的）。
 */
const downloadTitle = computed(() => {
  if (!hasImage.value) return '下载图片'
  const meta = summary.value.meta
  return meta ? `下载图片（${summary.value.name} · ${meta}）` : `下载图片（${summary.value.name}）`
})

async function onRotate(): Promise<void> {
  if (busy.value || !hasImage.value) return
  busy.value = true
  try {
    await rotateImage(ops, props.id)
  } finally {
    busy.value = false
  }
}

function onDownload(): void {
  if (!hasImage.value) return
  downloadImageNode(ops, props.id)
}
</script>

<template>
  <div v-if="visible" class="ig-root nodrag nopan" :style="panelStyle" @pointerdown.stop>
    <!-- 隐藏的原生选图框（+ 号触发） -->
    <input ref="fileInput" class="ig-file" type="file" accept="image/*" @change="onAddFileChange" />

    <!-- 素材行：连进来的上游素材 + 末尾「加素材」占位框 -->
    <div class="ig-materials">
      <button
        v-for="card in cards"
        :key="card.id"
        class="ig-card"
        :class="{ 'is-text': card.isText, 'is-clickable': !!card.url && !card.isText }"
        type="button"
        :title="card.name"
        :aria-label="'查看素材 ' + card.name"
        @click.stop="onCardClick(card)"
      >
        <img v-if="card.url && !card.isText" class="ig-card-thumb" :src="card.url" alt="" draggable="false" />
        <span v-else class="ig-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7V4h16v3" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="8" y1="20" x2="16" y2="20" />
          </svg>
        </span>
      </button>

      <button class="ig-card ig-card-add" type="button" title="添加素材" aria-label="添加素材" @click.stop="onAdd">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <span v-if="cards.length === 0" class="ig-materials-hint">把图片或文本节点连进来，或用 + 添加素材</span>
    </div>

    <!-- 大输入框：支持 @ 引用素材（复用统一的富文本编辑器） -->
    <div class="ig-editor nodrag nopan nowheel" @keydown="onEditorKeydown" @click="onEditorAreaClick">
      <ProseMirrorEditor
        ref="editorRef"
        v-model="prompt"
        v-model:prompt-doc="promptDoc"
        :resources="editorResources"
        :resolve-resource="resolveResource"
        placeholder="描述你想生成的画面内容，@ 引用素材"
        @click.stop
      />
    </div>

    <!-- 工具栏：左侧模型 + 该模型声明的参数，右侧状态 + 既有加工 + 发送 -->
    <div class="ig-toolbar">
      <div class="ig-selects">
        <!-- 模型：来自工具注册表。用项目统一的 Select（与设置界面同款浮层），不用原生 select -->
        <div class="ig-field" :title="currentDef?.description || '选择生成模型'">
          <Select
            :model-value="selectedTool"
            :options="modelOptions"
            :disabled="running || toolList.length === 0"
            placeholder="无可用工具"
            dropdown-width="match"
            :input-id="'ig-model-' + props.id"
            @update:model-value="onModelSelect"
          />
        </div>

        <!-- 参数：完全照工具声明长出来（比例/分辨率/风格/自定义组件…同一机制，本文件不认识它们）。
             交给通用渲染器 ToolParamField：内置控件它自己有，工具想用自定义组件也由它接管。 -->
        <div
          v-for="p in paramDefsList"
          :key="p.key"
          class="ig-field"
          :style="{ flexGrow: 0, flexBasis: fieldBasis(p) }"
          :title="p.description || p.label || p.key"
        >
          <ToolParamField
            :param="p"
            :model-value="paramRaw(params, p.key)"
            :disabled="running"
            :id-prefix="'ig-param-' + props.id"
            @update:model-value="(v: string | number | boolean) => onParamChange(p.key, v)"
          />
        </div>

        <!-- 模板：来自工具声明的预设提示词，选中即填入输入框（没有模板时不渲染） -->
        <div v-if="tplOptions.length > 0" class="ig-field" title="套用预设提示词">
          <Select
            :model-value="selectedTemplate"
            :options="tplOptions"
            :disabled="running"
            placeholder="模板"
            dropdown-width="match"
            :input-id="'ig-tpl-' + props.id"
            @update:model-value="onTemplateSelect"
          />
        </div>
      </div>

      <div class="ig-actions">
        <span v-if="status.text" class="ig-status" :class="'is-' + status.tone" role="status">{{ status.text }}</span>

        <button
          class="ig-icon-btn"
          type="button"
          title="顺时针旋转 90°"
          aria-label="顺时针旋转 90°"
          :disabled="busy || !hasImage"
          @click.stop="onRotate"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>

        <button
          class="ig-icon-btn"
          type="button"
          :title="downloadTitle"
          aria-label="下载图片"
          :disabled="!hasImage"
          @click.stop="onDownload"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>

        <button class="ig-send" :class="{ 'is-running': running }" type="button" :disabled="!canSend" title="发送" @click.stop="onSend">
          <span v-if="running" class="ig-spinner" aria-hidden="true" />
          <svg v-else class="ig-send-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          <span>{{ running ? '生成中' : '发送' }}</span>
        </button>
      </div>
    </div>

    <!-- 进度条：贴在面板底部（有百分比就按比例，外部只给阶段时就来回走） -->
    <div v-if="running" class="ig-progress" aria-hidden="true">
      <div
        class="ig-progress-bar"
        :class="{ 'is-indeterminate': progressPercent === null }"
        :style="progressPercent === null ? undefined : { width: progressPercent + '%' }"
      />
    </div>
  </div>
</template>

<style scoped>
/* 浮在卡片下缘之外：绝对定位不参与节点布局 → 不撑高节点。
   贴边距离与宽度由内联 style 覆盖（配置驱动），这里只保留读不到配置时的兜底值。
   居中用 translateX(-50%) 而不是固定负 margin —— 宽度可配后，写死的 -(宽/2) 必然错位。 */
.ig-root {
  position: absolute;
  left: 50%;
  top: calc(100% + 6px);
  transform: translateX(-50%);
  width: 650px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  /* 与设置面板同材质的纯白浮层（此前是浅灰底，与设置界面不一致） */
  background: var(--canvas-node-panel-surface, #fff);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
  z-index: 30;
}

.ig-file {
  display: none;
}

/* —— 素材行 —— */
.ig-materials {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  flex: none;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.ig-materials::-webkit-scrollbar {
  height: 4px;
}
.ig-materials::-webkit-scrollbar-thumb {
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.12);
}

/* 素材卡片：30×30 圆角 6，hover 轻微上浮 */
.ig-card {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-muted, #6b7280);
  cursor: default;
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ig-card.is-clickable {
  cursor: zoom-in;
}
.ig-card.is-clickable:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.ig-card:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}
.ig-card-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.ig-card-icon svg {
  width: 16px;
  height: 16px;
}

/* 末尾「加素材」占位框：虚线边，hover 转青 */
.ig-card-add {
  border-style: dashed;
  border-color: rgba(0, 0, 0, 0.18);
  background: transparent;
  color: var(--text-faint, #9ca3af);
  cursor: pointer;
}
.ig-card-add svg {
  width: 14px;
  height: 14px;
}
.ig-card-add:hover {
  border-color: #0891b2;
  color: #0891b2;
  background: rgba(8, 145, 178, 0.06);
}

.ig-materials-hint {
  color: var(--text-faint, #9ca3af);
  font-size: 12px;
  white-space: nowrap;
}

/* —— 输入区 —— */
.ig-editor {
  flex: 1;
  min-height: 0;
  margin: 6px 0;
  padding: 8px 10px;
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(0, 0, 0, 0.06);
  scrollbar-width: thin;
  transition: background-color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ig-editor:focus-within {
  background: #fff;
  border-color: rgba(8, 145, 178, 0.35);
}
.ig-editor::-webkit-scrollbar {
  width: 6px;
}
.ig-editor::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.12);
}
.ig-editor::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

/* 编辑器本体：透明、无边框、13px 正文（中文最小 12px 之上） */
.ig-editor :deep(.prose-mirror-editor > div:first-child) {
  min-height: 46px !important;
}
.ig-editor :deep(.ProseMirror) {
  min-height: 46px !important;
  outline: none !important;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-strong, #111827);
}
.ig-editor :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  color: var(--text-faint, #9ca3af);
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

/* —— 工具栏 —— */
.ig-toolbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ig-selects {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

/* 下拉字段：直接复用项目统一的 Select 组件（与设置界面同款浮层与 token），
   这里只负责给每个字段一个合理的宽度上限，让一排下拉不挤压工具栏。 */
.ig-field {
  flex: none;
  max-width: 168px;
  min-width: 84px;
}
.ig-field :deep(.sel-trigger) {
  /* 节点面板是紧凑场景：比设置界面里的行高再收一档，字号跟设置界面一致（13px） */
  padding: 5px 8px;
  font-size: 12px;
}
.ig-field :deep(.sel-arrow) {
  width: 14px;
  height: 14px;
}

.ig-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

/* 状态文案：12px（中文最小字号），三态各一色 */
.ig-status {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, #6b7280);
  background: rgba(0, 0, 0, 0.04);
}
.ig-status.is-running {
  color: #0e7490;
  background: rgba(8, 145, 178, 0.1);
}
.ig-status.is-error {
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.1);
}

/* 图标按钮 28×28 / 圆角 8 */
.ig-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-muted, #6b7280);
  cursor: pointer;
  transition: background-color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ig-icon-btn svg {
  width: 16px;
  height: 16px;
}
.ig-icon-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-strong, #111827);
}
.ig-icon-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.ig-icon-btn:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}
.ig-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 主按钮（全界面同一时刻只允许一个实心主按钮 → 只有「发送」是实心青底白字） */
.ig-send {
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
  white-space: nowrap;
  transition: background-color 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ig-send:hover:not(:disabled) {
  background: #0e7490;
}
.ig-send:active:not(:disabled) {
  transform: scale(0.97);
}
.ig-send:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}
.ig-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ig-send-icon {
  width: 12px;
  height: 12px;
}
.ig-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ig-spin 0.7s linear infinite;
  box-sizing: border-box;
}
@keyframes ig-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 进度条：贴面板底部 */
.ig-progress {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 4px;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(8, 145, 178, 0.14);
}
.ig-progress-bar {
  height: 100%;
  border-radius: 999px;
  background: #0891b2;
  transition: width 0.3s ease;
}
.ig-progress-bar.is-indeterminate {
  width: 34%;
  animation: ig-slide 1.1s ease-in-out infinite;
}
@keyframes ig-slide {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ig-card,
  .ig-icon-btn,
  .ig-send,
  .ig-editor,
  .ig-progress-bar {
    transition: none !important;
  }
  .ig-card:hover,
  .ig-icon-btn:active:not(:disabled),
  .ig-send:active:not(:disabled) {
    transform: none;
  }
  .ig-spinner,
  .ig-progress-bar.is-indeterminate {
    animation: none;
  }
}
</style>
