import type { AutoLayoutConfig, AutoLayoutConfigPatch } from './types'

export function mergeAutoLayoutConfig(
  base: AutoLayoutConfig,
  override: AutoLayoutConfigPatch = {},
): AutoLayoutConfig {
  return {
    ...base,
    ...override,
    intraSpacing: {
      ...base.intraSpacing,
      ...(override.intraSpacing || {}),
    },
    interSpacing: {
      ...base.interSpacing,
      ...(override.interSpacing || {}),
    },
  }
}
