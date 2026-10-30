/**
 * ui-kit 文档插件的 HMR 契约。
 *
 * 规矩（Vite 6/7/8 一路收紧）：`server.moduleGraph` 上**没有** `moduleMap` 这个字段；
 * 按 id 找模块只能用 `idToModuleMap`（或 `getModuleById` / `getModulesByFile`）。
 * 旧实现 `for (const mod of ctx.server.moduleGraph.moduleMap.values())` 会在 Vite 8 里
 * 直接抛 `Cannot read properties of undefined (reading 'values')` —— 现象是
 * 「改一篇组件文档，dev server 报错、页面不更新」，而首屏与构建完全正常，很容易漏掉。
 *
 * 这里不启真 dev server（那要把整个 Vite 拉起来、几秒起步），而是把插件对象拿出来，
 * 喂一个**形状正确**的假 server，验证：
 *   1. 文档改动时能成功失效所有虚拟文档模块（不抛错、真的调了 invalidateModule）；
 *   2. 非文档文件（源码 .ts）不该触发任何失效；
 *   3. 不在 docs 目录下的 .md 也不管（别的包的 README）。
 */
import { describe, expect, it, vi } from 'vitest'
import { uiKitDocsPlugin } from '../../vite'

const DOCS_DIR = 'D:/fake/ui-kit/docs'

/** 造一个只带 moduleGraph 的假 server（够插件用，不模仿整个 ViteDevServer） */
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
  it('改一篇文档会失效对应的虚拟模块（不依赖已删除的 moduleMap）', () => {
    const plugin = uiKitDocsPlugin(DOCS_DIR)
    const hook = plugin.handleHotUpdate as unknown as (ctx: HotCtx) => void
    expect(typeof hook, '插件没有 handleHotUpdate').toBe('function')

    const fake = fakeServer([
      '\0virtual:ui-kit-doc/button',
      '\0virtual:ui-kit-doc/input',
      'virtual:ui-kit-doc-example/button/0.vue',
      'D:/fake/ui-kit/src/index.ts',
    ])
    expect(() => hook({ file: DOCS_DIR + '/button.md', server: fake.server } as HotCtx)).not.toThrow()
    expect(fake.invalidateModule, '一个模块都没失效 → 页面不会热更新').toHaveBeenCalled()
    const invalidated = fake.invalidateModule.mock.calls.map((c) => (c[0] as { id: string }).id)
    expect(invalidated, '文档模块没被失效').toContain('\0virtual:ui-kit-doc/button')
    expect(invalidated, '示例模块没被失效').toContain('virtual:ui-kit-doc-example/button/0.vue')
    expect(invalidated, '把源码模块也失效了（会白屏整页重载）').not.toContain('D:/fake/ui-kit/src/index.ts')
  })

  it('改源码 / 别的目录的 md 不触发文档失效', () => {
    const plugin = uiKitDocsPlugin(DOCS_DIR)
    const hook = plugin.handleHotUpdate as unknown as (ctx: HotCtx) => void
    const fake = fakeServer(['\0virtual:ui-kit-doc/button'])
    hook({ file: 'D:/fake/ui-kit/src/index.ts', server: fake.server } as HotCtx)
    hook({ file: 'D:/fake/other/README.md', server: fake.server } as HotCtx)
    expect(fake.invalidateModule, '非文档文件也去失效了').not.toHaveBeenCalled()
  })
})
