<script setup lang="ts">
/**
 * EffectLibraryContent —— 特效库的**内容本体**（没有外壳）。
 *
 * 与风格库同一套做法：内容一份，容器两种。
 * - EffectLibraryOverlay：遮罩 + 居中面板 + 标题栏；
 * - 项目页「特效库」页签：直接铺满主内容区。
 *
 * 差别只在点击行为：点卡片 = 全屏预览（没有详情页）。
 */
import { computed, ref, watch } from 'vue'
import { useCanvasContextOrRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { StyleCard } from '../data/types'
import type { LibraryService } from '../data/store'
import { UI_GALLERY, UI_MEDIA_VIEWER } from '../names'
import { useStyleItem } from '../useStyleItem'
import { styleItemDepsOf } from '../useStyleItemPorts'
import { stylePlacementOf, focusStyleNode } from '../stylePlacement'
import { useCanvasGate } from '../useCanvasGate'

const emit = defineEmits<{
  /** 某条素材已成功加入画布（弹窗外壳据此关掉自己） */
  (e: 'used'): void
}>()

/** 两个状态：canvas = 可加入画布；project = 项目页，加号整颗不渲染。 */
const props = withDefaults(defineProps<{ mode?: 'canvas' | 'project' }>(), { mode: 'canvas' })
const showCanvasActions = computed(() => props.mode === 'canvas')
/** 项目页整页：画廊不要自带白底；弹窗里仍用白底。 */
const surface = computed(() => (props.mode === 'project' ? 'transparent' : 'panel'))

const { ctx } = useCanvasContextOrRender()
const gate = useCanvasGate(ctx, '特效')

/** 广场正文：按名从 ui 目录取 —— 风格 / 特效共用同一件 */
const GalleryComp = useUiComponent(UI_GALLERY)
/** 全屏预览：优先用主题登记的全屏预览件（mediaViewer，与生成历史同一个） */
const MediaViewerComp = useUiComponent(UI_MEDIA_VIEWER)

const svc = ctx.get<LibraryService>('effect-library')
const s = svc.state

/** 收藏集合：全局持久化（与风格库分开存，免得分不清） */
const STAR_KEY = 'effect-library:starred'
const starred = ref<Array<number | string>>(readStars())
function readStars(): Array<number | string> {
  try {
    const raw = localStorage.getItem(STAR_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function persistStars(): void {
  try {
    localStorage.setItem(STAR_KEY, JSON.stringify(starred.value))
  } catch {
    /* 配额/隐私模式：本次会话仍生效，静默 */
  }
}
function onToggleStar(item: StyleCard): void {
  const i = starred.value.indexOf(item.id)
  if (i >= 0) starred.value.splice(i, 1)
  else starred.value.push(item.id)
  persistStars()
}

/** 全屏预览：当前点开的那条（null = 不显示） */
const previewItem = ref<StyleCard | null>(null)
function onPreview(item: StyleCard): void {
  previewItem.value = item
}

/** 正在加入画布的素材（防连点） */
const using = ref(false)
/** 正在提交的那条素材 id（只让那张卡的按钮变灰，不影响别的卡） */
const usingIds = ref<Array<number | string>>([])
/** 加入失败的原因（面板里可见 —— 规范 §1.2） */
const useError = ref('')

/**
 * 加入画布（用户口径 2026-10-22）：与风格库同一套逻辑，只是 UI 不同 ——
 * 特效库点卡片仍是全屏预览，加入走卡片右下角的「+」按钮。
 *
 * 落进画布的是**封面图**（videos 是这条特效的效果演示，不是可编辑的素材本体）。
 */
async function onUse(item: StyleCard): Promise<void> {
  if (!gate.canUse.value) {
    useError.value = gate.reason.value
    return
  }
  const url = item.images[0] ?? item.cover ?? item.videos[0] ?? ''
  if (!url) {
    useError.value = '这条素材没有可加入画布的文件'
    return
  }
  if (using.value) return
  using.value = true
  usingIds.value = [item.id]
  useError.value = ''
  const view = ctx.tryGet<{
    screenToFlow?: (p: { x: number; y: number }) => { x: number; y: number }
    paneRect?: { value?: { x: number; y: number; width: number; height: number } }
  }>('view')
  const position =
    stylePlacementOf({
      screenToFlow: view?.screenToFlow as never,
      paneRect: view?.paneRect?.value as never,
    }) ?? { x: 160 + Math.round(Math.random() * 240), y: 120 + Math.round(Math.random() * 200) }
  try {
    const result = await useStyleItem(styleItemDepsOf(ctx), { url, label: item.name }, position)
    if (!result.ok) {
      console.warn('[effect-library] 加入画布失败：' + result.reason + '（' + url + '）')
      useError.value = result.message
      return
    }
    focusStyleNode(
      {
        selection: ctx.tryGet('selection'),
        view: ctx.tryGet('view'),
      },
      result.nodeId,
    )
    previewItem.value = null
    emit('used')
  } finally {
    using.value = false
    usingIds.value = []
  }
}

/**
 * 交给全屏预览的媒体：有预览视频就放视频（特效演示），没有就放封面图。
 * MediaViewer 认 { name, kind, url, list, index }。
 */
const previewMedia = computed(() => {
  const it = previewItem.value
  if (!it) return null
  const urls = it.videos.length ? it.videos : it.images
  return {
    name: it.name,
    kind: it.videos.length ? 'video' : 'image',
    url: urls[0],
    list: urls,
    index: 0,
  }
})

watch(
  () => s.open,
  (v) => {
    if (!v) {
      previewItem.value = null
      useError.value = ''
    }
  },
)
</script>

<template>
  <div class="elc">
    <p v-if="useError" class="elc-use-error" role="alert">{{ useError }}</p>

    <div class="elc-body">
      <component
        :is="GalleryComp"
        v-if="GalleryComp"
        :service="svc"
        :starred="starred"
        :columns="s.zoom + 2"
        mode="preview"
        :using-ids="usingIds"
        :use-disabled="!gate.canUse.value"
        :use-disabled-reason="gate.reason.value"
        :show-canvas-actions="showCanvasActions"
        :surface="surface"
        @toggle-star="onToggleStar"
        @preview="onPreview"
        @use="onUse"
      />
    </div>

    <!-- 全屏预览：优先主题注册的 mediaViewer（与生成历史同一个） -->
    <component :is="MediaViewerComp" v-if="MediaViewerComp" :item="previewMedia" @close="previewItem = null" />
  </div>
</template>

<style scoped>
.elc {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
}
.elc-body {
  display: flex;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
}
.elc-use-error {
  flex: none;
  margin: 8px 16px 0;
  padding: 8px 10px;
  border: 1px solid var(--ui-danger, #ef4444);
  border-radius: 8px;
  font-size: 12px;
  color: var(--ui-danger, #ef4444);
}
</style>
