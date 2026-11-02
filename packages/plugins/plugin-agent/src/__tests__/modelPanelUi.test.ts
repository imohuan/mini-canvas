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

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '../components/AgentConversation.vue'), 'utf8')

/** 三个面板的容器：只截「面板本体」，避免把输入区其它下拉算进来 */
const panels = ['ac-model-panel', 'ac-skill-panel', 'ac-mcp-panel'].map((name) => {
  const start = SRC.indexOf(name)
  expect(start, '找不到面板 ' + name).toBeGreaterThan(-1)
  return SRC.slice(start, start + 9000)
})

describe('面板头部：视图切换用原生 Tabs', () => {
  it('模型 / 技能面板使用 Tabs + TabsList + TabsTrigger', () => {
    for (const panel of panels.slice(0, 2)) {
      expect(panel).toMatch(/<Tabs\b/)
      expect(panel).toMatch(/<TabsList\b/)
      expect(panel).toMatch(/<TabsTrigger[^>]*value="card"/)
      expect(panel).toMatch(/<TabsTrigger[^>]*value="split"/)
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
      expect(panel).toMatch(/<InputGroup class="ac-search-inline"/)
      expect(panel).toMatch(/<InputGroupAddon align="inline-start"[^>]*>[\s\S]{0,120}<Search/)
    }
  })

  it('搜索框不再自带高度 / 字号 / addon 内边距覆盖', () => {
    const block = SRC.slice(SRC.indexOf('.ac-search-inline {'), SRC.indexOf('\n}', SRC.indexOf('.ac-search-inline {')))
    expect(block).not.toContain('height')
    expect(block).not.toContain('border-radius')
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
    const block = SRC.slice(SRC.indexOf('.ac-check-mark {'), SRC.indexOf('\n}', SRC.indexOf('.ac-check-mark {')))
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
    expect(SRC).toMatch(/<Badge[^>]*variant="secondary"[^>]*class="ac-badge"/)
    const block = SRC.slice(SRC.indexOf('.ac-badge {'), SRC.indexOf('\n}', SRC.indexOf('.ac-badge {')))
    expect(block).not.toContain('border-radius')
    expect(block).not.toContain('height')
  })

  it('底栏不再固定 54px 高', () => {
    const foot = SRC.slice(SRC.indexOf('.ac-panel-foot {'), SRC.indexOf('\n}', SRC.indexOf('.ac-panel-foot {')))
    expect(foot).not.toContain('54px')
    expect(foot).toMatch(/min-height: 36px/)
  })

  it('头部一行 8px 上下内边距', () => {
    const head = SRC.slice(SRC.indexOf('.ac-panel-head {'), SRC.indexOf('\n}', SRC.indexOf('.ac-panel-head {')))
    expect(head).toMatch(/padding: 8px 10px/)
  })
})
