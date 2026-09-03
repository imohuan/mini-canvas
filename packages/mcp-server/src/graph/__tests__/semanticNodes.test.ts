import { describe, it, expect, beforeEach } from 'vitest'
import { GraphModel } from '../GraphModel'
import { TaskManager } from '../../tasks/TaskManager'
import { ModelRegistry } from '../../models/ModelRegistry'
import { createSemanticNode, normalizePath, proxyUrlFor } from '../semanticNodes'
import type { ModelRunner } from '../../models/types'

function registryWith(runner: ModelRunner): ModelRegistry {
  const reg = new ModelRegistry()
  reg.registerCapabilities([{ model: 'test-img', label: 't', kind: 'image', ratio: ['1:1'] }])
  reg.registerRunner('web2api', runner)
  return reg
}

describe('createSemanticNode（语义化创建）', () => {
  let model: GraphModel
  let manager: TaskManager

  beforeEach(() => {
    model = new GraphModel()
    model.createCanvas('c1')
    manager = new TaskManager(model, { registry: registryWith({ run: () => ({ ok: true as const, urls: [] }) }) })
  })

  it('预览模式：path 建展示节点，data 带 imageUrl+sourcePath', () => {
    const r = createSemanticNode(model, manager, { canvasId: 'c1', type: 'image', args: { path: 'C:/a/b.png' } })
    expect(r.ok).toBe(true)
    expect(r.mode).toBe('preview')
    expect(r.nodeId).toBeTruthy()
    const n = model.getNode('c1', r.nodeId!)!
    expect(n.data.nodeType).toBe('image')
    expect(n.data.sourcePath).toBe(normalizePath('C:/a/b.png'))
    expect(n.data.imageUrl).toContain('/api/proxy-media?path=')
  })

  it('预览模式：同 sourcePath 去重，不重复建节点', () => {
    const r1 = createSemanticNode(model, manager, { canvasId: 'c1', type: 'image', args: { path: 'C:/a/b.png' } })
    const r2 = createSemanticNode(model, manager, { canvasId: 'c1', type: 'image', args: { path: 'C:/a/b.png' } })
    expect(r2.nodeId).toBe(r1.nodeId)
    expect(model.listNodes('c1').length).toBe(1)
  })

  it('生成模式：参考图不存在则自动建预览节点并连线到生成节点', () => {
    const r = createSemanticNode(model, manager, {
      canvasId: 'c1', type: 'image',
      args: { prompt: '一只猫', model: 'test-img', referenceImages: ['C:/ref/1.png', 'C:/ref/2.png'] },
    })
    expect(r.ok).toBe(true)
    expect(r.mode).toBe('generate')
    expect(r.previewNodeIds).toHaveLength(2)
    expect(r.nodeId).toBeTruthy()
    expect(r.taskId).toBeTruthy()
    // 2 个预览节点 + 1 个生成节点
    expect(model.listNodes('c1').length).toBe(3)
    // 2 条自动连线：预览→生成，显式 source/target handle
    const edges = model.listEdges('c1')
    expect(edges.length).toBe(2)
    for (const e of edges) {
      expect(e.target).toBe(r.nodeId)
      expect(e.sourceHandle).toBe('source')
      expect(e.targetHandle).toBe('target')
    }
    // 生成节点带 options(model/prompt)
    const gen = model.getNode('c1', r.nodeId!)!
    const opt = gen.data.options as Record<string, unknown>
    expect(opt.selectedModel).toBe('test-img')
    expect(opt.promptText).toBe('一只猫')
  })

  it('生成模式：参考图已存在（预览模式建过）则复用不新建', () => {
    createSemanticNode(model, manager, { canvasId: 'c1', type: 'image', args: { path: 'C:/ref/1.png' } })
    const r = createSemanticNode(model, manager, {
      canvasId: 'c1', type: 'image',
      args: { prompt: 'x', model: 'test-img', referenceImages: ['C:/ref/1.png'] },
    })
    // 1(预览复用) + 1 生成 = 2 节点；1 条连线
    expect(model.listNodes('c1').length).toBe(2)
    expect(model.listEdges('c1').length).toBe(1)
    expect(r.previewNodeIds).toHaveLength(1)
  })

  it('生成模式缺 prompt → 返回错误', () => {
    const r = createSemanticNode(model, manager, { canvasId: 'c1', type: 'image', args: {} })
    expect(r.ok).toBe(false)
  })

  it('画布不存在 → 返回错误', () => {
    const r = createSemanticNode(model, manager, { canvasId: 'ghost', type: 'image', args: { path: 'C:/a.png' } })
    expect(r.ok).toBe(false)
  })

  it('proxyUrlFor / normalizePath 行为', () => {
    expect(normalizePath('C:\\a\\b.png')).toBe('C:/a/b.png')
    expect(proxyUrlFor('C:/a b.png')).toBe('/api/proxy-media?path=C%3A%2Fa%20b.png')
  })
})
