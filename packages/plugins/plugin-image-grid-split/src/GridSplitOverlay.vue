<script setup lang="ts">
/**
 * GridSplitOverlay —— 切分模式的格子勾选覆盖层（叠在图片上的交互层）。
 *
 * 经 ctx.nodes.contribute('image', 'over:inset', …) 挂进图片节点的
 * over:inset 段（与裁剪/扩展浮层同一个分发容器 ImageOverlays），
 * 自身按「本节点是否在切分模式」显隐 —— 不动 image 插件任何文件。
 *
 * 交互（用户口径）：鼠标滑过哪格哪格高亮；点一下勾/取消该格；
 * 选中格画青色描边 + 微透明底，未选中格画细白线。事件不外漏（nodrag/nopan），
 * 避免拖格子把节点拖走。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { readStoryboardLayout, slotIndexAt, slotRects } from './storyboard'
import { setHoverCell, splitState, toggleCell } from './splitSession'
import { gridMaskUri, type MaskCell } from './gridMask'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()

const state = computed(() => splitState(props.id))

/**
 * 原图地址：格子要**自己画原图的一块**（用户口径 2026-10-31，参考 deepseek_html 示例）。
 *
 * 为什么不再只靠卡片遮罩：遮罩只能把卡片抠空，格子里看到的仍是底下那张完整图片，
 * 缝隙两侧的像素还是连续的 —— 看起来只是"盖了几个方块"。示例的做法是每格铺同一张图、
 * 按行列放大到 300%/N 并错位定位，格子自己就是那张图的一块，缝隙自然什么都不画。
 *
 * 解析顺序与图片节点一致：有 resourceId 先问资源服务，取不到再用旧 imageUrl 兜底。
 * 只用于渲染，不写回 data。
 */
const imageSrc = ref('')
let resolveToken = 0
async function refreshImageSrc(): Promise<void> {
  const token = ++resolveToken
  const d = props.data ?? {}
  const resourceId = typeof d.resourceId === 'string' ? d.resourceId : ''
  const legacy = typeof d.imageUrl === 'string' ? d.imageUrl : ''
  if (!resourceId) {
    imageSrc.value = legacy
    return
  }
  const res = ctx.tryGet<{ resolve?(ref: string): Promise<string | undefined> } | undefined>('resources')
  let resolved = ''
  try {
    resolved = (res && typeof res.resolve === 'function' ? await res.resolve(resourceId) : '') || ''
  } catch {
    resolved = ''
  }
  // 资源服务可能只认「画布id/哈希」而不认裸哈希，且旧存档常常没有 resourceId。
  // 兜底顺序与图片节点一致：resolve 出来的 > legacyUrl；两者都没有时退到节点上
  // 由图片组件解析出的 <img src>（那是页面确定能显示的那一份，保证格子与卡片是同一张图）。
  if (token !== resolveToken) return
  imageSrc.value = resolved || legacy
  if (!imageSrc.value) {
    const vp = ctx.tryGet<{ queryNodeEl?(id: string): HTMLElement | null } | undefined>('view')
    const img = vp?.queryNodeEl?.(props.id)?.querySelector('img')
    imageSrc.value = img?.getAttribute('src') || ''
  }
}
watch(
  () => [props.data?.resourceId, props.data?.imageUrl],
  () => { void refreshImageSrc() },
  { immediate: true },
)

/**
 * 进入切分时再补一次取图：卡片里的 <img> 是挂载后异步解析出来的，
 * 会话刚开始那一帧往往还没有 src（用户口径 2026-10-31：格子全是空的/只有底色）。
 * 轮询几帧，拿到就停 —— 只在切分期间跑，退出即停，开销可忽略。
 */
let fillTimer: ReturnType<typeof setInterval> | undefined
function stopFillWatch(): void {
  if (fillTimer !== undefined) {
    clearInterval(fillTimer)
    fillTimer = undefined
  }
}
watch(
  () => Boolean(state.value),
  (on) => {
    stopFillWatch()
    if (!on) return
    void refreshImageSrc()
    fillTimer = setInterval(() => {
      if (!state.value) { stopFillWatch(); return }
      void refreshImageSrc()
      if (imageSrc.value) stopFillWatch()
    }, 250)
  },
  { immediate: true },
)
const cells = computed(() => {
  const s = state.value
  if (!s) return []
  // 格子几何 = 分镜组同一套 slotRects（圆角卡片 + 间隔），按节点实测尺寸转百分比
  const rect = ctx.tryGet<{ getNodeRect(id: string): { w: number; h: number } | null | undefined } | undefined>('view')?.getNodeRect(props.id)
  const boardW = rect?.w && rect.w > 0 ? rect.w : 480
  const boardH = rect?.h && rect.h > 0 ? rect.h : 360
  const layout = readStoryboardLayout(ctx)
  const rects = slotRects(boardW, boardH, s.rows, s.cols, { ...layout, topPadding: 0, padding: 4, rowGap: 3, colGap: 3 })
  const out: Array<{
    index: number
    left: number
    top: number
    width: number
    height: number
    on: boolean
    /** 该格在原图里占的列/行（背景图的错位定位用） */
    col: number
    row: number
  }> = []
  for (const r of rects) {
    out.push({
      index: r.index,
      left: (r.x / boardW) * 100,
      top: (r.y / boardH) * 100,
      width: (r.w / boardW) * 100,
      height: (r.h / boardH) * 100,
      on: s.selected.has(r.index),
      col: r.index % s.cols,
      row: Math.floor(r.index / s.cols),
    })
  }
  return out
})

/**
 * 每格的背景样式（参考 deepseek_html 的写法）：
 *   background-size: cols*100% rows*100%;
 *   background-position: col/(cols-1)*100%  row/(rows-1)*100%
 * 行列只有 1 时定位取 0（分母为 0 会算成 NaN，CSS 直接失效）。
 */
function cellImageStyle(cell: { col: number; row: number }): Record<string, string> {
  const s = state.value
  const src = imageSrc.value
  if (!s || !src) return {}
  const px = s.cols > 1 ? (cell.col / (s.cols - 1)) * 100 : 0
  const py = s.rows > 1 ? (cell.row / (s.rows - 1)) * 100 : 0
  return {
    backgroundImage: 'url("' + src.replace(/"/g, '\\"') + '")',
    backgroundSize: s.cols * 100 + '% ' + s.rows * 100 + '%',
    backgroundPosition: px + '% ' + py + '%',
    backgroundRepeat: 'no-repeat',
  }
}

/**
 * 只有**四个外角**的格子带圆角（用户口径 2026-10-30，参考
 * deepseek_html_20261030_c8b73c.html：左上/右上/左下/右下各只圆一个角，
 * 中间格子全是直角）。
 *
 * 为什么不在 CSS 里按 nth-child 判：行列是可配的（2×2 到 8×8），
 * 用 nth-child 要写一堆媒体式规则；这里由几何直接给出，任意行列都对。
 */
function cornerClass(index: number, rows: number, cols: number): string {
  const r = Math.floor(index / cols)
  const c = index % cols
  const top = r === 0
  const bottom = r === rows - 1
  const left = c === 0
  const right = c === cols - 1
  if (top && left) return 'is-corner-tl'
  if (top && right) return 'is-corner-tr'
  if (bottom && left) return 'is-corner-bl'
  if (bottom && right) return 'is-corner-br'
  return ''
}

/** 蒙版圆角（外圈四角；与参考实现的 radius-tl/tr/bl/br 同值域） */
const MASK_RADIUS = 12

/**
 * 卡片遮罩（用户口径 2026-10-30，参考 deepseek_html 示例）：
 * 缝隙必须**透明**、直接露出画布背景，不再拿颜色盖。
 *
 * 生成一张黑底 + 白色格子的 SVG 当 mask-image 贴到卡片上：
 * 白色处保留图片，黑色处抠掉。四角只有最外圈带圆角，中间全是直角。
 * 坐标用节点实测尺寸算，与格子几何同源（同一套 slotRects）。
 */
const maskUri = computed(() => {
  const s = state.value
  if (!s) return ''
  const rect = ctx.tryGet<{ getNodeRect(id: string): { w: number; h: number } | null | undefined } | undefined>('view')?.getNodeRect(props.id)
  const boardW = rect?.w && rect.w > 0 ? rect.w : 480
  const boardH = rect?.h && rect.h > 0 ? rect.h : 360
  const rects = slotRects(boardW, boardH, s.rows, s.cols, {
    ...readStoryboardLayout(ctx), topPadding: 0, padding: 4, rowGap: 3, colGap: 3,
  })
  if (rects.length === 0) return ''
  const cells: MaskCell[] = rects.map((r) => {
    const row = Math.floor(r.index / s.cols)
    const col = r.index % s.cols
    return {
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      tl: row === 0 && col === 0 ? MASK_RADIUS : 0,
      tr: row === 0 && col === s.cols - 1 ? MASK_RADIUS : 0,
      br: row === s.rows - 1 && col === s.cols - 1 ? MASK_RADIUS : 0,
      bl: row === s.rows - 1 && col === 0 ? MASK_RADIUS : 0,
    }
  })
  return gridMaskUri(cells, boardW, boardH)
})

/**
 * 把遮罩真正贴到**卡片**上（用户口径 2026-10-30：缝隙要露出画布背景）。
 *
 * 为什么必须作用在卡片而不是本层：本层只是盖在上面的浮层，即使它镂空，
 * 底下那张卡片（底色 + 图片）依然完整 —— 用户看到的还是"背景连在一起"。
 * 遮在卡片上，卡片底色与图片一起被按格子形状抠掉，缝隙里才是真正的画布背景。
 *
 * 卡片元素从 viewport 服务按 id 取（实例级查询，多画布不串），
 * 取不到就什么都不做（极简宿主/单测），不报错。
 */
function cardEl(): HTMLElement | null {
  const vp = ctx.tryGet<{ queryNodeEl?(id: string): HTMLElement | null } | undefined>('view')
  const node = vp?.queryNodeEl?.(props.id)
  return (node?.querySelector('.v2-card') as HTMLElement | null) ?? null
}

const MASK_PROPS = ['mask-image', '-webkit-mask-image', 'mask-size', '-webkit-mask-size', 'mask-repeat', '-webkit-mask-repeat'] as const

function applyMask(uri: string): void {
  const el = cardEl()
  if (!el) return
  if (!uri) {
    for (const p of MASK_PROPS) el.style.removeProperty(p)
    return
  }
  el.style.setProperty('mask-image', uri)
  el.style.setProperty('-webkit-mask-image', uri)
  el.style.setProperty('mask-size', '100% 100%')
  el.style.setProperty('-webkit-mask-size', '100% 100%')
  el.style.setProperty('mask-repeat', 'no-repeat')
  el.style.setProperty('-webkit-mask-repeat', 'no-repeat')
}

// 遮罩随格子几何/尺寸/会话变化重贴；退出切分（state 为空）时清掉
watch(
  maskUri,
  (uri) => applyMask(uri),
  { immediate: true, flush: 'post' },
)
watch(
  () => Boolean(state.value),
  (on) => { if (!on) applyMask('') },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  stopFillWatch()
  applyMask('')
})

/** 鼠标 → 归一化坐标（相对卡片内容区 0~1）→ 格子索引 */
function cellFromEvent(ev: PointerEvent | MouseEvent): number {
  const el = ev.currentTarget as HTMLElement | null
  if (!el) return -1
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return -1
  const s = state.value
  if (!s) return -1
  const layout = readStoryboardLayout(ctx)
  const rects = slotRects(r.width, r.height, s.rows, s.cols, { ...layout, topPadding: 0, padding: 4, rowGap: 3, colGap: 3 })
  return slotIndexAt(rects, ev.clientX - r.left, ev.clientY - r.top)
}

function onMove(ev: MouseEvent): void {
  setHoverCell(props.id, cellFromEvent(ev))
}

function onLeave(): void {
  setHoverCell(props.id, -1)
}

function onClick(ev: MouseEvent): void {
  const idx = cellFromEvent(ev)
  if (idx >= 0) toggleCell(props.id, idx)
}
</script>

<template>
  <div
    v-if="state"
    class="gso-root nodrag nopan"
    data-testid="grid-split-overlay"
    @pointermove="onMove"
    @pointerleave="onLeave"
    @click="onClick"
  >
    <!-- 交互层（格子 + 勾选角标）。抠除效果不在这里画：
         真正的遮罩已经贴到卡片本身（见 applyMask），缝隙直接露出画布背景。 -->
    <div
      v-for="cell in cells"
      :key="cell.index"
      class="gso-cell"
      :class="[{ 'is-on': cell.on, 'is-hover': state.hover === cell.index }, cornerClass(cell.index, state.rows, state.cols)]"
      :style="{ left: cell.left + '%', top: cell.top + '%', width: cell.width + '%', height: cell.height + '%', ...cellImageStyle(cell) }"
    >
      <span v-if="state.hover === cell.index" class="gso-hint">
        {{ cell.on ? '取消选择' : '选择' }}
      </span>
    </div>
  </div>
</template>

<style scoped>
/* 铺满卡片内容区；事件收在这层，格子只读会话状态（不改 data、不进撤销栈） */
.gso-root {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  overflow: hidden;
  cursor: pointer;
  /**
   * 覆盖层底色（用户口径 2026-10-31，就是 .v2-overlay 里这一层）：
   * 格子之间有间隔，间隔必须被这层盖住 —— 否则透出底下那张完整原图，
   * 看上去只是盖了几个方块，分割就白做了。
   * 亮色 = 纯白；暗色跟随主题面板色。
   */
  background: var(--ui-panel, #ffffff);
  border-radius: 8px;
  margin: 1px;
}
/* 未选中格：独立圆角卡片（参考图 1 左侧）：浅灰底 + 细边，之间有间隔 */
.gso-cell {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--ui-overlay-solid, #fff) 62%, transparent);
  /* 默认直角：只有四个外角单独圆（参考 deepseek_html 的 radius-tl/tr/bl/br 写法） */
  border-radius: 0;
  background: color-mix(in srgb, var(--ui-overlay-solid, #fff) 14%, transparent);
  transition: background-color 0.12s ease, border-color 0.12s ease;
}
/* 四个外角：各只圆一个角（用户口径 2026-10-30） */
.gso-cell.is-corner-tl { border-top-left-radius: var(--radius-panel, 12px); }
.gso-cell.is-corner-tr { border-top-right-radius: var(--radius-panel, 12px); }
.gso-cell.is-corner-bl { border-bottom-left-radius: var(--radius-panel, 12px); }
.gso-cell.is-corner-br { border-bottom-right-radius: var(--radius-panel, 12px); }
/* 勾选角标（参考图 1：左上角小方框 + √） */
.gso-cell::before {
  content: '';
  position: absolute;
  top: 6px;
  left: 6px;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-badge, 6px);
  background: color-mix(in srgb, var(--ui-overlay-solid, #fff) 82%, transparent);
  border: 1px solid var(--ui-line, #e2e5ea);
  box-sizing: border-box;
}
.gso-cell::after {
  content: '';
  position: absolute;
  top: 11px;
  left: 11px;
  width: 8px;
  height: 5px;
  border-left: 2px solid var(--ui-accent, #0891b2);
  border-bottom: 2px solid var(--ui-accent, #0891b2);
  transform: rotate(-45deg) scale(0.6);
  opacity: 0;
  transition: opacity 0.1s ease, transform 0.1s ease;
}
.gso-cell.is-on::after {
  opacity: 1;
  transform: rotate(-45deg) scale(1);
}
/* 悬停：淡青底 */
.gso-cell.is-hover {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 22%, transparent);
  border-color: var(--ui-accent, #0891b2);
}
/* 选中：整格淡青 + 青描边（比未选中格更明显） */
.gso-cell.is-on {
  border-color: var(--ui-accent, #0891b2);
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 14%, transparent);
}
.gso-cell.is-on.is-hover {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 30%, transparent);
}
/* 悬停提示（用户口径 2026-10-30：格子中央显示"选择 / 取消选择"胶囊）：
   真实子元素（::after 已被勾选角标占用）：只在悬停格渲染（Vue 侧 state.hover 判断）。 */
/* 胶囊本体（居中、小字、深底白字） */
.gso-hint {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 3px 10px;
  border-radius: 999px;
  /* 提示固定黑底白字：亮色/暗色都一致，不跟主题翻成白底 */
  /* 主题色白名单: 悬停胶囊压在图格上，固定深底白字保证任何图像上都可读 */
  background: rgb(24 32 43 / 0.88);
  /* 主题色白名单: 同上，固定白字 */
  color: #ffffff;
  font-size: var(--text-xs, 12px);
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1;
}

</style>
