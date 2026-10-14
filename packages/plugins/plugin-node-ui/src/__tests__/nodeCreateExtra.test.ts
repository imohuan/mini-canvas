/**
 * 建节点时必须**带上 extra**（2026-10-13 端到端验导入时撞到的 bug）。
 *
 * 第一版 ui 类型的 create(position) 丢掉了 extra —— 于是所有"带数据建节点"的调用
 * （command:create-node 传 uiHtml / uiScripts，例如导入节点包）都**静默建出空节点**：
 * 节点在、界面空、声明也没了。这种静默丢弃最难查，所以钉死。
 */
import { describe, it, expect } from 'vitest'
import { nodeUiPlugin } from '../nodeUiPlugin'

const UI_NODE_TYPE = 'ui'

/** 造一个够装配用的假 ctx（记录注册进来的类型定义与写进去的 data） */
function fakeCtx() {
  const types = new Map<string, Record<string, unknown>>()
  const created: Array<{ type: string; position: { x: number; y: number }; data: unknown }> = []
  const tx = {
    createNode: (type: string, position: { x: number; y: number }, data: unknown) => {
      created.push({ type, position, data })
      return 'n1'
    },
  }
  const doc = {
    transaction: (_label: string, fn: (t: unknown) => unknown) => fn(tx),
    getNode: () => ({ id: 'n1', type: UI_NODE_TYPE, data: {} }),
    updateNode: () => undefined,
  }
  const ctx = {
    nodes: { register: (def: Record<string, unknown>) => types.set(String(def.type), def) },
    get: (n: string) => (n === 'doc' ? doc : undefined),
    tryGet: (n: string) => (n === 'doc' ? doc : undefined),
    on: () => undefined,
    // UiNodeService_ 是内核 Service 子类，构造时会 ctx.provide 上架自己（假 ctx 也得有）
    provide: () => undefined,
    // 本插件还会注册命令（导出/收藏/打包那几条）；给个空实现就够
    commands: { register: () => ({ dispose: () => undefined }) },
    settings: { get: () => undefined, set: () => undefined, define: () => undefined },
    registryOf: () => ({ add: () => undefined, list: () => [], keys: () => [] }),
  }
  return { ctx: ctx as never, types, created }
}

describe('可视化节点的 create(position, extra)', () => {
  it('extra 里的 data 必须真的写进节点（导入节点包全靠它）', () => {
    const s = fakeCtx()
    nodeUiPlugin.apply?.(s.ctx)
    const def = s.types.get(UI_NODE_TYPE) as { create: (p: { x: number; y: number }, extra?: unknown) => string }
    expect(typeof def?.create).toBe('function')

    def.create({ x: 10, y: 20 }, { uiHtml: '<div>导入来的界面</div>', uiScripts: { demo: {} } })
    expect(s.created).toHaveLength(1)
    const data = s.created[0]!.data as Record<string, unknown>
    expect(data.uiHtml).toBe('<div>导入来的界面</div>')
    expect(data.uiScripts).toEqual({ demo: {} })
    // 类型默认字段仍在（没被 extra 挤掉）
    expect(data.uiInputs).toEqual({})
  })

  it('没给 extra 时照样能建（默认字段齐全）', () => {
    const s = fakeCtx()
    nodeUiPlugin.apply?.(s.ctx)
    const def = s.types.get(UI_NODE_TYPE) as { create: (p: { x: number; y: number }, extra?: unknown) => string }
    def.create({ x: 0, y: 0 })
    const data = s.created[0]!.data as Record<string, unknown>
    expect(data.uiInputs).toEqual({})
    expect(data.uiHtml).toBeUndefined()
  })
})

