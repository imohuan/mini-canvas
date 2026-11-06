/**
 * 预览页配置必须真的落到「生效的位置」。
 *
 * 用户口径：顶部改了一项，下面组件却纹丝不动 = 这个配置没用。
 * 实测踩到过两次：
 * 1. 预览页直接 import 组件，绕过了 `withComponentConfig`，改尺寸页面没反应；
 * 2. 圆角只写 `--radius`，而 Tailwind 的 `rounded-*` 在构建期就写死了，改变量无效。
 *
 * 这里守住「配置 → 生效路径」的接线，不测浏览器像素（那部分在 Chrome 里目验）。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  DEFAULT_COMPONENT_CONFIG,
  componentConfig,
  resetComponentConfig,
} from '../componentConfig'
import { applyThemePreview, type PreviewThemeConfig } from '../theme/useThemePreview'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.resolve(here, '..')

const baseConfig: PreviewThemeConfig = {
  baseColor: 'neutral',
  theme: 'neutral',
  font: 'inter',
  heading: 'inherit',
  radius: 'large',
  size: 'default',
  arrowVisible: false,
  gap: 8,
  offset: 0,
  subGap: 8,
}

/** 假 style 容器：只记 setProperty / removeProperty。 */
function fakeRoot() {
  const map = new Map<string, string>()
  return {
    el: {
      style: {
        setProperty: (name: string, value: string) => void map.set(name, value),
        removeProperty: (name: string) => void map.delete(name),
      },
    } as unknown as HTMLElement,
    map,
  }
}

beforeEach(() => resetComponentConfig())

describe('预览页配置落到生效位置', () => {
  it('行为类配置（尺寸 / 箭头 / 间距 / 偏移 / 二级菜单间距）写进 componentConfig', () => {
    applyThemePreview(
      { ...baseConfig, size: 'lg', arrowVisible: true, gap: 16, offset: 4, subGap: 20 },
      false,
    )
    expect(componentConfig.size).toBe('lg')
    expect(componentConfig.arrowVisible).toBe(true)
    expect(componentConfig.gap).toBe(16)
    expect(componentConfig.offset).toBe(4)
    expect(componentConfig.subGap).toBe(20)
  })

  it('样式类配置（颜色 / 字体 / 圆角）写成 CSS 变量', () => {
    const { el, map } = fakeRoot()
    applyThemePreview({ ...baseConfig, theme: 'violet', font: 'roboto' }, false, el)
    expect(map.get('--primary')).toBeTruthy()
    expect(map.get('--font-body')).toContain('Roboto')
    // 标题「跟随正文」写的是 var 引用，正文换了标题一起换
    expect(map.get('--font-heading-font')).toBe('var(--font-body)')
    // 新的圆角档位：large = 8px = 0.5rem（原来一档就到 14px，太大）
    expect(map.get('--radius')).toBe('0.5rem')
  })

  it('切暗色会换成暗色那一套变量，而不是继续写亮色', () => {
    const light = fakeRoot()
    const dark = fakeRoot()
    applyThemePreview(baseConfig, false, light.el)
    applyThemePreview(baseConfig, true, dark.el)
    expect(light.map.get('--background')).not.toBe(dark.map.get('--background'))
  })

  it('旧值会被摘掉：从「大圆角」切回默认档不会留下上一条 --radius', () => {
    const { el, map } = fakeRoot()
    applyThemePreview({ ...baseConfig, radius: 'large' }, false, el)
    expect(map.has('--radius')).toBe(true)
    applyThemePreview({ ...baseConfig, radius: 'default' }, false, el)
    // 新档位里 default 表示「中 6px」，不再是旧的 10px
    expect(map.get('--radius')).toBe('0.375rem')
  })
})

describe('预览页的接线（静态检查）', () => {
  it('预览卡片从 previewKit 取组件，而不是直接 import components/ui', () => {
    // 卡片墙搬进 ComponentShowcase 后（项目页「组件库」页复用同一份），入口 App.vue 只剩一行。
    const app = readFileSync(path.join(srcRoot, 'theme/ComponentShowcase.vue'), 'utf-8')
    // 直接 import '@/components/ui/...' 就绕过了 size 注入薄层
    expect(app).not.toMatch(/from '@\/components\/ui\//)
    expect(app).toMatch(/from '\.\.\/previewKit'/)
  })

  it('previewKit 对每个导出都套了 withComponentConfig', () => {
    const kit = readFileSync(path.join(srcRoot, 'previewKit.ts'), 'utf-8')
    expect(kit).toMatch(/withComponentConfig/)
    expect(kit).toMatch(/configure\(buttonModule, 'Button'\)/)
  })

  it('预览页的每个 .vue（含配置条 / 字体下拉 / 取色器）都不直接 import 组件', () => {
    /*
     * 用户口径 2026-11-04：改「控件尺寸」时，顶部配置条自己的按钮却不跟着变。
     * 原因就是这些文件直接 import 组件，绕过了注入 size 的薄层。
     * 这里把所有预览用到的 .vue 都扫一遍，防止再漏。
     */
    const files = [
      'App.vue',
      'theme/ThemeConfigBar.vue',
      'theme/FontSelect.vue',
      'components/color-picker/ColorPicker.vue',
      'components/color-picker/ColorPickerSelect.vue',
    ]
    for (const rel of files) {
      const source = readFileSync(path.join(srcRoot, rel), 'utf-8')
      expect(source, rel + ' 必须走 @/previewKit 或底层 reka-ui').not.toMatch(
        /from '@\/components\/(ui|color-picker)\//,
      )
    }
  })

  it('预览页不写死 size 档位（否则调用点会盖掉全局尺寸）', () => {
    for (const rel of ['App.vue', 'theme/ThemeConfigBar.vue', 'theme/FontSelect.vue']) {
      const source = readFileSync(path.join(srcRoot, rel), 'utf-8')
      // 允许 size="icon-sm" 这类图标按钮；只禁 sm / default / lg 三档
      expect(source, rel).not.toMatch(/size="(sm|default|lg)"/)
    }
  })

  it('预览样式直接读 --radius，不依赖构建期写死的 rounded-* 工具类', () => {
    const css = readFileSync(path.join(srcRoot, 'assets', 'index.css'), 'utf-8')
    expect(css).toMatch(/\[data-slot='button'\][\s\S]{0,400}border-radius:[^;]{0,40}var\(--radius/)
    expect(css).toMatch(/\[data-slot='card'\][\s\S]{0,300}border-radius:[^;]{0,40}var\(--radius/)
  })

  it('按钮 / 输入框 / 下拉用同一个倍率（否则同 size 下圆角不一样）', () => {
    const css = readFileSync(path.join(srcRoot, 'assets', 'index.css'), 'utf-8')
    const block = css.slice(css.indexOf("[data-slot='button'][data-variant]"), css.indexOf("[data-slot='card'],"))
    // 用户口径 2026-11-04：主按钮比其它按钮圆 —— 因为漏了 data-variant 就走了默认 2.6×
    const multipliers = [...block.matchAll(/\*\s*([\d.]+)\)/g)].map((m) => m[1])
    expect(multipliers.length).toBeGreaterThan(0)
    expect(new Set(multipliers).size, '控件倍率必须一致：' + multipliers.join('/')).toBe(1)
    expect(multipliers[0]).toBe('2.6')
  })

  it('圆角档位足够细，且标签里不再出现“默认”', async () => {
    const { RADIUS_OPTIONS } = await import('../theme/fonts')
    // 用户口径 2026-11-04：每一档都太圆，要求多分几档
    expect(RADIUS_OPTIONS.length).toBeGreaterThanOrEqual(5)
    for (const option of RADIUS_OPTIONS) {
      expect(option.label).not.toContain('默认')
    }
    // 第一档是无圆角；所有固定档不超过 12px（再大就都是「很圆」）
    expect(RADIUS_OPTIONS[0]!.value).toBe('0rem')
    const maxPx = Math.max(...RADIUS_OPTIONS.map((r) => Number.parseFloat(r.value) * 16))
    expect(maxPx).toBeLessThanOrEqual(12)
    // 用户口径 2026-11-04 二次反馈：全圆没有实际场景，已删除
    expect(RADIUS_OPTIONS.map((r) => r.id)).not.toContain('full')
    expect(RADIUS_OPTIONS.length).toBe(5)
  })

  it('浮层组件案例按组件名逐项列出（不是一张配色表）', () => {
    // 用户口径 2026-11-04：浮层不要挤在一个「案例盒」里，各自成卡片
    const select = readFileSync(path.join(srcRoot, 'theme/cards/SelectCard.vue'), 'utf-8')
    const floating = readFileSync(path.join(srcRoot, 'theme/cards/FloatingCard.vue'), 'utf-8')
    const feedback = readFileSync(path.join(srcRoot, 'theme/cards/FeedbackCard.vue'), 'utf-8')
    expect(select).toContain('DropdownMenu')
    for (const name of ['Popover', 'Tooltip', 'Dialog']) {
      expect(floating, name).toContain(name)
    }
    for (const name of ['Notify', 'Message']) {
      expect(feedback, name).toContain(name)
    }
    // 之前那个「浮层配色」面板已删除
    expect(() => readFileSync(path.join(srcRoot, 'theme/SurfaceColors.vue'))).toThrow()
  })

  it('Select 提供嵌入 / 分离 / 滚动 / 二级四种写法', () => {
    const showcase = readFileSync(path.join(srcRoot, 'theme/cards/SelectCard.vue'), 'utf-8')
    // 嵌入：显式 item-aligned；分离：显式 popper
    expect(showcase).toMatch(/position="item-aligned"/)
    expect(showcase).toMatch(/position="popper"/)
    expect(showcase).toMatch(/max-h-56/)
    expect(showcase).toMatch(/SelectGroup/)
  })

  it('「生成参数」卡片有前缀图标与多状态按钮；预览页不再放多行文本', () => {
    const app = readFileSync(path.join(srcRoot, 'theme/cards/GenerateCard.vue'), 'utf-8')
    // 1. 反向提示词带前缀图标（图标 + 左内边距）
    expect(app).toMatch(/BanIcon/)
    expect(app).toMatch(/class="pl-9"/)
    // 2. 加载 / 禁用 / 图标按钮都有
    expect(app).toMatch(/animate-spin/)
    expect(app).toMatch(/生成中/)
    expect(readFileSync(path.join(srcRoot, 'theme/cards/BasicsCard.vue'), 'utf-8')).toMatch(/size="icon-sm"/)
    // 3. 用户口径 2026-11-04：两张卡片里的多行文本都删掉（Textarea 自带 resize-none，拖不动）
    for (const card of ['GenerateCard.vue', 'BasicsCard.vue']) {
      expect(readFileSync(path.join(srcRoot, 'theme/cards', card), 'utf-8'), card).not.toContain('Textarea')
    }
  })

  it('Tabs 单独成卡，旧的「左右两栏」标题不再出现', () => {
    const app = readFileSync(path.join(srcRoot, 'theme/ComponentShowcase.vue'), 'utf-8')
    expect(app).not.toContain('其余组件')
    expect(app).not.toContain('覆盖范围')
    const tabs = readFileSync(path.join(srcRoot, 'theme/cards/TabsCard.vue'), 'utf-8')
    expect(tabs).toMatch(/<Tabs v-model="active"/)
  })

  it('卡片墙：三列各自堆叠，没有整宽横条卡片', () => {
    const app = readFileSync(path.join(srcRoot, 'theme/ComponentShowcase.vue'), 'utf-8')
    // 只看模板里的 class，注释里提到旧做法不算
    expect(app).not.toMatch(/class="[^"]*max-w-6xl/)
    // 用户口径：要 shadcn blocks 那种卡片墙 —— 多列 + 卡片各自高度
    expect(app).toMatch(/lg:grid-cols-3/)
    // 每列是一个竖向 flex 堆叠，卡片才不会被同行拉高
    expect(app).toMatch(/flex flex-col gap-4/)
    // 不允许再出现横跨整行的卡片
    expect(app).not.toMatch(/col-span-full/)
    for (const card of ['GenerateCard', 'BasicsCard', 'TabsCard', 'SelectCard', 'FloatingCard', 'FeedbackCard']) {
      expect(app, card).toContain(`<${card} />`)
    }
  })

  it('圆角预览按真实像素画弧（不是把 100 单位整体缩放）', () => {
    const svg = readFileSync(path.join(srcRoot, 'theme/RadiusPreview.vue'), 'utf-8')
    // viewBox 必须跟显示尺寸一致，否则 12px 的弧会缩成不到 1px
    expect(svg).toMatch(/:viewBox="'0 0 ' \+ box \+ ' ' \+ box"/)
    // 只看模板里的实际写法，注释里描述旧做法不算
    expect(svg).not.toMatch(/:viewBox="'0 0 100/)
  })

  it('默认配置没被预览页偷偷改掉', () => {
    expect(DEFAULT_COMPONENT_CONFIG.gap).toBe(8)
    expect(DEFAULT_COMPONENT_CONFIG.arrowVisible).toBe(false)
  })
})

/**
 * 「同一档位下，各类控件高度必须一致」。
 *
 * 用户口径 2026-11-04：按钮、输入框、下拉、页签排在一行时要齐平。
 * 之前各写各的（Button h-8/9/10、Input 写死 h-9、TabsList 写死 h-9、NumberField 写死 h-9），
 * 全局改尺寸时只有按钮变，其它原地不动。
 *
 * 这里做静态检查：每类控件的三档高度都来自同一张表，不允许再写死单档。
 */
describe('尺寸档位一致性', () => {
  const read = (rel: string) => readFileSync(path.join(srcRoot, rel), 'utf-8')

  it('Button 的三档高度是 8 / 9 / 10', () => {
    const src = read('components/ui/button/index.ts')
    expect(src).toMatch(/'sm':\s*'h-8/)
    expect(src).toMatch(/'default':\s*'h-9/)
    expect(src).toMatch(/'lg':\s*'h-10/)
  })

  it('数字输入框走 cva 变体，三档与 Button 对齐', () => {
    const src = read('components/ui/number-field/index.ts')
    expect(src).toMatch(/sm:\s*'h-8/)
    expect(src).toMatch(/default:\s*'h-9/)
    expect(src).toMatch(/lg:\s*'h-10/)
    // 子件必须真的用上变体，否则等于没接
    expect(read('components/ui/number-field/NumberFieldInput.vue')).toMatch(
      /numberFieldInputVariants\(\{ size: props\.size \}\)/,
    )
  })

  it('下拉触发器与页签列表也有 lg 档（不能只到 default）', () => {
    expect(read('components/ui/select/SelectTrigger.vue')).toMatch(/data-\[size=lg\]:h-10/)
    const tabs = read('components/ui/tabs/index.ts')
    expect(tabs).toMatch(/sm:\s*'group-data-horizontal\/tabs:h-8'/)
    expect(tabs).toMatch(/lg:\s*'group-data-horizontal\/tabs:h-10'/)
  })

  it('页签列表不再写死 group-data-horizontal/tabs:h-9', () => {
    const tabs = read('components/ui/tabs/index.ts')
    // 只允许在 size 变体里出现 default 档，基础串里不能有固定高度
    const base = tabs.slice(tabs.indexOf('cva('), tabs.indexOf('variants:'))
    expect(base).not.toMatch(/h-9/)
  })

  it('单选项用的是 Button（自身带 size 变体），不再写死 h-9', () => {
    const bar = read('theme/ThemeConfigBar.vue')
    const chip = bar.slice(bar.indexOf('const CHOICE_CHIP'), bar.indexOf('function chipClass'))
    expect(chip).not.toMatch(/\\bh-9\\b/)
  })
})
