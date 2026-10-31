/**
 * canvasCommands —— 画布通用命令（建节点/删选中/撤销/重做）契约测试。
 *
 * 锁三件事：
 * 1. 四条命令按预期 id 注册，且 keys 与插件时期一致（快捷键不能悄悄变）。
 * 2. 删选中一次事务进一条历史（混选边+节点 → 一次撤销全回来）。
 * 3. 撤销句柄真能注销全部命令（宿主 ctx.stop 后重启不能重复注册）。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '../context'
import { NodeStore } from '../../nodeStore'
import { EdgeStore } from '../../edgeStore'
import { Selection } from '../../selection'
import { History } from '../../history'
import { GraphDocument } from '../../graphDocument'
import { NodeFactory } from '../nodeFactory'
import { registerCanvasCommands, CANVAS_COMMAND } from '../canvasCommands'
import { CommandRegistry, RegistryImpl } from '@mini-canvas/kernel'
import type { CommandDef } from '@mini-canvas/kernel'
import { commandRuntime, clearCommandRuntime, setCommandRuntime } from '../commandRuntime'
import { createDocService } from '../../docService'

/** 真内核服务最小装配（与宿主 boot 一致：command/graph/selection/nodeFactory 齐全） */
function boot(opts: { field?: RegistryImpl<{ def: CommandDef }> } = {}) {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())),
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())),
    }),
    restore: (g: { nodes: unknown[]; edges: unknown[] }) => {
      nodeStore.replaceAll(g.nodes as never)
      edgeStore.replaceAll(g.edges as never)
    },
  })
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history)
  // 步骤 5c：数据那一格只有 doc 一个名字（四个老服务名已下线）
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph, history }))
  const command = new CommandRegistry()
  ctx.inject('command', command)
  const nodeFactory = new NodeFactory()
  // 与真实插件（plugin-node-text）同款：creator 内部走 graph，于是建节点自动进历史 + 提交落盘
  nodeFactory.register('text', (position: { x: number; y: number }) => graph.createNode('text', position))
  ctx.inject('nodeFactory', nodeFactory)
  const dispose = registerCanvasCommands({ command, graph, selection, nodeFactory, ...(opts.field ? { field: opts.field } : {}) })
  return { ctx, command, graph, nodeStore, edgeStore, selection, nodeFactory, dispose }
}

describe('registerCanvasCommands —— 命令注册面', () => {
  it('注册四条命令，id 与 title 齐备', () => {
    const { command } = boot()
    expect(command.has(CANVAS_COMMAND.delete)).toBe(true)
    expect(command.has(CANVAS_COMMAND.createNode)).toBe(true)
    expect(command.has(CANVAS_COMMAND.undo)).toBe(true)
    expect(command.has(CANVAS_COMMAND.redo)).toBe(true)
    expect(command.get(CANVAS_COMMAND.delete)?.title).toBe('删除选中')
  })

  it('快捷键与插件时期逐字一致（删除 Delete/Backspace、撤销 mod+z、重做 mod+shift+z）', () => {
    const { command } = boot()
    expect(command.get(CANVAS_COMMAND.delete)?.keys).toEqual(['Delete', 'Backspace'])
    expect(command.get(CANVAS_COMMAND.undo)?.keys).toEqual(['mod+z'])
    expect(command.get(CANVAS_COMMAND.redo)?.keys).toEqual(['mod+shift+z'])
    // 建节点无快捷键（由菜单/按钮触发）
    expect(command.get(CANVAS_COMMAND.createNode)?.keys).toBeUndefined()
  })

  it('dispose 注销全部命令（宿主停用后不留残命令）', () => {
    const { command, dispose } = boot()
    dispose()
    expect(command.has(CANVAS_COMMAND.delete)).toBe(false)
    expect(command.has(CANVAS_COMMAND.createNode)).toBe(false)
    expect(command.has(CANVAS_COMMAND.undo)).toBe(false)
    expect(command.has(CANVAS_COMMAND.redo)).toBe(false)
  })
})

describe('command:create-node', () => {
  it('经 nodeFactory 建节点并写入 store', () => {
    const { command, nodeStore } = boot()
    command.execute(CANVAS_COMMAND.createNode, { type: 'text', position: { x: 10, y: 20 } })
    expect(nodeStore.getNodes()).toHaveLength(1)
    expect(nodeStore.getNodes()[0].type).toBe('text')
  })

  it('建节点进历史，可撤销', () => {
    const { command, nodeStore } = boot()
    command.execute(CANVAS_COMMAND.createNode, { type: 'text', position: { x: 0, y: 0 } })
    expect(nodeStore.getNodes()).toHaveLength(1)
    command.execute(CANVAS_COMMAND.undo)
    expect(nodeStore.getNodes()).toHaveLength(0)
    command.execute(CANVAS_COMMAND.redo)
    expect(nodeStore.getNodes()).toHaveLength(1)
  })
})

describe('command:delete', () => {
  it('无选中时 no-op 且不产生历史', () => {
    const { command, nodeStore } = boot()
    command.execute(CANVAS_COMMAND.delete)
    expect(nodeStore.getNodes()).toHaveLength(0)
    expect(command.execute(CANVAS_COMMAND.undo)).toBeUndefined() // 无可撤销
    expect(nodeStore.getNodes()).toHaveLength(0)
  })

  it('删选中节点，一次撤销全部恢复', () => {
    const { command, nodeStore, selection } = boot()
    command.execute(CANVAS_COMMAND.createNode, { type: 'text', position: { x: 0, y: 0 } })
    command.execute(CANVAS_COMMAND.createNode, { type: 'text', position: { x: 50, y: 0 } })
    const ids = nodeStore.getNodes().map((n) => n.id)
    selection.set(ids)
    command.execute(CANVAS_COMMAND.delete)
    expect(nodeStore.getNodes()).toHaveLength(0)
    command.execute(CANVAS_COMMAND.undo)
    expect(nodeStore.getNodes().map((n) => n.id).sort()).toEqual([...ids].sort())
  })

  it('删节点连带清边（级联），撤销后节点与边都回来', () => {
    const { command, nodeStore, edgeStore, graph, selection } = boot()
    const a = command.execute(CANVAS_COMMAND.createNode, { type: 'text', position: { x: 0, y: 0 } }) as string
    const b = command.execute(CANVAS_COMMAND.createNode, { type: 'text', position: { x: 200, y: 0 } }) as string
    graph.addEdge({ source: a, target: b })
    expect(edgeStore.getEdges()).toHaveLength(1)
    selection.set([a])
    command.execute(CANVAS_COMMAND.delete)
    expect(nodeStore.getNode(a)).toBeUndefined()
    expect(edgeStore.getEdges()).toHaveLength(0)
    command.execute(CANVAS_COMMAND.undo)
    expect(nodeStore.getNode(a)).toBeTruthy()
    expect(edgeStore.getEdges()).toHaveLength(1)
    void b
  })

  it('混选边+节点：一次撤销恢复整批（同事务）', () => {
    const { command, nodeStore, edgeStore, graph, selection } = boot()
    const a = command.execute(CANVAS_COMMAND.createNode, { type: 'text', position: { x: 0, y: 0 } }) as string
    const b = command.execute(CANVAS_COMMAND.createNode, { type: 'text', position: { x: 200, y: 0 } }) as string
    const e = graph.addEdge({ source: a, target: b })
    // 选中「边 + 一个节点」，边独立删（b 节点保留）
    selection.setEdges([e])
    selection.set([a])
    command.execute(CANVAS_COMMAND.delete)
    expect(edgeStore.getEdges()).toHaveLength(0)
    expect(nodeStore.getNode(a)).toBeUndefined()
    expect(nodeStore.getNode(b)).toBeTruthy() // b 未被选中，保留
    command.execute(CANVAS_COMMAND.undo)
    expect(edgeStore.getEdges()).toHaveLength(1)
    expect(nodeStore.getNode(a)).toBeTruthy()
    expect(nodeStore.getNode(b)).toBeTruthy()
  })
})

describe('command:undo / command:redo', () => {
  it('撤销后重做回到删除后的状态', () => {
    const { command, nodeStore, selection } = boot()
    const a = command.execute(CANVAS_COMMAND.createNode, { type: 'text', position: { x: 0, y: 0 } }) as string
    selection.set([a])
    command.execute(CANVAS_COMMAND.delete)
    command.execute(CANVAS_COMMAND.undo)
    expect(nodeStore.getNode(a)).toBeTruthy()
    command.execute(CANVAS_COMMAND.redo)
    expect(nodeStore.getNode(a)).toBeUndefined()
  })
})

describe('画布命令的自省（服务名 command 已下线）', () => {
  it('四条命令同时落进 command 场；dispose 后场与运行表一起清空', () => {
    const field = new RegistryImpl<{ def: CommandDef }>()
    const { command, dispose } = boot({ field })
    expect(field.keys().sort()).toEqual(
      [CANVAS_COMMAND.createNode, CANVAS_COMMAND.delete, CANVAS_COMMAND.redo, CANVAS_COMMAND.undo].sort(),
    )
    dispose()
    expect(field.keys()).toEqual([])
    expect(command.list()).toEqual([])
  })

  it('命令运行时能列出基础插件直注册的四条命令（不靠 command 服务名）', () => {
    const { command } = boot()
    const runtime = {
      execute: command.execute.bind(command),
      list: () => command.list(),
      has: command.has.bind(command),
      register: command.register.bind(command),
      remapKeys: command.remapKeys.bind(command),
      resetKeys: command.resetKeys.bind(command),
      originalKeys: command.originalKeys.bind(command),
      isRemapped: command.isRemapped.bind(command),
    }
    setCommandRuntime(runtime, command)
    try {
      expect(commandRuntime()?.list().map((c) => c.id).sort()).toEqual([
        CANVAS_COMMAND.createNode,
        CANVAS_COMMAND.delete,
        CANVAS_COMMAND.redo,
        CANVAS_COMMAND.undo,
      ])
    } finally {
      clearCommandRuntime()
    }
  })

  it('运行表拒绝重复 id 时，命令场里的同名条目也要撤回（不留看得见点不动的命令）', () => {
    const field = new RegistryImpl<{ def: CommandDef }>()
    const command = new CommandRegistry()
    command.register({ id: CANVAS_COMMAND.undo, run: () => {} })
    expect(() =>
      registerCanvasCommands({
        command,
        graph: {} as never,
        selection: {} as never,
        nodeFactory: {} as never,
        field,
      }),
    ).toThrow()
    expect(field.keys(), '重复 id 那一格不能留在场里').not.toContain(CANVAS_COMMAND.undo)
  })
})
