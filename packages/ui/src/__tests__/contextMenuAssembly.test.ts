/**
 * 右键菜单整装验证（设计文档 §十一 决策 10：删除 menu 服务、实现合回 plugin-context-menu）。
 *
 * 为什么放在 ui 包：菜单链路横跨三层 —— 基础插件注入了哪些服务（canvas-data）、
 * 插件自己的菜单聚合（plugin-context-menu）、宿主门面暴露了什么（canvas-render）。
 * 只有装配层能同时看到这三者，内核包不能反向依赖插件。
 *
 * 锁四件事：
 * 1. `menu` 服务**真没了**（基础服务从 18 塌向 7 的其中一步）；
 * 2. 数据门面 `doc` 到位（菜单聚合不再依赖 nodeStore/edgeStore/graph 三个名字）；
 * 3. `plugin-context-menu` 的 inject 依赖全部满足、插件 active（没有静默 PENDING —— 那会让
 *    右键菜单整个失灵但没有任何报错）；
 * 4. 菜单组装**真产出**删除项（命令表 + 类型表 → buildMenuItems 这条链是通的）。
 */
import { describe, it, expect } from 'vitest'
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { buildMenuItems, contextMenuPlugin } from '@mini-canvas/plugin-context-menu'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'

describe('右键菜单整装（menu 服务删除后）', () => {
  it('menu 服务消失、doc 到位、context-menu 插件 active 且菜单真产出删除项', async () => {
    const { host } = await createMiniCanvasHost({
      adapter: new MemoryStorageAdapter(),
      coldPlugins: [contextMenuPlugin, nodeTextPlugin],
    })

    // ① 决策 10：menu 服务与宿主 handle.menu 字段都已下线
    expect(host.ctx.hasService('menu')).toBe(false)
    expect('menu' in host).toBe(false)
    // ② 数据门面到位（菜单聚合的取数口）
    expect(host.ctx.hasService('doc')).toBe(true)

    // ③ 插件依赖全满足（缺一个就 PENDING，右键菜单会整个失灵且不报错）
    const st = host.ctx.inspectPlugins().find((p) => p.name === 'context-menu')
    expect(st?.state).toBe('active')
    expect(st?.missingDeps).toEqual([])

    // ④ 菜单链路通：命令表（插件的删除命令带 areas）+ 类型表 → 菜单项
    const cmds = host.command.list()
    expect(cmds.find((c) => c.id === 'context-menu:delete-node')?.areas).toEqual(['node'])
    expect(cmds.find((c) => c.id === 'context-menu:delete-edge')?.areas).toEqual(['edge'])
    const doc = host.ctx.get<{ types: ReadonlyMap<string, unknown> }>('doc')
    expect([...doc.types.keys()]).toContain('text')

    const nodeTypes = [...doc.types.entries()].map(([type, def]) => ({
      type,
      label: (def as { label: string }).label,
    }))
    const paneItems = buildMenuItems('pane', cmds, nodeTypes)
    expect(paneItems.map((i) => i.id)).toContain('create-node:text')
    expect(buildMenuItems('node', cmds, []).map((i) => i.id)).toContain('context-menu:delete-node')

    host.stop()
  })
})
