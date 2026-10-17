<script setup lang="ts">
/**
 * MediaViewer —— 全屏媒体查看器（注册组件，目录名 mediaViewer）。
 *
 * 交互照 AxImageViewer（ax-ui-kit）复刻（用户点名参考）：滚轮缩放 / 拖拽平移 / 旋转 /
 * 翻转 / 重置 / 上一张·下一张 / 下载；键盘快捷键（Esc 关、←→ 切换、+- 缩放、0 重置、
 * R 旋转、F 翻转）；右上角悬浮关闭、底部居中浮动控制条（页码 · 缩放百分比 · 工具组）。
 *
 * 与参考的差异（本项目需要）：不止图片 —— item.kind 决定内置渲染 文本/图片/视频/音频；
 * 其它资源类型用 #stage 插槽自己画。变换工具只对图片生效；视频/音频交给原生播放器。
 *
 * 注册进 ui 目录的 mediaViewer 名下：插件 useUiComponent("mediaViewer") 按名取用；
 * 成品应用从 @mini-canvas/plugin-theme-default 具名 import。换主题时观感一起换。
 * 颜色全走 token，不自造数值 —— 配色卫生测试盯着。
 *
 * onDelete：宿主给了才出现删除按钮（悬停显示）。删除动作由宿主定
 * （底栏=断开连线，资产面板=调后台接口），本组件不猜。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue"
import { useUiComponent, uiComponentOutside } from "@mini-canvas/canvas-render"

/**
 * 根节点是 Teleport：外层（SlotHost 的 overlay 槽 / 底栏 MediaPreviewOverlay）会下发
 * class / data-slot-* / data-testid 等属性，Teleport 没有可继承的根元素 —— 不关掉属性继承
 * Vue 每次渲染都打一条 "Extraneous non-props attributes ... teleport root nodes" 警告。
 * 这里改成"手动继承"：关掉自动继承后把 $attrs 显式绑到真正的根 div 上，
 * 外层传的 data-testid（底栏 e2e 用它找预览浮层）就不会丢。
 */
defineOptions({ inheritAttrs: false })

/** 一个待预览的媒体（与底栏 mediaPreview.ts 的 PreviewItem 同构；这里是通用形状） */
export interface MediaViewerItem {
  /** 标题（左上角悬浮显示；空则不显示） */
  name?: string
  /** 媒体种类（决定内置预览用 img / video / audio / 纯文本） */
  kind: "image" | "video" | "audio" | "text" | string
  /** 图片/视频/音频地址 */
  url?: string
  /** 文本内容（kind="text" 用） */
  text?: string
  /**
   * 一段自包含 HTML（kind="ui" 用）—— 可视化节点的界面代码。
   *
   * 为什么不能像别的类型那样给 url：可视化节点的内容不是"可加载的媒体"，
   * 而是一段 HTML（它没有独立的可访问地址）。用户口径 2026-10-14：
   * 「可以在预览中添加一个 iframe 预览框」—— 这个字段就是给那个 iframe 的 srcdoc。
   */
  html?: string
  /** 宿主自带的同组媒体（给了就出 上一张/下一张 与页码；图片变换工具随当前张走） */
  list?: string[]
  /** 当前张在 list 里的下标（配合 list 用；默认 0） */
  index?: number
}

const props = withDefaults(
  defineProps<{
    /** 当前预览的媒体；null/undefined = 不渲染 */
    item?: MediaViewerItem | null
    /** 删除处理（给了才会出现右上角的删除按钮） */
    onDelete?: (item: MediaViewerItem) => void
    /**
     * 宿主自备的预览注册件（画布树外渲染时 ui 目录取不到，宿主从自己的
     * 宿主 ctx 里读出来传入；键：audioPreview / videoPreview / textPreview）。
     * 给了就优先用，没给走 useUiComponent（树内）或原生标签兜底（树外）。
     */
    previewComponents?: Record<string, unknown> | null
  }>(),
  { item: null, onDelete: undefined, previewComponents: null },
)

const emit = defineEmits<{
  (e: "close"): void
  (e: "remove", item: MediaViewerItem): void
  /** 当前看的是 list 里的第几张（宿主传了 list 时才有意义；删除要按它算） */
  (e: "index", index: number): void
}>()

const item = computed(() => props.item ?? null)
const canRemove = computed(() => typeof props.onDelete === "function")

/**
 * kind 归一化：宿主可能传中文标签（生成历史的「图片/视频/音频/文本」），
 * 这里统一映射成内置渲染认的英文 kind —— 各接入方不必各自换算。
 */
const KIND_ALIASES: Record<string, string> = { 图片: "image", 视频: "video", 音频: "audio", 文本: "text" }
const kind = computed(() => KIND_ALIASES[item.value?.kind ?? ""] ?? item.value?.kind ?? "")

/**
 * 三类媒体的**预览注册件**（audioPreview / videoPreview / textPreview，节点插件登记）。
 * 登记了就用它们（波形播放器 / 自绘控件 / 文本排版），没登记才回落原生标签 ——
 * 预览观感跟着插件实现走，这里不做第二套。
 */
function tryUseComponent(name: string) {
  try {
    return useUiComponent(name)
  } catch {
    // 画布树外（资产抽屉 / 生成历史弹窗等）：useUiComponent 抛错（无 provide），
    // 但注册表本身是**全局单例**（宿主 ctx 上）—— 用树外取件入口照常拿到。
    // 这样树里树外取到的都是**同一个注册件**，各宿主不必再传 previewComponents。
    return ref(uiComponentOutside(name))
  }
}
const AudioPreview = computed(() => (props.previewComponents?.audioPreview as Component | undefined) ?? (tryUseComponent("audioPreview").value as Component | undefined))
const VideoPreview = computed(() => (props.previewComponents?.videoPreview as Component | undefined) ?? (tryUseComponent("videoPreview").value as Component | undefined))
const TextPreview = computed(() => (props.previewComponents?.textPreview as Component | undefined) ?? (tryUseComponent("textPreview").value as Component | undefined))

// ===== 多图（宿主给 list 时才有） =====
const list = computed<string[]>(() => (item.value?.list?.length ? item.value.list : item.value?.url ? [item.value.url] : []))
const currentIdx = ref(0)
const isMultiple = computed(() => list.value.length > 1)
const currentUrl = computed(() => list.value[currentIdx.value] ?? "")
const isImage = computed(() => kind.value === "image")
/** 能缩放/平移的媒体（图片 + 视频）。音频/文本不参与变换。
 *  用户口径（2026-10-07）：**只有图片**参与缩放/平移（视频默认铺满已够大，不要那一排缩放按钮）。
 *  视频改用节点插件的 videoPreview（自带播放/进度/音量），底部控制条对视频不再出现。 */
const canZoom = computed(() => isImage.value)

// ===== 图片变换（AxImageViewer 同款：缩放 / 拖拽 / 旋转 / 翻转） =====
const scale = ref(1)
const rotation = ref(0)
const flip = ref(false)
const offsetX = ref(0)
const offsetY = ref(0)
const dragging = ref(false)
let dragStartX = 0
let dragStartY = 0

const imageStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value}) rotate(${rotation.value}deg) scaleX(${flip.value ? -1 : 1})`,
  transition: dragging.value ? "none" : "transform 0.2s ease",
}))

function resetTransform(): void {
  scale.value = 1
  rotation.value = 0
  flip.value = false
  offsetX.value = 0
  offsetY.value = 0
}
function zoomIn(): void { scale.value = Math.min(scale.value + 0.25, 5) }
function zoomOut(): void { scale.value = Math.max(scale.value - 0.25, 0.25) }
function rotateImg(): void { rotation.value = (rotation.value + 90) % 360 }
function toggleFlip(): void { flip.value = !flip.value }

function handleWheel(e: WheelEvent): void {
  if (!isImage.value) return
  e.preventDefault()
  scale.value = Math.min(Math.max(scale.value + (e.deltaY > 0 ? -0.1 : 0.1), 0.25), 5)
}
function handleMouseDown(e: MouseEvent): void {
  if (!isImage.value) return
  if ((e.target as HTMLElement).closest(".mv-controls")) return
  dragging.value = true
  dragStartX = e.clientX - offsetX.value
  dragStartY = e.clientY - offsetY.value
}
function handleMouseMove(e: MouseEvent): void {
  if (!dragging.value) return
  offsetX.value = e.clientX - dragStartX
  offsetY.value = e.clientY - dragStartY
}
function handleMouseUp(): void { dragging.value = false }

// ===== 切换（多图） =====
function prevImage(): void {
  if (!isMultiple.value) return
  currentIdx.value = (currentIdx.value - 1 + list.value.length) % list.value.length
  resetTransform()
  emit("index", currentIdx.value)
}
function nextImage(): void {
  if (!isMultiple.value) return
  currentIdx.value = (currentIdx.value + 1) % list.value.length
  resetTransform()
  emit("index", currentIdx.value)
}

// ===== 下载（AxImageViewer 同款：fetch 转 blob；跨域失败退开新窗口） =====
async function download(): Promise<void> {
  const url = currentUrl.value
  if (!url) return
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = objUrl
    a.download = item.value?.name || "image"
    a.click()
    URL.revokeObjectURL(objUrl)
  } catch {
    window.open(url, "_blank")
  }
}

function close(): void { emit("close") }
function remove(): void {
  if (item.value && props.onDelete) props.onDelete(item.value)
}

// ===== 键盘（AxImageViewer 同款键位） =====
function handleKeydown(e: KeyboardEvent): void {
  if (!item.value) return
  switch (e.key) {
    case "Escape": e.stopPropagation(); close(); break
    case "ArrowLeft": case "a": case "A": prevImage(); break
    case "ArrowRight": case "d": case "D": nextImage(); break
    case "+": case "=": if (canZoom.value) zoomIn(); break
    case "-": if (canZoom.value) zoomOut(); break
    case "0": if (canZoom.value) resetTransform(); break
    case "r": case "R": if (isImage.value) rotateImg(); break
    case "f": case "F": if (isImage.value) toggleFlip(); break
  }
}

onMounted(() => window.addEventListener("keydown", handleKeydown, true))
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown, true)
  document.body.style.overflow = ""
})

/** 打开时锁 body 滚动、从宿主给的 index 起步、变换归零；关闭恢复 */
watch(item, (v) => {
  if (typeof document === "undefined") return
  if (v) {
    currentIdx.value = Math.min(Math.max(v.index ?? 0, 0), Math.max(list.value.length - 1, 0))
    emit("index", currentIdx.value)
    resetTransform()
    document.body.style.overflow = "hidden"
  } else {
    document.body.style.overflow = ""
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="item"
      v-bind="$attrs"
      class="mv-root"
      role="dialog"
      aria-modal="true"
      :aria-label="item.name || '素材预览'"
      data-testid="media-viewer"
      @click.self="close"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @wheel="handleWheel"
      @contextmenu.prevent
    >
      <!-- 右上角：删除（悬停显示）+ 常驻关闭 -->
      <span class="mv-actions">
        <button
          v-if="canRemove"
          class="mv-corner-btn mv-remove"
          type="button"
          title="删除该素材"
          aria-label="删除该素材"
          @click.stop="remove"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
        </button>
        <button class="mv-corner-btn" type="button" title="关闭 (Esc)" aria-label="关闭预览" @click.stop="close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </span>

      <!-- 左上角悬浮标题 -->
      <span v-if="item.name" class="mv-title">{{ item.name }}</span>

      <!-- 主内容：上一张 · 舞台 · 下一张 -->
      <div class="mv-container">
        <button v-if="isMultiple" class="mv-nav" type="button" title="上一张 (←)" aria-label="上一张" @click.stop="prevImage">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        <div class="mv-stage" @click.self="close">
          <img
            v-if="isImage && currentUrl"
            class="mv-img"
            :class="{ 'mv-img--dragging': dragging }"
            :style="imageStyle"
            :src="currentUrl"
            :alt="item.name"
            draggable="false"
          />
          <!-- 插件注册件舞台：有背景/圆角/限宽限高；内部指针事件全部 stop（不触发拖拽/关闭） -->
          <!--
            视频：用节点插件的 videoPreview（**自定义 UI**：播放/进度/时间/音量，不要浏览器原生控件），
            并传 tall=true 让它按大舞台排版。它铺满舞台（.mv-video-stage 撑满），控件 hover 显形。
            用户口径：不要原生 UI（但要能调音量）；不要缩放假把 —— 默认尺寸已经够大，不用缩放。
          -->
          <div v-else-if="kind === 'video' && currentUrl" class="mv-video-stage" @click.stop @mousedown.stop @mouseup.stop @mousemove.stop @wheel.stop>
            <component :is="VideoPreview" v-if="VideoPreview" :key="currentUrl" :url="currentUrl" :name="item.name" tall />
            <video v-else :key="currentUrl" class="mv-video" :src="currentUrl" controls autoplay playsinline />
          </div>
          <div v-else-if="kind === 'audio' && item.url && AudioPreview" class="mv-plugin-stage" @click.stop @mousedown.stop @mouseup.stop @mousemove.stop @wheel.stop>
            <component :is="AudioPreview" :url="item.url" :name="item.name" class="mv-media-plugin" />
          </div>
          <div v-else-if="kind === 'text' && TextPreview" class="mv-plugin-stage" @click.stop @mousedown.stop @mouseup.stop @mousemove.stop @wheel.stop>
            <component :is="TextPreview" :text="item.text" :name="item.name" class="mv-media-plugin" />
          </div>
          <!--
            可视化节点（kind='ui'）：没有"可加载的媒体地址"，它的内容是**一段 HTML**
            （item.html）。用户口径 2026-10-14：「我的当前的节点无法进行预览。或者，
            可以在预览中添加一个 iframe 预览框」—— 这里就是那个 iframe。

            为什么用 srcdoc 而不是新建页面：节点内容本来就是自包含的一段 HTML
            （与画布里节点内的沙箱同源约定，见 node-ui 的 uiData.buildSrcdoc）；空内容
            给一句占位提示，别让用户看到一片什么都没有（那看起来像又坏了）。
          -->
          <div v-else-if="kind === 'ui'" class="mv-ui-stage" @click.stop @mousedown.stop @mouseup.stop @mousemove.stop @wheel.stop>
            <iframe
              v-if="item.html"
              class="mv-ui-frame"
              :srcdoc="item.html"
              sandbox="allow-scripts"
              referrerpolicy="no-referrer"
              title="可视化节点预览"
            ></iframe>
            <p v-else class="mv-ui-empty">这个可视化节点还没有画过内容</p>
          </div>
          <audio v-else-if="kind === 'audio' && item.url" class="mv-audio" :src="item.url" controls />
          <pre v-else-if="kind === 'text'" class="mv-text">{{ item.text || '（空）' }}</pre>
          <slot v-else name="stage" :item="item" />
        </div>

        <button v-if="isMultiple" class="mv-nav" type="button" title="下一张 (→)" aria-label="下一张" @click.stop="nextImage">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>

      <!-- 底部浮动控制条（AxImageViewer 同款；只对图片出工具，视频/音频交给原生控制） -->
      <div v-if="canZoom" class="mv-controls" @mousedown.stop>
        <template v-if="isMultiple">
          <span class="mv-page">{{ currentIdx + 1 }} / {{ list.length }}</span>
          <span class="mv-divider" />
        </template>
        <button class="mv-btn" type="button" title="缩小 (-)" aria-label="缩小" @click="zoomOut">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
        </button>
        <span class="mv-zoom-label">{{ Math.round(scale * 100) }}%</span>
        <button class="mv-btn" type="button" title="放大 (+)" aria-label="放大" @click="zoomIn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="11" y1="8" x2="11" y2="14" /></svg>
        </button>
        <span class="mv-divider" />
        <button v-if="isImage" class="mv-btn" type="button" title="旋转 (R)" aria-label="旋转" @click="rotateImg">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
        </button>
        <button v-if="isImage" class="mv-btn" type="button" title="翻转 (F)" aria-label="翻转" @click="toggleFlip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18" /><path d="M8 7 4 12l4 5" /><path d="m16 7 4 5-4 5" /></svg>
        </button>
        <button v-if="canZoom" class="mv-btn" type="button" title="重置 (0)" aria-label="重置" @click="resetTransform">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
        </button>
        <span class="mv-divider" />
        <button class="mv-btn" type="button" title="下载" aria-label="下载" @click="download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mv-root {
  position: fixed;
  inset: 0;
  /* 100200：盖过生成历史弹窗（AxDialog z-index 200）与设置面板（SettingsShell 100000/100001），
     预览必须永远在最上层（用户实测：从历史里点开图片被弹窗压住）。 */
  z-index: 100200;
  background: var(--ui-scrim, rgb(0 0 0 / 0.6));
  user-select: none;
}
/* 右上角悬浮按钮组 */
.mv-actions {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
  display: flex;
  gap: 8px;
}
.mv-corner-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: var(--ui-veil, rgb(255 255 255 / 0.12));
  color: var(--ui-tip-ink, #fff);
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: background-color 0.15s ease-out;
}
.mv-corner-btn svg { width: 18px; height: 18px; }
.mv-corner-btn:hover { background: var(--ui-hover-strong, rgb(255 255 255 / 0.24)); }
.mv-corner-btn:focus-visible { outline: 2px solid var(--ui-tip-ink, #fff); outline-offset: 1px; }
/* 删除：悬停才露，落下去是危险色 */
.mv-remove { opacity: 0; pointer-events: none; transition: opacity 0.15s ease-out, background-color 0.15s ease-out; }
.mv-actions:hover .mv-remove,
.mv-remove:focus-visible { opacity: 1; pointer-events: auto; }
.mv-remove:hover { background: var(--ui-danger, #ef4444); color: var(--ui-overlay-solid, #fff); }
/* 左上角悬浮标题 */
.mv-title {
  position: absolute;
  top: 22px;
  left: 20px;
  z-index: 10;
  max-width: min(60vw, 480px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-tip-ink, #fff);
  text-shadow: 0 1px 4px var(--ui-scrim, rgb(0 0 0 / 0.35));
  pointer-events: none;
}
/* 主内容：左右留出导航键的位置 */
.mv-container {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 56px 72px 88px;
}
.mv-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--ui-veil, rgb(255 255 255 / 0.12));
  color: var(--ui-tip-ink, #fff);
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: background-color 0.15s ease-out;
}
.mv-nav svg { width: 20px; height: 20px; }
.mv-nav:hover { background: var(--ui-hover-strong, rgb(255 255 255 / 0.24)); }
.mv-nav:focus-visible { outline: 2px solid var(--ui-tip-ink, #fff); outline-offset: 1px; }
.mv-stage {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mv-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
  cursor: grab;
  will-change: transform;
}
.mv-img--dragging { cursor: grabbing; }
/* 插件注册的预览组件（audioPreview / videoPreview / textPreview）：撑满舞台。
   舞台高度由 min-height 决定（不是显式 height），子组件写 height:100% 解析不出来 ——
   内容只占顶部一条、下方留大片空白（实测音频 640×200 的舞台里只画了 96px）。
   用 flex 纵向拉伸撑满：apv/vpv/tpv 根都是可拉伸的 flex 列，撑满后波形/画面才铺满卡片。 */
.mv-media-plugin { flex: 1 1 auto; width: min(720px, 100%); min-height: 0; border-radius: 8px; overflow: hidden; }
.mv-media-plugin:has(.vpv-root) { width: min(920px, 100%); }
/* 视频舞台：撑满整个预览区（不给限宽限高 —— 视频默认就该大）。
   里面是节点插件的 videoPreview（自定义 UI：播放/进度/时间/音量），它自身撑满本层。 */
.mv-video-stage { flex: 1 1 auto; width: 100%; height: 100%; min-width: 0; min-height: 0; border-radius: 8px; overflow: hidden; display: flex; }
.mv-video { width: 100%; height: 100%; object-fit: contain; border-radius: 8px; outline: none; background: transparent; }
.mv-audio { width: min(560px, 100%); }
/* 可视化节点预览（kind='ui'）：iframe 装节点那段 HTML。
   尺寸比插件舞台更宽（它是"一整块界面"），上限用 vw/vh 免得在小屏上溢出。 */
.mv-ui-stage {
  width: min(900px, 90vw);
  height: min(620px, 72vh);
  border-radius: 16px;
  background: var(--ui-overlay-solid, #fff);
  box-shadow: var(--ui-shadow-lg, 0 18px 48px rgb(0 0 0 / 0.35));
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mv-ui-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: transparent;
}
.mv-ui-empty {
  margin: 0;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 13px;
}
/* 节点插件注册的预览组件舞台：有背景的卡片，限宽限高不铺满全屏（用户口径）。
   组件内部事件在此层被 stop（见模板），不会触发全屏查看器的拖拽/关闭。 */
.mv-plugin-stage {
  width: min(640px, 86vw);
  max-height: 60vh;
  min-height: 200px;
  border-radius: 16px;
  background: var(--ui-overlay-solid, #fff);
  box-shadow: var(--ui-shadow-lg, 0 18px 48px rgb(0 0 0 / 0.35));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: var(--ui-ink, inherit);
}
.mv-text {
  max-width: min(880px, 100%);
  max-height: 100%;
  margin: 0;
  padding: 20px 24px;
  overflow: auto;
  border-radius: 12px;
  background: var(--ui-veil, rgb(255 255 255 / 0.08));
  color: var(--ui-tip-ink, #fff);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
/* 底部浮动控制条：居中胶囊 */
.mv-controls {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 12px;
  background: var(--ui-veil-strong, rgb(30 30 30 / 0.82));
  color: var(--ui-tip-ink, #fff);
  backdrop-filter: blur(12px);
}
.mv-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease-out;
}
.mv-btn svg { width: 15px; height: 15px; }
.mv-btn:hover { background: var(--ui-hover, rgb(255 255 255 / 0.12)); }
.mv-btn:focus-visible { outline: 2px solid var(--ui-tip-ink, #fff); outline-offset: 1px; }
.mv-zoom-label { min-width: 44px; text-align: center; font-size: 12px; font-variant-numeric: tabular-nums; }
.mv-page { padding: 0 6px; font-size: 12px; font-variant-numeric: tabular-nums; }
.mv-divider { width: 1px; height: 16px; margin: 0 4px; background: var(--ui-line, rgb(255 255 255 / 0.18)); }
</style>
