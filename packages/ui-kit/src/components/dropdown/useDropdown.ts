import { computed, onBeforeUnmount, onBeforeUpdate, onMounted, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useFloating } from '../../shared/floating'
import { useEscape, useOutsideClick } from '../../shared/overlay'
import { claimFloating, floatingChainOf, isInsideChain, releaseFloating } from './registry'
import type { DropdownAnchor, DropdownProps } from './types'

/** 把 DOM / Ref / getter 统一读成一个元素；拿不到就返回 null。 */
function resolveAnchor(anchor: DropdownProps['anchor']): HTMLElement | null {
  if (!anchor) return null
  if (anchor instanceof HTMLElement) return anchor
  if (typeof anchor === 'function') return anchor() ?? null
  const value = (anchor as { value?: unknown }).value
  return value instanceof HTMLElement ? value : null
}

export interface DropdownApi {
  open: Ref<boolean>
  triggerRef: Ref<HTMLElement | null>
  panelRef: Ref<HTMLElement | null>
  position: ReturnType<typeof useFloating>['position']
  positioned: ReturnType<typeof useFloating>['positioned']
  show: () => void
  showAtPoint: (x: number, y: number) => void
  hide: () => void
  toggle: () => void
  scheduleHide: () => void
  cancelHide: () => void
  scheduleShow: () => void
  panelStyle: Ref<Record<string, string>>
  arrowStyle: ComputedRef<Record<string, string>>
  closeFromSlot: () => void
  /** 自己的浮层链 id（写进面板 attr，供内层识别祖先）。 */
  chainId: string
  /** 祖先链 + 自己。 */
  chain: ComputedRef<string[]>
}

/** 下拉浮层的开关、定位和互斥逻辑；模板只负责画。 */
export function useDropdown(props: DropdownProps, emit: (value: boolean) => void): DropdownApi {
  const chainId = props.chainId?.trim() || 'mck-dd-' + Math.random().toString(36).slice(2)
  /** always 模式是调试用的“常显”：忽略外部开关，一直保持 true。 */
  const open = ref((props.trigger ?? 'click') === 'always' ? true : (props.modelValue ?? false))
  /** 真实定位锚点：外部 anchor 优先，否则用触发器插槽的 DOM。 */
  const anchorEl = ref<HTMLElement | null>(null)
  const triggerRef = ref<HTMLElement | null>(null)
  const panelRef = ref<HTMLElement | null>(null)
  let hideTimer = 0
  let showTimer = 0
  /**
   * 祖先链 + 自己。
   *
   * 两条来源，先显式后 DOM：
   *   ① `parentChain`（调用方传入）：锚点不在父面板里时只能显式告知，
   *      如行右键菜单按鼠标坐标弹出，触发器根本不在父列表的 DOM 子树内；
   *   ② 触发器所在 DOM 的链：触发器就长在父浮层面板里的常见情况（参数面板里的下拉）。
   */
  const chain = computed<string[]>(() => {
    const explicit = props.parentChain?.trim()
    const ancestors = explicit ? explicit.split(/\s+/).filter(Boolean) : floatingChainOf(triggerRef.value)
    return [...ancestors, chainId]
  })

  /**
   * 实际方向：anchorPlacement 是显式九宫格；没有它才用旧 placement/align 组合。
   * 兼容已有的 bottom-start 等写法，不破坏 Select 等现有调用。
   */
  const resolvedPlacement = computed<DropdownAnchor>(() => {
    if (props.anchorPlacement) return props.anchorPlacement
    const base = props.placement ?? 'bottom-start'
    const side = base.split('-')[0] as 'top' | 'right' | 'bottom' | 'left'
    if (base === 'auto') return 'bottom-start'
    const suffix = base.split('-')[1]
    if (suffix === 'start' || suffix === 'end') return (side + '-' + suffix) as DropdownAnchor
    const align = props.align
    if (align === 'start' || align === 'end') return (side + '-' + align) as DropdownAnchor
    return side as DropdownAnchor
  })

  const options = computed(() => ({
    placement: resolvedPlacement.value,
    offset: props.offset ?? 6,
    matchWidth: props.matchWidth ?? false,
    maxWidth: props.menuMaxWidth,
    minWidth: props.menuMinWidth,
    maxHeight: props.menuMaxHeight,
  }))
  /** 坐标锚点（右键菜单）：非空时菜单钉在这个点上。 */
  const point = ref(props.point ?? null)
  watch(() => props.point, (value) => { point.value = value ?? null })
  const { position, positioned, update } = useFloating(anchorEl, panelRef, open, options, point)
  /** 坐标锚点换位置（从这一行换到另一行）时要立刻重算，不能只等下一帧。 */
  watch(point, () => { if (open.value) nextTick(update) }, { deep: true })

  // 常显切换时，直接把 open 拉成 true；模式切走时回到外部传入值。
  watch(() => props.modelValue, (value) => {
    if ((props.trigger ?? 'click') === 'always') return
    if (typeof value === 'boolean' && value !== open.value) {
      // 必须走 setOpen：外部 v-model 打开也要登记进全局互斥表，
      // 否则同屏两个受控下拉（如菜单里的两个二级菜单）会同时开着。
      setOpen(value)
    }
  })

  watch(() => (props.trigger ?? 'click') === 'always', (always) => {
    if (always) {
      open.value = true
      return
    }
    open.value = props.modelValue ?? false
  }, { immediate: true })

  // 常显模式下外部传来的 false 也不关闭：模板渲染前拉回 true，
  // 用 flush sync 避免在同一帧里 false→true 抖动。
  watch(open, (value) => {
    if ((props.trigger ?? 'click') === 'always' && value === false) open.value = true
  }, { flush: 'sync' })

  function closeInstance(): void {
    // 被别的浮层顶掉时，也要取消还没触发的悬停打开：
    // 否则「悬停 → 立刻点击」时，提示气泡的延迟计时会在菜单打开后又把自己弹出来，
    // 顺手把刚开的菜单 claim 掉（表现为菜单闪一下就没了）。
    cancelShow()
    cancelHide()
    setOpen(false)
  }

  function setOpen(value: boolean): void {
    if ((props.trigger ?? 'click') === 'always' && !value) return
    if (open.value === value) return
    open.value = value
    emit(value)
    // 互斥登记集中在这里做：所有开关路径（触发器/外点/Esc/外部 v-model）都经过它。
    if (value && !props.disabled && props.exclusive !== false) {
      claimFloating(closeInstance, () => chain.value)
    } else if (!value) {
      releaseFloating(closeInstance)
    }
    if (value) nextTick(update)
  }

  function show(): void {
    if (props.disabled) return
    // 已经在显示了，之前排队的悬停打开就作废。
    cancelShow()
    cancelHide()
    // 普通打开不沿用上一次的坐标锚点（右键开过之后再点触发器，菜单要回到触发器身边）。
    point.value = props.point ?? null
    syncAnchor()
    setOpen(true)
  }

  /** 在视口坐标打开（行右键 / 行尾按钮）：与普通打开共用同一套定位、翻转与互斥。 */
  function showAtPoint(x: number, y: number): void {
    if (props.disabled) return
    cancelHide()
    point.value = { x, y }
    // 坐标锚点不需要元素锚点，清掉避免读到旧触发器位置。
    anchorEl.value = null
    setOpen(true)
    nextTick(update)
  }

  function hide(): void {
    // 主动关闭同样作废排队中的悬停打开，避免关掉之后又被计时器拉起来。
    cancelShow()
    cancelHide()
    // always 模式不允许真的关闭，直接回到 true。
    if ((props.trigger ?? 'click') === 'always') {
      open.value = true
      return
    }
    releaseFloating(closeInstance)
    open.value = false
    emit(false)
  }

  function toggle(): void {
    // 悬停模式由鼠标进出负责关闭；点击只负责打开。
    // 否则鼠标明明还停在触发器上，点一下反而把刚悬停打开的菜单关掉。
    if ((props.trigger ?? 'click') === 'hover') {
      show()
      return
    }
    if (open.value) hide()
    else show()
  }

  function scheduleHide(): void {
    if ((props.trigger ?? 'click') !== 'hover') return
    cancelHide()
    cancelShow()
    hideTimer = globalThis.setTimeout(hide, Math.max(0, props.hoverCloseDelay ?? 150)) as unknown as number
  }

  function cancelHide(): void {
    globalThis.clearTimeout(hideTimer)
    hideTimer = 0
  }

  /** 悬停打开可以延迟：Tooltip 需要「停一下才出现」，Dropdown 本身是 0 延迟。 */
  function scheduleShow(): void {
    if ((props.trigger ?? 'click') !== 'hover') {
      show()
      return
    }
    const delay = Math.max(0, props.hoverOpenDelay ?? 0)
    if (delay === 0) {
      show()
      return
    }
    cancelShow()
    showTimer = globalThis.setTimeout(runScheduledShow, delay) as unknown as number
  }

  function cancelShow(): void {
    globalThis.clearTimeout(showTimer)
    showTimer = 0
  }

  /**
   * 真正执行「排队中的悬停打开」。
   *
   * 为什么不直接复用 show()：show() 第一句就是 cancelShow()。回调已经触发、
   * 计时器应当归零，再走一遍取消逻辑虽然当前无害，但把「排队中」与「已经到点」
   * 两种状态混在一起，后面的关闭路径就很难判断该取消什么。分开写，语义清楚。
   * 关闭时必须先 cancelShow：否则「悬停→立刻点外面」时，排队里的那次打开会把
   * 刚刚关掉的浮层重新拉起来（dropdown.test.ts 的回归项）。
   */
  function runScheduledShow(): void {
    showTimer = 0
    if (props.disabled) return
    cancelHide()
    point.value = props.point ?? null
    setOpen(true)
  }

  /**
   * 锚点跟随：anchor 可以是 Ref，元素也可能晚挂载。
   * 只在 anchor 或触发器 DOM 变化时重算一次；写入前先比较，
   * 保证不会在 watcher 里更新自己又触发自己。
   */
  /**
   * 锚点跟随：anchor 可以是 Ref，元素也可能晚挂载。
   * 这里不用 watcher；每次渲染前从 props.anchor 重新解析一次。
   * 避免在 watcher 里更新 anchorEl 又引发组件更新，形成递归。
   */
  function syncAnchor(): void {
    if (point.value) {
      // 坐标锚点优先：不解析元素锚点，箭头也按坐标算。
      if (anchorEl.value !== null) anchorEl.value = null
      return
    }
    const next = resolveAnchor(props.anchor) ?? triggerRef.value
    if (next !== anchorEl.value) anchorEl.value = next
  }
  onBeforeUpdate(syncAnchor)
  // 常显模式在首次挂载时面板就渲染；onBeforeUpdate 不会触发，
  // 必须在 mounted 后补一次锚点同步，否则浮层停在默认的 0,0。
  onMounted(() => {
    syncAnchor()
    // 挂载时就已经是打开状态（v-model=true 或 always）也要登记互斥，
    // 否则后开的浮层看不到它，两个菜单会同时留在屏幕上。
    if (open.value && !props.disabled && props.exclusive !== false) {
      claimFloating(closeInstance, () => chain.value)
    }
  })
  syncAnchor()

  useOutsideClick(open, [triggerRef, panelRef, anchorEl], () => {
    if ((props.trigger ?? 'click') === 'always') return
    if (props.closeOnOutside === false) return
    hide()
  }, (target) => isInsideChain(target, chainId))
  useEscape(open, () => {
    if (props.closeOnEscape === false) return
    hide()
    if (props.restoreFocus !== false) triggerRef.value?.focus?.()
  })
  onBeforeUnmount(() => {
    cancelHide()
    cancelShow()
    // 卸载后必须从互斥表摘掉：否则后续浮层打开时还会去调一个已销毁实例的 close。
    releaseFloating(closeInstance)
  })

  // 宿主「都关了吧」广播：实现不必被宿主 import，谁开着谁自己收。
  function onCloseAll(): void {
    if (open.value) hide()
  }
  watch(() => props.closeAllEvent, (eventName, _old, onCleanup) => {
    if (!eventName || typeof window === 'undefined') return
    window.addEventListener(eventName, onCloseAll)
    onCleanup(() => window.removeEventListener(eventName, onCloseAll))
  }, { immediate: true })

  // 显式父链的子浮层：父菜单关掉（点外 / Esc / 选择）时跟着收。
  watch(() => props.parentOpen?.(), (parentOpen) => {
    if (parentOpen === false && open.value) hide()
  })

  const panelStyle = computed<Record<string, string>>(() => {
    const style: Record<string, string> = {
      left: position.value.left + 'px',
      top: position.value.top + 'px',
      maxHeight: position.value.maxHeight ? position.value.maxHeight + 'px' : '',
    }
    // 空串是试玩面板里“用默认”的表达；不能让空字符串落到 style 上。
    if (props.menuWidth?.trim()) style.width = props.menuWidth
    else if (props.matchWidth && position.value.width) style.width = position.value.width + 'px'
    if (props.menuHeight?.trim()) style.height = props.menuHeight
    if (props.menuMinWidth?.trim()) style.minWidth = props.menuMinWidth
    if (props.menuMaxWidth?.trim()) style.maxWidth = props.menuMaxWidth
    if (props.zIndex !== undefined && props.zIndex !== '') style.zIndex = String(props.zIndex)
    return style
  })

  /**
   * 箭头是独立 fixed 元素：面板自己 overflow 滚动，画在面板内部会被裁掉。
   * 只露出朝触发器那一半，内侧一半由面板盖住，看起来像从面板边缘长出来。
   */
  const ARROW_SIZE = 10
  const ARROW_PAD = 12
  const arrowStyle = computed<Record<string, string>>(() => {
    const hidden: Record<string, string> = { display: 'none' }
    // 还没定位好时箭头先藏起来，但层级仍要带上：一旦显示，不能掉到别的浮层下面。
    if (props.zIndex !== undefined && props.zIndex !== '') hidden.zIndex = String(props.zIndex)
    if (!props.arrow || !positioned.value) return hidden
    const panel = panelRef.value
    /** 箭头指向的参照：坐标锚点用点本身，元素锚点用元素矩形。 */
    const triggerRect: DOMRect | null = point.value
      ? ({ left: point.value.x, top: point.value.y, right: point.value.x, bottom: point.value.y, width: 0, height: 0, x: point.value.x, y: point.value.y, toJSON: () => ({}) } as DOMRect)
      : (anchorEl.value?.getBoundingClientRect() ?? null)
    const trigger = triggerRect
    if (!panel || !trigger) return hidden
    const pos = position.value
    const side = pos.placement.split('-')[0] as 'top' | 'bottom' | 'left' | 'right'
    const tr = triggerRect
    const half = ARROW_SIZE / 2
    const style: Record<string, string> = {
      position: 'fixed',
      width: ARROW_SIZE + 'px',
      height: ARROW_SIZE + 'px',
      // 用变量而不是写死底色：调用方（如 Tooltip 的深色气泡）能只换箭头颜色，
      // 定位、贴边、翻转仍由库负责。
      background: 'var(--mck-dropdown-arrow-bg, var(--ui-panel, #fff))',
      border: '0 solid var(--mck-dropdown-arrow-line, var(--ui-line, #e2e5ea))',
      transform: 'rotate(45deg)',
      pointerEvents: 'none',
    }
    if (props.zIndex !== undefined && props.zIndex !== '') style.zIndex = String(props.zIndex)
    const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))
    if (side === 'top' || side === 'bottom') {
      const center = tr.left + tr.width / 2
      style.left = clamp(center - half, pos.left + ARROW_PAD, pos.left + panel.offsetWidth - ARROW_PAD) + 'px'
      style.top = (side === 'bottom' ? pos.top : pos.top + panel.offsetHeight) - half + 'px'
      const edges = side === 'bottom' ? ['Top', 'Left'] : ['Bottom', 'Right']
      for (const edge of edges) style['border' + edge + 'Width'] = '1px'
    } else {
      const center = tr.top + tr.height / 2
      style.top = clamp(center - half, pos.top + ARROW_PAD, pos.top + panel.offsetHeight - ARROW_PAD) + 'px'
      style.left = (side === 'right' ? pos.left : pos.left + panel.offsetWidth) - half + 'px'
      const edges = side === 'right' ? ['Bottom', 'Left'] : ['Top', 'Right']
      for (const edge of edges) style['border' + edge + 'Width'] = '1px'
    }
    return style
  })

  /**
   * slot 里的 close 必须真的关掉浮层并通知父组件；
   * hide 与外点/ESC 共用，但父级 modelValue 还没同步时也要兜底置 false。
   */
  function closeFromSlot(): void {
    // 常显 = 不允许从 slot 关闭。
    if ((props.trigger ?? 'click') === 'always') return
    open.value = false
    releaseFloating(closeInstance)
    emit(false)
    if (props.restoreFocus !== false) triggerRef.value?.focus?.()
  }

  return { open, triggerRef, panelRef, position, positioned, show, showAtPoint, hide, toggle, scheduleHide, cancelHide, scheduleShow, panelStyle, arrowStyle, closeFromSlot, chainId, chain }
}
