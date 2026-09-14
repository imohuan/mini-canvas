/**
 * panelSource —— 生成面板纯逻辑的行为契约。
 *
 * 这些是「用户在看画布时到底会发生什么」的规则：素材行显示哪些素材、模型下拉能选几个、
 * 参数默认值是什么、点发送时请求里装了什么。全部用普通数组/对象断言，不依赖浏览器。
 */
import { describe, it, expect } from 'vitest'
import type { ToolDef } from '@mini-canvas/kernel'
import {
  buildToolInput,
  collectUpstreamMaterials,
  makeResourceResolver,
  materialCards,
  paramDefs,
  paramValue,
  panelStatusText,
  paramsForTool,
  pickDefaultTool,
  toEditorResources,
  toolOptions,
  toolResourcesFor,
  type UpstreamMaterial,
} from '../panelSource'

/** 一个能出图的工具（声明了比例 + 分辨率两个参数，模拟真实模型） */
function imageTool(over: Partial<ToolDef> = {}): ToolDef {
  return {
    name: 'image.generate:demo',
    title: '示例出图',
    group: '图片生成',
    produces: 'image',
    accepts: ['image', 'text'],
    params: [
      {
        key: 'ratio',
        label: '比例',
        type: 'select',
        default: '1:1',
        options: [
          { label: '1:1', value: '1:1' },
          { label: '16:9', value: '16:9' },
        ],
      },
      {
        key: 'resolution',
        label: '分辨率',
        type: 'select',
        options: [
          { label: '1K', value: '1k' },
          { label: '2K', value: '2k' },
        ],
      },
    ],
    run: () => ({ ok: true, urls: ['out.png'] }),
    ...over,
  }
}

/** 造一个「节点 id → 节点」的查表 */
function nodeTable(nodes: Record<string, { type?: string; data?: Record<string, unknown> }>) {
  return (id: string) => nodes[id]
}

describe('collectUpstreamMaterials：谁连进来了', () => {
  it('只收连到本节点的上游，且图片/文本各按自己的字段取名', () => {
    const got = collectUpstreamMaterials(
      [
        { source: 'img1', target: 'me' },
        { source: 'txt1', target: 'me' },
        { source: 'other', target: 'someone-else' },
      ],
      'me',
      nodeTable({
        img1: { type: 'image', data: { imageUrl: 'data:image/png;base64,A', label: '猫' } },
        txt1: { type: 'text', data: { text: '一只在睡觉的猫', label: '描述' } },
        other: { type: 'image', data: { imageUrl: 'data:image/png;base64,X' } },
      }),
    )
    expect(got).toHaveLength(2)
    expect(got[0]).toEqual({ id: 'img1', kind: 'image', name: '猫', url: 'data:image/png;base64,A' })
    expect(got[1]).toEqual({ id: 'txt1', kind: 'text', name: '描述', value: '一只在睡觉的猫' })
  })

  it('没命名时回退：图片用文件名，文本用「文本」', () => {
    const got = collectUpstreamMaterials(
      [
        { source: 'img1', target: 'me' },
        { source: 'txt1', target: 'me' },
      ],
      'me',
      nodeTable({
        img1: { type: 'image', data: { imageUrl: 'data:image/png;base64,A', imageName: 'photo.png' } },
        txt1: { type: 'text', data: { text: 'hi' } },
      }),
    )
    expect(got[0].name).toBe('photo.png')
    expect(got[1].name).toBe('文本')
  })

  it('空图节点（有边但还没图）不算素材 —— 否则素材行会出现一张空卡片', () => {
    const got = collectUpstreamMaterials(
      [{ source: 'img1', target: 'me' }],
      'me',
      nodeTable({ img1: { type: 'image', data: { imageUrl: '' } } }),
    )
    expect(got).toEqual([])
  })

  it('同一上游连了多条边 → 只算一次（素材行不重复）', () => {
    const got = collectUpstreamMaterials(
      [
        { source: 'img1', target: 'me' },
        { source: 'img1', target: 'me' },
      ],
      'me',
      nodeTable({ img1: { type: 'image', data: { imageUrl: 'data:image/png;base64,A' } } }),
    )
    expect(got).toHaveLength(1)
  })

  it('上游节点已不存在（边还挂着）→ 跳过，不抛', () => {
    const got = collectUpstreamMaterials([{ source: 'ghost', target: 'me' }], 'me', () => undefined)
    expect(got).toEqual([])
  })
})

describe('模型下拉与参数默认值', () => {
  it('工具列表 → 下拉选项（有 title 用 title，否则用 name）', () => {
    const opts = toolOptions([imageTool(), imageTool({ name: 'image.generate:plain', title: undefined })])
    expect(opts).toEqual([
      { label: '示例出图', value: 'image.generate:demo' },
      { label: 'image.generate:plain', value: 'image.generate:plain' },
    ])
  })

  it('默认选中第一个工具；没有工具时是空串（面板据此显示空态）', () => {
    expect(pickDefaultTool([imageTool(), imageTool({ name: 'b' })])).toBe('image.generate:demo')
    expect(pickDefaultTool([])).toBe('')
  })

  it('参数默认值来自工具声明：有 default 用 default，没有的取第一个选项', () => {
    const params = paramsForTool(imageTool())
    expect(params).toEqual({ ratio: '1:1', resolution: '1k' })
  })

  it('换模型时上一个模型的遗留参数不带过来（下拉不会显示别的模型的参数）', () => {
    const other = imageTool({
      name: 'image.generate:other',
      params: [{ key: 'style', type: 'select', default: '写实', options: [{ label: '写实', value: '写实' }] }],
    })
    expect(paramsForTool(other, { ratio: '16:9' })).toEqual({ style: '写实' })
  })

  it('参数不声明就一个下拉都不渲染', () => {
    expect(paramDefs(imageTool({ params: undefined }))).toEqual([])
    expect(paramDefs(undefined)).toEqual([])
  })

  it('下拉当前值统一转成字符串（数字型参数也能显示）', () => {
    expect(paramValue({ n: 2 }, 'n')).toBe('2')
    expect(paramValue({}, 'n')).toBe('')
  })
})

describe('点发送时装进请求的东西', () => {
  const materials: UpstreamMaterial[] = [
    { id: 'img1', kind: 'image', name: '猫', url: 'data:image/png;base64,A' },
    { id: 'txt1', kind: 'text', name: '描述', value: '睡觉的猫' },
    { id: 'vid1', kind: 'video', name: '片子', url: 'blob:video' },
  ]

  it('工具声明只吃 image+text → 视频不进请求（避免后端收到不支持的素材）', () => {
    const res = toolResourcesFor(imageTool(), materials)
    expect(res.map((r) => r.id)).toEqual(['img1', 'txt1'])
    expect(res[0]).toEqual({ id: 'img1', kind: 'image', name: '猫', url: 'data:image/png;base64,A' })
    expect(res[1]).toEqual({ id: 'txt1', kind: 'text', name: '描述', value: '睡觉的猫' })
  })

  it('工具没声明 accepts（不挑食）→ 素材全带上', () => {
    const res = toolResourcesFor(imageTool({ accepts: undefined }), materials)
    expect(res.map((r) => r.id)).toEqual(['img1', 'txt1', 'vid1'])
  })

  it('prompt 去掉首尾空白；参数原样带上', () => {
    const input = buildToolInput('  画一只猫  ', imageTool(), materials, { ratio: '16:9', resolution: '2k' })
    expect(input.prompt).toBe('画一只猫')
    expect(input.params).toEqual({ ratio: '16:9', resolution: '2k' })
    expect(input.resources?.map((r) => r.id)).toEqual(['img1', 'txt1'])
  })

  it('只写空格等于没写（后端正则会拒空提示词）', () => {
    expect(buildToolInput('   ', imageTool(), materials).prompt).toBe('')
  })
})

describe('素材行与 @ 引用', () => {
  const materials: UpstreamMaterial[] = [
    { id: 'img1', kind: 'image', name: '猫', url: 'data:image/png;base64,A' },
    { id: 'txt1', kind: 'text', name: '描述', value: '睡觉的猫' },
  ]

  it('素材行：图片带 url（画缩略图），文本标记 isText（画图标）', () => {
    expect(materialCards(materials)).toEqual([
      { id: 'img1', kind: 'image', name: '猫', url: 'data:image/png;base64,A', value: undefined, isText: false },
      { id: 'txt1', kind: 'text', name: '描述', url: undefined, value: '睡觉的猫', isText: true },
    ])
  })

  it('@ 引用候选：图片给 url + mediaType=image，文本给 value', () => {
    const items = toEditorResources(materials)
    expect(items[0].id).toBe('img1')
    expect(items[0].url).toBe('data:image/png;base64,A')
    expect(items[0].mediaType).toBe('image')
    expect(items[1].value).toBe('睡觉的猫')
    expect(items[1].category).toBe('素材')
  })

  it('@ 引用回查：按节点 id 找回素材，找不到返回 null', () => {
    const resolve = makeResourceResolver(toEditorResources(materials))
    expect(resolve('txt1')?.name).toBe('描述')
    expect(resolve('nope')).toBeNull()
  })
})

describe('面板状态文案', () => {
  it('生成中显示阶段文案与百分比', () => {
    expect(panelStatusText({ running: true, message: '正在出图', progress: 42.4, toolCount: 1 }))
      .toEqual({ tone: 'running', text: '正在出图 42%' })
  })

  it('外部只给阶段不给百分比 → 只显示文案（不显示 0%）', () => {
    expect(panelStatusText({ running: true, message: '排队中', toolCount: 1 }))
      .toEqual({ tone: 'running', text: '排队中' })
  })

  it('没有工具时给出明确空态（不是空白，也不是点了没反应）', () => {
    const s = panelStatusText({ running: false, toolCount: 0 })
    expect(s.tone).toBe('idle')
    expect(s.text).toContain('没有可用的生成工具')
  })

  it('失败优先于一切（失败时不该还显示「生成中」）', () => {
    expect(panelStatusText({ running: true, error: '额度不足', toolCount: 1 }))
      .toEqual({ tone: 'error', text: '额度不足' })
  })

  it('就绪时不占地方', () => {
    expect(panelStatusText({ running: false, toolCount: 2 }).text).toBe('')
  })
})

