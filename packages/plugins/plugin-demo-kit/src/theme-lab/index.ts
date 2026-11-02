/** 主题工作台的装配入口（demo-kit 的展厅之一，不参与产品冷启动）。 */
export { default as ThemeLab } from './ThemeLab.vue'
export { default as ThemeLabSettingsPage } from './ThemeLabSettingsPage.vue'
export { default as ThemeLabNav } from './ThemeLabNav.vue'
export { Config as ThemeLabConfig, THEME_LAB_NAV_ID } from './config'
export {
  COLOR_META,
  GROUP_ORDER,
  PLUGIN_LABELS,
  OPTIONAL_PLUGINS,
  SCENE_META,
  buildColorEntries,
  baseKeyOf,
} from './catalog'
export type {
  DeclaredColorField,
  ThemeLabAnchor,
  ThemeLabColorEntry,
  ThemeLabColorMeta,
  ThemeLabGroup,
  ThemeLabMode,
  ThemeLabScene,
} from './catalog'
export { buildGuideLine, nearestEdgePoint, isVisibleTarget, intersectsViewport, isSvgPath, pointOnPath } from './guide'
export { replayScene, replayAlign, replayBoxSelect, replayCut, releaseHeld } from './replay'
