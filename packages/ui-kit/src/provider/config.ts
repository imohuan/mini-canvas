import type { UiKitContext, UiKitDensity, UiKitSize, UiKitSizeToken } from '../shared/types'
import type { UiKitProviderProps } from './types'

export const DEFAULT_SIZES: Record<UiKitSize, UiKitSizeToken> = {
  sm: { height: 28, fontSize: 12, paddingX: 10, icon: 14 },
  md: { height: 34, fontSize: 13, paddingX: 12, icon: 16 },
  lg: { height: 42, fontSize: 14, paddingX: 16, icon: 18 },
}

const DENSITY_GAP: Record<UiKitDensity, number> = {
  compact: 4,
  comfortable: 6,
  spacious: 10,
}

const DENSITY_PAD: Record<UiKitDensity, number> = {
  compact: 8,
  comfortable: 12,
  spacious: 16,
}

/** 把 props 收成组件统一消费的上下文与 CSS 变量。 */
export function resolveConfig(props: UiKitProviderProps): UiKitContext {
  /**
   * 颜色 props 只用于**独立预览/组件展厅**覆盖节选颜色；Provider 自身不把它们写进 `:root`。
   *
   * 为什么：`UiKitProvider` 在画布里可能被嵌在别的主题面上（侧栏、Agent 面板、节点浮层），
   * 一写 `:root` 就会把整个应用的主色改掉。需要局部改色的场景由调用方在容器上覆盖 `--ui-*`，
   * 作用域更小、不会泄露到画布其它区域。
   */
  const overrides: Record<string, string> = {}
  const size = props.size ?? 'md'
  const density = props.density ?? 'comfortable'
  const radius = Number.isFinite(props.radius) ? Math.min(Math.max(props.radius ?? 8, 0), 32) : 8
  const sizes = { ...DEFAULT_SIZES }
  for (const key of ['sm', 'md', 'lg'] as const) {
    sizes[key] = { ...DEFAULT_SIZES[key], ...(props.sizes?.[key] ?? {}) }
  }
  const z = props.zIndexBase ?? 90000
  const cssVars: Record<string, string> = {
    ...overrides,
    '--mck-radius-control': radius + 'px',
    '--mck-radius-panel': Math.max(radius + 6, 12) + 'px',
    '--mck-gap': DENSITY_GAP[density] + 'px',
    '--mck-pad': DENSITY_PAD[density] + 'px',
    '--mck-size-sm': sizes.sm.height + 'px',
    '--mck-size-md': sizes.md.height + 'px',
    '--mck-size-lg': sizes.lg.height + 'px',
    '--mck-font-sm': sizes.sm.fontSize + 'px',
    '--mck-font-md': sizes.md.fontSize + 'px',
    '--mck-font-lg': sizes.lg.fontSize + 'px',
    '--mck-icon-sm': sizes.sm.icon + 'px',
    '--mck-icon-md': sizes.md.icon + 'px',
    '--mck-icon-lg': sizes.lg.icon + 'px',
    '--mck-pad-x-sm': sizes.sm.paddingX + 'px',
    '--mck-pad-x-md': sizes.md.paddingX + 'px',
    '--mck-pad-x-lg': sizes.lg.paddingX + 'px',
    /**
     * 浮层层级：四档都由 zIndexBase 派生。
     *
     * 为什么必须输出成变量：宿主常把组件库嵌进自己的层级体系（画布浮窗、侧栏、
     * Agent 面板各有 z-index），只给一个 `zIndexBase` prop 而样式写死数字 = 参数完全无效。
     * 浮层 CSS 一律 `z-index: var(--mck-z-xxx, <原来的数字>)`，脱离 Provider 单独用时行为不变。
     */
    '--mck-z-dropdown': String(z),
    '--mck-z-popover': String(z + 10),
    '--mck-z-modal': String(z + 100),
    '--mck-z-toast': String(z + 200),
  }
  return {
    size,
    density,
    radius,
    sizes,
    cssVars,
    zIndex: {
      dropdown: z,
      popover: z + 10,
      modal: z + 100,
      toast: z + 200,
    },
  }
}
