/**
 * ThemePlugin — 节点主题插件
 *
 * 管理画布节点主题颜色系统，提供：
 * - 一键切换预设主题（slate / blue / green / warm / custom）
 * - 自定义 accent + surface 颜色，自动计算全量 CSS 变量
 * - 单变量精细覆盖（patchVariables）
 * - 响应式数据流：store 状态变化 → 自动重新计算 → 立即写入 :root CSS 变量
 *
 * 使用方式：
 * ```typescript
 * // 接口传参
 * const plugin = { ...ThemePlugin, options: { preset: 'blue' } }
 *
 * // 运行时 API（类型安全）
 * const themeApi = manager.getPluginAPI<ThemeAPI>('theme')
 * themeApi?.applyPreset('green')
 * themeApi?.setVariable('canvas-node-accent', '#ef4444')
 * ```
 *
 * @event theme:changed — 主题变化时触发，携带完整 ThemeState
 */
import type { CanvasPlugin, PluginContext } from '../types'
import type { ThemeOptions, ThemeAPI, ThemeState, ThemePresetName } from './types'
import { getPreset, getPresetsList } from './themePresets'
import { computeThemeVars, applyThemeToDOM } from './colorUtils'
import type { PanelSettingDefinition } from '../../registry/types'

/** 默认主题状态 */
function defaultState(): ThemeState {
  return {
    activePreset: 'slate',
    accent: '#111827',
    surface: '#f9fafb',
    textStrong: '#111827',
    text: '#4b5563',
    textMuted: '#64748b',
    customVariables: {},
  }
}

/**
 * 从 store 读取当前主题状态（带默认值回退）
 */
function readState(store: PluginContext['store']): ThemeState {
  const ds = defaultState()
  return {
    activePreset: (store.get<string>('activePreset') as ThemePresetName) || ds.activePreset,
    accent: store.get<string>('accent') || ds.accent,
    surface: store.get<string>('surface') || ds.surface,
    textStrong: store.get<string>('textStrong') || ds.textStrong,
    text: store.get<string>('text') || ds.text,
    textMuted: store.get<string>('textMuted') || ds.textMuted,
    customVariables: store.get<Record<string, string>>('customVariables') || { ...ds.customVariables },
  }
}

/**
 * 写入完整状态到 store
 */
function writeState(store: PluginContext['store'], state: ThemeState): void {
  store.set('activePreset', state.activePreset)
  store.set('accent', state.accent)
  store.set('surface', state.surface)
  store.set('textStrong', state.textStrong)
  store.set('text', state.text)
  store.set('textMuted', state.textMuted)
  store.set('customVariables', { ...state.customVariables })
}

/**
 * 全量刷新：读当前 store 状态 → 计算变量 → 写入 DOM
 */
function refreshTheme(store: PluginContext['store']): void {
  const st = readState(store)
  console.log('[🎨 ThemePlugin] refreshTheme — accent:', st.accent, 'surface:', st.surface, 'custom vars count:', Object.keys(st.customVariables).length)
  const vars = computeThemeVars(st.accent, st.surface)
  applyThemeToDOM(vars, st.customVariables)
  console.log('[🎨 ThemePlugin] refreshTheme done — DOM updated')
}

// ============================================================================
// Plugin
// ============================================================================

export const ThemePlugin: CanvasPlugin<ThemeOptions, ThemeAPI> = {
  name: 'theme',
  version: '1.0.0',

  install(context: PluginContext, options: ThemeOptions) {
    const logger = context.logger
    const store = context.store

    // 1. 初始化状态（优先用传入 options，回退到默认 slate）
    const initState = defaultState()

    if (options.preset) {
      const preset = getPreset(options.preset)
      initState.activePreset = preset.name
      initState.accent = options.accent || preset.accent
      initState.surface = options.surface || preset.surface
      initState.textStrong = preset.textStrong
      initState.text = preset.text
      initState.textMuted = preset.textMuted
      if (preset.override || options.overrides) {
        initState.customVariables = { ...(preset.override || {}), ...(options.overrides || {}) }
      }
    } else if (options.accent) {
      initState.activePreset = 'custom'
      initState.accent = options.accent
      if (options.surface) initState.surface = options.surface
    }

    writeState(store, initState)

    // 注册面板设置项
    const presetOptions = getPresetsList().map(p => ({ value: p.name, title: p.name }))
    context.panels.registerSetting('theme', {
      id: 'theme.activePreset',
      title: '主题预设',
      description: '一键切换整体配色方案',
      type: 'select',
      group: '主题',
      order: 10,
      defaultValue: initState.activePreset,
      options: presetOptions,
    } as PanelSettingDefinition)

    context.panels.registerSetting('theme', {
      id: 'theme.accent',
      title: '强调色',
      description: '节点边框和高亮的主色调',
      type: 'color',
      group: '主题',
      order: 20,
      defaultValue: initState.accent,
    } as PanelSettingDefinition)

    context.panels.registerSetting('theme', {
      id: 'theme.surface',
      title: '底色',
      description: '节点和面板的背景色',
      type: 'color',
      group: '主题',
      order: 30,
      defaultValue: initState.surface,
    } as PanelSettingDefinition)
    // 2. 初始渲染
    refreshTheme(store)
    logger.info(`Initialized with preset: ${initState.activePreset}, accent: ${initState.accent}`)

    // 3. 监听关键字段变化 → 自动刷新
    const unwatchAccent = store.watch('accent', () => refreshTheme(store))
    const unwatchSurface = store.watch('surface', () => refreshTheme(store))
    const unwatchCustom = store.watch('customVariables', () => refreshTheme(store))

    // ====================================================================
    // API
    // ====================================================================

    const api: ThemeAPI = {
      get state(): ThemeState {
        return readState(store)
      },

      applyPreset(name) {
        console.log('[🎨 ThemePlugin] applyPreset called:', name)
        const preset = getPreset(name)
        const st = readState(store)
        st.activePreset = preset.name
        st.accent = preset.accent
        st.surface = preset.surface
        st.textStrong = preset.textStrong
        st.text = preset.text
        st.textMuted = preset.textMuted
        st.customVariables = { ...(preset.override || {}) }
        writeState(store, st)
        refreshTheme(store)
        context.emit('theme:changed', st)
        logger.info(`Preset applied: ${name}`)
      },

      applyCustom(accent, surface) {
        console.log('[🎨 ThemePlugin] applyCustom called:', accent, surface)
        const st = readState(store)
        st.activePreset = 'custom'
        st.accent = accent
        if (surface) st.surface = surface
        writeState(store, st)
        refreshTheme(store)
        context.emit('theme:changed', st)
        logger.info(`Custom theme: accent=${accent}, surface=${st.surface}`)
      },

      setVariable(name, value) {
        const st = readState(store)
        const key = name as string
        if (value === null || value === undefined) {
          delete st.customVariables[key]
        } else {
          st.customVariables[key] = value
        }
        writeState(store, st)
        refreshTheme(store)
        logger.debug(`Variable set: --${name} = ${value}`)
      },

      setVariables(vars) {
        const st = readState(store)
        for (const [name, value] of Object.entries(vars)) {
          const key = name as string
          if (value === null || value === undefined) {
            delete st.customVariables[key]
          } else {
            st.customVariables[key] = value
          }
        }
        writeState(store, st)
        refreshTheme(store)
        context.emit('theme:changed', st)
        logger.info(`Variables updated: ${Object.keys(vars).length} changes`)
      },

      reset() {
        api.applyPreset('slate')
      },

      getPresets() {
        return getPresetsList()
      },
    }

    // 4. 暴露命令事件（供其他插件/外部使用）
    const offApplyPreset = context.on('theme:apply-preset', (preset: any) => api.applyPreset(preset))
    const offApplyCustom = context.on('theme:apply-custom', (payload: any) => {
      api.applyCustom(payload?.accent, payload?.surface)
    })
    const offSetVariable = context.on('theme:set-variable', (payload: any) => {
      if (payload?.name && payload?.value !== undefined) {
        api.setVariable(payload.name, payload.value)
      }
    })
    const offReset = context.on('theme:reset', () => api.reset())

    // 初始发射
    context.emit('theme:changed', initState)

    return {
      api,
      uninstall() {
        offApplyPreset()
        offApplyCustom()
        offSetVariable()
        offReset()
        unwatchAccent()
        unwatchSurface()
        unwatchCustom()
        logger.info('ThemePlugin cleaned up')
      },
    }
  },
}
