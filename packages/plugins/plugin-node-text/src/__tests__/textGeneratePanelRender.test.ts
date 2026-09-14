/**
 * TextGeneratePanel 渲染契约（SSR 拿真实 HTML 断言）。
 *
 * 锁用户可见的三件事：
 * 1. 只有**单选**时才浮出 —— 多选时所有控制栏都收起（用户明确要求"多选的时候都不显示"）；
 * 2. 面板里有输入框 + 模型/参数/模板下拉 + 发送按钮，且下拉**不是原生 select**（用项目统一 Select）；
 * 3. 贴边距离来自配置（工具栏底部偏移），读不到回落 6px。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import type { ToolDef } from '@mini-canvas/kernel'
import TextGeneratePanel from '../TextGeneratePanel.vue'

const DEMO_TOOL: ToolDef = {
  name: 'text.generate:demo',
  title: '示例文本模型',
  group: '文本生成',
  produces: 'text',
  accepts: ['text'],
  params: [
    {
      key: 'thinking',
      label: '思考程度',
      type: 'select',
      default: 'medium',
      options: [
        { label: '低', value: 'low' },
        { label: '中', value: 'medium' },
      ],
    },
  ],
  templates: [{ id: 'ask', name: '提问模板', prompt: '请提问：' }],
  run: () => ({ ok: true, text: 'x' }),
}

/**
 * 最小渲染上下文：只桩出组件真正用到的几项。
 * selection **必须带 ids** —— 控制栏的显隐判定是"恰好选中一个且是我"，只看 has 是过去的 bug。
 */
function renderCtx(
  selectedIds: string[],
  tools: ToolDef[],
  settings?: { get(key: string): unknown },
): CanvasRenderContext {
  const selected = new Set(selectedIds)
  const services: Record<string, unknown> = {
    selection: { ids: selected, has: (id: string) => selected.has(id), onChange: () => () => {} },
    text: { editText: () => {}, duplicateTextNode: () => '', patchTextData: () => {} },
    graph: { removeNodes: () => 0, updateNode: () => {} },
    nodeStore: { getNode: () => undefined },
    ...(settings ? { settings: { ...settings, onChange: () => ({ dispose: () => {} }) } } : {}),
  }
  return {
    ctx: {
      get: (name: string) => services[name],
      tools: { list: () => tools, invoke: async () => ({ ok: false, error: '测试里不真调工具' }) },
    },
    viewport: { value: { zoom: 1 } },
    renderNodes: { value: [] },
    renderEdges: { value: [] },
  } as unknown as CanvasRenderContext
}

function render(
  selectedIds: string[],
  data: Record<string, unknown> = {},
  tools: ToolDef[] = [DEMO_TOOL],
  settings?: { get(key: string): unknown },
): Promise<string> {
  const app = createSSRApp({ render: () => h(TextGeneratePanel as Component, { id: 'n1', data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(selectedIds, tools, settings))
  return renderToString(app)
}

describe('文本生成控制栏的显隐', () => {
  it('未选中 → 不渲染', async () => {
    expect(await render([])).not.toContain('tg-root')
  })

  it('单选 → 渲染', async () => {
    expect(await render(['n1'])).toContain('tg-root')
  })

  it('多选 → 不渲染（用户要求：多选时上下控制栏都不显示）', async () => {
    const html = await render(['n1', 'n2'])
    expect(html).not.toContain('tg-root')
  })

  it('选中集里只有别人（不含我）→ 不渲染', async () => {
    expect(await render(['other'])).not.toContain('tg-root')
  })
})

describe('文本生成控制栏的内容', () => {
  it('输入框、模型/参数/模板下拉、发送按钮都在；下拉不是原生 select', async () => {
    const html = await render(['n1'])
    expect(html).toContain('tg-root')
    // 大输入框（富文本编辑器挂载点 + @ 引用说明）
    expect(html).toContain('prose-mirror-editor')
    // 输入区容器在（placeholder 文案由编辑器内部落地，SSR 里不出现原文，故按结构断言）
    expect(html).toContain('tg-editor')
    // 下拉走统一 Select（触发器类名），连原生 select 标签都不该出现
    expect(html).toContain('sel-trigger')
    expect(html).not.toContain('<select')
    // 字段数 = 模型 + 思考程度 + 模板
    expect(html.match(/class="tg-field"/g)?.length).toBe(3)
    // 主按钮
    expect(html).toContain('发送')
  })

  it('模型下拉显示当前工具标题（选项来自工具注册表）', async () => {
    expect(await render(['n1'])).toContain('示例文本模型')
  })

  it('没有可用工具 → 明确的空态文案，且发送按钮真的被禁用', async () => {
    const html = await render(['n1'], {}, [])
    expect(html).toContain('无可用工具')
    expect(html).toMatch(/class="tg-send[^"]*"[^>]*disabled/)
  })

  it('工具没声明模板 → 少一个下拉（模板下拉照声明长，不写死）', async () => {
    const noTpl: ToolDef = { ...DEMO_TOOL, templates: undefined }
    const html = await render(['n1'], {}, [noTpl])
    expect(html.match(/class="tg-field"/g)?.length).toBe(2)
  })

  it('保留字数/行数读数与复制、删除动作（原状态栏职责并进来）', async () => {
    const html = await render(['n1'], { text: 'ab\ncd' })
    expect(html).toContain('>4<') // 字符数（不含换行）
    expect(html).toContain('>2<') // 行数
    expect(html).toContain('aria-label="复制节点"')
    expect(html).toContain('aria-label="删除节点"')
  })
})

describe('贴边距离来自配置', () => {
  it('下控制栏偏移读到 24 就用 24', async () => {
    const html = await render(['n1'], {}, [DEMO_TOOL], {
      get: (k) => (k === 'toolbarBottomOffset' ? 24 : undefined),
    })
    expect(html).toContain('calc(100% + 24px)')
    expect(html).not.toContain('calc(100% + 6px)')
  })

  it('读不到回落 6px（不会产生坏 CSS）', async () => {
    expect(await render(['n1'])).toContain('calc(100% + 6px)')
  })
})
