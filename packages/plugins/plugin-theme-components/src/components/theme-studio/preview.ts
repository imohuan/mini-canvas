/**
 * 颜色配方的实时预览：一组同步绘制函数 + 确定性取景。
 *
 * 流程（每次重画都完整跑一遍，不做增量）：
 *   1. 取 theme-preview 槽里的绘制层，按 order 排序；
 *   2. 每层一个固定尺寸的 div（画板尺寸），清空后调用 paint(ctx)；
 *   3. 取景 = 节点矩形 ∪ 各层上报的"我画到哪儿了"（ctx.claim），交给纯函数算缩放与位移；
 *   4. 写入舞台 transform。
 *
 * 为什么不再实时量 DOM：量出来的是半个内容（标题、端口、标签在卡片外），
 * 且每轮结果不同，既会偏心也会越切越小。现在用确定的数据，边距可被测试钉死。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CANVAS_CONTEXT_KEY,
  THEME_PREVIEW_NODES,
  THEME_PREVIEW_SLOT,
  indexPreviewRects,
  readPreviewColor,
  unionPreviewRect,
  type PreviewLayer,
  type PreviewNodeRect,
  type PreviewRect,
} from '@mini-canvas/canvas-render'
import { fitRectInView } from './framing'
import type { ThemeStudioState } from './state'

/**
 * 画板尺寸（绘图坐标）。固定不变：它是取景的计算基准，
 * 跟着内容长会导致"切一次主题小一圈"。
 */
const ARTBOARD_W = 760
const ARTBOARD_H = 500
/**
 * 内容四周留白（绘图坐标）。
 *
 * 缩放按"内容 + 留白"算，所以留白越大，内容被缩得越小、上下越空。
 * 40 会让画板上下显得空旷，收到 24 后内容更饱满，同时仍能包住选框外扩。
 */
const PREVIEW_PAD = 24
/** 最多放大到 1 倍：样张按原尺寸看颜色 */
const MAX_FIT_SCALE = 1

interface ThemePreviewOccupant {
  id: string
  order: number
  component: unknown
}

export function useThemeStudioPreview(state: ThemeStudioState) {
  const { mode, previewRevision, tick, rawGet, readFields, disposers } = state

  const canvasContext = inject(CANVAS_CONTEXT_KEY, null)
  const hasCanvasContext = computed(() => Boolean(canvasContext?.ctx?.slots))

  const previewBox = ref<HTMLElement | null>(null)
  const stageEl = ref<HTMLElement | null>(null)
  const previewSize = ref({ w: 0, h: 0 })
  const bounds = ref<PreviewRect>({ x: 0, y: 0, w: ARTBOARD_W, h: ARTBOARD_H })
  let resizeObserver: ResizeObserver | null = null
  let frame = 0

  /** 各层的 div（复用，避免每帧重建） */
  const layerEls = new Map<string, HTMLElement>()

  function measurePreview(): void {
    const box = previewBox.value
    if (!box) return
    /**
     * 必须扣掉边框：getBoundingClientRect 含 1px border，而舞台是按 content box 定位的。
     * 不扣的话左右/上下各差 2px，看上去就是"没居中"。
     */
    const style = getComputedStyle(box)
    const borderX = parseFloat(style.borderLeftWidth || '0') + parseFloat(style.borderRightWidth || '0')
    const borderY = parseFloat(style.borderTopWidth || '0') + parseFloat(style.borderBottomWidth || '0')
    const w = box.clientWidth || box.getBoundingClientRect().width - borderX
    const h = box.clientHeight || box.getBoundingClientRect().height - borderY
    if (w > 0 && h > 0) previewSize.value = { w, h }
  }

  function layers(): ThemePreviewOccupant[] {
    const slots = canvasContext?.ctx?.slots
    if (!slots) return []
    return (slots.occupants(THEME_PREVIEW_SLOT) as ThemePreviewOccupant[])
      .filter((o) => typeof (o.component as Partial<PreviewLayer> | undefined)?.paint === 'function')
      .sort((a, b) => a.order - b.order)
  }

  function ensureLayerEl(id: string, order: number): HTMLElement {
    let el = layerEls.get(id)
    if (!el) {
      el = document.createElement('div')
      el.dataset.previewLayer = id
      el.style.cssText =
        'position:absolute;left:0;top:0;pointer-events:none;' +
        'width:' + ARTBOARD_W + 'px;height:' + ARTBOARD_H + 'px'
      layerEls.set(id, el)
    }
    el.style.zIndex = String(order)
    return el
  }

  /** 默认节点：保底的两节点样张 */
  function previewNodes(): PreviewNodeRect[] {
    return THEME_PREVIEW_NODES.map((node) => ({ ...node }))
  }

  function motionAllowed(): boolean {
    return typeof matchMedia === 'function' ? !matchMedia('(prefers-reduced-motion: reduce)').matches : true
  }

  /** 同步绘制：一次算完，一次写完 */
  function draw(): void {
    const stage = stageEl.value
    if (!stage) return

    const nodes = previewNodes()
    const rects = indexPreviewRects(nodes)
    const claims: PreviewRect[] = []

    const baseCtx = {
      root: stage,
      rects,
      nodes,
      mode: mode.value,
      colors: (key: string) => readPreviewColor(rawGet, key, mode.value, '#0891b2'), // 主题色白名单: 预览层同步绘制的是画布内容快照（品牌色 / 素材色），不是界面 token
      get: (key: string) => rawGet(key),
      motion: motionAllowed(),
      /** 各层如实上报自己画的范围，取景据此计算 */
      claim: (rect: PreviewRect) => claims.push(rect),
    }

    for (const layer of layers()) {
      const el = ensureLayerEl(layer.id, layer.order)
      if (el.parentNode !== stage) stage.appendChild(el)
      el.replaceChildren()
      ;(layer.component as PreviewLayer).paint({ ...baseCtx, el })
    }

    /**
     * 取景范围一律钳到画板内 [0,0,ARTBOARD_W,ARTBOARD_H]。
     *
     * 原因：标题、端口、标签都会伸到卡片外，甚至伸出画板边界（y 变负）。
     * 一旦包围盒带负坐标，按"内容居中"算就会把内容顶出容器上沿 ——
     * 实测结果是 top 边距 -16px、下方空一大片。画板本来就装了这些外扩，
     * 直接以画板为取景范围最稳，也保证四边留白完全对称。
     */
    const content = unionPreviewRect([...nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })), ...claims])
    bounds.value = clampToArtboard(content)
    measurePreview()
  }

  /** 把取景范围收进画板内：保证不出界，也不会因为负坐标把画面顶偏。 */
  function clampToArtboard(rect: PreviewRect | null): PreviewRect {
    if (!rect) return { x: 0, y: 0, w: ARTBOARD_W, h: ARTBOARD_H }
    const x = Math.max(0, rect.x)
    const y = Math.max(0, rect.y)
    const right = Math.min(ARTBOARD_W, rect.x + rect.w)
    const bottom = Math.min(ARTBOARD_H, rect.y + rect.h)
    if (right <= x || bottom <= y) return { x: 0, y: 0, w: ARTBOARD_W, h: ARTBOARD_H }
    return { x, y, w: right - x, h: bottom - y }
  }

  function schedule(): void {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      measurePreview()
      draw()
    })
  }

  /** 取景：纯函数算缩放与位移，保证四边留白相等 */
  const fittedStageStyle = computed(() => {
    void previewRevision.value
    void tick.value
    const view = {
      w: previewSize.value.w || ARTBOARD_W,
      h: previewSize.value.h || ARTBOARD_H,
    }
    const result = fitRectInView(bounds.value, view, PREVIEW_PAD, MAX_FIT_SCALE)
    return {
      width: ARTBOARD_W + 'px',
      height: ARTBOARD_H + 'px',
      transformOrigin: '0 0',
      transform: 'translate(' + result.x + 'px, ' + result.y + 'px) scale(' + result.scale + ')',
    }
  })

  onMounted(() => {
    readFields()
    previewRevision.value += 1
    measurePreview()
    draw()

    window.addEventListener('resize', schedule)
    const box = previewBox.value
    if (box && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(schedule)
      resizeObserver.observe(box)
    }

    const current = rawGet('themeMode')
    if (current === 'light' || current === 'dark') mode.value = current

    watch(mode, () => {
      previewRevision.value += 1
      schedule()
    })

    disposers.push(
      state.source.onChange((key, value) => {
        readFields()
        tick.value += 1
        previewRevision.value += 1
        if (key === 'themeMode' && (value === 'light' || value === 'dark')) mode.value = value
        schedule()
      }),
    )
    const off = state.source.onSchemaChange?.(() => {
      readFields()
      tick.value += 1
      previewRevision.value += 1
      schedule()
    })
    if (off) disposers.push(off)

    const pluginCtx = canvasContext?.ctx
    if (pluginCtx) {
      disposers.push(
        pluginCtx.on('ctx:plugin-installed', schedule),
        pluginCtx.on('ctx:plugin-uninstalled', schedule),
      )
    }
  })

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    resizeObserver?.disconnect()
    resizeObserver = null
    window.removeEventListener('resize', schedule)
    for (const dispose of disposers) dispose.dispose()
  })

  return { canvasContext, hasCanvasContext, previewBox, stageEl, fittedStageStyle, schedule }
}
