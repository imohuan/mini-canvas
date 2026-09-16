export { alignGuidePlugin, name, apply, Config } from './alignGuidePlugin'
export type { AlignGuideConfig } from './alignGuideConfig'
export { alignGuideConfigFrom } from './alignGuideConfig'
export { bindAlignGuideToggle } from './alignGuideToggle'
export {
  computeAlignGuides,
  shouldAlignOnDrag,
  SNAP_THRESHOLD,
  type AlignRect,
  type AlignResult,
  type GuideLine,
} from './alignGuideEngine'
