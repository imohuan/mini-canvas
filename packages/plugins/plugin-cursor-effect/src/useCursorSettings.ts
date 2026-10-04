/**
 * useCursorSettings —— 设置页与内核 settings 之间的薄接线（读当前值 / 写回 / 恢复默认）。
 *
 * 为什么要有它：settings 不是 Vue 响应式对象，改值只经 onChange 广播；
 * 页面要"实时反映当前值"，就得订阅它、拿一个本地 tick 驱动重渲染。
 */
import { onBeforeUnmount, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { DEFAULTS, type CursorEffectConfig } from './catalog'

/** 内核 settings 的最小读写面 */
interface SettingsWriteLike {
  get(key: string): unknown
  set(key: string, value: string | number | boolean): boolean
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}

export function useCursorSettings() {
  const { ctx } = useCanvasRender()
  const store = ctx.get<SettingsWriteLike>('settings')
  const tick = ref(0)
  const off = store?.onChange(() => { tick.value += 1 })
  onBeforeUnmount(() => off?.dispose())

  /** 读当前值（settings 未声明/缺省时回落 schema 默认） */
  function get<K extends keyof CursorEffectConfig>(key: K): CursorEffectConfig[K] {
    void tick.value
    const v = store?.get(key)
    return (v === undefined || v === null ? DEFAULTS[key] : v) as CursorEffectConfig[K]
  }
  /** 写回（实时生效 + 随 settingsPersist 持久化） */
  function set(key: keyof CursorEffectConfig, value: string | number | boolean): void {
    store?.set(key, value)
  }
  /** 全部恢复 schema 默认 */
  function reset(): void {
    for (const key of Object.keys(DEFAULTS) as Array<keyof CursorEffectConfig>) set(key, DEFAULTS[key])
  }

  return { get, set, reset }
}

