/**
 * 步骤 4 宿主侧验收 —— canvas-base 是核心插件（决策 1）+ 15 行装配已搬走。
 *
 * 锁三件事：
 * 1. **搬窝真搬走了**：createMiniCanvasHost.ts 里的 `ctx.inject` 从 15 处降到 ≤2
 *    （只留 nodeLayout/viewport 这两个真属于渲染层、必须挂载时注入的）；
 * 2. **对外契约一个没变**：CanvasHostHandle 字段、api 面、默认清单、持久化恢复行为照旧；
 * 3. **四条 manager 路径各自处理"被拦"**（决策 1 表格逐条）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { createMiniCanvasHost } from '../createMiniCanvasHost'
import { MemoryStorageAdapter, CANVAS_BASE_PLUGIN_NAME } from '@mini-canvas/canvas-data'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import type { PluginModule } from '@mini-canvas/kernel'

describe('步骤 4 完成标准① —— ctx.inject 从 15 处降到 ≤3', () => {
  it('createMiniCanvasHost.ts 只剩 nodeLayout / viewport / pluginManager / tip 四处 ctx.inject', () => {
    const src = readFileSync(fileURLToPath(new URL('../createMiniCanvasHost.ts', import.meta.url)), 'utf8')
    // 只看代码行（注释里的说明文字不算"装配点"）
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
      .join('\n')
    const hits = code.match(/ctx\.inject\(/g) ?? []
    // 四处：两件渲染服务（nodeLayout/viewport）+「统一安装句柄 pluginManager」+「通用鼠标提示 tip」。
    // pluginManager：插件管理插件要能按名装卸别的插件（2026-10-02 用户诉求）。
    // tip：全局鼠标跟随提示属于渲染反馈的基础设施（2026-10-26 用户口径：拖线非法提示、
    // 选择态提示等统一走它），与主题无关，故由渲染宿主上架。
    expect(hits.length).toBeLessThanOrEqual(4)
    expect(src).toContain("ctx.inject('nodeLayout'")
    expect(src).toContain("ctx.inject('viewport'")
    expect(src).toContain("ctx.inject('pluginManager'")
    expect(src).toContain("ctx.inject('tip'")
  })

  it('其余服务由基础插件的 apply 注入（业务插件 ctx.get 照样取得到）', async () => {
    const { host } = await createMiniCanvasHost({
      adapter: new MemoryStorageAdapter(),
      coldPlugins: [nodeTextPlugin],
    })
    for (const name of [
      'save',
      // 5c：数据那一格只有 doc（nodeStore/edgeStore/graph/history 四个老名已下线）
      'doc',
      'resources',
      'nodeRegistry',
      'themeRegistry',
      'selection',
      'command',
      'nodeFactory',
      'settingsPersist',
      // 宿主自己补的两件
      'nodeLayout',
      'viewport',
    ]) {
      expect(host.ctx.hasService(name), name + ' 未注入').toBe(true)
    }
    host.stop()
  })
})

describe('步骤 4 完成标准② —— uninstallPlugin(canvas-base) 返回 false 且画布功能不受影响', () => {
  it('拒卸后建节点 / 撤销 / 落盘仍然照常（服务一个没少）', async () => {
    const storage = new MemoryStorageAdapter()
    const { host } = await createMiniCanvasHost({
      adapter: storage,
      coldPlugins: [nodeTextPlugin],
    })
    // 拒卸（画布基础服务是"环境"，不是可卸的清单项）
    expect(host.ctx.uninstallPlugin(CANVAS_BASE_PLUGIN_NAME)).toBe(false)
    expect(host.ctx.canUninstall(CANVAS_BASE_PLUGIN_NAME)).toEqual({ ok: false, reason: 'core' })

    // 画布功能不受影响：建节点 → 撤销 → 重做 → 落盘
    const id = host.nodeFactory.create('text', { x: 0, y: 0 })
    expect(host.nodeStore.getNode(id)?.type).toBe('text')
    host.command.execute('command:undo')
    expect(host.nodeStore.getNode(id)).toBeUndefined()
    host.command.execute('command:redo')
    expect(host.nodeStore.getNode(id)).toBeDefined()
    await host.save.flush()
    const saved = await storage.get<Array<{ id: string }>>('canvas:graph')
    expect(saved?.map((n) => n.id)).toEqual([id])
    host.stop()
  })
})

describe('步骤 4 对外契约不变 —— 默认清单、handle 字段、pluginManager.list', () => {
  it('api.listPlugins() 默认仍是空清单（canvas-base 是环境不是清单项）', async () => {
    const { host, api, manager } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    expect(api.listPlugins()).toEqual([])
    expect(manager.list()).toEqual([])
    // 内核层看得见（诊断用），只是应用层门面不列
    expect(host.ctx.listPlugins()).toEqual([CANVAS_BASE_PLUGIN_NAME])
    expect(host.ctx.inspectPlugins().find((p) => p.name === CANVAS_BASE_PLUGIN_NAME)?.core).toBe(true)
    host.stop()
  })

  it('CanvasHostHandle 的字段一个不少（含基础服务与渲染层两件）', async () => {
    const { host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    for (const key of [
      'ctx',
      'save',
      'nodeStore',
      'edgeStore',
      'nodeRegistry',
      'themeRegistry',
      'selection',
      'command',
      'history',
      'nodeFactory',
      'graph',
      'nodeLayout',
      'viewport',
      'resources',
      'stop',
    ]) {
      expect(host[key as keyof typeof host], key + ' 缺失').toBeDefined()
    }
    host.stop()
  })

  it('业务插件的装/卸/热重载照常（守卫不误伤）', async () => {
    const { host, api } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    const demo: PluginModule = { name: 'demo', apply(c) { c.inject('demoSvc', { v: 1 }) } }
    api.installPlugin(demo)
    expect(api.listPlugins()).toEqual(['demo'])
    expect(host.ctx.get<{ v: number }>('demoSvc').v).toBe(1)
    expect(api.uninstallPlugin('demo')).toBe(true)
    expect(host.ctx.get('demoSvc')).toBeUndefined()
    host.stop()
  })
})

describe('决策 1 表格：manager 四条路径各自处理"被拦"', () => {
  it('manager.uninstall(core) 明确抛错（含 not-found/not-started 也抛），且不动配置快照', async () => {
    const { manager, host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    expect(() => manager.uninstall(CANVAS_BASE_PLUGIN_NAME)).toThrow(/\(core\) during uninstall/)
    // not-found 也必须带原因抛（严格审查 H2：三态不压扁成二值静默）
    expect(() => manager.uninstall('ghost-plugin')).toThrow(/\(not-found\) during uninstall/)
    // 没产出副作用：插件仍 active、服务仍在
    expect(host.ctx.fiber(CANVAS_BASE_PLUGIN_NAME)?.stateName).toBe('active')
    expect(host.ctx.hasService('doc')).toBe(true)
    // 四个老服务名确已下线（5c 目标）
    for (const legacy of ['nodeStore', 'edgeStore', 'graph', 'history']) {
      expect(host.ctx.hasService(legacy), legacy + ' 不该再是服务名').toBe(false)
    }
    host.stop()
  })

  it('manager.reload(core) 无 next：抛错而不是静默删配置', async () => {
    const { manager, host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    await expect(manager.reload(CANVAS_BASE_PLUGIN_NAME)).rejects.toThrow(/\(core\) during reload/)
    expect(host.ctx.fiber(CANVAS_BASE_PLUGIN_NAME)?.stateName).toBe('active')
    host.stop()
  })

  it('manager.reload(core, next)：抛"核心插件不可热替换"，不是重名错误（旧硬 bug）', async () => {
    const { manager, host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    const next: PluginModule = { name: CANVAS_BASE_PLUGIN_NAME, apply() {} }
    await expect(manager.reload(CANVAS_BASE_PLUGIN_NAME, next)).rejects.toThrow(/\(core\) during reload/)
    // 旧实现会"卸失败后继续 installPlugin" → 抛 [core] Duplicate plugin name；此处必须不是它
    await expect(manager.reload(CANVAS_BASE_PLUGIN_NAME, next)).rejects.not.toThrow(/Duplicate plugin name/)
    // 旧实现（真插件）仍在，没被半卸
    expect(host.ctx.get('doc')).toBe(host.doc)
    expect(host.ctx.fiber(CANVAS_BASE_PLUGIN_NAME)?.stateName).toBe('active')
    host.stop()
  })

  it('manager.install(同名实现) 覆盖核心插件：抛"不能被同名实现覆盖"', async () => {
    const { manager, host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    await expect(
      manager.install({ name: CANVAS_BASE_PLUGIN_NAME, apply() {} }),
    ).rejects.toThrow(/cannot be replaced by another implementation of the same name/)
    expect(host.ctx.fiber(CANVAS_BASE_PLUGIN_NAME)?.stateName).toBe('active')
    host.stop()
  })

  it('api.reloadPlugin(core) 同一条虫也不留：明确抛错而不是"卸失败还继续装"撞重名', async () => {
    const { api, host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    expect(() => api.reloadPlugin(CANVAS_BASE_PLUGIN_NAME)).toThrow(/core plugin cannot be uninstalled/)
    expect(() => api.reloadPlugin(CANVAS_BASE_PLUGIN_NAME, { name: CANVAS_BASE_PLUGIN_NAME, apply() {} })).toThrow(
      /core plugin cannot be uninstalled/,
    )
    expect(host.ctx.fiber(CANVAS_BASE_PLUGIN_NAME)?.stateName).toBe('active')
    host.stop()
  })
})
