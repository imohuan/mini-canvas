import type { CanvasPlugin, PluginContext } from '../types'

/** 辅助线数据类型 */
interface HelperLine {
  type: 'horizontal' | 'vertical'
  /** flow 坐标位置（垂直参考线时为 x，水平参考线时为 y） */
  position: number
}

/** 吸附阈值（像素） */
const SNAP_THRESHOLD = 8

/**
 * AlignGuidePlugin - 对齐辅助线插件
 *
 * @description
 * 拖拽节点时自动检测与其他节点的对齐关系，
 * 显示蓝色水平/垂直参考线并自动吸附对齐。
 *
 * **设计关键 — 参考线渲染方式：**
 * 不在 viewport 内部渲染（viewport 有 CSS transform），
 * 而是在外层 canvas-container 中创建绝对定位的容器，
 * 通过手动计算公式将 flow 坐标转为屏幕坐标：
 *
 * ```
 * screenX = linePosition * zoom + viewportX
 * screenY = linePosition * zoom + viewportY
 * ```
 *
 * 这避免了 viewport CSS transform 继承导致的坐标偏移问题。
 *
 * **多选适配：**
 * 当多个节点被选中并一起拖拽时，VueFlow 的 `nodeDrag` 事件
 * 会为每个被选中的节点分别触发。插件只对 PRIMARY 拖拽节点计算对齐线。
 *
 * **吸附算法：**
 * 1. 计算拖拽节点的边界框（x, y, right, bottom, centerX, centerY）
 * 2. 与其他每个节点比较 9 种对齐模式
 * 3. 选择最近的垂直/水平对齐线
 * 4. 直接修改 reactive node.position 实现吸附
 *
 * @event align-guide:update — 辅助线更新 { guides: HelperLine[] }
 */
export const AlignGuidePlugin: CanvasPlugin = {
  name: 'align-guide',
  version: '0.3.0',

  install(context: PluginContext, _options: Record<string, unknown>) {
    const logger = context.logger

    // ====== Panel 开关：启用/禁用对齐辅助线 ======
    context.panels.registerSetting('align-guide', {
      id: 'align-guide.enabled',
      source: 'align-guide',
      title: '启用对齐辅助线',
      description: '拖拽节点时显示对齐参考线并自动吸附对齐',
      type: 'boolean',
      group: '对齐 Align Guide',
      order: 60,
      defaultValue: true,
    })
    const enabledRef = context.store.toRef('enabled', true)

    /** 辅助线 DOM 容器（渲染在 viewport 外层） */
    let containerEl: HTMLDivElement | null = null
    /** 缓存的垂直辅助线元素（预创建，仅更新 CSS 以避免 DOM 重建闪烁） */
    let vLine: HTMLDivElement | null = null
    /** 缓存的水平辅助线元素 */
    let hLine: HTMLDivElement | null = null
    /** 当前拖拽的节点 ID */
    let draggingNodeId: string | null = null
    /** renderLines 调用计数器（用于诊断闪烁频率） */
    let renderCount = 0
    /** 上次渲染的辅助线签名（用于跳过重复渲染） */
    let lastGuideSignature = ''

    // ====== 拖拽期间锁定 dimensions ======
    // 拖拽过程中 node.dimensions 可能因 counter-scale / content reflow 而波动，
    // 导致 getNodeBounds 每帧算出不同的边界框，引发吸附 delta 在相邻两帧间交替。
    // 解决方案：dragStart 时锁定 dimensions，拖拽全程用这个值，dragStop 时释放。
    let dragDimensions: { width: number; height: number } | null = null

    function ensureContainer(): HTMLDivElement {
      if (containerEl) return containerEl
      const el = document.createElement('div')
      el.className = 'align-guide-container'
      el.style.cssText = [
        'position:absolute',
        'top:0', 'left:0',
        'width:100%', 'height:100%',
        'pointer-events:none',
        'z-index:9999',
        'overflow:hidden',
      ].join(';')
      const canvasContainer = document.querySelector('.canvas-container')
      if (canvasContainer) {
        canvasContainer.appendChild(el)
      }
      containerEl = el
      return el
    }

    /**
     * 预创建缓存的辅助线 DOM 元素，后续只更新 CSS 属性，不再重建 DOM。
     * 这是消除闪烁的核心优化：避免 innerHTML 全量替换。
     */
    function ensureLineElements() {
      const el = ensureContainer()
      if (!vLine) {
        vLine = document.createElement('div')
        vLine.style.cssText = 'position:absolute;top:0;width:1px;height:100%;background:rgba(99,102,241,0.6);pointer-events:none;display:none;'
        el.appendChild(vLine)
        logger.debug('[AlignGuide] 垂直辅助线元素已创建')
      }
      if (!hLine) {
        hLine = document.createElement('div')
        hLine.style.cssText = 'position:absolute;left:0;height:1px;width:100%;background:rgba(99,102,241,0.6);pointer-events:none;display:none;'
        el.appendChild(hLine)
        logger.debug('[AlignGuide] 水平辅助线元素已创建')
      }
    }

    /**
     * 更新缓存的辅助线元素位置和显隐。
     * 只改 CSS 属性（left/top/display），不创建也不销毁 DOM。
     * 跳过与上次完全相同的渲染以进一步减少回流。
     */
    function renderLines(lines: HelperLine[]) {
      ensureLineElements()
      if (!vLine || !hLine) return

      const vp = context.viewport.getViewport()

      const vGuide = lines.find((l) => l.type === 'vertical')
      const hGuide = lines.find((l) => l.type === 'horizontal')

      // 构建签名用于跳过重复渲染
      const signature = `${vGuide?.position ?? 'none'}_${hGuide?.position ?? 'none'}_${vp.zoom.toFixed(3)}_${vp.x.toFixed(2)}_${vp.y.toFixed(2)}`
      if (signature === lastGuideSignature) return
      lastGuideSignature = signature

      renderCount++
      logger.debug(`[AlignGuide] renderLines #${renderCount} v=${vGuide?.position ?? '-'} h=${hGuide?.position ?? '-'} zoom=${vp.zoom.toFixed(2)} vp=(${vp.x.toFixed(1)},${vp.y.toFixed(1)})`)

      if (vGuide) {
        vLine.style.left = `${vGuide.position * vp.zoom + vp.x}px`
        vLine.style.display = 'block'
      } else {
        vLine.style.display = 'none'
      }

      if (hGuide) {
        hLine.style.top = `${hGuide.position * vp.zoom + vp.y}px`
        hLine.style.display = 'block'
      } else {
        hLine.style.display = 'none'
      }
    }

    function clearLines() {
      lastGuideSignature = ''
      renderCount = 0
      if (vLine) vLine.style.display = 'none'
      if (hLine) hLine.style.display = 'none'
      logger.debug('[AlignGuide] 辅助线已清除')
    }

    /**
     * 获取节点绝对位置（flow 坐标系）。
     *
     * 自由节点：node.position 即绝对坐标。
     * 分组子节点：node.position 相对 group → 用 computedPosition。
     */
    function getAbsolutePos(node: any): { x: number; y: number } {
      if (node.parentNode && node.computedPosition && node.computedPosition.x !== undefined) {
        return { x: node.computedPosition.x, y: node.computedPosition.y }
      }
      return { x: node.position.x, y: node.position.y }
    }

    /** 计算节点边界框（绝对 flow 坐标） */
    function getNodeBounds(node: any) {
      const pos = getAbsolutePos(node)
      const w = node.dimensions?.width || 256
      const h = node.dimensions?.height || 256
      return {
        x: pos.x,
        y: pos.y,
        right: pos.x + w,
        bottom: pos.y + h,
        centerX: pos.x + w / 2,
        centerY: pos.y + h / 2,
        width: w,
        height: h,
      }
    }

    /**
     * 计算拖拽节点与其他所有节点之间的对齐线。
     *
     * 拖拽期间使用 dragStart 锁定的 dimensions，避免 counter-scale
     * 导致的尺寸波动使每帧的 db 边界框不同、引发吸附 delta 振荡。
     */
    function calculateGuides(draggedNode: any): HelperLine[] {
      // 取锁定的尺寸（优先）或当前实时尺寸
      const w = dragDimensions?.width ?? draggedNode.dimensions?.width
      const h = dragDimensions?.height ?? draggedNode.dimensions?.height
      if (!w || !h) return []

      const allNodes = context.actions.getNodes()
      const others = allNodes.filter((n) => n.id !== draggedNode.id && n.parentNode !== draggedNode.id)
      if (others.length === 0) return []

      // 用锁定尺寸构造拖拽节点边界框
      const pos = getAbsolutePos(draggedNode)
      const db = {
        x: pos.x,
        y: pos.y,
        right: pos.x + w,
        bottom: pos.y + h,
        centerX: pos.x + w / 2,
        centerY: pos.y + h / 2,
        width: w,
        height: h,
      }

      let closestV: { dist: number; pos: number } | null = null
      let closestH: { dist: number; pos: number } | null = null
      let snapDeltaX = 0
      let snapDeltaY = 0

      for (const other of others) {
        const ob = getNodeBounds(other)

        // ---- 垂直对齐检查（9 种模式） ----
        const vPairs: { diff: number; pos: number; snapX: number }[] = [
          { diff: Math.abs(db.x - ob.x), pos: ob.x, snapX: ob.x - db.x },
          { diff: Math.abs(db.x - ob.right), pos: ob.right, snapX: ob.right - db.x },
          { diff: Math.abs(db.x - ob.centerX), pos: ob.centerX, snapX: ob.centerX - db.x },
          { diff: Math.abs(db.right - ob.x), pos: ob.x, snapX: ob.x - db.right },
          { diff: Math.abs(db.right - ob.right), pos: ob.right, snapX: ob.right - db.right },
          { diff: Math.abs(db.right - ob.centerX), pos: ob.centerX, snapX: ob.centerX - db.right },
          { diff: Math.abs(db.centerX - ob.x), pos: ob.x, snapX: ob.x - db.centerX },
          { diff: Math.abs(db.centerX - ob.right), pos: ob.right, snapX: ob.right - db.centerX },
          { diff: Math.abs(db.centerX - ob.centerX), pos: ob.centerX, snapX: ob.centerX - db.centerX },
        ]
        for (const v of vPairs) {
          if (v.diff < SNAP_THRESHOLD && (!closestV || v.diff < closestV.dist)) {
            closestV = { dist: v.diff, pos: v.pos }
            snapDeltaX = v.snapX
          }
        }

        // ---- 水平对齐检查（9 种模式） ----
        const hPairs: { diff: number; pos: number; snapY: number }[] = [
          { diff: Math.abs(db.y - ob.y), pos: ob.y, snapY: ob.y - db.y },
          { diff: Math.abs(db.y - ob.bottom), pos: ob.bottom, snapY: ob.bottom - db.y },
          { diff: Math.abs(db.y - ob.centerY), pos: ob.centerY, snapY: ob.centerY - db.y },
          { diff: Math.abs(db.bottom - ob.y), pos: ob.y, snapY: ob.y - db.bottom },
          { diff: Math.abs(db.bottom - ob.bottom), pos: ob.bottom, snapY: ob.bottom - db.bottom },
          { diff: Math.abs(db.bottom - ob.centerY), pos: ob.centerY, snapY: ob.centerY - db.bottom },
          { diff: Math.abs(db.centerY - ob.y), pos: ob.y, snapY: ob.y - db.centerY },
          { diff: Math.abs(db.centerY - ob.bottom), pos: ob.bottom, snapY: ob.bottom - db.centerY },
          { diff: Math.abs(db.centerY - ob.centerY), pos: ob.centerY, snapY: ob.centerY - db.centerY },
        ]
        for (const h of hPairs) {
          if (h.diff < SNAP_THRESHOLD && (!closestH || h.diff < closestH.dist)) {
            closestH = { dist: h.diff, pos: h.pos }
            snapDeltaY = h.snapY
          }
        }
      }

      // ---- 应用吸附 ----
      if (snapDeltaX !== 0) {
        draggedNode.position.x += snapDeltaX
        logger.debug(`[AlignGuide] 吸附 X: delta=${snapDeltaX.toFixed(2)} dims=${w}x${h} → (${draggedNode.position.x.toFixed(1)}, ${draggedNode.position.y.toFixed(1)})`)
      }
      if (snapDeltaY !== 0) {
        draggedNode.position.y += snapDeltaY
        logger.debug(`[AlignGuide] 吸附 Y: delta=${snapDeltaY.toFixed(2)} dims=${w}x${h} → (${draggedNode.position.x.toFixed(1)}, ${draggedNode.position.y.toFixed(1)})`)
      }

      const guides: HelperLine[] = []
      if (closestV) guides.push({ type: 'vertical', position: closestV.pos })
      if (closestH) guides.push({ type: 'horizontal', position: closestH.pos })
      return guides
    }

    // ====== 事件监听 ======

    // rAF 节流：nodeDrag 每帧触发 ~60Hz，对齐引导线不需要逐帧重算
    let dragRafId: number | null = null
    let latestDragNode: any = null

    const offNodeDrag = context.on('nodeDrag', ({ node }: any) => {
      if (!enabledRef.value) return
      if (draggingNodeId !== null && draggingNodeId !== node.id) return
      draggingNodeId = node.id
      latestDragNode = node

      if (dragRafId) return
      dragRafId = requestAnimationFrame(() => {
        dragRafId = null
        if (!latestDragNode) return
        const guides = calculateGuides(latestDragNode)
        renderLines(guides)
        context.emit('align-guide:update', { guides })
      })
    })

    const offNodeDragStart = context.on('nodeDragStart', ({ node }: any) => {
      if (!enabledRef.value) return
      draggingNodeId = node.id
      // 锁定拖拽起始时的 dimensions，整个拖拽期间只用这个值
      const dims = node.dimensions
      if (dims?.width && dims?.height) {
        dragDimensions = { width: dims.width, height: dims.height }
      } else {
        dragDimensions = null
      }
      logger.debug(`[AlignGuide] nodeDragStart: ${node.id} dims=${dragDimensions?.width ?? '?'}x${dragDimensions?.height ?? '?'}`)
    })

    const offNodeDragStop = context.on('nodeDragStop', () => {
      draggingNodeId = null
      dragDimensions = null
      clearLines()
      context.emit('align-guide:update', { guides: [] })
    })

    logger.info('[AlignGuide] 就绪 (外层 DOM + 预创建缓存元素 + 拖拽锁 dimensions)')

    return {
      uninstall() {
        offNodeDrag()
        offNodeDragStart()
        offNodeDragStop()
        clearLines()
        const el = document.querySelector('.align-guide-container')
        el?.remove()
        containerEl = null
        vLine = null
        hLine = null
      },
    }
  },
}
