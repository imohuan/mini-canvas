/**
 * 悬停 MCP 工具时弹出详情卡（下拉工具行 + 输入框标签共用一份状态）。
 *
 * 为什么不用 HoverCard 包住每一行：
 *   · 标签是 ProseMirror 直接造的 DOM，挂不了 Vue 组件；
 *   · 下拉行在滚动容器里，每行各配一份浮层会让数量和定位都难收口。
 * 收成一个挂在 body 上的浮层后，两处只是「谁能发起显示」的差别。
 */
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, type Ref } from 'vue'
import {
  mcpToolFullNameOfChip,
  mcpToolMetaFallback,
  type McpToolMeta,
} from '../shared/mcpToolMeta.js'
import { computeToolCardPosition, type ToolCardAnchor } from '../shared/mcpToolCard.js'

export interface ToolCardState {
  visible: boolean
  /** 位置量好之前先透明，避免卡片从左上角闪一下再跳到位 */
  ready: boolean
  /** 只有工具全名、还没拿到说明与参数（正在探测） */
  pending: boolean
  tool: McpToolMeta | null
  left: number
  top: number
  maxHeight: number
  side: 'top' | 'bottom' | 'left' | 'right'
}

export interface McpToolHoverDeps {
  /** 某个服务探测到的工具清单（没探测过时为空数组） */
  toolsOf: (server: string) => McpToolMeta[]
  /** 打开 MCP 面板时用过的自动探测：卡片缺详情时借它补一次 */
  ensureProbed: () => void
}

const CARD_WIDTH = 320
const CARD_MARGIN = 12
const SHOW_DELAY_MS = 160
/** 从工具行移到卡片要跨过 10px 的空隙：给足时间，卡片不会刚出现就消失 */
const HIDE_DELAY_MS = 260

export function useMcpToolHover(deps: McpToolHoverDeps) {
  const card = reactive<ToolCardState>({
    visible: false,
    ready: false,
    pending: false,
    tool: null,
    left: 0,
    top: 0,
    maxHeight: 360,
    side: 'top',
  })
  const cardEl = ref<HTMLElement | null>(null)
  /** 当前悬停的来源元素：尺寸/位置变了要按它重算 */
  let anchorEl: HTMLElement | null = null
  let anchorSide: 'top' | 'left' = 'top'
  /** 不能盖住的区域（下拉菜单矩形）；标签悬停时为空 */
  let avoidRect: { left: number; top: number; right: number; bottom: number } | null = null
  /** 当前标签悬停的键：同一颗标签上的子元素反复触发 pointerover 时不要重置计时器 */
  let chipKey = ''
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let probedOnce = false

  function clearShowTimer(): void {
    if (showTimer) clearTimeout(showTimer)
    showTimer = null
  }

  function clearHideTimer(): void {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = null
  }

  function hideNow(): void {
    clearShowTimer()
    clearHideTimer()
    card.visible = false
    card.ready = false
    card.tool = null
    card.pending = false
    anchorEl = null
    chipKey = ''
    avoidRect = null
  }

  /** 位置按触发元素真实矩形算；卡片尺寸也按渲染后的真实尺寸算，避免长描述顶出屏幕 */
  async function place(
    anchor: ToolCardAnchor,
    side: 'top' | 'left',
    avoid?: { left: number; top: number; right: number; bottom: number },
  ): Promise<void> {
    await nextTick()
    /** 卡片 Teleport 到 body，组件 ref 拿不到；按唯一的类名取刚渲染出来的那张 */
    const el = cardEl.value ?? document.querySelector<HTMLElement>('.ac-toolcard')
    /**
     * 先放开到「视口最大高度」再量：卡片上一步可能带着上一次的 maxHeight，
     * 直接量会把真实内容高度截短，算出来的位置偏下（长参数列表会压到触发元素上）。
     */
    if (el) el.style.maxHeight = Math.max(120, window.innerHeight - 24) + 'px'
    const rect = el?.getBoundingClientRect()
    const pos = computeToolCardPosition({
      anchor,
      card: { width: rect?.width || CARD_WIDTH, height: rect?.height || 320 },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      side,
      margin: CARD_MARGIN,
      ...(avoid ? { avoid } : {}),
    })
    card.left = pos.left
    card.top = pos.top
    card.maxHeight = pos.maxHeight
    card.side = pos.side
    card.ready = true
  }

  function anchorOf(el: Element): ToolCardAnchor {
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }

  /** 直接给一个工具（下拉行用）：等一小会儿再弹，快速划过列表不会连闪 */
  function showTool(tool: McpToolMeta, el: Element, side: 'top' | 'left' = 'left', pending = false): void {
    clearHideTimer()
    clearShowTimer()
    /**
     * 下拉里的工具行：横向参照物换成**整个菜单**。
     *
     * 行本身在菜单内部，按行算「左边」只会把卡片叠回菜单上；按菜单算才能落到菜单外侧。
     * 纵向仍按这一行算，卡片对着用户正在看的工具。
     */
    const menu = side === 'left' ? el.closest('[data-slot="dropdown-menu-content"]') : null
    const rowRect = el.getBoundingClientRect()
    const menuRect = menu?.getBoundingClientRect()
    const anchor: ToolCardAnchor = menuRect
      ? {
        left: menuRect.left,
        top: rowRect.top,
        right: menuRect.right,
        bottom: rowRect.bottom,
        width: menuRect.width,
        height: rowRect.height,
      }
      : anchorOf(el)
    const avoid = menuRect
      ? { left: menuRect.left, top: menuRect.top, right: menuRect.right, bottom: menuRect.bottom }
      : undefined
    showTimer = setTimeout(() => {
      card.tool = tool
      card.pending = pending
      card.visible = true
      card.ready = false
      anchorEl = el as HTMLElement
      anchorSide = side
      avoidRect = avoid ?? null
      void place(anchor, side, avoid)
    }, SHOW_DELAY_MS)
  }

  function lookup(fullName: string): { tool: McpToolMeta; complete: boolean } | null {
    const parts = /^mcp__(.+?)__(.+)$/.exec(fullName)
    if (!parts) return null
    const hit = deps.toolsOf(parts[1]).find((t) => t.fullName === fullName || t.name === parts[2])
    if (hit) return { tool: hit, complete: true }
    const fallback = mcpToolMetaFallback(fullName)
    return fallback ? { tool: fallback, complete: false } : null
  }

  /** 标签（`.resource-chip`）用：从 data-* 认工具，认不出就什么都不做 */
  function showChip(el: Element): boolean {
    const fullName = mcpToolFullNameOfChip({
      id: el.getAttribute('data-id'),
      refKind: el.getAttribute('data-ref-kind'),
      refValue: el.getAttribute('data-ref-value'),
      name: el.getAttribute('data-name'),
    })
    if (!fullName) return false
    const key = fullName + '|' + String(el.getAttribute('data-id') ?? '')
    if (chipKey === key) return true
    chipKey = key
    const found = lookup(fullName)
    if (!found) return false
    /** 卡片缺说明 / 参数时顺手探一次：标签可能是上次会话留下的，探测数据已经不在内存里 */
    if (!found.complete && !probedOnce) {
      probedOnce = true
      deps.ensureProbed()
    }
    showTool(found.tool, el, 'top', !found.complete)
    return true
  }

  /** 探测结果晚到时，把正在显示的同一张卡补全 */
  function refreshCard(): void {
    const tool = card.tool
    if (!card.visible || !tool) return
    const found = lookup(tool.fullName)
    if (found?.complete) {
      card.tool = found.tool
      card.pending = false
    }
  }

  function scheduleHide(): void {
    clearShowTimer()
    clearHideTimer()
    hideTimer = setTimeout(hideNow, HIDE_DELAY_MS)
  }

  /** 指针进到卡片里：取消关闭，用户才能滚动看参数 */
  function keepCard(): void {
    clearHideTimer()
  }

  function onPointerOver(event: PointerEvent): void {
    const target = event.target as Element | null
    if (!target) return
    /** 卡片自己（Teleport 到 body，组件 ref 在父级拿不到，按类名认） */
    if (target.closest('.ac-toolcard')) {
      keepCard()
      return
    }
    const chip = target.closest('.resource-chip') ?? target.closest('.ac-tag')
    const inComposer = chip?.closest('.prose-mirror-editor') ?? null
    if (chip && inComposer && showChip(chip)) return
    if (chip && inComposer) {
      if (card.visible) scheduleHide()
      return
    }
    /** 指针还停在下拉的工具行里（含行内文字、图标）：不关，交给那一行自己的 enter 处理 */
    if (target.closest('.ac-tool-row')) {
      clearHideTimer()
      return
    }
    if (card.visible) scheduleHide()
    // 卡片还没出来但计时器已经在跑：指针已经离开触发元素，取消这次弹出
    else clearShowTimer()
  }

  function onViewportChange(): void {
    if (!card.visible) return
    if (!anchorEl || !anchorEl.isConnected) {
      hideNow()
      return
    }
    /**
     * 下拉模式：菜单矩形要**现取**。面板拖动 / 停靠切换后菜单会换位置，
     * 拿开机时那份旧矩形算，卡片又会压回菜单上。
     */
    const menu = anchorSide === 'left' ? anchorEl.closest('[data-slot="dropdown-menu-content"]') : null
    const fresh = menu?.getBoundingClientRect()
    const avoid = fresh
      ? { left: fresh.left, top: fresh.top, right: fresh.right, bottom: fresh.bottom }
      : avoidRect ?? undefined
    void place(anchorOf(anchorEl), anchorSide, avoid)
  }

  onMounted(() => {
    document.addEventListener('pointerover', onPointerOver, true)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('pointerover', onPointerOver, true)
    window.removeEventListener('scroll', onViewportChange, true)
    window.removeEventListener('resize', onViewportChange)
    hideNow()
  })

  return {
    card,
    cardEl: cardEl as Ref<HTMLElement | null>,
    showTool,
    scheduleHide,
    keepCard,
    hideNow,
    refreshCard,
  }
}
