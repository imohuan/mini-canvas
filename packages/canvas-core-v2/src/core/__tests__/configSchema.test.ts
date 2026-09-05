import { describe, it, expect } from 'vitest'
import { Context } from '../Context'
import { resolveConfig, ConfigError, F } from '../configSchema'
import type { ConfigSchema } from '../configSchema'
import type { PluginModule, PluginScope } from '../types'

/** 造最小 ctx：注入 themeRegistry 外不需要其它服务；插件走 Config schema + apply(ctx,config) */
async function boot(plugins: PluginModule[]): Promise<Context> {
  const ctx = new Context()
  for (const p of plugins) ctx.plugin(p)
  await ctx.start()
  return ctx
}

describe('configSchema（轻量对象 schema，自研 cordis ch5）', () => {
  const schema: ConfigSchema = {
    greeting: { type: 'string', default: 'Hello', label: '问候' },
    edgeType: F.select('bezier', ['bezier', 'straight', 'step']),
    edgeColor: F.color('#3b82f6'),
    lineWidth: { type: 'number', default: 2, min: 1, max: 6 },
    glow: { type: 'boolean', default: true },
  }

  it('缺省用默认补齐，返回全量对象；外来 key 忽略', () => {
    const cfg = resolveConfig(schema, { edgeType: 'straight' })
    expect(cfg).toEqual({
      greeting: 'Hello',
      edgeType: 'straight',
      edgeColor: '#3b82f6',
      lineWidth: 2,
      glow: true,
    })
  })

  it('类型不符 → ConfigError(响亮带字段名与期望)', () => {
    expect(() => resolveConfig(schema, { glow: 'yes' })).toThrow(ConfigError)
    expect(() => resolveConfig(schema, { glow: 'yes' })).toThrow(/invalid config/)
    expect(() => resolveConfig(schema, { lineWidth: 'x' })).toThrow(/"lineWidth" expected number/)
  })

  it('number 越界 / 非有限 / select 不在枚举 / color 非法 → ConfigError', () => {
    expect(() => resolveConfig(schema, { lineWidth: 99 })).toThrow(/exceeds max 6/)
    expect(() => resolveConfig(schema, { lineWidth: -1 })).toThrow(/below min 1/)
    expect(() => resolveConfig(schema, { lineWidth: Number.NaN })).toThrow(/expected number/)
    expect(() => resolveConfig(schema, { edgeType: 'curved' })).toThrow(/expected one of/)
    expect(() => resolveConfig(schema, { edgeColor: 'red' })).toThrow(/expected hex color/)
  })

  it('无 schema 时原样返回 raw', () => {
    expect(resolveConfig(undefined, { a: 1 })).toEqual({ a: 1 })
  })
})

describe('P4 config 装配校验 + apply(ctx, config)（内核集成）', () => {
  it('apply 收到经 schema 校验、默认补齐的 config（未给装配 config）', async () => {
    let received: unknown
    await boot([
      {
        name: 'cfg-a',
        Config: { edgeType: F.select('bezier', ['bezier', 'straight']), glow: F.boolean(true) },
        apply(_ctx: PluginScope, config) {
          received = config
        },
      },
    ])
    expect(received).toEqual({ edgeType: 'bezier', glow: true })
  })

  it('ctx.plugin(mod, config) 装配 config 覆盖默认 → apply 收到被覆盖值', async () => {
    let received: unknown
    const ctx = new Context()
    ctx.plugin(
      {
        name: 'cfg-b',
        Config: { edgeColor: F.color('#111'), glow: F.boolean(false) },
        apply(_c: PluginScope, config) {
          received = config
        },
      },
      { edgeColor: '#ff0000' },
    )
    await ctx.start()
    expect(received).toEqual({ edgeColor: '#ff0000', glow: false })
  })

  it('装配 config 校验失败 → 插件进 FAILED 并响亮抛 ConfigError', async () => {
    const ctx = new Context()
    const plug: PluginModule = {
      name: 'cfg-bad',
      Config: { lineWidth: { type: 'number', default: 2, min: 1, max: 6 } },
      apply(_c: PluginScope, _config) {
        throw new Error('should not run')
      },
    }
    ctx.plugin(plug, { lineWidth: 100 })
    await expect(ctx.start()).rejects.toThrow(/exceeds max 6/)
    const fiber = ctx.fiber('cfg-bad')
    expect(fiber?.state).toBe('failed') // 保留 FAILED 供诊断
    expect(fiber?.error).toBeInstanceOf(ConfigError)
  })

  it('config 声明进 settings 单一数据源：plugin/ctx 同读一份，改动经 onChange 就地更新', async () => {
    let calls: unknown[] = []
    const ctx = new Context()
    ctx.plugin({
      name: 'cfg-c',
      Config: { edgeColor: F.color('#3b82f6') },
      apply(c: PluginScope) {
        c.settings.onChange('cfg-c', (k, v) => calls.push([k, v]))
      },
    })
    await ctx.start()
    // host 经 get('settings') 读到 schema 声明的初始值
    const store = ctx.get<{ get(k: string): unknown }>('settings')
    expect(store.get('edgeColor')).toBe('#3b82f6')
    ctx.settings.set('edgeColor', '#00ff00')
    expect(store.get('edgeColor')).toBe('#00ff00')
    expect(calls).toEqual([['edgeColor', '#00ff00']])
  })
})
