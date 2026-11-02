/**
 * themePreview —— 主题工作台的「预览画布」契约。
 *
 * 为什么要有这层：主题页只应该收集颜色、提供一块画布；画布上出现什么（节点、连线、
 * 选框、参考线、刀光）由**各插件自己注册、自己画**。插件没装 → 没有它的图层，
 * 主题页不需要认识任何具体插件。
 *
 * 用法：
 * - 宿主（主题工作台）用 createThemePreviewScene 建场景，provideThemePreviewScene 下发；
 * - 插件在 apply 里 ctx.slots.register('theme-preview', { component, order })；
 * - 图层组件里 useThemePreviewScene() 拿坐标 / 模式 / settings 读取器。
 */
import { computed, inject, provide, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import { resolveThemeColorValue } from './themePalette'

/** 预览画布统一使用的槽名（插件往这里注册自己的图层组件）。 */
export const THEME_PREVIEW_SLOT = 'theme-preview'

/** 画布坐标（单位 px，原点在预览画布左上角）。 */
export interface ThemePreviewRect {
  x: number
  y: number
  w: number
  h: number
}

/** 预览画布默认提供的两个节点；所有插件都按这两个矩形定位自己的效果。 */
export interface ThemePreviewNode extends ThemePreviewRect {
  id: 'preview-a' | 'preview-b'
}

export type ThemePreviewMode = 'light' | 'dark'

/** 场景里读配置的最小接口（与 settings 同形，插件图层不必自己拿 ctx）。 */
export interface ThemePreviewSettings {
  get(key: string): unknown
}

export interface ThemePreviewScene {
  /** 当前预览的亮 / 暗模式 */
  mode: Readonly<Ref<ThemePreviewMode>>
  /** 两个默认节点（位置 / 尺寸由契约固定，插件只读） */
  nodes: readonly ThemePreviewNode[]
  /** 真实 settings 读取器；独立验收页 / 单测没有时是 null */
  settings: ThemePreviewSettings | null
  /** 配置版本号：settings 改动时 +1，让图层里的取色重新计算 */
  revision: Readonly<Ref<number>>
  /** 图层上报自己占用的矩形（用于「所有内容并集 + padding」自动取景） */
  registerBounds(id: string, rect: ThemePreviewRect): void
  unregisterBounds(id: string): void
  /** 所有已注册图层的并集；没有图层时是整块画板 */
  bounds: Readonly<Ref<ThemePreviewRect>>
}

/** 默认画板：640 × 400，两个节点 + 一条连线的基础排布。 */
export const THEME_PREVIEW_ARTBOARD: ThemePreviewRect = { x: 0, y: 0, w: 720, h: 400 }

export const THEME_PREVIEW_NODES: readonly ThemePreviewNode[] = Object.freeze([
  { id: 'preview-a', x: 60, y: 110, w: 230, h: 150 },
  { id: 'preview-b', x: 470, y: 110, w: 230, h: 160 },
])

export const THEME_PREVIEW_KEY: InjectionKey<ThemePreviewScene> = Symbol.for('mini-canvas-theme-preview')

function unionRect(list: ThemePreviewRect[]): ThemePreviewRect | null {
  if (list.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of list) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || r.w <= 0 || r.h <= 0) continue
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function createThemePreviewScene(options: {
  mode: Ref<ThemePreviewMode>
  settings?: ThemePreviewSettings | null
  nodes?: readonly ThemePreviewNode[]
  revision?: Ref<number>
}): ThemePreviewScene {
  const nodes = options.nodes ?? THEME_PREVIEW_NODES
  const registered = ref<Record<string, ThemePreviewRect>>({})
  const revision = options.revision ?? ref(0)

  const bounds = computed<ThemePreviewRect>(() => {
    void registered.value
    return unionRect(Object.values(registered.value)) ?? THEME_PREVIEW_ARTBOARD
  })

  return {
    mode: options.mode,
    nodes,
    settings: options.settings ?? null,
    revision,
    registerBounds(id: string, rect: ThemePreviewRect): void {
      registered.value = { ...registered.value, [id]: rect }
    },
    unregisterBounds(id: string): void {
      if (!(id in registered.value)) return
      const next = { ...registered.value }
      delete next[id]
      registered.value = next
    },
    bounds,
  }
}

export function provideThemePreviewScene(scene: ThemePreviewScene): void {
  provide(THEME_PREVIEW_KEY, scene)
}

const FALLBACK_MODE = ref<ThemePreviewMode>('light')
const FALLBACK_SCENE: ThemePreviewScene = createThemePreviewScene({ mode: FALLBACK_MODE })

/**
 * 图层组件读场景。没有宿主 provide 时给一份空场景（默认两个节点、无 settings），
 * 这样单测 / 独立渲染不会炸，只是不显示真实配置色。
 */
export function useThemePreviewScene(): ThemePreviewScene {
  return inject(THEME_PREVIEW_KEY, FALLBACK_SCENE)
}

/**
 * 读宿主色板 token（accentColor / edgeRailColor …）在当前预览模式下的颜色。
 * 场景没有 settings 时回落兜底值，保证独立页 / 单测也能画。
 */
export function useThemePreviewColor(tokenKey: string, fallback: string): ComputedRef<string> {
  const scene = useThemePreviewScene()
  return computed(() => {
    void scene.revision.value
    if (!scene.settings) return fallback
    return resolveThemeColorValue((key) => scene.settings?.get(key), tokenKey, scene.mode.value) || fallback
  })
}

/**
 * 读插件自己申报的两格制颜色（如 multiSelectFrameOuterColor / pathColor）。
 * 空串 / 缺失 = 跟随主题强调色（与各插件配置语义一致）。
 */
export function useThemePreviewPluginColor(baseKey: string, fallback: string): ComputedRef<string> {
  const scene = useThemePreviewScene()
  return computed(() => {
    void scene.revision.value
    const suffix = scene.mode.value === 'dark' ? 'Dark' : 'Light'
    const raw = scene.settings?.get(baseKey + suffix) ?? scene.settings?.get(baseKey)
    const value = typeof raw === 'string' ? raw.trim() : ''
    return value || fallback
  })
}
