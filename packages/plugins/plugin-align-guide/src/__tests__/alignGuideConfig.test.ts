/**
 * alignGuideConfig 单测 —— 对齐辅助线「总开关」的纯逻辑 + 内核登记链路。
 *
 * 为什么这么测：本包沿用项目里 plugin-node-find 的做法（纯逻辑单测、不 import .vue），
 * 故这里不装载插件本体，而是拿**真实的 Config schema**（纯 .ts，无 Vue）配一个探针插件
 * 走一遍真内核装配 —— 内核把 Config 标量字段登记进 settings 单一数据源，
 * 而设置面板的分组/控件完全由 settings.groups() 驱动，所以断言它等于断言"用户在设置里看得到这个开关"。
 *
 * 同时锁住 key 前缀：settings 的 key 是全局平面命名，先声明者独占；裸 'enabled' 已被
 * plugin-edge-cutting 占用，本插件必须用 alignGuideEnabled，否则开关会静默失效。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { Config, alignGuideConfigFrom } from '../alignGuideConfig'

/** 用真实 Config schema 装配一个探针插件（不 import .vue，跑的是内核 config 登记链路） */
async function bootWithConfig(raw?: unknown) {
  const ctx = new Context()
  ctx.plugin({ name: 'align-guide-probe', Config, apply: () => undefined }, raw)
  await ctx.start()
  return ctx
}

describe('Config schema（开关的声明）', () => {
  it('默认开启、布尔开关、有 label/description/分组', () => {
    expect(Config.alignGuideEnabled.type).toBe('boolean')
    expect(Config.alignGuideEnabled.default).toBe(true)
    expect(Config.alignGuideEnabled.label).toBeTruthy()
    expect(Config.alignGuideEnabled.description).toBeTruthy()
    // 一级「布局」下带二级段（设置面板左导航/页签靠 group 的 / 分段驱动）
    expect(Config.alignGuideEnabled.group).toBe('布局/对齐辅助线')
  })

  it('key 带插件前缀（裸 enabled 已被连线切割插件占用，撞名会被先声明者独占而失效）', () => {
    expect(Object.keys(Config)).toEqual(['alignGuideEnabled'])
  })
})

describe('装配进 settings（设置面板据此长开关）', () => {
  it('默认值进 settings，分组出现在 groups() 里', async () => {
    const ctx = await bootWithConfig()
    const settings = ctx.get<{ groups(): string[]; get(k: string): unknown }>('settings')
    expect(settings.groups()).toContain('布局/对齐辅助线')
    expect(settings.get('alignGuideEnabled')).toBe(true)
    ctx.stop()
  })

  it('装配时显式关掉 → settings 初值就是关（config 覆盖 schema 默认）', async () => {
    const ctx = await bootWithConfig({ alignGuideEnabled: false })
    expect(ctx.get<{ get(k: string): unknown }>('settings').get('alignGuideEnabled')).toBe(false)
    ctx.stop()
  })

  it('非法装配值（类型不对）→ 响亮报错，不静默吞掉', async () => {
    const ctx = new Context()
    ctx.plugin({ name: 'align-guide-probe', Config, apply: () => undefined }, { alignGuideEnabled: 'yes' })
    await expect(ctx.start()).rejects.toThrow(/alignGuideEnabled/)
    ctx.stop()
  })
})

describe('alignGuideConfigFrom（apply/组件实时读当前值）', () => {
  it('读 settings 当前值：面板关掉后立刻读到 false', async () => {
    const ctx = await bootWithConfig()
    expect(alignGuideConfigFrom(ctx).alignGuideEnabled).toBe(true)
    ctx.settings.set('alignGuideEnabled', false)
    expect(alignGuideConfigFrom(ctx).alignGuideEnabled).toBe(false)
    // 再打开也能读到（开关是双向的，关掉不等于永久失效）
    ctx.settings.set('alignGuideEnabled', true)
    expect(alignGuideConfigFrom(ctx).alignGuideEnabled).toBe(true)
    ctx.stop()
  })

  it('settings 未就绪 / 未声明该项 → 回落默认开（插件永不因读不到配置而哑掉）', () => {
    const bare = { get: () => undefined } as unknown as Context
    expect(alignGuideConfigFrom(bare).alignGuideEnabled).toBe(true)
  })
})
