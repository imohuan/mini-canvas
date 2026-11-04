/**
 * 组件配置：组件库唯一的“全局默认值入口”。
 *
 * 分两类，走两条路：
 * - **样式类**（颜色 / 圆角 / 字体）：改 CSS 变量，组件一行不用改，天然实时。
 * - **行为类**（size / 箭头 / 偏移）：CSS 做不到，必须让组件拿到值。
 *   size 这类**组件本来就声明了 prop 的**，由注册薄层（withComponentConfig）注入默认值，
 *   组件内部完全不用改；箭头 / 偏移由组件读这份配置（它们不是 prop）。
 *
 * 为什么用 reactive：主题设置改一次，所有读取方（薄层 + 组件内的 computed）当场更新，
 * 不需要刷新页面，也不需要重新挂载。
 */
import { reactive } from 'vue'

/** 组件 size 词表：与 shadcn 各组件自己的 size 取值一致。 */
export const COMPONENT_SIZE_CHOICES = ['sm', 'default', 'lg'] as const
export type ComponentSize = (typeof COMPONENT_SIZE_CHOICES)[number]

export interface ComponentConfig {
  /** 带 size prop 的组件的默认档；调用点显式传 size 时仍以调用点为准 */
  size: ComponentSize
  /** 是否画浮层箭头 */
  arrowVisible: boolean
  /** 浮层与触发器的可见间距（px） */
  gap: number
  /**
   * 额外外推量（px）：**累加**到 gap 上，不是覆盖。
   *
   * 为什么需要它：触发器外面常常还有容器（带 padding / 边框）。gap 设 0 时箭头会贴着触发器，
   * 于是整块浮层缩进容器里、被遮住一半。给一个正的外推量，就能让箭头停在容器外侧。
   */
  offset: number
  /** 子菜单与父菜单的可见间距（px） */
  subGap: number
}

export const DEFAULT_COMPONENT_CONFIG: Readonly<ComponentConfig> = Object.freeze({
  size: 'default',
  arrowVisible: false,
  gap: 8,
  offset: 0,
  subGap: 8,
})

/** 当前生效的组件配置（响应式：改一次，全部读取方立刻跟上） */
export const componentConfig = reactive<ComponentConfig>({ ...DEFAULT_COMPONENT_CONFIG })

/** 外壳 / 主题把设置值写进来；只接受合法值，不认识的一律保留旧值。 */
export function setComponentConfig(patch: Partial<ComponentConfig>): void {
  if (patch.size !== undefined) {
    if (COMPONENT_SIZE_CHOICES.includes(patch.size)) componentConfig.size = patch.size
  }
  if (typeof patch.arrowVisible === 'boolean') componentConfig.arrowVisible = patch.arrowVisible
  for (const key of ['gap', 'offset', 'subGap'] as const) {
    const v = patch[key]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) componentConfig[key] = v
  }
}

/** 恢复默认（主题卸载时用，避免幽灵配置挡住下一个主题） */
export function resetComponentConfig(): void {
  Object.assign(componentConfig, DEFAULT_COMPONENT_CONFIG)
}

/** 浮层最终与触发器的距离：gap + offset（累加） */
export function popupTotalGap(): number {
  return componentConfig.gap + componentConfig.offset
}
