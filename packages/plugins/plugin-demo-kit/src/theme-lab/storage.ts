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
  themes: LabTheme[]
}

const KEY = 'mini-canvas:plugin-theme-lab:v1'

export const LAB_THEMES: LabTheme[] = [
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
]

export function readLabState(): LabState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (raw && raw.version === 1 && Array.isArray(raw.themes)) {
      return { ...raw, themes: raw.themes.filter((item: LabTheme) => item && item.id && typeof item.name === 'string') }
    }
  } catch { /* 坏存档当作空 */ }
  return { version: 1, themeId: 'mist', mode: 'dark', themes: LAB_THEMES.map((theme) => ({ ...theme, overrides: { ...theme.overrides } })) }
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
