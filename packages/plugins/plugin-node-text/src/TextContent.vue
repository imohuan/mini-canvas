<script setup lang="ts">
/**
 * TextContent —— text 节点 content 组件（随 plugin-node-text 插件包发布，经 BaseNode 壳的 content 段渲染）。
 *
 * 职责：展示文本（带缩放分级 LOD：预览全文 → 骨架横条 → 更小档骨架横条）；双击进入编辑，
 * 失焦把改动经 ctx.get('text').editText 写回内核并落盘。
 *
 * 三态由用户明确定义：
 * - **预览态**（默认）：即可滚动（不选中、不编辑也能滚），滚轮只滚文字、不缩放画布；
 *   滚动条平时隐身，鼠标进节点才出现细条（用户 2026-10-29 对照参考稿确认）；
 * - **编辑态**（双击进入）：同样是细条，不用系统原生滚动条（用户：「双击的时候又出现了一个
 *   滚动条，相当于出现了两种」）；滚轮仍从画布手里抢过来；
 * - **骨架横条**（缩到一定程度）：原话「当鼠标缩放到一定程度下，文本会发生一些改变。
 *   我希望你可以改变成图片中的这种形式，使用不同长度的矩形色块」——就是骨架屏那类效果；
 *   追问「两档都改吗」→「两档都改成横条」，所以两档（skeleton / skeleton-mini）都是横条，
 *   差别只是条的厚度与行距（缩得越小越薄越密）。
 *
 * 判定都在 textViewMode.ts（纯函数、可单测），横条几何在 textSkeleton.ts，本组件只照结论渲染。
 *
 * 与 V1 的关系（packages/canvas-core/src/nodes/text/TextNode.vue）：
 * - 内容区语义等价 V1 的 p-4（16px 内边距）；
 * - 编辑态就是一个**透明底、无边框、无 outline**的 textarea（就地编辑，不是"输入框卡片"）；
 * - **回车是换行，不是提交**（V1 只绑 keydown.escape）；Esc 取消编辑、blur 提交；
 * - 唯一的差异：V1 缩到很小时**干脆不让进编辑**，这里允许进（用户双击就是想编辑），
 *   只是代价自负——所以编辑态在大缩放范围里一直可用。
 *
 * 编辑态放在 textEditSession（模块级、按 nodeId 记名）而不是本组件的 ref：
 * 这样"编辑态有没有滚动条、有没有拦滚轮"能被无头测试直接渲染出来验（项目铁律：渲染结果要有测试兜底）。
 *
 * 依赖方向：只 import 渲染层的 useCanvasRender()(收口函数)，不反向依赖 demo-web。
 * LOD 阈值从 theme-default 的 Config 单一数据源读（textLodIconZoom / titleScaleMinZoom，对齐 v1 core 同名项），
 * 经 onChange 订阅实时生效；读不到时回落默认（0.18 / 0.5）。
 */
import { ref, computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { TextNodeService } from './nodeTextPlugin'
import { isSkeletonMode, resolveLodThresholds, resolveTextContentSpec } from './textViewMode'
import { beginEdit, endEdit, isTextEditing } from './textEditSession'
import { resolveScrollbarThumb, scrollStepForWheel, scrollTopForThumbDrag } from './textScrollbar'
import TextSkeleton from './TextSkeleton.vue'

/** 内容区固定内边距（px）：横条要在这个框里排，所以外层与预览字共享同一组数值 */
const CONTENT_PADDING = 16

const props = defineProps<{ id: string; data: { text?: string; cardWidth?: number; cardHeight?: number } }>()

// 统一渲染上下文经 useCanvasRender() 取(宿主 provide)；ctx 是裸内核上下文(boot 后已就绪，见 CanvasSurface)。
// 根 Context 没有服务属性 Proxy（declare module 只增强类型）；这里用 ctx.get 取 text 服务，避免 ctx.text 运行时为 undefined。
const { ctx, flow } = useCanvasRender()
/** 统一空状态：文本为空时显示「双击编辑」提示（与其它节点同一套空态观感） */
const NodeEmptyState = useUiComponent('nodeEmptyState')
const viewport = flow.viewport
function textService() {
  return ctx.get<TextNodeService>('text')
}

// 编辑态来自会话（按 nodeId 记名），同包组件/测试共享同一份真相
const editing = computed(() => isTextEditing(props.id))
const draft = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const previewEl = ref<HTMLDivElement | null>(null)
const scrollTrackEl = ref<HTMLElement | null>(null)
// 本地展示值：init 自 props.data，编辑后本地回显
const shown = ref(props.data.text ?? '')

// 外部写回同步：撤销/重做、AI 或别的插件改 data.text 时，本地展示值要跟着变。
// 不加这个 watch 时 shown 只在 setup 初始化一次，撤销后画面仍显示旧文本（B 类缺口）。
// 编辑中不覆盖草稿，否则用户正在敲字会被外部写回打断。
watch(
  () => props.data.text,
  (next) => {
    if (editing.value) return
    shown.value = typeof next === 'string' ? next : ''
  },
)

// —— 缩放分级 LOD 阈值（theme-default Config，经 ctx.settings 实时读）——
const settingsGet = (key: string): unknown => ctx?.tryGet('settings')?.get(key)
const lodThresholds = ref(resolveLodThresholds(settingsGet('titleScaleMinZoom'), settingsGet('textLodIconZoom')))
const textSettingOff = ctx?.tryGet('settings')?.onChange((key, value) => {
  if (key === 'titleScaleMinZoom' || key === 'textLodIconZoom') {
    lodThresholds.value = resolveLodThresholds(settingsGet('titleScaleMinZoom'), settingsGet('textLodIconZoom'))
  }
})
onBeforeUnmount(() => textSettingOff?.dispose())

// 当前画布缩放（VueFlow viewport 经渲染上下文暴露，响应式）
const zoom = computed(() => Math.max((viewport.value?.zoom ?? 1) || 1, 0.01))
// 内容形态（预览 / 骨架横条两档 / 编辑）+ 该形态下的滚动与滚轮策略，全部由纯函数判定
const spec = computed(() =>
  resolveTextContentSpec({
    editing: editing.value,
    zoom: zoom.value,
    fullZoom: lodThresholds.value.fullZoom,
    iconZoom: lodThresholds.value.iconZoom,
  }),
)
// 骨架横条的档位：越缩越小 → 换更薄更密那档
const skeletonDensity = computed<'body' | 'mini'>(() => (spec.value.mode === 'skeleton-mini' ? 'mini' : 'body'))

// —— 预览 / 编辑共用的细滚动条：原生条一律不画，hover 或刚滚动时浮出自绘细条 ——
// 度量来自真实视口（预览量 .preview，编辑量 textarea）；内容没超出时 scrollThumb=null，整条不渲染。
const scrollMetrics = ref({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })
const scrollbarActive = ref(false)
const scrollbarDragging = ref(false)
let scrollbarActiveTimer: ReturnType<typeof setTimeout> | null = null
let scrollDragPointer: number | null = null
let scrollDragStartY = 0
let scrollDragStartTop = 0
let scrollbarRo: ResizeObserver | null = null

const scrollThumb = computed(() => {
  if (!spec.value.scrollable) return null
  return resolveScrollbarThumb({ ...scrollMetrics.value, trackHeight: scrollMetrics.value.clientHeight })
})
const scrollThumbStyle = computed(() => {
  const thumb = scrollThumb.value
  return thumb ? { height: `${thumb.thumbHeight}px`, transform: `translate3d(0, ${thumb.thumbTop}px, 0)` } : {}
})

function syncScrollbar(): void {
  const el = scrollSource()
  if (!el) {
    scrollMetrics.value = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 }
    return
  }
  scrollMetrics.value = {
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }
}

/** 当前承载文字的滚动层：编辑态是 textarea，其余可读态是预览 div */
function scrollSource(): HTMLElement | null {
  return spec.value.mode === 'editing' ? inputEl.value : previewEl.value
}

/** 滚动后让细条多停留一会儿（鼠标没 hover 也能看清刚刚滚到哪） */
function keepScrollbarVisible(): void {
  scrollbarActive.value = true
  if (scrollbarActiveTimer) clearTimeout(scrollbarActiveTimer)
  scrollbarActiveTimer = setTimeout(() => {
    scrollbarActive.value = false
    scrollbarActiveTimer = null
  }, 900)
}

function onPreviewScroll(): void {
  syncScrollbar()
  keepScrollbarVisible()
}

/** 编辑框滚动也更新细条位置（原生条已隐藏） */
function onEditorScroll(): void {
  syncScrollbar()
  keepScrollbarVisible()
}

/**
 * 预览态滚轮只滚文字，不缩放画布（nowheel 之外再加一道事件冒泡兜底）。
 *
 * 自己写 scrollTop 而不用浏览器默认：画布放大后 transform 会把 delta 一起放大
 * （230% 时一格 100px 变 230px），文字会"飞"。这里固定每格最多 40px 内容。
 */
function onPreviewWheel(e: WheelEvent): void {
  e.stopPropagation()
  const el = previewEl.value
  if (el) {
    const step = scrollStepForWheel(e.deltaY)
    if (step !== 0) {
      e.preventDefault()
      el.scrollTop += step
    }
  }
  syncScrollbar()
  keepScrollbarVisible()
}

/** 点轨道空白：把滑块中心移到指针处（和系统滚动条一致） */
function onScrollTrackPointerDown(e: PointerEvent): void {
  const el = scrollSource()
  const thumb = scrollThumb.value
  const track = scrollTrackEl.value
  if (!el || !thumb || !track) return
  e.preventDefault()
  e.stopPropagation()
  keepScrollbarVisible()
  const rect = track.getBoundingClientRect()
  const travel = rect.height - thumb.thumbHeight
  if (travel <= 0) return
  const top = Math.min(Math.max(e.clientY - rect.top - thumb.thumbHeight / 2, 0), travel)
  el.scrollTop = (top / travel) * thumb.maxScrollTop
  syncScrollbar()
}

function onThumbPointerDown(e: PointerEvent): void {
  const el = scrollSource()
  const thumb = scrollThumb.value
  if (!el || !thumb) return
  e.preventDefault()
  e.stopPropagation()
  scrollDragPointer = e.pointerId
  scrollDragStartY = e.clientY
  scrollDragStartTop = el.scrollTop
  scrollbarDragging.value = true
  scrollbarActive.value = true
  if (scrollbarActiveTimer) {
    clearTimeout(scrollbarActiveTimer)
    scrollbarActiveTimer = null
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onThumbPointerMove(e: PointerEvent): void {
  if (scrollDragPointer !== e.pointerId) return
  const el = scrollSource()
  const thumb = scrollThumb.value
  if (!el || !thumb) return
  e.preventDefault()
  e.stopPropagation()
  el.scrollTop = scrollTopForThumbDrag({
    startScrollTop: scrollDragStartTop,
    deltaY: e.clientY - scrollDragStartY,
    thumbTravel: scrollMetrics.value.clientHeight - thumb.thumbHeight,
    maxScrollTop: thumb.maxScrollTop,
  })
  syncScrollbar()
}

function endThumbDrag(e: PointerEvent): void {
  if (scrollDragPointer !== e.pointerId) return
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  scrollDragPointer = null
  scrollbarDragging.value = false
  keepScrollbarVisible()
}

watch(
  [shown, () => spec.value.mode],
  () => void nextTick(syncScrollbar),
  { flush: 'post' },
)

onMounted(() => {
  void nextTick(syncScrollbar)
  // 卡片 resize、字体变化、内容换行变化都会改 scrollHeight；量到就重算滑块。
  if (typeof ResizeObserver === 'undefined') return
  scrollbarRo = new ResizeObserver(() => syncScrollbar())
  if (previewEl.value) scrollbarRo.observe(previewEl.value)
})

/** 编辑框出现时也要量它（预览层此刻已卸载） */
watch(inputEl, (el) => {
  if (!el) return
  scrollbarRo?.observe(el)
  void nextTick(syncScrollbar)
})
// 估算用内容盒尺寸：卡片宽高（data 里的卡片镜像）减掉内边距。
// 只用于 ResizeObserver 报到之前的首帧估算 —— 卡片被 resize 过就有值（否则类型默认尺寸兜 300×200）。
const boxHint = computed(() => ({
  width: Math.max(finiteOr(props.data.cardWidth, 300) - CONTENT_PADDING * 2, 0),
  height: Math.max(finiteOr(props.data.cardHeight, 200) - CONTENT_PADDING * 2, 0),
}))

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function startEdit(): void {
  if (editing.value) return // 已在编辑中就不要再进（否则会把用户正在敲的草稿重置掉）
  if (isSkeletonMode(spec.value.mode)) return // 极小缩放下内容已经看不清，不进编辑（避免误操作）
  beginEdit(props.id)
  draft.value = shown.value
  void nextTick(() => inputEl.value?.focus())
}

function commit(): void {
  if (!editing.value) return
  endEdit(props.id)
  const next = draft.value
  if (next !== shown.value) {
    shown.value = next
    textService().editText(props.id, next)
  }
}

/** Esc 取消编辑：丢掉草稿，回到进入编辑前的展示值（不写回内核） */
function cancelEdit(): void {
  endEdit(props.id)
  draft.value = shown.value
}

/**
 * 编辑态滚轮：只滚自己的文字，不缩放画布。
 *
 * 两手准备 —— 类名 nowheel 是给 VueFlow 的 d3-zoom 过滤用的（它按 closest('.nowheel') 跳过），
 * 这里的 stopPropagation 是兜底：图层叠得深时类名判定偶尔会落空，事件也已经在冒泡路上被截住。
 * 与预览同一条规则：画布放大后 transform 会把 delta 一起放大，所以自己按上限走。
 */
function onEditorWheel(e: WheelEvent): void {
  e.stopPropagation()
  const el = inputEl.value
  if (el) {
    const step = scrollStepForWheel(e.deltaY)
    if (step !== 0) {
      e.preventDefault()
      el.scrollTop += step
    }
  }
  syncScrollbar()
  keepScrollbarVisible()
}

/**
 * 编辑态键盘：**只拦 Esc**（V1 同款）。
 * 回车**不拦**——textarea 的默认行为就是换行，这是用户要的"回车换行，不是提交"。
 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') cancelEdit()
}

function stop(e: MouseEvent): void {
  e.stopPropagation()
}

onBeforeUnmount(() => {
  scrollbarRo?.disconnect()
  scrollbarRo = null
  if (scrollbarActiveTimer) clearTimeout(scrollbarActiveTimer)
  scrollbarActiveTimer = null
  if (editing.value) {
    endEdit(props.id)
    const next = draft.value
    if (next !== shown.value) textService().editText(props.id, next)
  }
})
</script>

<template>
  <div
    class="text-node"
    :class="{ nowheel: spec.blockCanvasWheel, 'is-scroll-active': scrollbarActive }"
    :data-mode="spec.mode"
    :data-scrollable="String(spec.scrollable)"
  >
    <div class="body">
      <!-- 骨架横条（两档）：用长短不一的灰条把这整段文字的版式画成剪影，零文本重绘。
           density 决定条的厚度/行距（mini 更薄更密）；行数与长短都由真实文本折算。 -->
      <TextSkeleton
        v-if="isSkeletonMode(spec.mode)"
        class="skeleton"
        :text="shown"
        :density="skeletonDensity"
        :width-hint="boxHint.width"
        :height-hint="boxHint.height"
      />

      <!-- 编辑态：textarea（预览态才显示真实文本）。透明底 / 无边框 / 无 outline，与 V1 一致。
           nodrag/nopan：在编辑框里按住拖动是"选字"，不该把节点拖走或拖动画布（老版同样有这个坑，这里补掉）。
           回车换行（不拦 keydown.enter），Esc 取消，blur 提交。 -->
      <textarea
        v-else-if="spec.mode === 'editing'"
        ref="inputEl"
        v-model="draft"
        class="editor nodrag nopan nowheel"
        placeholder="输入文本..."
        aria-label="文本内容"
        @blur="commit"
        @keydown="onKeydown"
        @wheel="onEditorWheel"
        @scroll="onEditorScroll"
        @click.stop="stop"
        @mousedown.stop="stop"
      ></textarea>

      <!-- 全文预览：随画布自然缩放。
           双击进入编辑（与 V1 一致：只读态才绑 dblclick；编辑态里双击是"选词"，不该被当成再进编辑）。 -->
      <div
        v-else
        ref="previewEl"
        class="preview"
        title="双击编辑"
        @dblclick.stop="startEdit"
        @scroll="onPreviewScroll"
        @wheel="onPreviewWheel"
      >
        <!-- 空态完全走默认组件的默认 UI（column + md），与其它节点同一观感 -->
        <NodeEmptyState
          v-if="!shown && NodeEmptyState"
          text="（空）"
          description="双击编辑"
        />
        <template v-else>{{ shown || '（空）' }}</template>
      </div>

    </div>

    <!-- 预览态自绘细滚动条：原生条隐藏，鼠标进入节点或刚滚动时浮出。
         轨道挂在 body 外面（body 会裁掉超出内容盒的东西），上下各让 16px 与文字区对齐；
         轨道只在内容真的超出时渲染；轨道/滑块都 stopPropagation，拖它不会拖走节点。 -->
    <div
      v-if="scrollThumb"
      ref="scrollTrackEl"
      class="scrollbar-track"
      :class="{ 'is-dragging': scrollbarDragging }"
      @pointerdown="onScrollTrackPointerDown"
    >
      <div
        class="scrollbar-thumb"
        :style="scrollThumbStyle"
        @pointerdown="onThumbPointerDown"
        @pointermove="onThumbPointerMove"
        @pointerup="endThumbDrag"
        @pointercancel="endThumbDrag"
      />
    </div>
  </div>
</template>

<style scoped>
/* 外层容器 = V1 的 p-4 + overflow-hidden（16px 内边距，内容不溢出卡片圆角） */
.text-node {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 文字基准：14px / 行高 1.5（V1 的 text-gray-700 leading-relaxed 语义）；
   颜色走主题变量，缺变量时回落 V1 的 text-gray-700 (#374151) */
.preview,
.editor {
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  color: var(--canvas-node-text-body, #374151);
}

/* 全文预览：透明底、可点、pre-wrap；双击进入编辑。
   预览即可滚（不选中、不编辑也能滚）；原生滚动条不占位，由下面自绘细条代替。 */
.preview {
  width: 100%;
  height: 100%;
  white-space: pre-wrap;
  overflow-y: auto;
  overflow-x: hidden;
  overflow-wrap: anywhere;
  overscroll-behavior: contain;
  cursor: text;
  scrollbar-width: none;
}
.preview::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

/* 预览 / 编辑共用的细滚动条：默认透明，鼠标进节点或刚滚动过才出现；不占文字宽度。
   轨道放在 .text-node 上（16px 内边距之上），不会和原生条一起冒出来。 */
.scrollbar-track {
  position: absolute;
  top: 16px;
  bottom: 16px;
  right: 6px;
  width: 6px;
  z-index: 2;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
  touch-action: none;
}
.text-node:hover .scrollbar-track,
.text-node.is-scroll-active .scrollbar-track {
  opacity: 1;
  pointer-events: auto;
}
.scrollbar-thumb {
  position: absolute;
  top: 0;
  left: 1px;
  width: 4px;
  border-radius: 999px;
  background: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.28));
  cursor: grab;
  will-change: transform;
}
.scrollbar-thumb:hover,
.scrollbar-track.is-dragging .scrollbar-thumb {
  background: var(--ui-scroll-thumb-hover, rgba(0, 0, 0, 0.42));
}
.scrollbar-track.is-dragging .scrollbar-thumb {
  cursor: grabbing;
}

/* 骨架横条层：吃满内容盒（与上面那 16px 内边距对齐），自己不再加内边距 */
.skeleton {
  position: absolute;
  inset: 0;
}

/* 编辑态：透明底、无边框、无 outline、撑满——就地编辑（不是"输入框卡片"），与 V1 一致；
   滚动条与预览**同一套自绘细条**：原生条宽度为 0，不会出现第二根系统滚动条
   （用户 2026-10-29：「双击的时候又出现了一个滚动条，相当于出现了两种」）。 */
.editor {
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  outline: none;
  background: transparent;
  resize: none;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: none;
}
.editor::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
.editor:focus-visible {
  outline: none;
}
</style>

