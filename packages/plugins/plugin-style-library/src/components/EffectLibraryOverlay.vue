<script setup lang="ts">
/**
 * EffectLibraryOverlay —— 特效库的浮层外壳（与风格库同一套外壳，只换标题与内容模式）。
 *
 * 与 StyleLibraryOverlay 的差别只有两点：
 * ① 读的服务是 \`effect-library\`；
 * ② 点卡片 = **全屏预览**（没有详情页）—— 用宿主/主题注册的全屏预览组件（MediaViewer，
 *    与"生成历史点开预览"同一个），特效有预览视频就放视频、没有就放封面图。
 *
 * 收藏、最近使用这些与风格库通用；外壳结构照旧（遮罩 + 居中面板 + 标题栏）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X, Minus } from 'lucide-vue-next'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { StyleCard } from '../data/types'
import type { StyleLibraryService } from '../data/store'
import { UI_GALLERY, UI_MEDIA_VIEWER } from '../names'

const { ctx } = useCanvasRender()

/** 广场正文：按名从 ui 目录取（树内 useUiComponent）——风格/特效共用同一件 */
const GalleryComp = useUiComponent(UI_GALLERY)
/**
 * 全屏预览：优先用主题登记的全屏预览件（\`mediaViewer\`，与生成历史同一个），
 * 没登记就退回到本插件自带的薄壳（仍走宿主/主题的 mediaViewer，见 EffectLibraryViewer.vue）。
 */
const MediaViewerComp = useUiComponent(UI_MEDIA_VIEWER)

const svc = ctx.get<StyleLibraryService>('effect-library')
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

/**
 * 交给全屏预览的媒体：有预览视频就放视频（特效演示），没有就放封面图。
 * MediaViewer 认 { name, kind, url, list, index }；list 给同一条的多张，支持左右切换。
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

const minimized = ref(false)

function onKey(e: KeyboardEvent): void {
  if (!s.open) return
  if (e.key === 'Escape' && !previewItem.value) { e.stopPropagation(); svc.close() }
}
onMounted(() => document.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))

// 关闭时收起预览与最小化态
watch(() => s.open, (v) => {
  if (!v) { previewItem.value = null; minimized.value = false }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="s.open && !minimized" class="elol-layer" @pointerdown.self="svc.close()" @contextmenu.prevent>
      <div class="elol-panel" @pointerdown.stop>
        <header class="elol-head">
          <h3 class="elol-title">素材库 · 特效库</h3>
          <div class="elol-head-actions">
            <button class="elol-icon" type="button" aria-label="最小化" title="最小化" @click="minimized = true">
              <Minus :size="16" />
            </button>
            <button class="elol-icon" type="button" aria-label="关闭特效库" title="关闭" @click="svc.close()">
              <X :size="16" />
            </button>
          </div>
        </header>

        <div class="elol-body">
          <component :is="GalleryComp" v-if="GalleryComp" :service="svc" :starred="starred" :columns="s.zoom + 2"
            mode="preview" @toggle-star="onToggleStar" @preview="onPreview" />
        </div>
      </div>

      <!-- 全屏预览：优先主题注册的 mediaViewer（与生成历史同一个）；缺件时用自带薄壳 -->
      <component :is="MediaViewerComp" v-if="MediaViewerComp" :item="previewMedia" @close="previewItem = null" />
    </div>
  </Teleport>
</template>

<style scoped>
.elol-layer {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: linear-gradient(180deg, var(--ui-scrim-soft, rgb(15 23 42 / 0.16)), var(--ui-scrim-soft, rgb(15 23 42 / 0.26)));
  backdrop-filter: blur(2px);
}
.elol-panel {
  display: flex;
  flex-direction: column;
  width: min(1280px, 100%);
  height: min(86vh, 860px);
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 16px;
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-lg, 0 24px 64px rgb(15 23 42 / 0.2));
  overflow: hidden;
  animation: elol-in 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes elol-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: none; }
}
.elol-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 10px 10px 10px 18px;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
}
.elol-title { margin: 0; font-size: 14px; font-weight: 700; color: var(--ui-ink, #18202b); }
.elol-head-actions { display: flex; gap: 4px; }
.elol-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
.elol-icon:hover { background: var(--ui-hover, rgb(0 0 0 / 0.06)); color: var(--ui-ink, #18202b); }
.elol-icon:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
.elol-body { flex: 1; min-height: 0; }

@media (prefers-reduced-motion: reduce) {
  .elol-panel, .elol-icon { transition: none !important; animation: none !important; }
}
</style>
