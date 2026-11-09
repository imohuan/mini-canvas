/**
 * 主题工作台的本地保存。
 *
 * 为什么存 localStorage 而不是项目 settings：demo 要能“点开就试”，不往用户画布配置里写东西。
 * 数据结构刻意做成可读的：
 * { version, themeId, mode, themes: [{ id, name, overrides: { [fieldKey]: string } }] }
 * 其中 fieldKey 就是真实 settings 的 key（如 accentColorLight）。
 */

import type { ThemeLabMode } from './catalog'

export interface LabTheme {
  id: string
  name: string
  /** 用户改过的字段（只存与默认不同的；空串表示“清除了可选色 → 跟随主题”） */
  overrides: Record<string, string>
}

export interface LabState {
  version: 1
  themeId: string
  mode: ThemeLabMode
  /**
   * **只存用户自建模板**。
   *
 * 预设（墨黑 / 雾青 / 陶土 / 靛蓝 / 薄荷 / 朱砂 / 海蓝 / 罗兰）永远从代码里的 LAB_THEMES 取，
   * 不落进存档：以前把预设一起存了，用户在界面上改一格就会把预设写坏，
   * 而且再也回不到原样。
   */
  themes: LabTheme[]
}

/**
 * 「自定义」不是模板，而是"当前配色跟任何一套模板都不一样"这个状态。
 * 它没有 overrides：它就是 settings 里现在写着的那些值本身。
 */
export const CUSTOM_THEME_ID = 'custom'
export const CUSTOM_THEME: LabTheme = { id: CUSTOM_THEME_ID, name: '自定义', overrides: {} }

/** 是不是「自定义」这一格（它不在 themes 数组里，也不存 overrides） */
export function isCustomThemeId(id: string): boolean {
  return id === CUSTOM_THEME_ID
}

const KEY = 'mini-canvas:plugin-theme-lab:v2'
/** 旧版键（存了预设的那份）。启动时迁移一次，之后不再读写。 */
const LEGACY_KEY = 'mini-canvas:plugin-theme-lab:v1'

/** 预设模板的 id 集合：这些永远只读，不能改名、不能改色、不能删除。 */
export const PRESET_THEME_IDS: readonly string[] = [
  'mono-dark',
  'mist',
  'clay',
  'indigo',
  'mint',
  'crimson',
  'ocean',
  'violet',
]

export function isPresetTheme(theme: LabTheme): boolean {
  return PRESET_THEME_IDS.includes(theme.id)
}

/** 只有用户自己新建的模板可以改、可以删。 */
export function isEditableTheme(theme: LabTheme): boolean {
  return !isPresetTheme(theme) && !isCustomThemeId(theme.id)
}

export const LAB_THEMES: LabTheme[] = [
  {
    id: 'mono-dark',
    name: '墨黑',
    overrides: {
      accentColorLight: '#1f2430', accentColorDark: '#e8ebf2', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      accentHoverColorLight: '#12161d', accentHoverColorDark: '#f7f9fc', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      dangerColorLight: '#c8323f', dangerColorDark: '#f0717b', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      warnColorLight: '#b0791f', warnColorDark: '#e3b65c', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeRailColorLight: '#858c99', edgeRailColorDark: '#4a505c', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeFlowColorLight: '#5c6472', edgeFlowColorDark: '#dfe4ec', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      alignGuideColorLight: '#8b919c', alignGuideColorDark: '#a8b0bc', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectBoxColorLight: '#3a414d', multiSelectBoxColorDark: '#d8dde6', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameOuterColorLight: '#7d8593', multiSelectFrameOuterColorDark: '#9aa2af', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameInnerColorLight: '#a7aeba', multiSelectFrameInnerColorDark: '#c3cad4', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      pathColor: '#3a414d', bladeColor: '#edc069', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
    },
  },
  { id: 'mist', name: '雾青', overrides: {} },
  {
    id: 'clay',
    name: '陶土',
    overrides: {
      accentColorLight: '#c45a3b', accentColorDark: '#ef8764', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      accentHoverColorLight: '#a8482d', accentHoverColorDark: '#d5704f', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      dangerColorLight: '#d94a4a', dangerColorDark: '#f27b7b', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      warnColorLight: '#cf922b', warnColorDark: '#edb45a', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeRailColorLight: '#a38d83', edgeRailColorDark: '#6e5c55', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeFlowColorLight: '#ef946c', edgeFlowColorDark: '#f4a17c', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      alignGuideColorLight: '#ba927c', alignGuideColorDark: '#e4b28f', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectBoxColorLight: '#c96646', multiSelectBoxColorDark: '#ef8866', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameOuterColorLight: '#d18a6f', multiSelectFrameOuterColorDark: '#e99676', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameInnerColorLight: '#e0a58c', multiSelectFrameInnerColorDark: '#f2b195', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      pathColor: '#c96646', bladeColor: '#edc069', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
    },
  },
  {
    id: 'indigo',
    name: '靛蓝',
    overrides: {
      accentColorLight: '#5667d8', accentColorDark: '#8d9bff', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      accentHoverColorLight: '#4453b8', accentHoverColorDark: '#7483f0', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      dangerColorLight: '#e05261', dangerColorDark: '#f07f8b', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      warnColorLight: '#c9953f', warnColorDark: '#e7b266', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeRailColorLight: '#8b94b5', edgeRailColorDark: '#555f80', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeFlowColorLight: '#7b8cff', edgeFlowColorDark: '#a1adff', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      alignGuideColorLight: '#7d8dcf', alignGuideColorDark: '#aab5ff', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectBoxColorLight: '#5f70dd', multiSelectBoxColorDark: '#8493f4', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameOuterColorLight: '#8896e7', multiSelectFrameOuterColorDark: '#96a3f2', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameInnerColorLight: '#a6b0ef', multiSelectFrameInnerColorDark: '#b2bbfa', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      pathColor: '#6c7cf0', bladeColor: '#eac36d', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
    },
  },
  {
    id: 'mint',
    name: '薄荷',
    overrides: {
      accentColorLight: '#2f9e66', accentColorDark: '#62d494', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      accentHoverColorLight: '#278353', accentHoverColorDark: '#4dbb7d', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      dangerColorLight: '#d94d5f', dangerColorDark: '#ef7d8b', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      warnColorLight: '#b8872e', warnColorDark: '#e0b45e', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeRailColorLight: '#9eb4a9', edgeRailColorDark: '#5d7468', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeFlowColorLight: '#4ed98d', edgeFlowColorDark: '#70e9a4', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      alignGuideColorLight: '#8bb79a', alignGuideColorDark: '#94d8af', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectBoxColorLight: '#45a56e', multiSelectBoxColorDark: '#67cd92', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameOuterColorLight: '#70bb8e', multiSelectFrameOuterColorDark: '#7ad29d', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameInnerColorLight: '#95cfa9', multiSelectFrameInnerColorDark: '#9adfb4', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      pathColor: '#39a366', bladeColor: '#e6c66d', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
    },
  },
  {
    id: 'crimson',
    name: '朱砂',
    overrides: {
      accentColorLight: '#cc3f57', accentColorDark: '#ff7b92', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      accentHoverColorLight: '#ad2c43', accentHoverColorDark: '#e26077', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      dangerColorLight: '#b52a2a', dangerColorDark: '#f07270', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      warnColorLight: '#c98a1f', warnColorDark: '#eab655', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeRailColorLight: '#b3949b', edgeRailColorDark: '#75565f', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeFlowColorLight: '#f2678b', edgeFlowColorDark: '#ff8fb0', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      alignGuideColorLight: '#c47e95', alignGuideColorDark: '#f0a3b9', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectBoxColorLight: '#d0516f', multiSelectBoxColorDark: '#f07d97', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameOuterColorLight: '#d2839a', multiSelectFrameOuterColorDark: '#ef8ea5', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameInnerColorLight: '#e0a3b4', multiSelectFrameInnerColorDark: '#f2aabc', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      pathColor: '#d0516f', bladeColor: '#edc069', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
    },
  },
  {
    id: 'ocean',
    name: '海蓝',
    overrides: {
      accentColorLight: '#1877c9', accentColorDark: '#5cbcff', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      accentHoverColorLight: '#125fa5', accentHoverColorDark: '#3f9fe6', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      dangerColorLight: '#d94a4a', dangerColorDark: '#f27b7b', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      warnColorLight: '#c9922b', warnColorDark: '#eab45a', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeRailColorLight: '#8aa3b5', edgeRailColorDark: '#4f6a80', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeFlowColorLight: '#38b6f2', edgeFlowColorDark: '#66d6ff', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      alignGuideColorLight: '#6ba4c9', alignGuideColorDark: '#93cdf0', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectBoxColorLight: '#2a84cf', multiSelectBoxColorDark: '#66b9f2', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameOuterColorLight: '#6ba3cf', multiSelectFrameOuterColorDark: '#7dc0ee', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameInnerColorLight: '#93bfe0', multiSelectFrameInnerColorDark: '#9ed1f5', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      pathColor: '#2a86d0', bladeColor: '#f0c34d', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
    },
  },
  {
    id: 'violet',
    name: '罗兰',
    overrides: {
      accentColorLight: '#7a4fd8', accentColorDark: '#b195ff', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      accentHoverColorLight: '#6339bd', accentHoverColorDark: '#9a7cf0', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      dangerColorLight: '#d64a6a', dangerColorDark: '#f07b95', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      warnColorLight: '#c98a2f', warnColorDark: '#e7b565', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeRailColorLight: '#9c93b8', edgeRailColorDark: '#5f5679', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      edgeFlowColorLight: '#9a6bff', edgeFlowColorDark: '#b79bff', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      alignGuideColorLight: '#a189c9', alignGuideColorDark: '#c3adf0', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectBoxColorLight: '#8459dd', multiSelectBoxColorDark: '#a78bf4', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameOuterColorLight: '#a190d8', multiSelectFrameOuterColorDark: '#a996ef', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      multiSelectFrameInnerColorLight: '#bdaae5', multiSelectFrameInnerColorDark: '#c0aef7', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
      pathColor: '#8459dd', bladeColor: '#f0c34d', // 主题色白名单: 主题模板预设（存的是用户挑的色值，不是界面样式）
    },
  },
]

export function readLabState(): LabState {
  // 新存档：只含用户自建模板
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (raw && raw.version === 1 && Array.isArray(raw.themes)) {
      return {
        version: 1,
        themeId: raw.themeId === CUSTOM_THEME_ID || PRESET_THEME_IDS.includes(raw.themeId) || raw.themes.some((t: LabTheme) => t?.id === raw.themeId)
          ? raw.themeId
          : 'mist',
        mode: raw.mode === 'dark' ? 'dark' : 'light',
        themes: raw.themes.filter(isValidCustomTheme),
      }
    }
  } catch {
    /* 坏存档当作空 */
  }

  // 旧存档迁移：把当年误存进去的预设丢掉，只保留用户自建的那些。
  // 这样被改坏的「雾青」下一次打开就自动恢复成代码里的原样。
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null')
    const carried = Array.isArray(legacy?.themes) ? legacy.themes.filter(isValidCustomTheme) : []
    return {
      version: 1,
      themeId: carried.some((t: LabTheme) => t.id === legacy?.themeId) ? legacy.themeId : 'mist',
      mode: legacy?.mode === 'dark' ? 'dark' : 'light',
      themes: carried,
    }
  } catch {
    /* 迁移失败当作空 */
  }

  return { version: 1, themeId: 'mist', mode: 'light', themes: [] }
}

/** 存档里的一项是不是合法的"用户自建模板"（预设与脏数据一律丢掉）。 */
function isValidCustomTheme(item: unknown): item is LabTheme {
  if (!item || typeof item !== 'object') return false
  const theme = item as LabTheme
  if (typeof theme.id !== 'string' || typeof theme.name !== 'string') return false
  if (!theme.id || !theme.name.trim()) return false
  // 预设不进存档；自定义态也不是一个可保存的模板
  if (PRESET_THEME_IDS.includes(theme.id)) return false
  if (theme.id === CUSTOM_THEME_ID) return false
  if (!theme.overrides || typeof theme.overrides !== 'object') theme.overrides = {}
  return true
}

export function writeLabState(state: LabState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    return true
  } catch { return false }
}

export function cloneThemes(themes: LabTheme[]): LabTheme[] {
  return themes.map((theme) => ({ ...theme, overrides: { ...theme.overrides } }))
}

/** 代码里的预设模板（只读真源）。每次返回新对象，调用方改它也不会污染常量。 */
export function clonePresets(): LabTheme[] {
  return LAB_THEMES.map((theme) => ({ ...theme, overrides: { ...theme.overrides } }))
}
