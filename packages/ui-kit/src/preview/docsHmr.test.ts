/**
 * ui-kit 文档插件的 HMR 契约。
 *
 * 文档现在住在组件目录里（src/components/<id>/docs.md），插件传入的目录是
 * src/components；改任意组件的 docs.md 都要失效所有虚拟文档模块。
 *
 * 历史坑：Vite 6/7/8 的 moduleGraph 上没有 moduleMap 字段，只能走 idToModuleMap；
 * 旧实现直接遍历 moduleMap 会在 Vite 8 抛错，表现为「改文档、页面不更新」。
 */
import { describe, expect, it, vi } from 'vitest'
import { uiKitDocsPlugin } from '../../vite'

const COMPONENTS_DIR = 'D:/fake/ui-kit/src/components'

/** 造一个只带 moduleGraph 的假 server（够插件用，不模仿整个 ViteDevServer）。 */
function fakeServer(ids: string[]) {
  const mods = ids.map((id) => ({ id }))
  const invalidateModule = vi.fn()
  return {
    server: {
      moduleGraph: {
        idToModuleMap: new Map(mods.map((m) => [m.id, m])),
        invalidateModule,
      },
    },
    invalidateModule,
    mods,
  }
}

type HotCtx = { file: string; server: ReturnType<typeof fakeServer>['server'] }

describe('ui-kit 文档插件的热更新', () => {
  it('改一篇组件文档会失效对应的虚拟模块（不依赖已删除的 moduleMap）', () => {
    const plugin = uiKitDocsPlugin(COMPONENTS_DIR)
    const hook = plugin.handleHotUpdate as unknown as (ctx: HotCtx) => void
    expect(typeof hook, '插件没有 handleHotUpdate').toBe('function')

    const fake = fakeServer([
      '\0virtual:ui-kit-doc/button',
      '\0virtual:ui-kit-doc/input',
      'virtual:ui-kit-doc-example/button/0.vue',
      'D:/fake/ui-kit/src/index.ts',
    ])
    expect(() => hook({ file: COMPONENTS_DIR + '/button/docs.md', server: fake.server } as HotCtx)).not.toThrow()
    expect(fake.invalidateModule, '一个模块都没失效 → 页面不会热更新').toHaveBeenCalled()
    const invalidated = fake.invalidateModule.mock.calls.map((c) => (c[0] as { id: string }).id)
    expect(invalidated, '文档模块没被失效').toContain('\0virtual:ui-kit-doc/button')
    expect(invalidated, '示例模块没被失效').toContain('virtual:ui-kit-doc-example/button/0.vue')
    expect(invalidated, '把源码模块也失效了（会白屏整页重载）').not.toContain('D:/fake/ui-kit/src/index.ts')
  })

  it('改源码 / 别的目录的 md 不触发文档失效', () => {
    const plugin = uiKitDocsPlugin(COMPONENTS_DIR)
    const hook = plugin.handleHotUpdate as unknown as (ctx: HotCtx) => void
    const fake = fakeServer(['\0virtual:ui-kit-doc/button'])
    hook({ file: 'D:/fake/ui-kit/src/index.ts', server: fake.server } as HotCtx)
    hook({ file: 'D:/fake/other/README.md', server: fake.server } as HotCtx)
    expect(fake.invalidateModule, '非文档文件也去失效了').not.toHaveBeenCalled()
  })
})
