<script setup lang="ts">
/**
 * StyleLibraryOverlay —— 风格广场的浮层外壳（图 1 的那张大面板）。
 *
 * 只做三件事：
 * ① 从服务读 state.open 决定显隐（关闭时不产出 DOM）；
 * ② 拼外壳：Teleport 到 body + 遮罩 + 居中面板 + 标题栏（✕ / 最小化）+ 内容区；
 * ③ 把「收藏 / 详情 / 使用」这些交互接上服务与宿主。
 *
 * 真正的广场正文与详情都**按名从 ui 目录取**（`styleLibraryGallery` / `styleLibraryDetail`），
 * 不写死 import —— 换外观注册同名更小 order 的件即可。
 * 收藏是本地持久化（localStorage，按画布无关的全局键）—— 与后台无关，不需要服务端支持。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X, Minus } from 'lucide-vue-next'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { StyleCard } from '../data/types'
import type { LibraryService } from '../data/store'
import { UI_GALLERY, UI_DETAIL } from '../names'
import { useStyleItem } from '../useStyleItem'
import { styleItemDepsOf } from '../useStyleItemPorts'

const { ctx } = useCanvasRender()

/** 广场正文 / 详情：按名从 ui 目录取（树内调用 useUiComponent）；缺件时退化为不渲染 */
const GalleryComp = useUiComponent(UI_GALLERY)
const DetailComp = useUiComponent(UI_DETAIL)

/** 取服务（组件在画布渲染子树内，能用 useCanvasRender 拿 ctx） */
const svc = ctx.get<LibraryService>('style-library')
const s = svc.state

/** 收藏集合：全局持久化（localStorage）—— 与具体画布无关 */
const STAR_KEY = 'style-library:starred'
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
    /* 配额/隐私模式：收藏本次会话仍生效，静默 */
  }
}

function onToggleStar(item: StyleCard): void {
  const i = starred.value.indexOf(item.id)
  if (i >= 0) starred.value.splice(i, 1)
  else starred.value.push(item.id)
  persistStars()
}

/** 详情 */
const detailItem = ref<StyleCard | null>(null)
const detailStarred = computed(() => (detailItem.value ? starred.value.includes(detailItem.value.id) : false))
function onOpenDetail(item: StyleCard): void {
  detailItem.value = item
}

/** 正在提交的素材（防连点重复建节点） */
const using = ref(false)
/** 正在提交的那条素材 id（只让那张卡的按钮变灰，不影响别的卡） */
const usingIds = ref<Array<number | string>>([])
/** 加入失败的原因（显示在面板里 —— 规范 §1.2：只在控制台 warn 不算降级） */
const useError = ref('')

/**
 * 使用：把选中的图**存进画布资源库**（resources.put）再建节点，并用风格名命名。
 *
 * 为什么不直接写风格库地址（2026-10-22 用户口径）：
 * 素材库目录一改 / 插件没装，画布上的图就全裂；且节点本来只该保存持久资源引用。
 * 落进资源库后，图片字节归本画布所有，与素材库是否在线无关。
 *
 * 命名：createNode 把 resourceId / imageUrl / label 一次写入 → 单条历史；
 * 多图风格在标题后加序号（第 1 张不加），避免同名分不清。
 */
async function onUse(item: StyleCard, index: number): Promise<void> {
  const url = item.images[index] ?? item.cover
  const position = { x: 160 + Math.round(Math.random() * 240), y: 120 + Math.round(Math.random() * 200) }
  // 多图时带序号（第 1 张不加，避免"名 1"这种啰嗦标题）
  const label = item.images.length > 1 && index > 0 ? item.name + ' ' + (index + 1) : item.name
  if (using.value) return
  using.value = true
  usingIds.value = [item.id]
  useError.value = ''
  try {
    // 规范 §3.1：字节 → media.put → media.addNode；节点字段由图片插件自己写
    const result = await useStyleItem(styleItemDepsOf(ctx), { url, label }, position)
    if (!result.ok) {
      // 不退回"写素材库地址"：那会让节点依赖素材库目录与插件在线。
      // 原因显示在面板里（见模板的 slol-use-error），用户知道该修什么。
      console.warn('[style-library] 加入画布失败：' + result.reason + '（' + url + '）')
      useError.value = result.message
      return
    }
    detailItem.value = null
    svc.close()
  } finally {
    using.value = false
    usingIds.value = []
  }
}

/** 最小化：只收起面板（不关，保留状态） */
const minimized = ref(false)

function onKey(e: KeyboardEvent): void {
  if (!s.open) return
  if (e.key === 'Escape' && !detailItem.value) { e.stopPropagation(); svc.close() }
}
onMounted(() => document.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))

// 关闭时收起详情与最小化态，下次打开是干净的面板
watch(() => s.open, (v) => {
  if (!v) { detailItem.value = null; minimized.value = false; useError.value = '' }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="s.open && !minimized" class="slol-layer" @pointerdown.self="svc.close()" @contextmenu.prevent>
      <div class="slol-panel" @pointerdown.stop>
        <header class="slol-head">
          <h3 class="slol-title">素材库 · 风格广场</h3>
          <div class="slol-head-actions">
            <!-- <button class="slol-icon" type="button" aria-label="最小化" title="最小化" @click="minimized = true">
              <Minus :size="16" />
            </button> -->
            <button class="slol-icon" type="button" aria-label="关闭风格库" title="关闭" @click="svc.close()">
              <X :size="16" />
            </button>
          </div>
        </header>

        <!-- 加入画布失败：必须看得见（规范 §1.2） -->
        <p v-if="useError" class="slol-use-error" role="alert">{{ useError }}</p>

        <div class="slol-body">
          <component :is="GalleryComp" v-if="GalleryComp" :service="svc" :starred="starred" :columns="s.zoom + 2"
            :using-ids="usingIds" @toggle-star="onToggleStar" @open-detail="onOpenDetail" @use="onUse" />
        </div>
      </div>

      <!-- 详情（图 3）：同层浮现 -->
      <component :is="DetailComp" v-if="DetailComp" :item="detailItem" :starred="detailStarred"
        @close="detailItem = null" @toggle-star="onToggleStar" @use="onUse" />
    </div>
  </Teleport>
</template>

<style scoped>
.slol-layer {
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
.slol-panel {
  display: flex;
  flex-direction: column;
  width: min(1280px, 100%);
  height: min(86vh, 860px);
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 16px;
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-lg, 0 24px 64px rgb(15 23 42 / 0.2));
  overflow: hidden;
  animation: slol-in 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes slol-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: none; }
}
.slol-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 10px 10px 10px 18px;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
}
.slol-title { margin: 0; font-size: 14px; font-weight: 700; color: var(--ui-ink, #18202b); }
.slol-use-error {
  flex: none;
  margin: 8px 16px 0;
  padding: 8px 10px;
  border: 1px solid var(--ui-danger, #ef4444);
  border-radius: 8px;
  font-size: 12px;
  color: var(--ui-danger, #ef4444);
}
.slol-head-actions { display: flex; gap: 4px; }
.slol-icon {
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
.slol-icon:hover { background: var(--ui-hover, rgb(0 0 0 / 0.06)); color: var(--ui-ink, #18202b); }
.slol-icon:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
.slol-body { flex: 1; min-height: 0; }

@media (prefers-reduced-motion: reduce) {
  .slol-panel, .slol-icon { transition: none !important; animation: none !important; }
}
</style>
