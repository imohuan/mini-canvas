/** 引用资源标签：技能/MCP/节点的标记（ref）必须带对的 kind 与载荷 */
import { describe, it, expect } from 'vitest'
import { skillResources, mcpResources, nodeResources } from '../agentResources'

describe('技能标签', () => {
  it('带 skill 标记，载荷 = SKILL.md 路径', () => {
    const [r] = skillResources([{ name: 'archify', description: '画架构图', dir: 'D:/a/skills/archify' }])
    expect(r.ref).toEqual({ kind: 'skill', name: 'archify', value: 'D:/a/skills/archify/SKILL.md' })
  })

  it('拿不到目录时不给路径（标记仍成立）', () => {
    const [r] = skillResources([{ name: 'x', description: '' }])
    expect(r.ref).toEqual({ kind: 'skill', name: 'x', value: '' })
  })
})

describe('MCP 标签', () => {
  it('带 mcp 标记，且**不带**地址（后端靠名字连服务）', () => {
    const [r] = mcpResources([{ name: 'smart', config: { url: 'http://x/mcp' } }])
    expect(r.ref).toEqual({ kind: 'mcp', name: 'smart' })
    expect(r.ref?.value).toBeUndefined()
  })
})

describe('节点标签', () => {
  it('载荷 = 画布id#节点id，且带 onClick 聚焦回调', () => {
    let focused = ''
    const [r] = nodeResources([{ id: 'n1', name: '立绘', type: 'image' }], 'default', (id) => (focused = id))
    expect(r.ref).toEqual({ kind: 'node', name: '立绘', value: 'default#n1' })
    r.onClick?.(r)
    expect(focused).toBe('n1')
  })

  it('没有名字时用 id 当展示名', () => {
    const [r] = nodeResources([{ id: 'n2', name: '', type: 'text' }], 'c')
    expect(r.name).toBe('n2')
    expect(r.ref?.value).toBe('c#n2')
  })
})
