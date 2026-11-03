/**
 * 3D 预览的指针、滚轮、双击、键盘与重置事件。
 * 事件绑定顺序、stopPropagation 时机、滚轮 passive:false 都与原组件一致；
 * 返回值交给统一卸载函数逐个 removeEventListener。
 */
import type { Ref } from 'vue'
import { applyDrag, applyZoom, resetView } from '../panoramaView'
import { beginInteract, endInteract, exitFullscreen, isFullscreen, isInteracting } from '../panoramaSession'
import { resolveEscapeAction, resolvePanoramaSpec, type PanoramaSpec } from '../panoramaMode'
import type { PanoramaThreeState } from './threeState'

export interface PanoramaEventsOptions {
  id: string
  /** 当前模式下的行为结论 */
  spec: () => PanoramaSpec
  /** 当前视角状态 */
  three: () => PanoramaThreeState
  /** 退出交互时同步重置拖拽标记 */
  dragging: Ref<boolean>
}

export interface PanoramaEventsApi {
  dragging: Ref<boolean>
  /** 绑交互：拖拽转视角 + 滚轮缩放。返回解绑函数 */
  bindEvents: (el: HTMLElement) => () => void
  /** 重置视角（回到初始朝向与视野角） */
  onReset: () => void
  /** 双击进入交互模式（预览态才有意义；失败态不进） */
  onDblClick: (e: MouseEvent) => void
  /** 退出交互模式（Esc / 点画布空白），回到"按住就能拖节点"的默认状态 */
  exitInteract: () => void
  /** Esc 退出交互模式（全屏时先退全屏，再按一次退交互） */
  onKeydown: (e: KeyboardEvent) => void
}

export function usePanoramaEvents(options: PanoramaEventsOptions): PanoramaEventsApi {
  const { id, spec, dragging } = options
  let dragStart = { x: 0, y: 0, lon: 0, lat: 0 }

  /** 绑交互：拖拽转视角 + 滚轮缩放。全部 stopPropagation，避免画布同时被拖动/缩放 */
  function bindEvents(el: HTMLElement): () => void {
    const onPointerDown = (e: PointerEvent): void => {
      // 预览模式不接管指针：事件照常冒泡到节点，按住画面就是拖节点（用户要的默认行为）
      if (!spec().capturePointer) return
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      dragging.value = true
      dragStart = { x: e.clientX, y: e.clientY, lon: options.three().view.target.lon, lat: options.three().view.target.lat }
      // 光标不在这里直接写 el.style：内联样式会盖住模板上按模式绑的 cursor（预览模式还给节点拖拽），
      // 统一交给模板 :style="...dragging ? 'grabbing' : 'grab'" 一处决定。
      el.setPointerCapture?.(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent): void => {
      if (!dragging.value) return
      e.preventDefault()
      e.stopPropagation()
      // 用相对按下点的位移重算，避免多次拖拽误差累积
      const next = applyDrag(
        { lon: dragStart.lon, lat: dragStart.lat, fov: options.three().view.target.fov },
        e.clientX - dragStart.x,
        e.clientY - dragStart.y,
      )
      options.three().view.target = { ...options.three().view.target, lon: next.lon, lat: next.lat }
    }
    const onPointerUp = (e: PointerEvent): void => {
      if (!dragging.value) return
      e.stopPropagation()
      dragging.value = false
      el.releasePointerCapture?.(e.pointerId)
    }
    const onWheel = (e: WheelEvent): void => {
      // 预览模式：滚轮归画布（缩放画布）；只有交互模式才抢过来改视野角
      if (!spec().captureWheel) return
      e.preventDefault()
      e.stopPropagation()
      options.three().view.target = applyZoom(options.three().view.target, e.deltaY)
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    // wheel 一律以"非被动"挂上：预览模式里它直接 return（不 preventDefault，画布照常缩放），
    // 交互模式才真正拦截。按模式增删监听器的代价是模式切换要动事件绑定，不值得。
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      el.removeEventListener('wheel', onWheel)
    }
  }

  /** 重置视角（回到初始朝向与视野角） */
  function onReset(): void {
    options.three().view.target = resetView()
  }

  /** 双击进入交互模式（预览态才有意义；失败态不进） */
  function onDblClick(e: MouseEvent): void {
    if (spec().mode === 'error') return
    if (spec().interactive) return
    e.stopPropagation()
    beginInteract(id)
  }

  /** 退出交互模式（Esc / 点画布空白），回到"按住就能拖节点"的默认状态 */
  function exitInteract(): void {
    endInteract(id)
    dragging.value = false
  }

  /**
   * Esc 退出交互模式（全屏时先退全屏，再按一次退交互）。
   * 挂在 window 而不是画面元素上：进交互后焦点可能不在画面里，挂在元素上会出现"按 Esc 没反应"。
   */
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return
    // 一次只退一层（判定见 panoramaMode.resolveEscapeAction）：全屏 → 退回节点内仍可转视角 →
    // 再按一次才回到"按住就能拖节点"。有明确中间层，既不会一下跳回去，也不容易误退。
    const action = resolveEscapeAction({ fullscreen: isFullscreen(id), interactive: isInteracting(id) })
    if (action === 'exit-fullscreen') exitFullscreen(id)
    else if (action === 'exit-interact') exitInteract()
  }

  return { dragging, bindEvents, onReset, onDblClick, exitInteract, onKeydown }
}
