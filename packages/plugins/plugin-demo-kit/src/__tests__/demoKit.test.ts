/**
 * demo-kit 的接线守卫（合并前四个包各自的守卫，收成一份）。
 *
 * 锁四件事：
 * 1. 身份：一个可安装件，不是产品自带件；清单名 / 运行时名 / 标题三处对得上；
 * 2. 四套演示都真的登记了东西（展厅 / 顶栏插槽 / 外壳槽 / 热重载靶子）；
 * 3. 所有条目 id 都带 `demo-kit/` 前缀（卸载好认，也不跟真实插件撞 id）；
 * 4. 卸载 demo-kit → 四套条目一起回收，不留半截浮层。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Context } from '@plume-canvas/canvas-data'
import { apply, name, inject } from '../index'
import { apply as applyGallery } from '../gallery'
import { apply as applyUiSlots } from '../ui-slots'
import { apply as applyShellSlots } from '../shell-slots'
import { apply as applyHotReload } from '../hot-reload'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as {
  plume?: { installable?: boolean; builtin?: boolean; pluginName?: string; title?: string }
  scripts?: Record<string, string>
}

describe('demo-kit 身份', () => {
  it('是可安装示例，不是产品自带件', () => {
    expect(pkg.plume?.installable).toBe(true)
    expect(pkg.plume?.builtin).toBeUndefined()
  })

  it('清单名、运行时名一致，标题能认出是示例', () => {
    expect(pkg.plume?.pluginName).toBe('demo-kit')
    expect(name).toBe('demo-kit')
    expect(pkg.plume?.title).toContain('示例')
  })

  it('四套演示都不声明硬依赖（缺主题也能装，只是少了默认件）', () => {
    expect(inject).toEqual([])
  })

  it('有构建脚本；构建过就必须产出对应全局名', () => {
    expect(typeof pkg.scripts?.build).toBe('string')
    const out = path.join(PKG_ROOT, 'dist/plugin-demo-kit.js')
    if (!existsSync(out)) return
    expect(readFileSync(out, 'utf8')).toMatch(/\.PlumePluginDemoKit\s*=\s*\{\}/)
  })
})

describe('demo-kit 四套演示都登记了东西', () => {
  it('展厅 / 顶栏 / 外壳槽 / 热重载靶子各有条目，且都以 demo-kit/ 开头', async () => {
    const ctx = new Context()
    ctx.plugin({ name, apply })
    await ctx.start()

    const slots = (ctx as unknown as {
      slots: { occupants(slot: string): Array<{ id: string; meta?: unknown }> }
    }).slots
    const overlay = slots.occupants('overlay')
    const topToolbar = slots.occupants('image.topToolbar')
    const status = slots.occupants('shell.status')
    const dock = slots.occupants('shell.dock')
    const tabs = slots.occupants('shell.drawer.tabs')

    expect(overlay).toHaveLength(2) // 组件展厅 + 热重载靶子
    expect(topToolbar).toHaveLength(1)
    expect(status).toHaveLength(2)
    expect(dock).toHaveLength(3)
    expect(tabs).toHaveLength(1)
    // 抽屉页签必须带 meta.panel（宿主契约：缺面板会被忽略）
    expect((tabs[0]!.meta as { panel?: unknown }).panel).toBeTruthy()

    const ids = [...overlay, ...topToolbar, ...status, ...dock, ...tabs].map((e) => e.id)
    for (const id of ids) expect(id.startsWith('demo-kit/'), id).toBe(true)

    ctx.stop()
  })

  it('卸载 demo-kit 后四套条目一起回收', async () => {
    const ctx = new Context()
    ctx.plugin({ name, apply })
    await ctx.start()
    const slots = (ctx as unknown as { slots: { occupants(slot: string): unknown[] } }).slots

    ctx.uninstallPlugin('demo-kit')

    expect(slots.occupants('overlay')).toHaveLength(0)
    expect(slots.occupants('image.topToolbar')).toHaveLength(0)
    expect(slots.occupants('shell.status')).toHaveLength(0)
    expect(slots.occupants('shell.dock')).toHaveLength(0)
    expect(slots.occupants('shell.drawer.tabs')).toHaveLength(0)
    // 颜色配方已迁进默认主题：demo-kit 不注册任何设置页
    expect(slots.occupants('settingsGroup/主题工作台')).toHaveLength(0)
  })
})

describe('各子演示单独可调（便于测试与将来拆分）', () => {
  it('四个 apply 都是函数，且各自只登记自己的槽', () => {
    for (const fn of [applyGallery, applyUiSlots, applyShellSlots, applyHotReload]) {
      expect(typeof fn).toBe('function')
    }
    const seen: Array<[string, string]> = []
    const ctx = {
      slots: { register: (slot: string, req: { id: string }) => { seen.push([slot, req.id]); return req.id } },
      tryGet: () => undefined,
      effect: () => undefined,
      on: () => ({ dispose: () => undefined }),
    }
    applyGallery(ctx as never)
    applyShellSlots(ctx as never)
    applyHotReload(ctx as never)
    const slots = seen.map(([s]) => s)
    expect(slots).toContain('overlay')
    expect(slots).toContain('shell.status')
    expect(slots.filter((s) => s === 'shell.dock')).toHaveLength(3)
  })
})
