/**
 * 卡片 / 分栏切换与面板细节（用户口径 2026-11-06）。
 *
 * 用户报的四件事逐条钉住：
 *   1. 切换要顺滑：两套视图常驻 DOM，只切显示，不再 v-if 拆装；
 *   2. 页签值必须跟视图一致：不能出现「界面在分栏、页签还亮着卡片」；
 *   3. 分栏右侧不能叠两条滚动条，选中项上方要有留白；
 *   4. 审核模式的「推荐 / 谨慎」跟在标题右侧，描述单独换行。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentComposer.vue'))
const CSS = ['part1.css', 'part2.css', 'part3.css', 'part4.css']
  .map((f) => readFileSync(path.resolve(HERE, '../ui/conversation/agent-composer', f), 'utf8'))
  .join('\n')
const MENUS = readFileSync(path.resolve(HERE, '../ui/conversation/useAgentMenus.ts'), 'utf8')

/** 取一条样式规则的正文 */
function ruleBody(source: string, selector: string): string {
  const at = source.indexOf(selector + ' {')
  expect(at, '找不到样式规则：' + selector).toBeGreaterThan(-1)
  return source.slice(at, source.indexOf('}', at))
}

describe('卡片 / 分栏切换', () => {
  it('两套视图常驻 DOM，靠 is-active 切显示', () => {
    const panes = SRC.match(/ac-view-pane/g) ?? []
    expect(panes.length).toBeGreaterThanOrEqual(4)
    expect(SRC).toMatch(/:class="\{ 'is-active': modelView === 'card' \}"/)
    expect(SRC).toMatch(/:class="\{ 'is-active': modelView === 'split' \}"/)
    expect(SRC).toMatch(/:class="\{ 'is-active': skillView === 'card' \}"/)
    expect(SRC).toMatch(/:class="\{ 'is-active': skillView === 'split' \}"/)
  })

  /** 隐藏的视图按内容高度参与布局时，外层滚动区会被一起撑高（真机表现就是右边叠两条滚动条） */
  it('每个视图都裁在自己的格子里，不让内容决定行高', () => {
    const body = ruleBody(CSS, '.ac-view-pane')
    expect(body).toMatch(/min-height:\s*0/)
    expect(body).toMatch(/max-height:\s*100%/)
    expect(body).toMatch(/overflow:\s*hidden/)
  })

  /** 页签只认两档；收到其它值不能回落成 card（那正是「页签与界面不一致」的来源） */
  it('切换函数只认 card / split，其它值保持原样', () => {
    const start = MENUS.indexOf('function setModelView')
    expect(start).toBeGreaterThan(-1)
    const block = MENUS.slice(start, MENUS.indexOf('\n}', start))
    expect(block).toContain("value === 'split'")
    expect(block).toContain("value === 'card'")
    expect(block).not.toContain("value === 'split' ? 'split' : 'card'")
  })
})

describe('分栏布局', () => {
  it('右侧结果区首行有上留白（选中底色不贴面板上沿）', () => {
    const at = CSS.indexOf('.ac-split-scroll .ac-model-row-list')
    expect(at).toBeGreaterThan(-1)
    const block = CSS.slice(at, CSS.indexOf('\n}', at))
    expect(block).toMatch(/padding-top:\s*[1-9]/)
  })

  /** 双滚动条的根因是隐藏视图把外层撑高，不是原生滚动条 —— 改法必须留在 .ac-view-pane 上 */
  it('双滚动条靠「视图不撑高外层」解决，不靠藏滚动条', () => {
    const body = ruleBody(CSS, '.ac-view-pane')
    expect(body).toMatch(/overflow:\s*hidden/)
    expect(CSS).not.toMatch(/::-webkit-scrollbar\s*\{/)
  })

  /**
   * 切换要对得起「顺滑」两个字（用户 2026-11-06 第二次反馈：切到分栏还有一点卡）。
   * 两套视图各渲染一整份模型列表，切换时浏览器不该重排这两大块：
   * 位移会推动整块内容、触发布局，已删除；改用 contain + 只动 opacity。
   */
  it('切换只做淡入，不用位移（位移会触发重排，也是多出滚动条的原因）', () => {
    const body = ruleBody(CSS, '.ac-view-pane')
    expect(body).toMatch(/transition:\s*opacity/)
    // 只检查真正的声明，注释里提到过 translateY（解释为什么去掉）不算
    expect(body).not.toMatch(/^\s*transform:/m)
    expect(body).not.toMatch(/transition:[^;]*transform/)
  })

  /**
   * 反向钉住：不要给视图加 contain。
   * contain: layout 会让这一格不参与父级尺寸协商，分栏左栏实测会塌成空白。
   */
  it('不给视图加 contain（会让分栏左栏塌掉）', () => {
    const body = ruleBody(CSS, '.ac-view-pane')
    expect(body).not.toMatch(/^\s*contain:/m)
  })
})

describe('ScrollArea 内容层的内边距', () => {
  /**
   * 用户 2026-11-06 截图：「没有 Y 轴 padding」。
   * 根因不是数值写错，而是这些 scroll-body 规则写在父组件的 scoped 样式里，
   * 而带这个 class 的元素由子组件 AgentScrollArea 内部渲染 —— 不带父组件的 scoped 标记，
   * 规则从来没命中过。必须用 :deep() 穿透，否则再改数值也不会生效。
   */
  it('所有内容层内边距都用 :deep 穿透到子组件', () => {
    for (const sel of [
      '.ac-split-scroll :deep(.ac-split-scroll-body)',
      '.ac-menu-scroll :deep(.ac-model-scroll-body)',
      '.ac-panel-scroll :deep(.ac-panel-scroll-body)',
      '.ac-rail-scroll :deep(.ac-rail-scroll-body)',
    ]) {
      expect(CSS, '缺少 :deep 规则：' + sel).toContain(sel)
    }
  })

  it('右侧结果区上下左右都有内边距（hover 底色不贴边、不压滚动条）', () => {
    // 有两条同名规则（高度链 / 内边距），取带 padding 的那条
    const at = CSS.lastIndexOf('.ac-split-scroll :deep(.ac-split-scroll-body)')
    const block = CSS.slice(at, CSS.indexOf('\n}', at))
    expect(block).toMatch(/padding:\s*6px 6px 10px 10px/)
  })
})

describe('模型行高度', () => {
  /**
   * 用户 2026-11-06 截图：两行文字挤在一条 32px 高的行里，上下完全没有留白。
   * 组件库 Button size="sm" 自带 h-8，必须让高度回到「由内容决定」。
   */
  it('行高跟着内容走，不被组件库固定成 32px', () => {
    const at = CSS.indexOf('.ac-model-row-list button,')
    const block = CSS.slice(at, CSS.indexOf('\n}', at))
    expect(block).toMatch(/height:\s*auto/)
  })
})

describe('审核模式选项', () => {
  it('标题与徽章同一行（徽章紧跟标题右侧，不换行）', () => {
    // 用行首锚定：part3 里还有一条 `.ac-review-item .ac-option-title` 的覆盖规则
    const body = ruleBody(CSS, '\n.ac-option-title')
    expect(body).toMatch(/flex-wrap:\s*nowrap/)
  })

  it('描述单独一行且允许换行', () => {
    const body = ruleBody(CSS, '.ac-option-desc')
    expect(body).toMatch(/display:\s*block/)
    expect(body).toMatch(/white-space:\s*normal/)
  })

  it('选项是上下两行，不是组件库默认的横向排布', () => {
    const body = ruleBody(CSS, '.ac-review-item')
    expect(body).toMatch(/flex-direction:\s*column/)
  })
})

describe('MCP 工具块', () => {
  it('每个工具左侧是单选框，可多选', () => {
    expect(SRC).toContain('class="ac-tool-radio"')
    expect(SRC).toContain('role="checkbox"')
    expect(SRC).toContain('toggleMcpTool(item.name, t.name)')
  })

  it('整块有外框，左侧带一条竖线', () => {
    // 外框在服务卡片容器上（工具区是它的内部展开区），工具列表左侧仍是竖线
    const item = ruleBody(CSS, '.ac-mcp-item')
    expect(item).toMatch(/border:\s*1px solid/)
    const list = ruleBody(CSS, '.ac-tool-list')
    expect(list).toMatch(/border-left:\s*1px solid/)
  })

  /** 用户 2026-11-06：卡片行上已经有「canvas / 11 工具」，工具区里不要再重复一遍标题。 */
  it('工具区里没有任何标题（服务名 / 工具数只在卡片行上出现一次）', () => {
    expect(SRC).not.toContain('ac-tools-title')
    expect(SRC).not.toContain('ac-mcp-tools-head')
    // 工具区里不再出现服务名（卡片行上那处是 .ac-server-name，保留）
    const tools = SRC.slice(SRC.indexOf('class="ac-mcp-tools"'), SRC.indexOf('class="ac-tool-list"'))
    expect(tools).not.toContain('{{ item.name }}')
  })

  /** 用户 2026-11-06：工具区必须落在服务卡片的边框内，不能另外再长出一个面板。 */
  it('工具区在服务卡片容器内部，共用同一圈外框', () => {
    const item = SRC.slice(SRC.indexOf('class="ac-mcp-item"'), SRC.indexOf('class="ac-tool-list"'))
    expect(item).toContain('class="ac-mcp-card"')
    expect(item).toContain('class="ac-mcp-tools"')
    // 工具区自己不再画边框（外框由 .ac-mcp-item 画）
    const tools = ruleBody(CSS, '.ac-mcp-tools')
    expect(tools).toMatch(/border:\s*0/)
  })
})

