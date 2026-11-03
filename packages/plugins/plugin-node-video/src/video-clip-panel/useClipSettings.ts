import { computed, onBeforeUnmount } from 'vue'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'
import { readClipPrefs } from '../videoClipStore'

export interface ClipSettingsOptions {
  ctx: CanvasRenderContext['ctx']
  nodeId: string
}

/**
 * 吸附/循环偏好：首次读取、设置变更订阅与吸附范围夹取。
 */
export function useClipSettings(options: ClipSettingsOptions) {
  const { ctx, nodeId } = options

  /** 会话偏好（吸附/循环）。面板上的按钮直接改这份；设置面板改的是它下面的默认值 */
  const prefs = readClipPrefs(nodeId)

  /**
   * 从 settings 取某一个偏好键的当前值。只取**改动的那一项**：
   * 改吸附间隔时不该把面板上手动切换过的循环开关一起重置（那是两回事）。
   */
  function settingsValue(key: 'videoClipSnapStep' | 'videoClipSnapRadius' | 'videoClipLoop'): unknown {
    const settings = ctx.tryGet<{ get(key: string): unknown }>('settings')
    return settings ? settings.get(key) : undefined
  }

  /**
   * 把 settings 里的值同步进会话偏好（不传 key = 三项全同步，用于挂载时的种子）。
   *
   * ★ 为什么不能只在 onMounted 播一次种子（用户 2026-10-31 报「配置改了不生效」）：
   * 剪辑面板是常驻组件，设置面板改值时不重新挂载 —— 只读一次就永远是打开那一刻的旧值。
   */
  function syncPrefsFromSettings(key?: 'videoClipSnapStep' | 'videoClipSnapRadius' | 'videoClipLoop'): void {
    if (key === undefined || key === 'videoClipSnapStep') {
      const step = settingsValue('videoClipSnapStep')
      if (typeof step === 'number' && Number.isFinite(step) && step > 0) prefs.snapStep = step
    }
    if (key === undefined || key === 'videoClipSnapRadius') {
      const radius = settingsValue('videoClipSnapRadius')
      if (typeof radius === 'number' && Number.isFinite(radius) && radius > 0) prefs.snapRadius = radius
    }
    if (key === undefined || key === 'videoClipLoop') {
      const loop = settingsValue('videoClipLoop')
      if (typeof loop === 'boolean') prefs.loop = loop
    }
  }

  syncPrefsFromSettings()

  /**
   * 订阅设置变更（用户口径：设置页里的吸附间隔/范围/区间循环要**实时**生效）。
   * 只要动的是这三个键就重新同步；别的设置不打扰。
   */
  const offPrefs = ctx
    .tryGet<{
      onChange(cb: (key: string, value: unknown) => void, opts?: { scope?: string }): { dispose(): void }
    }>('settings')
    ?.onChange((key) => {
      if (key !== 'videoClipSnapStep' && key !== 'videoClipSnapRadius' && key !== 'videoClipLoop') return
      // 只同步改动的那一项，不碰另一项
      syncPrefsFromSettings(key)
    })
  onBeforeUnmount(() => offPrefs?.dispose())

  /** 吸附范围夹取：不能超过间隔的一半（demo 铁律 3） */
  const effectiveRadius = computed(() => Math.min(prefs.snapRadius, prefs.snapStep / 2))

  return {
    prefs,
    effectiveRadius,
  }
}

