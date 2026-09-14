/**
 * bindAlignGuideToggle 单测 —— "只有开着才生效"这条需求的行为锁。
 *
 * 用真内核 + 真实 Config schema 装配（attach 传假函数，故不必加载 .vue 浮层），
 * 断言四件事：
 *   1. 默认开着 → 装配时就 attach；
 *   2. 设置面板关掉 → 立刻 detach（浮层卸载 = 不吸附、不画线、不订阅拖拽）；
 *   3. 再打开 → 重新 attach（可恢复，不是一次性开关）；
 *   4. 插件卸载 → 退订 + detach（不残留，不误触别的插件配置变化）。
 */
import { describe, it, expect, vi } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { Config } from '../alignGuideConfig'
import { bindAlignGuideToggle } from '../alignGuideToggle'

type Detach = () => void

/** 装配插件：apply 里走真实的 bindAlignGuideToggle，attach 用假的（记录调用与撤销） */
async function boot(raw?: unknown) {
  const attach = vi.fn((): Detach => vi.fn())
  const ctx = new Context()
  ctx.plugin(
    {
      name: 'align-guide',
      Config,
      apply: (scope: Context) => {
        scope.effect(() => bindAlignGuideToggle(scope, attach))
      },
    },
    raw,
  )
  await ctx.start()
  return { ctx, attach }
}

/** 第 n 次 attach 返回的撤销函数 */
function detachOf(attach: ReturnType<typeof vi.fn>, n: number): ReturnType<typeof vi.fn> {
  return attach.mock.results[n].value as unknown as ReturnType<typeof vi.fn>
}

describe('总开关的装卸行为', () => {
  it('默认开着：装配时就挂上浮层（拖拽即可吸附画线）', async () => {
    const { ctx, attach } = await boot()
    expect(attach).toHaveBeenCalledTimes(1)
    ctx.stop()
  })

  it('装配时已关掉：一次都不装配（插件的存在不产生任何效果）', async () => {
    const { ctx, attach } = await boot({ alignGuideEnabled: false })
    expect(attach).not.toHaveBeenCalled()
    ctx.stop()
  })

  it('设置面板关掉立刻卸载、再打开重新装配（双向，实时生效）', async () => {
    const { ctx, attach } = await boot()
    const firstDetach = detachOf(attach, 0)

    ctx.settings.set('alignGuideEnabled', false)
    expect(firstDetach).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledTimes(1)

    ctx.settings.set('alignGuideEnabled', true)
    expect(attach).toHaveBeenCalledTimes(2)
    ctx.stop()
  })

  it('关着时重复设同一个值不再动装卸（幂等，不反复挂卸）', async () => {
    const { ctx, attach } = await boot()
    ctx.settings.set('alignGuideEnabled', false)
    ctx.settings.set('alignGuideEnabled', false)
    ctx.settings.set('alignGuideEnabled', false)
    expect(attach).toHaveBeenCalledTimes(1)
    ctx.stop()
  })

  it('别的 key 变化不误触本插件的装卸', async () => {
    const { ctx, attach } = await boot()
    const store = ctx.get<{ setDefault(k: string, v: string | number | boolean): void }>('settings')
    store.setDefault('someOtherKey', 1)
    expect(attach).toHaveBeenCalledTimes(1)
    ctx.stop()
  })

  it('插件卸载 → 退订并卸载浮层（不留残线，也不再监听配置）', async () => {
    const { ctx, attach } = await boot()
    const firstDetach = detachOf(attach, 0)
    expect(ctx.uninstallPlugin('align-guide')).toBe(true)
    expect(firstDetach).toHaveBeenCalledTimes(1)
    ctx.stop()
  })
})
