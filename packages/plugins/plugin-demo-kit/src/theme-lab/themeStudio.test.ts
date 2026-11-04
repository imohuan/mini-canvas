/**
 * ThemeStudio 的契约守卫。
 *
 * 这里不渲染 Vue 组件（取色器依赖浏览器 API，Node 环境会等不到 DOM），
 * 只锁用户真正依赖的三条链路：
 * 1. 颜色目录来自真实 settings：插件装了就有、卸了就没有；
 * 2. 独立验收页与设置页共用同一条 settings 适配，颜色写回同一个 key；
 * 3. 预览不再由工作台画：插件各自注册到 theme-preview 槽；页面只留 SlotHost + 取景。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildColorEntries, GROUP_ORDER, type DeclaredColorField } from './catalog'
import { createStudioPreviewSource } from './themeStudioPreview'
import { THEME_PREVIEW_SLOT } from '@mini-canvas/canvas-render'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// 样式外置后，模板与样式分居两个文件：断言仍按「页面整体」读，语义不变。
const STUDIO = [
  readFileSync(path.join(HERE, 'theme-studio-panel/ThemeStudioView.vue'), 'utf8'),
  readFileSync(path.join(HERE, 'theme-studio-panel/theme-studio.css'), 'utf8'),
].join('\n')

function colorFields(): DeclaredColorField[] {
  const { store } = createStudioPreviewSource()
  const out: DeclaredColorField[] = []
  for (const group of store.groups()) {
    if (!group.startsWith('外观/')) continue
    for (const field of store.groupOf(group)) {
      if (field.schema.type === 'color') out.push(field)
    }
  }
  return out
}

describe('主题工作台契约', () => {
  it('真实配置能合成所有分组色签', () => {
    const entries = buildColorEntries(colorFields(), new Set(['theme-default', 'multi-select', 'align-guide', 'edge-cutting']))
    expect(entries.length).toBeGreaterThan(8)
    expect(entries.map((entry) => entry.id)).toContain('accentColor')
    expect(entries.map((entry) => entry.id)).toContain('bladeColor')
    const groups = new Set(entries.map((entry) => entry.group))
    for (const group of GROUP_ORDER) {
      if (group === '其它') continue
      expect(groups.has(group), group).toBe(true)
    }
  })

  it('插件没装时它的颜色不凭空出现', () => {
    const onlyHost = colorFields().filter((field) => !field.key.startsWith('multiSelect') && field.key !== 'alignGuideColorLight' && field.key !== 'alignGuideColorDark' && field.key !== 'pathColor' && field.key !== 'bladeColor')
    const entries = buildColorEntries(onlyHost, new Set(['theme-default']))
    expect(entries.some((entry) => entry.group === '切割')).toBe(false)
    expect(entries.some((entry) => entry.id === 'accentColor')).toBe(true)
  })

  it('独立验收页写回真实 settings 的同一个 key', () => {
    const { store, source } = createStudioPreviewSource()
    const before = store.get('accentColorLight')
    source.set('accentColorLight', '#8d00e5')
    expect(store.get('accentColorLight')).toBe('#8d00e5')
    expect(store.get('accentColorLight')).not.toBe(before)
    // 亮暗两格互不影响
    expect(store.get('accentColorDark')).toBeTruthy()
  })

  it('页面保留模板 → 色签 → 完整画布 → 另存/复制这条结构', () => {
    expect(STUDIO).toContain('主题模板')
    expect(STUDIO).toContain('全部颜色')
    expect(STUDIO).toContain('实时预览')
    expect(STUDIO).toContain('另存为模板')
    expect(STUDIO).toContain('复制 CSS')
    // 窄窗口：预览提前且单列
    expect(STUDIO).toContain('@container (max-width: 700px)')
    expect(STUDIO).toContain('container-type: inline-size')
  })

  it('预览由插件图层组成，工作台不再画死节点 / 连线 / 刀光', () => {
    // 读插件注册结果：主题页只认槽名，不认识具体插件
    expect(STUDIO).toContain('SlotHost')
    expect(STUDIO).toContain('THEME_PREVIEW_SLOT')
    expect(STUDIO).not.toContain('studio-wire-base')
    expect(STUDIO).not.toContain('studio-node-a')
    expect(STUDIO).not.toContain('studio-blade')
    expect(STUDIO).not.toContain('studio-state')
  })

  it('色块是 40px 正方形，不是拉长的色带', () => {
    expect(STUDIO).toMatch(/\.studio-token-picker \{[^}]*width: 40px[^}]*height: 40px/s)
    expect(STUDIO).toMatch(/\.studio-token-picker :deep\(\.cf-trigger\) \{[^}]*width: 40px[^}]*height: 40px/s)
  })

  it('四个已装插件都注册自己的预览层，主题页不认识具体插件', async () => {
    const { Context } = await import('@mini-canvas/canvas-data')
    const ctx = new Context()
    const { registerThemePreview: registerTheme } = await import('@mini-canvas/plugin-theme-components')
    const { registerThemePreview: registerMulti } = await import('@mini-canvas/plugin-multi-select')
    const { registerThemePreview: registerGuide } = await import('@mini-canvas/plugin-align-guide')
    const { registerThemePreview: registerCut } = await import('@mini-canvas/plugin-edge-cutting')
    registerTheme(ctx as never)
    registerMulti(ctx as never)
    registerGuide(ctx as never)
    registerCut(ctx as never)
    const ids = ctx.slots.occupants(THEME_PREVIEW_SLOT).map((item) => item.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'theme-components/preview',
        'multi-select/preview-frame',
        'align-guide/preview',
        'edge-cutting/preview',
      ]),
    )
  })
})
