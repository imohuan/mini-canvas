<script setup lang="ts">
/**
 * ImageCompareContent —— 图片对比节点的 content 组件（随插件包发布，经 BaseNode 壳的 content 段渲染）。
 *
 * 对照老版 packages/canvas-core/src/nodes/image-compare/ImageCompareNode.vue：把连进来的两张图叠在一起，
 * 用一条可拖拽的分割线做"左图 / 右图"对照（左图用 clip-path 裁到分割线左侧）。
 *
 * 与老版的差异（v2 分层）：
 * - 上游图不再经 @vue-flow 的 useUpstreamImages，而是读渲染上下文的 renderEdges/renderNodes（v2 等价物）；
 * - 取图/FIFO/夹取等纯逻辑挪到 imageCompareEngine.ts（可单测）；
 * - **宽度跟随第一条连线的图片**（用户要求）：上游图片节点显示多宽，对比窗口就多宽 ——
 *   两边像素对齐了对照才有意义。规则与幂等在 compareFit.ts（纯函数、可单测）；
 *   老版是按图片原始像素 + 上限另算一套（会"一加载就写节点尺寸"），v2 直接跟随，不再自己发明尺寸。
 *   只跟宽度、不动高度：高度留给用户自己拖。
 *
 * 交互：分割线把手 pointerdown 起手 → move/up 绑到全局 document。
 * 绑全局而非元素自身，是因为 setPointerCapture 在画布缩放/嵌套场景下不总生效，
 * 指针一旦移出把手元素就会"拖一半断掉"（同 useNodeCardSize 的既有结论）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { clampDivider, resolveCompareEntries } from './imageCompareEngine'
import { compareWidthPatch, DEFAULT_COMPARE_HEIGHT, resolveFollowWidth } from './compareFit'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx, renderEdges, renderNodes } = useCanvasRender()

/** 按节点 id 取 data（renderNodes 是当前渲染快照） */
function nodeData(nodeId: string): Record<string, unknown> | undefined {
  const n = renderNodes.value.find((item) => item.id === nodeId)
  return n?.data as Record<string, unknown> | undefined
}

/**
 * 连到本节点、且上游真有图的入边（按连线先后），最多两组 [图片地址, 上游节点 id]。
 * 保留边本身（而不只是地址）：左右小标签要指到"是哪个上游节点"，
 * 只按图片地址反查会在两个上游用同一张图时认错人。
 */
const sources = computed(() => resolveCompareEntries(renderEdges.value, props.id, nodeData))

const leftImage = computed(() => sources.value[0]?.url ?? '')
const rightImage = computed(() => sources.value[1]?.url ?? '')
const hasAny = computed(() => !!leftImage.value || !!rightImage.value)
const hasTwo = computed(() => !!leftImage.value && !!rightImage.value)

// ==================== 宽度跟随第一条连线的图片 ====================
/**
 * 上游**图片节点的显示宽度**（data.cardWidth）—— 图片插件在上传/换图/裁剪/生成后都会写它，
 * 也就是用户在画布上实际看到的那个宽度。分屏对比要对齐的就是这个宽度，不是原始像素。
 */
function upstreamCardWidth(nodeId: string): unknown {
  return nodeData(nodeId)?.cardWidth
}

/**
 * 幂等把卡片宽度对齐到第一条连线那张图的显示宽度。
 *
 * 幂等是硬要求：本函数写回宽度会再触发一次依赖（renderNodes/props.data）变化 ——
 * 靠 compareWidthPatch 里"算出来等于当前就不写"这条判断挡住（与 imageFit 同一套路），
 * 否则就是"自己触发自己"的死循环。
 */
function syncFollowWidth(): void {
  const target = resolveFollowWidth(sources.value, upstreamCardWidth)
  const patch = compareWidthPatch(target, props.data, DEFAULT_COMPARE_HEIGHT)
  if (!patch) return
  ctx
    .get<{ updateNode(id: string, patch: { data: Record<string, unknown>; size: { w: number; h: number } }): void }>(
      'graph',
    )
    .updateNode(props.id, {
      data: { ...(props.data ?? {}), cardWidth: patch.cardWidth },
      size: patch.size,
    })
}

// 上游图变化（新连一张 / 换图 / 上游卡片宽度被 resize）→ 重新对齐宽度。
// 依赖里带上上游的 cardWidth 本身，所以"上游被拖动改宽"也会跟随。
watch(
  () => sources.value.map((e) => `${e.sourceId}:${String(upstreamCardWidth(e.sourceId))}`).join(','),
  () => syncFollowWidth(),
  { immediate: true },
)

/** 两侧图片名字（取上游节点的 label / imageName），没有就显示 左/右 */
function upstreamName(side: 'left' | 'right'): string {
  const entry = side === 'left' ? sources.value[0] : sources.value[1]
  const fallback = side === 'left' ? '左' : '右'
  if (!entry) return fallback
  const data = nodeData(entry.sourceId)
  const name = (data?.imageName as string) || (data?.label as string) || ''
  return name ? truncate(name, 10) : fallback
}
const leftLabel = computed(() => upstreamName('left'))
const rightLabel = computed(() => upstreamName('right'))

/** 名字太长时中间打省略号（首尾各留一半，便于分辨） */
function truncate(name: string, max = 10): string {
  const chars = Array.from(name)
  if (chars.length <= max) return name
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return chars.slice(0, head).join('') + '…' + (tail > 0 ? chars.slice(chars.length - tail).join('') : '')
}

// —— 分割线位置：拖拽期间用本地值（流畅），松手才写回节点（一次一条历史） ——
const localDivider = ref<number>(clampDivider(Number(props.data?.dividerPosition)))
const dragging = ref(false)
const surfaceRef = ref<HTMLDivElement | null>(null)
watch(
  () => props.data?.dividerPosition,
  (v) => {
    if (dragging.value) return
    localDivider.value = clampDivider(Number(v))
  },
)

function onDividerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  dragging.value = true
  document.addEventListener('pointermove', onDocMove)
  document.addEventListener('pointerup', onDocUp)
  document.addEventListener('pointercancel', onDocUp)
}

function onDocMove(e: PointerEvent): void {
  if (!dragging.value) return
  const el = surfaceRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return
  localDivider.value = clampDivider(((e.clientX - rect.left) / rect.width) * 100)
}

function onDocUp(): void {
  if (!dragging.value) return
  dragging.value = false
  document.removeEventListener('pointermove', onDocMove)
  document.removeEventListener('pointerup', onDocUp)
  document.removeEventListener('pointercancel', onDocUp)
  commitDivider()
}

/** 把当前分割线位置写回节点：走插件服务（图写入口，自动进历史/落盘），刷新后位置还在 */
function commitDivider(): void {
  ctx
    .get<{ setDividerPosition(id: string, pct: number): void }>('imageCompare')
    .setDividerPosition(props.id, localDivider.value)
}

onBeforeUnmount(() => {
  document.removeEventListener('pointermove', onDocMove)
  document.removeEventListener('pointerup', onDocUp)
  document.removeEventListener('pointercancel', onDocUp)
})
</script>

<template>
  <div ref="surfaceRef" class="cmp">
    <!-- 一张都没连：占位说明 -->
    <div v-if="!hasAny" class="cmp-empty">
      <svg class="cmp-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <rect x="3" y="3" width="8" height="18" rx="1" />
        <rect x="13" y="3" width="8" height="18" rx="1" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </svg>
      <span class="cmp-empty-text">把两个图片节点连进来做对比</span>
    </div>

    <!-- 只连了一张：直接显示，并提示再连一张 -->
    <template v-else-if="!hasTwo">
      <img class="cmp-img" :src="leftImage" alt="对比图" draggable="false" />
      <div class="cmp-hint">再连一个图片节点即可分屏对比</div>
    </template>

    <!-- 两张都有：右图在底层，左图裁到分割线左侧 -->
    <template v-else>
      <div class="cmp-layer">
        <img class="cmp-img" :src="rightImage" alt="右侧对比图" draggable="false" />
        <span class="cmp-tag cmp-tag--right">{{ rightLabel }}</span>
      </div>

      <div class="cmp-layer cmp-layer--top" :style="{ clipPath: `inset(0 ${100 - localDivider}% 0 0)` }">
        <img class="cmp-img" :src="leftImage" alt="左侧对比图" draggable="false" />
        <span class="cmp-tag cmp-tag--left">{{ leftLabel }}</span>
      </div>

      <!-- 分割线：nodrag 让拖它不被画布的"拖节点"抢走 -->
      <div
        class="cmp-divider nodrag nopan"
        :class="{ 'is-dragging': dragging }"
        :style="{ left: `${localDivider}%` }"
        role="slider"
        :aria-valuenow="Math.round(localDivider)"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="对比分割线"
        tabindex="0"
        @pointerdown="onDividerDown"
        @keydown.left.prevent="localDivider = clampDivider(localDivider - 2)"
        @keydown.right.prevent="localDivider = clampDivider(localDivider + 2)"
        @keyup.left="commitDivider"
        @keyup.right="commitDivider"
      >
        <span class="cmp-divider-line" />
        <span class="cmp-handle">
          <svg class="cmp-handle-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 3.5L2.5 7L6 10.5" />
            <path d="M10 3.5L13.5 7L10 10.5" />
          </svg>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 视觉对齐 docs/design/ui-style-guide.md：灰阶承载层级、圆角 8、动效 .18s + reduced-motion 降级 */
.cmp {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 8px;
  background: #f3f4f6;
  user-select: none;
}

/* 空态 */
.cmp-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
}
.cmp-empty-icon {
  width: 36px;
  height: 36px;
  color: #d1d5db;
}
.cmp-empty-text {
  color: #9ca3af;
  font-size: 12px;
}

/* 图与图层 */
.cmp-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.cmp-layer--top {
  z-index: 1;
}
.cmp-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* cover：两侧同尺寸叠放时像素能对齐，对比才有意义 */
  object-fit: cover;
  display: block;
}

/* 左右小标签 */
.cmp-tag {
  position: absolute;
  top: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(17, 24, 39, 0.55);
  color: #fff;
  font-size: 10px;
  line-height: 1.6;
  pointer-events: none;
}
.cmp-tag--left {
  left: 6px;
}
.cmp-tag--right {
  right: 6px;
}

/* 单图提示 */
.cmp-hint {
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(17, 24, 39, 0.55);
  color: #fff;
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
}

/* 分割线 */
.cmp-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 22px;
  margin-left: -11px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  touch-action: none;
}
.cmp-divider-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #fff;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.35);
}
.cmp-handle {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  color: #6b7280;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
  transition: box-shadow 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.cmp-divider:hover .cmp-handle,
.cmp-divider.is-dragging .cmp-handle {
  color: #111827;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
}
.cmp-divider:focus-visible {
  outline: none;
}
.cmp-divider:focus-visible .cmp-handle {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}
.cmp-handle-icon {
  width: 16px;
  height: 16px;
}

@media (prefers-reduced-motion: reduce) {
  .cmp-handle {
    transition: none;
  }
}
</style>
