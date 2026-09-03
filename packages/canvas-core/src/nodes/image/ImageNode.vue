<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useVueFlow, Position } from '@vue-flow/core'
import BaseNode from '../../components/Decoration/BaseNode.vue'
import NodeToolbar from '../../components/Decoration/NodeToolbar.vue'
import BaseToolbar from '../../components/Toolbar/BaseToolbar.vue'
import ImageCropper from './ImageCropper.vue'
import ImageExpander from './ImageExpander.vue'
import ImageMasker from './ImageMasker.vue'
import ImageBottomToolbar from './ImageBottomToolbar.vue'
import type { ToolbarConfig } from './ImageBottomToolbar.vue'
import ImageRunIndicator from './ImageRunIndicator.vue'
import { useCanvasRuntime } from '../../runtime/useCanvasRuntime'
import { useCanvasStore } from '../../composables/useCanvasStore'
import { getModel, executeRun } from './imageModels'
import type { GenerationPayload, GenerationResult, RunProgress } from './imageModels'
import { notifyError, notifySuccess } from '../../components/Ui'
import { formatFileSize } from '../../utils/format'
import type { MaskConfig } from '../../types/CanvasNodeData'

defineOptions({ inheritAttrs: false })

const props = defineProps<NodeProps>()
const { updateNode } = useVueFlow()
const runtime = useCanvasRuntime()
const canvas = useCanvasStore()
const error = ref(false)

const isCropping = computed(() => props.data?._overlay?._cropMode === true)
const isExpanding = computed(() => props.data?._overlay?._expandMode === true)
const isMasking = computed(() => props.data?._overlay?._maskMode === true)
const maskConfig = computed<MaskConfig>(() =>
  props.data?._overlay?._maskConfig || { brushSize: 20, brushColor: '#ff0000', brushOpacity: 0.5, isErasing: false },
)

function onCropUpdate(rect: { x: number; y: number; width: number; height: number }) {
  updateNode(props.id, { data: { ...props.data, _overlay: { ...props.data._overlay, _cropRect: rect } } })
}

function onExpandUpdate(rect: { x: number; y: number; width: number; height: number }) {
  updateNode(props.id, { data: { ...props.data, _overlay: { ...props.data._overlay, _expandRect: rect } } })
}

function onExpandCancel() {
  runtime.commandRegistry.execute('image.expandCancel', { runtime, node: props, logger: console } as any)
}
function onExpandConfirm() {
  runtime.commandRegistry.execute('image.expandConfirm', { runtime, node: props, logger: console } as any)
}

function onCropCancel() {
  runtime.commandRegistry.execute('image.cropCancel', { runtime, node: props, logger: console } as any)
}
function onCropConfirm() {
  runtime.commandRegistry.execute('image.cropConfirm', { runtime, node: props, logger: console } as any)
}

function onMaskUpdate(blobUrl: string | null) {
  updateNode(props.id, { data: { ...props.data, maskUrl: blobUrl } })
}

// ---- ESC 退出编辑模式（裁剪/扩展/蒙版）----
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  const overlay = props.data?._overlay
  if (!overlay) return
  const ctx = { runtime, node: props, logger: console } as any
  if (overlay._cropMode === true) {
    runtime.commandRegistry.execute('image.cropCancel', ctx)
  } else if (overlay._expandMode === true) {
    runtime.commandRegistry.execute('image.expandCancel', ctx)
  } else if (overlay._maskMode === true) {
    runtime.commandRegistry.execute('image.maskCancel', ctx)
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

watch(
  () => props.data?.imageUrl,
  () => { error.value = false },
)

// ---- 标题栏 ----
const nodeLabel = computed(() => (props.data?.label as string) || (props.data?.nodeType as string) || '图片')

const dims = computed(() => {
  const w = props.data?.imageWidth as number
  const h = props.data?.imageHeight as number
  const size = props.data?.imageSize as number
  const parts: string[] = []
  if (w && h) parts.push(`${w}\u00d7${h}`)
  if (size) parts.push(formatFileSize(size))
  return parts.join(' \u00b7 ')
})

const titleIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round"/></svg>'

const bottomOffset = computed(() => canvas.state.core.bottomToolbarOffset)

/** 全屏 Dialog 状态 */
const showExpandDialog = ref(false)

/** 底部工具栏默认配置 */
function defaultToolbarConfig(): ToolbarConfig {
  return {
    promptText: '',
    promptDoc: null,
    selectedModel: 'chatgpt-gpt-image-2',
    selectedRatio: '1:1',
    selectedResolution: '',
    selectedTemplate: '',
  }
}

/** 底部工具栏配置（v-model）— 统一存为节点 data.options，实现持久化 */
const toolbarConfig = ref<ToolbarConfig>(defaultToolbarConfig())

/** 本地编辑正在回写 data.options 的标志：覆盖 updateNode 的异步窗口，避免被 props 回读误回收 */
let applyingLocal = false

/** 序列化比较当前 toolbarConfig 与 data.options 是否一致（用于打破双向 watch 循环） */
function sameAsToolbar(opts: unknown): boolean {
  if (!opts || typeof opts !== 'object') return false
  const a = JSON.stringify({ ...defaultToolbarConfig(), ...opts })
  const b = JSON.stringify({ ...defaultToolbarConfig(), ...toolbarConfig.value })
  return a === b
}

/** 从节点 data.options 载入配置（合并默认值，保证字段齐全） */
function initToolbarFromData() {
  const opts = props.data?.options as Partial<ToolbarConfig> | undefined
  const merged = { ...defaultToolbarConfig(), ...opts }
  // 迁移兜底：持久化的模型已不在注册表（如删除了的 anycook）→ 回落到默认有效模型，
  // 避免工具栏卡在无法切换的失效值上
  if (!getModel(merged.selectedModel)) {
    merged.selectedModel = defaultToolbarConfig().selectedModel
    merged.selectedRatio = defaultToolbarConfig().selectedRatio ?? merged.selectedRatio
    merged.selectedResolution = defaultToolbarConfig().selectedResolution ?? ''
    merged.selectedTemplate = defaultToolbarConfig().selectedTemplate ?? ''
  }
  toolbarConfig.value = merged
}
initToolbarFromData()

// 外部（如 MCP）设置 data.options → 同步到本地。
// 值一致说明是本组件自己的回写回读，跳过；正在本地回写期间也跳过（覆盖异步窗口），避免覆盖刚改的值。
watch(
  () => props.data?.options,
  (opts) => {
    if (!opts || typeof opts !== 'object') return
    if (applyingLocal) return
    if (sameAsToolbar(opts)) return
    initToolbarFromData()
  },
)

// 本地编辑 → 回写 data.options（用完整配置，避免字段丢失；持久化，刷新后恢复）
watch(toolbarConfig, (val) => {
  const full = { ...defaultToolbarConfig(), ...val }
  applyingLocal = true
  updateNode(props.id, { data: { ...props.data, options: full } })
  // 稍后清标志：让 updateNode 的回读不被跳过处理（外部真正的改动此时应已能通过 sameAsToolbar 正确区分）
  setTimeout(() => { applyingLocal = false }, 0)
}, { deep: true })

// ================= 生成运行态（由节点持有，节点常驻显示进度；成功/失败走全局 notify） =================

export type ImageRunStatus = 'idle' | 'running' | 'success' | 'error'

const runStatus = ref<ImageRunStatus>('idle')
/** 运行中最新进度快照 */
const runProgress = ref<RunProgress>({})
/** 失败态错误信息（用于节点上常驻的失败提示） */
const runError = ref('')
/** 自增运行号：防止上一轮晚到的回调覆盖新一轮状态 */
let runSeq = 0

const isRunning = computed(() => runStatus.value === 'running')

/** 复位运行态（成功自动复位；失败由用户点「重试/关闭」触发） */
function resetRun() {
  runSeq += 1
  runStatus.value = 'idle'
  runProgress.value = {}
  runError.value = ''
  // 若当前显示的是外部后台任务态(error)，一并清掉 data.runState，避免残留失败浮层
  const rs = props.data?.runState as ExternalRunState | undefined
  if (rs && (rs.status === 'error' || rs.status === 'done')) {
    updateNode(props.id, { data: { ...props.data, runState: undefined } })
  }
}

/** 执行一次生成（由工具栏点「发送」触发；执行/状态均在节点层，工具栏解耦） */
async function runGeneration(payload: GenerationPayload) {
  if (isRunning.value) return
  const seq = ++runSeq
  runStatus.value = 'running'
  runProgress.value = {}
  runError.value = ''

  try {
    const result: GenerationResult = await executeRun(payload, {
      interval: 650,
      timeoutMs: 120_000,
      onProgress: (p) => {
        if (seq !== runSeq) return
        runProgress.value = p
      },
    })
    if (seq !== runSeq) return

    if (result.ok) {
      runStatus.value = 'idle'
      if (result.urls?.length) {
        notifySuccess('已生成 1 张画面', { images: result.urls })
      } else {
        notifySuccess('生成完成')
      }
    } else {
      runStatus.value = 'error'
      runError.value = result.error || '生成失败，请重试'
      notifyError(runError.value)
      console.error('[ImageNode] 生成失败', payload.model, result.error)
    }
  } catch (err) {
    if (seq !== runSeq) return
    runStatus.value = 'error'
    runError.value = err instanceof Error ? err.message : String(err) || '生成过程出现异常'
    notifyError(runError.value)
    console.error('[ImageNode] 生成异常', payload.model, err)
  }
}

function onToolbarAction(action: string, value?: unknown) {
  if (action === 'send') {
    runGeneration(value as GenerationPayload)
  } else if (action === 'more') {
    showExpandDialog.value = !showExpandDialog.value
  }
}

// ================= 外部后台任务态（R2：data.runState 只读驱动，供 AI/MCP 建节点后显示进度/结果） =================

interface ExternalRunState {
  status?: 'running' | 'done' | 'error'
  progress?: number
  message?: string
  taskId?: string
  urls?: string[]
  imageUrl?: string
  error?: string
}

/** 后台写入 data.runState（经 SSE node:updated 就地刷新） */
const externalRun = computed<ExternalRunState | undefined>(() => {
  const rs = props.data?.runState
  return rs && typeof rs === 'object' ? (rs as ExternalRunState) : undefined
})

/** 是否处于"外部后台任务"驱动态（running / error） */
const hasExternalRun = computed(() => {
  const s = externalRun.value?.status
  return s === 'running' || s === 'error'
})

/** 对外统一：优先显示外部后台任务态；否则显示本地 executeRun 态 */
const showRunIndicator = computed(() => isRunning.value || runStatus.value === 'error' || hasExternalRun.value)
const indicatorIsExternal = computed(() => {
  if (hasExternalRun.value) return true
  return false
})
const indicatorRunning = computed(() => (indicatorIsExternal.value ? externalRun.value?.status === 'running' : isRunning.value))
const indicatorProgress = computed<RunProgress>(() => {
  if (indicatorIsExternal.value) {
    return {
      progress: externalRun.value?.progress,
      message: externalRun.value?.message,
      taskId: externalRun.value?.taskId,
    } as RunProgress
  }
  return runProgress.value
})
const indicatorErrorText = computed(() => {
  if (indicatorIsExternal.value) return externalRun.value?.error || externalRun.value?.message || ''
  return runError.value
})
const indicatorPercent = computed(() => {
  const p = indicatorProgress.value.progress
  if (p === undefined || p === null || Number.isNaN(p)) return null
  return Math.max(0, Math.min(100, p))
})

/** 外部任务 done：把结果 url 落到 data.imageUrl（前端 <img> 直接展示），并在 data 记 runState 结果 */
watch(
  () => externalRun.value?.status,
  (status) => {
    if (status !== 'done') return
    const rs = externalRun.value
    const src = rs?.imageUrl || rs?.urls?.[0]
    if (src && !isExternalImageShown(src)) {
      updateNode(props.id, {
        data: { ...props.data, imageUrl: src, runState: { ...rs, imageUrl: src } },
      })
    }
  },
)

/** 该 url 是否已是当前节点展示图（避免写同值循环回播） */
function isExternalImageShown(url: string): boolean {
  const cur = props.data?.imageUrl
  const curRs = externalRun.value?.imageUrl
  return cur === url || curRs === url
}

/** 外部任务 error/running 期间不应允许本地再次发送（简单互斥展示即可，不阻塞底层） */

</script>

<template>
  <BaseNode v-bind="$props">
    <!-- 标题栏图标 -->
    <template #title-icon>
      <span class="w-3.5 h-3.5 shrink-0 inline-flex items-center" v-html="titleIconSvg" />
    </template>

    <!-- 标题文字 -->
    <template #title-label>
      <span class="truncate">{{ nodeLabel }}</span>
    </template>

    <!-- 额外信息：原图分辨率 1920×1080 -->
    <template #title-extra>
      <span v-if="dims" class="text-gray-400 shrink-0 ml-auto">{{ dims }}</span>
    </template>

    <!-- 顶部工具栏：裁剪/扩展/蒙版/滤镜等 -->
    <template #top-toolbar>
      <BaseToolbar v-bind="$props" toolbar-position="top" />
    </template>

    <!-- 图片内容 -->
    <template #content>
      <div class="w-full h-full relative">
        <img
          v-if="data?.imageUrl && !error"
          :src="data.imageUrl"
          :alt="data?.label || '图片'"
          class="w-full h-full object-cover bg-gray-50 pointer-events-none"
          @error="error = true"
        />
        <div v-else class="w-full h-full flex items-center justify-center bg-gray-100">
          <svg class="w-12 h-12 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
            <path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>

        <ImageCropper
          v-if="isCropping && data?.imageUrl"
          :node-id="id"
          :image-url="data.imageUrl"
          :image-width="(data.imageWidth as number) || 0"
          :image-height="(data.imageHeight as number) || 0"
          @update:crop="onCropUpdate"
          @cancel="onCropCancel"
          @confirm="onCropConfirm"
        />

        <ImageExpander
          v-if="isExpanding && data?.imageUrl"
          :node-id="id"
          :image-url="data.imageUrl"
          :image-width="(data.imageWidth as number) || 0"
          :image-height="(data.imageHeight as number) || 0"
          @update:expand="onExpandUpdate"
          @cancel="onExpandCancel"
          @confirm="onExpandConfirm"
        />

        <ImageMasker
          v-if="isMasking && data?.imageUrl"
          :node-id="id"
          :image-url="data.imageUrl"
          :image-width="(data.imageWidth as number) || 0"
          :image-height="(data.imageHeight as number) || 0"
          :mask-config="maskConfig"
          :mask-data-url="(data?.maskUrl as string) || null"
          @update:mask-data="onMaskUpdate"
        />
      </div>
    </template>

    <!-- 底部工具栏 + 常驻运行进度浮层 -->
    <template #bottom-toolbar>
      <!-- 生成运行进度/失败浮层：跟随节点顶部常驻显示（NodeToolbar 定位但不依赖选中，仅运行/失败可见） -->
      <NodeToolbar v-if="showRunIndicator && !showExpandDialog" :node-id="id" :position="Position.Top" :offset="bottomOffset" :is-visible="showRunIndicator">
        <ImageRunIndicator :running="indicatorRunning" :progress="indicatorProgress" :error="indicatorErrorText" :percent="indicatorPercent">
          <template #actions>
            <button class="run-indicator-btn" @click="resetRun">关闭</button>
          </template>
        </ImageRunIndicator>
      </NodeToolbar>

      <NodeToolbar v-if="!showExpandDialog" :node-id="id" :position="Position.Bottom" :offset="bottomOffset">
        <ImageBottomToolbar v-bind="$props" :config="toolbarConfig" :is-running="isRunning" @update:config="toolbarConfig = $event" @action="onToolbarAction" />
      </NodeToolbar>
    </template>
  </BaseNode>

  <!-- 全屏 Dialog -->
  <Teleport to="body">
    <div v-if="showExpandDialog" class="expand-dialog-overlay" @click.self="showExpandDialog = false">
      <div class="expand-dialog">
        <div class="expand-dialog-body">
          <ImageBottomToolbar v-bind="$props" :config="toolbarConfig" :is-running="isRunning" :is-fullscreen="true" @update:config="toolbarConfig = $event" @action="onToolbarAction" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.expand-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.expand-dialog {
  position: relative;
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  width: 50vw;
  height: 70vh;
  overflow: hidden;
}

.expand-dialog-body {
  padding: 0;
  height: 100%;
  overflow: hidden;
}

.expand-dialog-body .image-bottom-panel {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 0;
  box-shadow: none;
  backdrop-filter: none;
}

.expand-dialog-body .ProseMirror {
  min-height: 200px !important;
}

.run-indicator-btn {
  flex-shrink: 0;
  border: none;
  background: rgba(220, 38, 38, 0.12);
  color: #b91c1c;
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.run-indicator-btn:hover {
  background: rgba(220, 38, 38, 0.2);
}
</style>
