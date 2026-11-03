import type { UiState } from './createUiState'
import type { UiHostScope } from './useUiHost'
import type { SettingsStore } from '@mini-canvas/kernel'

/**
 * 主题：写 <html class="dark"> + 订阅 settings.themeMode 镜像。
 */
export function createThemeScope(state: UiState, host: UiHostScope) {
  const { hostCtx, writeSetting, showToast } = host

  // ===== 主题 =====
  /**
   * 把主题写到 <html class="dark">（Tailwind v4 / shadcn 通行做法）。
   *
   * 注：权威落值点其实是渲染宿主的 installThemeMode（订阅 settings 的 themeMode），
   * 这里保留同名动作是为了"宿主还没就绪 / 无宿主"时也能立即生效（幂等，重复写无害）。
   */
  function applyTheme(v: 'dark' | 'light'): void {
    if (typeof document === 'undefined') return // Node 单测环境无 DOM：跳过副作用（设置仍照常写入）
    document.documentElement.classList.toggle('dark', v === 'dark')
  }
  /**
   * 订阅主题模式（渲染层配置 themeMode）→ 同步到本地镜像值。
   *
   * 唯一事实来源是内核设置；按钮与设置面板都写同一处，所以"面板里切了、按钮状态也跟着变"。
   * 与 bindCanvasToggles 同款：重复 onReady 先撤旧订阅，避免回调堆积。
   */
  let disposeThemeModeBind: (() => void) | undefined
  function bindThemeMode(): void {
    disposeThemeModeBind?.()
    disposeThemeModeBind = undefined
    const store = hostCtx()?.get<SettingsStore>('settings')
    if (!store) return
    const cur = store.get('themeMode')
    if (cur === 'dark' || cur === 'light') state.theme = cur
    disposeThemeModeBind = store.onChange((key, value) => {
      if (key === 'themeMode' && (value === 'dark' || value === 'light')) state.theme = value
    }).dispose
  }
  /** 撤掉主题模式订阅（宿主销毁时调用） */
  function unbindThemeMode(): void {
    disposeThemeModeBind?.()
    disposeThemeModeBind = undefined
  }
  function toggleTheme(): void {
    const next = state.theme === 'dark' ? 'light' : 'dark'
    state.theme = next
    // 写内核设置（= 持久化 + 落 DOM 的唯一通道）。宿主没就绪/没声明该键时 writeSetting 是 no-op，
    // 此时下面的 applyTheme 兜底，保证按钮永远点得动。
    writeSetting('themeMode', next)
    applyTheme(next)
    showToast(next === 'dark' ? '已切换暗色主题' : '已切换亮色主题')
  }
  return { applyTheme, bindThemeMode, unbindThemeMode, toggleTheme }
}

export type ThemeScope = ReturnType<typeof createThemeScope>

