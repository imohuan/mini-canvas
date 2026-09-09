/**
 * canvas-export smoke：装配导出命令插件不抛、命令已注册（P1-15 补每包 smoke）。
 */
import { describe, it, expect } from 'vitest'
import { Context, Selection, CommandRegistry } from '@mini-canvas/canvas-core-v2'
import { canvasExportPlugin } from '../canvasExportPlugin'

function boot() {
  const ctx = new Context()
  ctx.inject('selection', new Selection())
  ctx.inject('command', new CommandRegistry())
  ctx.plugin(canvasExportPlugin)
  return ctx
}

describe('canvas-export 装配 smoke', () => {
  it('插件可装配启动；canvas-export:full / :selected 命令已注册（浏览器外不装 DOM 也安全）', async () => {
    const ctx = boot()
    await ctx.start()
    const cmd = ctx.get<{ has(id: string): boolean }>('command')
    expect(cmd.has('canvas-export:full')).toBe(true)
    expect(cmd.has('canvas-export:selected')).toBe(true)
    ctx.stop()
  })
})

