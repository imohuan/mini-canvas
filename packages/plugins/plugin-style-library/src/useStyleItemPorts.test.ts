/**
 * 组件侧接线：`media` 是**能力**（registryOf('capability')），不是服务。
 *
 * 真实故障（2026-10-23 用户实测）：`ctx.tryGet('media')` 永远 undefined →
 * 点「加入画布」报 `no-media`。服务场里没有 media 这个键，只有能力场里有它的工厂。
 *
 * 这里用**真的能力场 + 真的宿主标准能力工厂**（createStandardCapabilities）跑，
 * 不用手写假货 —— 否则接错场也会「测得过」。
 */
import { describe, it, expect, vi } from 'vitest'
import { styleItemDepsOf } from './useStyleItemPorts'

/** 能力工厂形状（与 canvas-render 的 CapabilityFactory 同形，测试范围内约定） */
type CapabilityFactory = (node?: unknown) => unknown

/**
 * 最小注册场替身（本插件没把 @mini-canvas/kernel 列进依赖，测试就地造一个）。
 * 只实现本文件用到的 top/add；语义与 RegistryImpl 一致：后加的 order 小的赢。
 */
function fieldOf<T>() {
  const items = new Map<string, { value: T; order: number }>()
  return {
    add(key: string, value: T, opts: { order?: number } = {}) {
      items.set(key, { value, order: opts.order ?? 0 })
    },
    top(key: string) {
      const hit = items.get(key)
      return hit ? { value: hit.value } : undefined
    },
  }
}

/** 造一个最小 ctx：只有能力场 + 节点标题入口（与本文件用到的一致） */
function ctxOf(extra: { setLabel?: (id: string, label: string | undefined) => void } = {}) {
  const field = fieldOf<CapabilityFactory>()
  const resources = {
    put: vi.fn(async (_blob: Blob, _opts?: unknown) => 'default/deadbeefdeadbeef.png'),
    resolve: vi.fn(async (_id: string) => '/api/canvases/default/resources/deadbeefdeadbeef.png'),
  }
  // 宿主标准能力（与 createMiniCanvasHost 里的注册同一份工厂）
  const ctx = {
    get: (name: string) => (name === 'resources' ? resources : undefined),
    registryOf: (kind: string) => {
      if (kind !== 'capability') throw new Error('unexpected field: ' + kind)
      return field
    },
  }
  // 宿主标准能力里的 media：真实实现见 canvas-render 的 createMediaCapability
  // （这里只留 media 一个键 —— 本文件只验「取的是能力场不是服务场」）
  field.add(
    'media',
    ((node?: unknown) => {
      const c = ctx as { get(name: string): unknown }
      return {
        put: (blob: Blob, opts?: unknown) => (c.get('resources') as typeof resources).put(blob, opts),
        resolve: (id: string) => (c.get('resources') as typeof resources).resolve(id),
        addNode: () => undefined,
      }
    }) as CapabilityFactory,
    { order: 100 },
  )
  return {
    ctx: {
      tryGet: (name: string) =>
        name === 'nodes' ? (extra.setLabel ? { setLabel: extra.setLabel } : undefined) : undefined,
      registryOf: ctx.registryOf,
    },
    field,
    resources,
  }
}

describe('styleItemDepsOf：从能力场取 media', () => {
  it('★ 能力场里注册了 media → deps.media 拿得到（不是 undefined）', () => {
    const { ctx } = ctxOf()
    const deps = styleItemDepsOf(ctx as never)
    expect(deps.media).toBeTruthy()
    expect(typeof deps.media!.put).toBe('function')
    expect(typeof deps.media!.addNode).toBe('function')
  })

  it('能力场是空的（宿主没注册）→ undefined，由调用方显示可见提示', () => {
    const ctx = {
      tryGet: () => undefined,
      registryOf: () => fieldOf<CapabilityFactory>(),
    }
    expect(styleItemDepsOf(ctx as never).media).toBeUndefined()
  })

  it('setLabel 走 ctx.tryGet(\'nodes\')；没有就留空（不抛）', () => {
    const setLabel = vi.fn()
    const withNodes = styleItemDepsOf(ctxOf({ setLabel }).ctx as never)
    withNodes.setLabel?.('n1', '风格 A')
    expect(setLabel).toHaveBeenCalledWith('n1', '风格 A')

    const without = styleItemDepsOf(ctxOf().ctx as never)
    expect(() => without.setLabel?.('n1', 'A')).not.toThrow()
  })
})
