/**
 * textPanelSource 单测 —— 文本生成控制栏的纯逻辑（不挂浏览器）。
 *
 * 锁的是"节点不认识模型"这条架构：面板只按 produces/accepts 挑工具、按工具声明的 params 长下拉、
 * 按工具声明的 templates 填模板，加模型/加参数都不用改面板。
 */
import { describe, it, expect } from 'vitest'
import type { ToolDef } from '@mini-canvas/kernel'
import {
  buildToolInput,
  collectUpstreamMaterials,
  makeResourceResolver,
  paramDefs,
  paramOptions,
  paramValue,
  paramsForTool,
  pickDefaultTool,
  templateOptions,
  templatePrompt,
  toEditorResources,
  toolOptions,
  validateGenInput,
} from '../textPanelSource'

const TOOL: ToolDef = {
  name: 'text.generate:demo',
  title: '示例文本模型',
  group: '文本生成',
  produces: 'text',
  accepts: ['text', 'image'],
  params: [
    {
      key: 'thinking',
      label: '思考程度',
      type: 'select',
      default: 'medium',
      options: [
        { label: '低', value: 'low' },
        { label: '中', value: 'medium' },
        { label: '高', value: 'high' },
      ],
    },
  ],
  templates: [{ id: 'ask', name: '提问', prompt: '请针对下面的内容提出三个问题：' }],
  run: () => ({ ok: true, text: 'x' }),
}

describe('collectUpstreamMaterials（上游上下文）', () => {
  const edges = [{ source: 'a', target: 'me' }, { source: 'b', target: 'me' }, { source: 'c', target: 'other' }]
  const nodes: Record<string, { type: string; data: Record<string, unknown> }> = {
    a: { type: 'image', data: { imageUrl: 'img.png', label: '照片' } },
    b: { type: 'text', data: { text: '一段文字' } },
    c: { type: 'image', data: { imageUrl: 'x.png' } },
  }
  const getNode = (id: string) => nodes[id]

  it('只收连到本节点的上游；图片给 url、文本给 value', () => {
    const ms = collectUpstreamMaterials(edges, 'me', getNode)
    expect(ms.map((m) => m.kind)).toEqual(['image', 'text'])
    expect(ms[0]).toMatchObject({ url: 'img.png', name: '照片' })
    expect(ms[1]).toMatchObject({ value: '一段文字' })
  })

  it('连到别的节点的边不算（不是"把所有节点都收进来"）', () => {
    expect(collectUpstreamMaterials(edges, 'me', getNode).some((m) => m.id === 'c')).toBe(false)
  })

  it('没有 url 也没有文本的节点跳过（不占位）', () => {
    const ms = collectUpstreamMaterials([{ source: 'd', target: 'me' }], 'me', () => ({
      type: 'image',
      data: {},
    }))
    expect(ms).toEqual([])
  })

  it('同一条边只算一次（重复边不重复收）', () => {
    const dup = [{ source: 'a', target: 'me' }, { source: 'a', target: 'me' }]
    expect(collectUpstreamMaterials(dup, 'me', getNode).length).toBe(1)
  })

  it('文本节点内容为空也算素材（可以 @ 引用它）', () => {
    const ms = collectUpstreamMaterials([{ source: 'b', target: 'me' }], 'me', () => ({
      type: 'text',
      data: {},
    }))
    expect(ms[0]).toMatchObject({ kind: 'text', value: '' })
  })
})

describe('工具筛选与选项', () => {
  it('工具列表 → 下拉选项（显示标题、值是工具名）', () => {
    expect(toolOptions([TOOL])).toEqual([{ label: '示例文本模型', value: 'text.generate:demo' }])
  })

  it('默认选中第一个工具；没有工具给空串（面板据此显示空态）', () => {
    expect(pickDefaultTool([TOOL])).toBe('text.generate:demo')
    expect(pickDefaultTool([])).toBe('')
  })
})

describe('参数（声明式 → 下拉）', () => {
  it('参数定义直接来自工具声明（面板不认识"思考程度"是什么）', () => {
    expect(paramDefs(TOOL).map((p) => p.key)).toEqual(['thinking'])
    expect(paramDefs(undefined)).toEqual([])
  })

  it('参数候选值 → 下拉选项', () => {
    expect(paramOptions(paramDefs(TOOL)[0])).toEqual([
      { label: '低', value: 'low' },
      { label: '中', value: 'medium' },
      { label: '高', value: 'high' },
    ])
  })

  it('换工具时用新工具的默认值（上一个工具的遗留参数不带走）', () => {
    expect(paramsForTool(TOOL)).toEqual({ thinking: 'medium' })
    expect(paramsForTool({ ...TOOL, params: undefined })).toEqual({})
  })

  it('参数当前值转字符串供显示；缺省给空串', () => {
    expect(paramValue({ thinking: 'high' }, 'thinking')).toBe('high')
    expect(paramValue({}, 'thinking')).toBe('')
  })
})

describe('模板（声明式 → 模板下拉）', () => {
  it('工具自己声明的模板出现在下拉里', () => {
    expect(templateOptions(TOOL, [TOOL])).toEqual([{ label: '提问', value: 'ask' }])
  })

  it('选中模板能取到正文（面板据此填进输入框）', () => {
    expect(templatePrompt(TOOL, [TOOL], 'ask')).toBe('请针对下面的内容提出三个问题：')
    expect(templatePrompt(TOOL, [TOOL], '不存在')).toBe('')
  })
})

describe('组装调用输入', () => {
  it('提示词去空白，素材按工具 accepts 过滤后随行', () => {
    const input = buildToolInput('  写点什么  ', TOOL, [
      { id: 'a', kind: 'image', name: '图', url: 'i.png' },
      { id: 'b', kind: 'text', name: '文', value: 'abc' },
      { id: 'c', kind: 'video', name: '视频', url: 'v.mp4' }, // TOOL 不接受 video → 被过滤
    ], { thinking: 'high' })

    expect(input.prompt).toBe('写点什么')
    expect(input.resources?.map((r) => r.id)).toEqual(['a', 'b'])
    expect(input.resources?.[1]).toMatchObject({ kind: 'text', value: 'abc' })
    expect(input.params).toEqual({ thinking: 'high' })
  })

  it('工具没声明 accepts → 不挑食，素材全带上', () => {
    const anyTool: ToolDef = { ...TOOL, accepts: undefined }
    const input = buildToolInput('x', anyTool, [{ id: 'c', kind: 'video', name: 'v', url: 'v.mp4' }])
    expect(input.resources?.map((r) => r.id)).toEqual(['c'])
  })

  it('参数是副本（改动不会串到调用方那份）', () => {
    const params = { thinking: 'low' }
    const input = buildToolInput('x', TOOL, [], params)
    expect(input.params).toEqual({ thinking: 'low' })
    expect(input.params).not.toBe(params)
  })
})

describe('发送前的本地校验', () => {
  it('没工具 → 明确文案（不能点了一片空白）', () => {
    expect(validateGenInput('写了', undefined, 0)).toMatch(/没有可用的生成工具/)
  })

  it('既没提示词也没素材 → 拦下来，省一次外部调用', () => {
    expect(validateGenInput('   ', TOOL, 0)).toMatch(/请先写下你的要求/)
  })

  it('没提示词但有素材 → 放行（可以让模型直接处理素材）', () => {
    expect(validateGenInput('', TOOL, 1)).toBe('')
  })

  it('有提示词 → 放行', () => {
    expect(validateGenInput('写点什么', TOOL, 0)).toBe('')
  })
})

describe('编辑器资源（@ 引用）', () => {
  const materials = [
    { id: 'a', kind: 'image' as const, name: '照片', url: 'i.png' },
    { id: 'b', kind: 'text' as const, name: '笔记', value: 'abc' },
  ]

  it('图片带 url、文本带 value（编辑器据此渲染缩略图/图标）', () => {
    const items = toEditorResources(materials)
    expect(items[0]).toMatchObject({ url: 'i.png', mediaType: 'image' })
    expect(items[1]).toMatchObject({ value: 'abc' })
  })

  it('资源解析按 id 命中（编辑已有文档时把 @ 还原成真实资源）', () => {
    const items = toEditorResources(materials)
    const resolve = makeResourceResolver(items)
    expect(resolve('a')?.name).toBe('照片')
    expect(resolve('不存在')).toBeNull()
  })
})
