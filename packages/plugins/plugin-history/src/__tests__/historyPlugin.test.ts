import { describe, expect, it, vi } from 'vitest'
import { CommandRegistry, Context, History, type HistorySnapshot } from '@mini-canvas/canvas-core-v2'
import { historyPlugin, name } from '../historyPlugin'

/** 极简快照存储：外部 state 引用 + 深拷贝桥 */
function makeHistory(): { history: History; set: (v: string) => void; get: () => string } {
  let state = 'a'
  const store: HistorySnapshot<string> = {
    snapshot: () => state,
    restore: (s: string) => {
      state = s
    },
  }
  const history = new History(store)
  return {
    history,
    set: (v: string) => {
      history.withRecord(() => {
        state = v
      })
    },
    get: () => state,
  }
}

describe('plugin-history', () => {
  it('插件名/依赖正确', () => {
    expect(name).toBe('history')
    expect(historyPlugin.inject).toContain('history')
  })

  it('apply 注册 history:undo/redo 命令并上架 history-facade 服务', async () => {
    const ctx = new Context()
    const { history, set, get } = makeHistory()
    ctx.inject('history', history)
    const command = new CommandRegistry()
    ctx.inject('command', command)
    await ctx.start()

    ctx.installPlugin(historyPlugin)

    const facade = ctx.get<{ canUndo(): boolean; canRedo(): boolean }>('history-facade')
    expect(facade).toBeTruthy()
    expect(command.has('history:undo')).toBe(true)
    expect(command.has('history:redo')).toBe(true)

    // 先做一次可撤销变更 → canUndo true
    set('b')
    expect(facade!.canUndo()).toBe(true)
    expect(get()).toBe('b')

    // 执行 history:undo 命令 → 回到 a
    command.execute('history:undo')
    expect(get()).toBe('a')
    expect(facade!.canRedo()).toBe(true)

    // 执行 history:redo → 回到 b
    command.execute('history:redo')
    expect(get()).toBe('b')

    await ctx.stop()
  })

  it('热卸后命令与 facade 回收', async () => {
    const ctx = new Context()
    const { history } = makeHistory()
    ctx.inject('history', history)
    const command = new CommandRegistry()
    ctx.inject('command', command)
    await ctx.start()
    ctx.installPlugin(historyPlugin)
    expect(ctx.get('history-facade')).toBeTruthy()

    ctx.uninstallPlugin('history')
    expect(ctx.get('history-facade')).toBeUndefined()
    expect(command.has('history:undo')).toBe(false)
    await ctx.stop()
  })
})
