/**
 * 模型 / 技能 / MCP 面板的 UI 契约（用户口径 2026-11-02）：
 *
 * 截图里三处不对：搜索框被藏成一个放大镜按钮、右上角是自绘分段、
 * 选中项是一颗青色实心圆 ✅，头尾还各留一大块空白。
 * 这里钉住「用 shadcn 原生件」这条线，避免以后又被自绘样式替换掉。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 三个面板的容器：只截「面板本体」，避免把输入区其它下拉算进来 */
const SRC = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentComposer.vue'))
/** 模型面板已抽成 ModelPicker（用户 2026-11-07：Agent 与底栏共用同一件） */
const MODEL = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/ModelPicker.vue'))
const MSG = readFileSync(path.resolve(HERE, '../ui/conversation/AgentMessageList.vue'), 'utf8')
const panels = [
  { src: MODEL, name: 'ac-model-panel' },
  { src: SRC, name: 'ac-skill-panel' },
  { src: SRC, name: 'ac-mcp-panel' },
].map(({ src, name }) => {
  const start = src.indexOf(name)
  expect(start, '找不到面板 ' + name).toBeGreaterThan(-1)
  return src.slice(start, start + 9000)
})

describe('面板头部：视图切换用自定义页签（2026-11-07 弃用 shadcn Tabs）', () => {
  /**
   * 用户 2026-11-07：reka Tabs 的选中态是组件内部状态，与 view 高亮/内容
   * 长期不同步（连续反馈 5+ 次）。改为自定义按钮，高亮直接绑 view，
   * 不允许再引回 Tabs 组件。
   */
  it('模型 / 技能面板使用 ac-view-tab 自定义页签，高亮绑 view', () => {
    for (const panel of panels.slice(0, 2)) {
      expect(panel).toContain('class="ac-view-tabs"')
      expect(panel).toMatch(/is-active.: (view|skillView) === 'card'/)
      expect(panel).toMatch(/is-active.: (view|skillView) === 'split'/)
      // 不允许再引回 shadcn Tabs
      expect(panel).not.toMatch(/<Tabs\b/)
      expect(panel).not.toMatch(/<TabsTrigger/)
    }
  })

  it('自绘分段与指示条已删除', () => {
    expect(SRC).not.toContain('ac-segment')
    expect(SRC).not.toContain('ICON_VIEW_GRID')
    expect(SRC).not.toContain('ICON_VIEW_SPLIT')
  })
})

describe('搜索框：常显的 shadcn InputGroup + 前置图标', () => {
  it('三个面板都直接渲染 InputGroup（不再折叠成按钮）', () => {
    for (const panel of panels) {
      // 用户口径 2026-11-05：shadcn 组件用默认样式，不再挂自定义 class。
      expect(panel).toMatch(/<InputGroup>/)
      expect(panel).toMatch(/<InputGroupAddon align="inline-start"[^>]*>[\s\S]{0,120}<Search/)
    }
  })

  it('搜索框完全用组件库默认样式（不再有尺寸覆盖）', () => {
    expect(SRC).not.toContain('.ac-search-inline')
    expect(SRC).not.toContain('.ac-search-addon')
    expect(SRC).not.toContain('.ac-search-input')
  })

  it('搜索开关的状态与图标按钮已经移除', () => {
    expect(SRC).not.toContain('modelSearchOpen')
    expect(SRC).not.toContain('skillSearchOpen')
    expect(SRC).not.toContain('mcpSearchOpen')
    expect(SRC).not.toContain('togglePanelSearch')
    expect(SRC).not.toContain('ac-search-toggle')
  })

  it('搜索框不再被容器查询隐藏', () => {
    expect(SRC).not.toContain('is-search-open')
    expect(SRC).not.toMatch(/@container[^{]*\{[^}]*\.ac-panel-search[^}]*display:\s*none/)
  })
})

describe('选中勾：普通 Check，不是青色实心圆', () => {
  it('没有实心底色与圆形半径', () => {
    const base = SRC.indexOf('.ac-check-mark {\n  display: grid')
    const block = SRC.slice(base, SRC.indexOf('\n}', base))
    expect(block).not.toContain('background')
    expect(block).not.toContain('border-radius')
    expect(block).toContain('opacity: 0')
  })

  it('图标尺寸为 16（shadcn 菜单勾的常规尺寸）', () => {
    expect(SRC).toMatch(/\.ac-check-mark \{[^}]*width: 16px[^}]*height: 16px/)
  })
})

describe('头尾间距', () => {
  it('默认 / 精选标签用组件库 Badge，不再自绘胶囊', () => {
    expect(SRC).toMatch(/<Badge[^>]*variant="secondary"/)
    // 不挂自定义 class，也不再有自己的尺寸规则。
    expect(SRC).not.toContain('ac-badge')
  })

  it('底栏不再固定 54px 高', () => {
    const foot = SRC.slice(SRC.indexOf('.ac-panel-foot {'), SRC.indexOf('\n}', SRC.indexOf('.ac-panel-foot {')))
    expect(foot).not.toContain('54px')
    expect(foot).toMatch(/min-height: 36px/)
  })

  it('头部与列表共用 12px 横向留白（左对齐同一条竖线）', () => {
    const head = SRC.slice(SRC.indexOf('.ac-panel-head {'), SRC.indexOf('\n}', SRC.indexOf('.ac-panel-head {')))
    expect(head).toMatch(/padding: 12px 12px 10px/)
  })
})
