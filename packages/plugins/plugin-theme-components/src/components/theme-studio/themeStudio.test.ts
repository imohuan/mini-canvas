/**
 * 颜色配方的契约守卫。
 *
 * 三条用户真正依赖的链路：
 * 1. 色签来自真实 settings 里已声明的 color 字段：插件装了就出现；
 * 2. 改单个颜色只写 settings，不改模板本体；与模板不一致时选择卡片显示「自定义」；
 * 3. 预览由一组同步 paint 函数组成：插件注册到 theme-preview 槽，页面按 order 执行。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SettingsStore } from '@plume-canvas/kernel'
import { defineThemePaletteSettings, THEME_PREVIEW_SLOT } from '@plume-canvas/canvas-render'
import { buildColorEntries, GROUP_ORDER, type DeclaredColorField } from './catalog'
import { CUSTOM_THEME_ID, LAB_THEMES, readLabState } from './storage'
import { matchesThemeValues, themeIdForValues } from './themeMatch'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STUDIO = [readFileSync(path.join(HERE, 'ThemeStudioView.vue'), 'utf8'), readFileSync(path.join(HERE, 'theme-studio.css'), 'utf8')].join('\n')

/** 测试用 settings：宿主色板 + 三个插件的颜色字段（与真实声明路径一致）。 */
function createTestSettings(): SettingsStore {
  const store = new SettingsStore()
  defineThemePaletteSettings(store)
  store.define(
    '外观/主题配色',
    {
      alignGuideColorLight: { type: 'color', default: '', optional: true, label: '参考线颜色' },
      multiSelectBoxColorLight: { type: 'color', default: '', optional: true, label: '绘制框颜色' },
      pathColor: { type: 'color', default: '', optional: true, label: '切割轨迹颜色' },
      bladeColor: { type: 'color', default: '', optional: true, label: '刀锋颜色' },
    },
    'test',
  )
  store.define(
    '外观/暗色主题配色',
    {
      alignGuideColorDark: { type: 'color', default: '', optional: true, label: '参考线颜色' },
      multiSelectBoxColorDark: { type: 'color', default: '', optional: true, label: '绘制框颜色' },
    },
    'test',
  )
  return store
}

function colorFields(store: SettingsStore): DeclaredColorField[] {
  const out: DeclaredColorField[] = []
  for (const group of store.groups()) {
    if (!group.startsWith('外观/')) continue
    for (const field of store.groupOf(group)) {
      if (field.schema.type === 'color') out.push(field as DeclaredColorField)
    }
  }
  return out
}

describe('颜色配方契约', () => {
  it('真实配置能合成所有分组色签', () => {
    const entries = buildColorEntries(
      colorFields(createTestSettings()),
      new Set(['theme-default', 'multi-select', 'align-guide', 'edge-cutting']),
    )
    expect(entries.length).toBeGreaterThan(8)
    expect(entries.map((entry) => entry.id)).toContain('accentColor')
    expect(entries.map((entry) => entry.id)).toContain('bladeColor')
    const groups = new Set(entries.map((entry) => entry.group))
    for (const group of GROUP_ORDER) {
      if (group === '其它') continue
      expect(groups.has(group), group).toBe(true)
    }
  })

  it('配色等于某套模板 → 选中那套；只要有一格不同 → 自定义', () => {
    const entries = buildColorEntries(
      colorFields(createTestSettings()),
      new Set(['theme-default', 'multi-select', 'align-guide', 'edge-cutting']),
    )
    const modes = ['light', 'dark'] as const

    // 按某一套模板展开成"每格的值"：声明过的用 overrides，其余回落字段默认值
    const valuesFor = (theme: (typeof LAB_THEMES)[number]) => {
      const values: Record<string, string> = {}
      for (const entry of entries) {
        for (const mode of modes) {
          const key = mode === 'light' ? entry.keys.light : entry.keys.dark
          values[key] = theme.overrides[key] ?? (mode === 'light' ? entry.defaults.light : entry.defaults.dark)
        }
      }
      return values
    }

    for (const theme of LAB_THEMES) {
      const values = valuesFor(theme)
      expect(matchesThemeValues(theme, entries, modes, values)).toBe(true)
      expect(themeIdForValues(LAB_THEMES, entries, modes, values)).toBe(theme.id)
    }

    // 挑一套模板后改一个颜色：不再匹配任何模板 → 自定义
    const clay = LAB_THEMES.find((theme) => theme.id === 'clay')!
    const clayValues = valuesFor(clay)
    const tweaked = { ...clayValues, accentColorLight: '#123456' }
    expect(matchesThemeValues(clay, entries, modes, tweaked)).toBe(false)
    expect(themeIdForValues(LAB_THEMES, entries, modes, tweaked)).toBe(CUSTOM_THEME_ID)
  })

  it('改单个颜色只写 settings，不改模板存档', () => {
    const store = createTestSettings()
    const before = JSON.stringify(LAB_THEMES)
    store.set('accentColorLight', '#8d00e5')
    expect(store.get('accentColorLight')).toBe('#8d00e5')
    expect(JSON.stringify(LAB_THEMES)).toBe(before)
  })

  it('内置模板是只读真源：存档里不会出现它们', () => {
    // 预设永远从代码取，写存档时被过滤掉
    expect(LAB_THEMES.map((t) => t.id)).toEqual([
      'mono-dark',
      'mist',
      'clay',
      'indigo',
      'mint',
      'crimson',
      'ocean',
      'violet',
    ])
    // 墨黑排在最前面：亮暗两态都用近黑/近白强调色
    expect(LAB_THEMES[0].name).toBe('墨黑')
    expect(LAB_THEMES[0].overrides.accentColorLight).toBe('#1f2430')
    expect(LAB_THEMES[0].overrides.accentColorDark).toBe('#e8ebf2')
    const mist = LAB_THEMES.find((t) => t.id === 'mist')!
    // 雾青必须是"全部回归默认"，不能被任何历史改动污染
    expect(mist.overrides).toEqual({})
    expect(LAB_THEMES.find((t) => t.id === 'clay')!.overrides.accentColorLight).toBe('#c45a3b')
    expect(LAB_THEMES.find((t) => t.id === 'indigo')!.overrides.accentColorLight).toBe('#5667d8')
    expect(LAB_THEMES.find((t) => t.id === 'mint')!.overrides.accentColorLight).toBe('#2f9e66')
    expect(LAB_THEMES.find((t) => t.id === 'crimson')!.overrides.accentColorLight).toBe('#cc3f57')
    expect(LAB_THEMES.find((t) => t.id === 'ocean')!.overrides.accentColorLight).toBe('#1877c9')
    expect(LAB_THEMES.find((t) => t.id === 'violet')!.overrides.accentColorLight).toBe('#7a4fd8')
  })

  it('旧存档里被改坏的预设会被丢弃，用户自建模板保留下来', () => {
    const legacy = {
      version: 1,
      themeId: 'mist',
      mode: 'light',
      themes: [
        // 被写坏的预设：迁移时必须丢掉，这样雾青自动恢复原样
        { id: 'mist', name: '雾青', overrides: { accentColorLight: '#000000' } },
        // 用户自建：保留
        { id: 'lab-1', name: '我的配色', overrides: { accentColorLight: '#123456' } },
      ],
    }
    // 测试环境没有 localStorage：装一个最小的内存版（storage.ts 只用 getItem/setItem）
    const mem = new Map<string, string>()
    const fake = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    }
    const original = (globalThis as { localStorage?: unknown }).localStorage
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true })
    try {
      mem.set('plume-canvas:plugin-theme-lab:v1', JSON.stringify(legacy))
      const state = readLabState()
      expect(state.themes.map((t) => t.id)).toEqual(['lab-1'])
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
  })

  it('删除按钮只出现在用户自建模板上', () => {
    expect(STUDIO).toContain('studio-template-remove')
    // 预设不渲染删除按钮
    expect(STUDIO).toMatch(/v-if="!isPresetTheme\(theme\)"/)
  })

  it('页面保留模板 → 色签条 → 画布 → 另存/复制这条结构', () => {
    expect(STUDIO).toContain('主题模板')
    expect(STUDIO).toContain('studio-swatches')
    expect(STUDIO).toContain('实时预览')
    expect(STUDIO).toContain('另存为模板')
    expect(STUDIO).toContain('复制 CSS')
    expect(STUDIO).toContain('@container (max-width: 700px)')
    expect(STUDIO).toContain('container-type: inline-size')
  })

  it('「自定义」卡片排在模板最前面，并且能被选中', () => {
    expect(STUDIO).toContain('studio-template-custom')
    expect(STUDIO).toContain('@click="selectCustom"')
    expect(STUDIO).toContain('自定义')
  })

  it('色签是方形小色块，且排在画板顶部一行', () => {
    expect(STUDIO).toMatch(/\.studio-token-picker \{[^}]*width: 22px[^}]*height: 22px/s)
    // 固定一行不放第二行：色块已经缩小到 22px，正常宽度都放得下
    expect(STUDIO).toMatch(/\.studio-swatches \{[^}]*flex-wrap: nowrap/s)
  })

  it('卡片内部有顶部内边距，内容不贴边', () => {
    // 顶 / 左右 / 底都要有留白；顶部要更宽，避免被设置外壳的标题栏盖住
    expect(STUDIO).toMatch(/\.studio-root \{[^}]*padding: 26px 14px 18px/s)
  })

  it('取景内容 = 节点 + 各层上报，不再实时量 DOM', () => {
    const source = readFileSync(path.join(HERE, 'preview.ts'), 'utf8')
    expect(source).toContain('claim')
    // 实时量 DOM 只能量到半个内容，既偏心又会越切越小
    expect(source).not.toContain('drawnRects')
  })

  it('取景交给纯函数，画板尺寸是常量（不会自我放大）', () => {
    const source = readFileSync(path.join(HERE, 'preview.ts'), 'utf8')
    expect(source).toContain('const ARTBOARD_W')
    expect(source).toContain('fitRectInView')
    expect(source).not.toContain('PREVIEW_PAD_TOP')
  })

  it('测量容器必须扣掉边框（否则四边各差 1px，看着就是不居中）', () => {
    const source = readFileSync(path.join(HERE, 'preview.ts'), 'utf8')
    expect(source).toContain('borderLeftWidth')
    expect(source).toContain('clientWidth')
  })

  it('默认主题自己注册一层绘制函数，其它插件各自注册自己的那层', async () => {
    const { Context } = await import('@plume-canvas/canvas-data')
    const ctx = new Context()
    const { registerThemePreview: registerTheme } = await import('../../themePreview')
    registerTheme(ctx as never)
    const occupants = ctx.slots.occupants(THEME_PREVIEW_SLOT)
    const ids = occupants.map((item) => item.id)
    expect(ids).toEqual(expect.arrayContaining(['theme-components/preview']))
    for (const occupant of occupants) {
      expect(typeof (occupant.component as { paint?: unknown }).paint).toBe('function')
    }
  })
})
