/**
 * 「画布树外按名取 UI 组件」的订阅器。
 *
 * 为什么单独成文件：这段逻辑有一个容易漏的时序 —— 组件先挂载、CanvasHost 后 ready。
 * 只在 onMounted 里查一次目录的话，那时 ctx 还不存在，之后目录换赢家也收不到通知，
 * 界面会永远停在调用方给的 fallback 上（设置字段、资产预览都踩过）。
 *
 * 这里不碰 DOM / Vue 生命周期，宿主目录用 getter 注入，方便直接测时序。
 */
import { shallowRef, type Ref } from 'vue'

/** 目录字段只需这两个能力：取当前赢家、订阅变化。 */
export interface UiCatalogFieldLike<T> {
  top(key: string): { value: T } | undefined
  subscribe(fn: () => void): { dispose(): void }
}

export interface OutsideComponentTracker<T> {
  current: Ref<T | undefined>
  /** 重新读取宿主目录并（重新）订阅；宿主为 undefined 时回到未绑定状态。 */
  bind: () => void
  /** 释放订阅（卸载时调用）。 */
  dispose: () => void
}

export function createOutsideComponentTracker<T>(
  name: string,
  getField: () => UiCatalogFieldLike<T> | undefined,
  /** 主题在 Provider 外发布的静态目录（可选的兜底；宿主就绪后以宿主目录优先） */
  getStatic?: () => T | undefined,
): OutsideComponentTracker<T> {
  const current = shallowRef<T | undefined>(undefined)
  let sub: { dispose(): void } | undefined

  function read(): T | undefined {
    return getField()?.top(name)?.value ?? getStatic?.()
  }
  function sync(): void {
    const next = read()
    if (next !== current.value) current.value = next
  }
  function dispose(): void {
    sub?.dispose()
    sub = undefined
  }
  function bind(): void {
    dispose()
    const field = getField()
    if (!field) {
      // 宿主被撤掉：回到主题的静态件或 fallback，别继续显示上一个宿主的组件。
      sync()
      return
    }
    sub = field.subscribe(sync)
    sync()
  }

  // 初次创建就先读一次：调用方可能在挂载前就需要组件（模板首帧）。
  sync()
  return { current, bind, dispose }
}
