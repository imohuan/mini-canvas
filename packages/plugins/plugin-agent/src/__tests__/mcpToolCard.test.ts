/**
 * MCP 工具详情卡：参数摊平、标签认工具、定位翻边。
 *
 * 这三个都是纯函数：卡片本身是浮层，真机验证在 Chrome 里做，这里锁住
 * 「数据整理对不对」「屏幕边缘会不会露出去」。
 */
import { describe, it, expect } from 'vitest'
import {
  mcpToolFullNameOfChip,
  mcpToolMetaFallback,
  mcpToolMetaOfRow,
  mcpToolParamRows,
  schemaTypeLabel,
} from '../ui/shared/mcpToolMeta'
import { computeToolCardPosition } from '../ui/shared/mcpToolCard'
import { probeToolRows } from '../server/agent/probeTools'

describe('MCP 工具参数', () => {
  it('列出第一层参数：名字 / 类型 / 必填 / 说明 / 默认值 / 枚举', () => {
    const rows = mcpToolParamRows({
      type: 'object',
      required: ['ids'],
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: '节点 id 列表' },
        limit: { type: 'number', default: 20 },
        mode: { enum: ['full', 'brief'] },
      },
    })
    expect(rows.map((r) => r.name)).toEqual(['ids', 'limit', 'mode'])
    expect(rows[0]).toMatchObject({ type: 'string[]', required: true, description: '节点 id 列表' })
    expect(rows[1]).toMatchObject({ type: 'number', required: false, defaultValue: '20' })
    expect(rows[2].enumValues).toEqual(['full', 'brief'])
    expect(rows[2].type).toBe('full | brief')
  })

  it('没有 schema / 没有 properties 时给空数组（卡片显示「不需要参数」）', () => {
    expect(mcpToolParamRows(undefined)).toEqual([])
    expect(mcpToolParamRows({ type: 'object' })).toEqual([])
    expect(mcpToolParamRows({ type: 'object', properties: [] })).toEqual([])
  })

  it('类型标注认数组 / 联合 / 嵌套对象', () => {
    expect(schemaTypeLabel({ type: ['string', 'null'] })).toBe('string | null')
    expect(schemaTypeLabel({ type: 'object', properties: { a: { type: 'string' } } })).toBe('object')
    expect(schemaTypeLabel({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe('string | number')
    expect(schemaTypeLabel(undefined)).toBe('any')
  })
})

describe('标签认 MCP 工具', () => {
  it('用 data-id 认出工具全名', () => {
    expect(mcpToolFullNameOfChip({ id: 'mcp-tool:mcp__canvas__canvas_get' })).toBe('mcp__canvas__canvas_get')
  })

  it('data-ref-value 带全名时优先用它', () => {
    expect(mcpToolFullNameOfChip({ id: 'mcp-tool:old', refValue: 'mcp__canvas__canvas_list_canvases' }))
      .toBe('mcp__canvas__canvas_list_canvases')
  })

  it('只有「服务.工具」名字时也能拆（旧标签）', () => {
    expect(mcpToolFullNameOfChip({ refKind: 'mcp', name: 'canvas.canvas_get' })).toBe('mcp__canvas__canvas_get')
  })

  it('资产 / 节点标签不会被误认成 MCP（名字里有点号也不行）', () => {
    expect(mcpToolFullNameOfChip({ id: 'ref-node:n1', name: '素材 v1.2' })).toBeNull()
    expect(mcpToolFullNameOfChip({ id: 'mcp:canvas', refKind: 'mcp', name: 'canvas' })).toBeNull()
  })
})

describe('探测行 / 兜底数据', () => {
  it('SDK 全名拆成服务与工具，并带上 parameters', () => {
    const [row] = probeToolRows([
      { name: 'mcp__canvas__canvas_get', description: '读取画布', parameters: { type: 'object', properties: { id: { type: 'string' } } } },
    ])
    expect(row).toMatchObject({ name: 'canvas_get', server: 'canvas', description: '读取画布', fullName: 'mcp__canvas__canvas_get' })
    expect(row.parameters).toEqual({ type: 'object', properties: { id: { type: 'string' } } })
  })

  it('没有 parameters 时不塞空对象（界面据此显示「不需要参数」）', () => {
    const [row] = probeToolRows([{ name: 'mcp__x__y', description: '' }])
    expect('parameters' in row).toBe(false)
  })

  it('探测行补全成卡片数据；没有探测结果时用全名兜底', () => {
    expect(mcpToolMetaOfRow({ fullName: 'mcp__canvas__canvas_get', description: '读取' }))
      .toMatchObject({ name: 'canvas_get', server: 'canvas', description: '读取' })
    expect(mcpToolMetaFallback('mcp__smart__do_it')).toMatchObject({ name: 'do_it', server: 'smart' })
    expect(mcpToolMetaFallback('not-a-tool')).toBeNull()
  })
})

describe('卡片定位', () => {
  const anchor = { left: 600, top: 400, right: 900, bottom: 440, width: 300, height: 40 }

  it('上方放得下就放上方，水平居中', () => {
    const pos = computeToolCardPosition({
      anchor,
      card: { width: 320, height: 240 },
      viewport: { width: 1280, height: 900 },
      side: 'top',
    })
    expect(pos.side).toBe('top')
    expect(pos.top).toBe(400 - 10 - 240)
    expect(pos.left).toBe(750 - 160)
  })

  it('上方不够就翻到下方', () => {
    const pos = computeToolCardPosition({
      anchor: { ...anchor, top: 60, bottom: 100 },
      card: { width: 320, height: 300 },
      viewport: { width: 1280, height: 900 },
      side: 'top',
    })
    expect(pos.side).toBe('bottom')
    expect(pos.top).toBe(100 + 10)
  })

  it('贴右边的标签：卡片往左长，不出屏幕', () => {
    const pos = computeToolCardPosition({
      anchor: { left: 1100, top: 500, right: 1260, bottom: 522, width: 160, height: 22 },
      card: { width: 320, height: 300 },
      viewport: { width: 1280, height: 900 },
      side: 'top',
    })
    expect(pos.left).toBeGreaterThanOrEqual(12)
    expect(pos.left + 320).toBeLessThanOrEqual(1280 - 12)
  })

  it('下拉在屏幕右侧：优先放到菜单左边', () => {
    const pos = computeToolCardPosition({
      anchor: { left: 800, top: 300, right: 1200, bottom: 330, width: 400, height: 30 },
      card: { width: 320, height: 300 },
      viewport: { width: 1280, height: 900 },
      side: 'left',
    })
    expect(pos.side).toBe('left')
    expect(pos.left + 320).toBeLessThanOrEqual(800)
  })

  it('菜单贴满右边缘（右边缘 = 视口宽）时，卡片仍落在菜单左侧，不会被夹回去盖住菜单', () => {
    const pos = computeToolCardPosition({
      anchor: { left: 1520, top: 505, right: 1891, bottom: 551, width: 371, height: 46 },
      avoid: { left: 1520, top: 294, right: 1920, bottom: 766 },
      card: { width: 320, height: 337 },
      viewport: { width: 1920, height: 855 },
      side: 'left',
    })
    expect(pos.side).toBe('left')
    expect(pos.left + 320).toBeLessThanOrEqual(1520)
    expect(pos.left).toBeGreaterThanOrEqual(12)
  })

  it('左边不够就翻到右边；卡片比屏幕还高时给 maxHeight', () => {
    const pos = computeToolCardPosition({
      anchor: { left: 20, top: 300, right: 260, bottom: 330, width: 240, height: 30 },
      card: { width: 320, height: 2000 },
      viewport: { width: 1280, height: 900 },
      side: 'left',
    })
    expect(pos.side).toBe('right')
    expect(pos.maxHeight).toBe(900 - 24)
    // 超高的卡片靠 maxHeight 收住：实际占位是 maxHeight，而不是原始 2000 高
    expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(900 - 12)
  })

  it('给了菜单矩形时，卡片必须落在菜单外面（不能盖住 MCP 菜单）', () => {
    const menu = { left: 1520, top: 294, right: 1920, bottom: 766 }
    const pos = computeToolCardPosition({
      anchor: { left: 1520, top: 557, right: 1891, bottom: 603, width: 371, height: 46 },
      avoid: menu,
      card: { width: 320, height: 340 },
      viewport: { width: 1920, height: 855 },
      side: 'left',
    })
    expect(pos.side).toBe('left')
    expect(pos.left + 320).toBeLessThanOrEqual(menu.left)
  })

  it('菜单左右都放不下（面板占了大半屏）：改到菜单上方 / 下方，不压菜单', () => {
    const menu = { left: 40, top: 200, right: 960, bottom: 560 }
    const pos = computeToolCardPosition({
      anchor: { left: 40, top: 300, right: 920, bottom: 340, width: 880, height: 40 },
      avoid: menu,
      card: { width: 320, height: 300 },
      viewport: { width: 1000, height: 900 },
      side: 'left',
    })
    expect(['top', 'bottom']).toContain(pos.side)
    const overlapsMenuVertically = pos.top < menu.bottom && pos.top + Math.min(300, pos.maxHeight) > menu.top
    expect(overlapsMenuVertically).toBe(false)
  })
})
