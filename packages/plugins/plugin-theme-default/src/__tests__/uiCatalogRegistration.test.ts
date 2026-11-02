/**
 * 默认主题的 ui 目录登记：名字 = 组件库导出名，不含 shadcn 前缀；Toaster 只登记一份。
 *
 * 用户口径（2026-11-03）：`const { Button, DropdownMenuContent } = useUiComponent()`
 * 读起来应该和 `import { Button } from '@/components/ui/button'` 一样自然。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { SHADCN_COMPONENT_NAMES } from '@mini-canvas/ui-kit-shadcn'
import { apply } from '../index'

describe('默认主题登记 ui 目录', () => {
  it('SHADCN_COMPONENTS 的键就是源码导出名（Button / DropdownMenuContent）', () => {
    expect(SHADCN_COMPONENT_NAMES).toContain('Button')
    expect(SHADCN_COMPONENT_NAMES).toContain('DropdownMenuContent')
    expect(SHADCN_COMPONENT_NAMES.some((name) => name.startsWith('shadcn'))).toBe(false)
  })

  it('装上默认主题后，ui 目录能按原名取到组件；没有 shadcn 前缀别名', async () => {
    const ctx = new Context()
    apply(ctx as never)
    await ctx.start()
    const ui = ctx.registryOf<unknown>('ui')
    expect(ui.top('Button')?.value).toBeTruthy()
    expect(ui.top('DropdownMenuContent')?.value).toBeTruthy()
    expect(ui.top('shadcnButton')).toBeUndefined()
    expect(ui.top('Toaster')?.value).toBeTruthy()
    ctx.stop()
  })

  it('notify 服务随默认主题上架，并提供 success / error 等方法', async () => {
    const ctx = new Context()
    apply(ctx as never)
    await ctx.start()
    const notify = ctx.get<{ success?: unknown; error?: unknown }>('notify')
    expect(typeof notify.success).toBe('function')
    expect(typeof notify.error).toBe('function')
    ctx.stop()
  })
})
