/**
 * 作者上下文的服务类型推导（执行计划 T03）。
 *
 * 目标：内置服务名直接决定 get/tryGet 的返回类型，插件不必再手写
 * ctx.get<DocService>('doc') 这类"靠人抄对"的泛型；同时旧写法与扩展服务仍可用。
 *
 * 本文件的价值一半在编译期：下面若干 "const x: SomeService = ctx.get('name')"
 * 若推导失效会直接编译报错（canvas-base 的 typecheck 覆盖 src）。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import type { DocService, SelectionService, ResourceService } from '@mini-canvas/canvas-data'
import type { ViewContract, FitToOptions } from '../index'

describe('T03 · 按服务名推导类型', () => {
  it('canvas-base 导出完整取景契约（含 durationMs 等合法参数）', () => {
    // 编译期断言：插件作者只引 canvas-base 也要拿到完整选项。
    // 底栏曾手写窄端口，结果传入 durationMs 时 UI typecheck 报「不认识该字段」。
    const opts: FitToOptions = { heightRatio: 0.5, minZoom: 0.1, maxZoom: 4, durationMs: 200 }
    expect(opts.durationMs).toBe(200)
    const probe: Pick<ViewContract, 'fitTo'> | undefined = undefined
    expect(probe).toBeUndefined()
  })

  it('已知服务名：get 返回集中声明的类型（编译期断言 + 运行期取值）', async () => {
    const ctx = new Context()
    let doc: DocService | undefined
    let selection: SelectionService | undefined
    let resources: ResourceService | undefined
    const injectedCanvas = {
      listCommands: () => [] as Array<{ id: string }>,
    }
    ctx.inject('canvas', injectedCanvas)

    ctx.plugin({
      name: 'type-probe',
      setup(c) {
        // 编译期：不写泛型也必须推出正确类型（写错会编译报错）
        doc = c.get('doc')
        selection = c.get('selection')
        resources = c.get('resources')
        // command 服务名已并入 canvas；这里验证新入口在类型上可按名取。
        expect(typeof c.get('canvas').listCommands).toBe('function')
      },
    })
    await ctx.start()

    // 运行期：类型推导不改变运行时行为，取到的就是同一批注入实例
    expect(doc).toBe(ctx.get('doc'))
    expect(selection).toBe(ctx.get('selection'))
    expect(resources).toBe(ctx.get('resources'))
    expect(Array.isArray(ctx.get('canvas').listCommands())).toBe(true)
  })

  it('tryGet 同样按名推导，缺服务返回 undefined', async () => {
    const ctx = new Context()
    let missing: ResourceService | undefined
    let present: DocService | undefined
    ctx.plugin({
      name: 'probe',
      setup(c) {
        missing = c.tryGet('resources')
        present = c.tryGet('doc')
      },
    })
    await ctx.start()
    // 两个都没注入 → undefined；类型仍是各自服务类型（编译期已验）
    expect(missing).toBeUndefined()
    expect(present).toBeUndefined()
  })

  it('旧写法（显式泛型 / 扩展服务名）不被新重载破坏', async () => {
    const ctx = new Context()
    interface MyThing { value: number }
    ctx.inject('my-thing', { value: 42 } as MyThing)

    let explicit: MyThing | undefined
    let unknownName: unknown
    ctx.plugin({
      name: 'legacy-probe',
      setup(c) {
        // 扩展服务：服务名不在 Services 里 → 走显式泛型重载
        explicit = c.get<MyThing>('my-thing')
        // 不写泛型的未知服务名 → 回落到宽松重载（不报错）
        unknownName = c.get('not-declared-anywhere')
      },
    })
    await ctx.start()
    expect(explicit).toEqual({ value: 42 })
    expect(unknownName).toBeUndefined()
  })
})
