import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { CanvasCommand, CommandContext } from './types'

// ---------- helpers ----------
const noop = () => {}
const makeCtx = (overrides?: Partial<CommandContext>): CommandContext => ({
  runtime: undefined,
  actions: undefined,
  selection: undefined,
  viewport: undefined,
  store: undefined,
  logger: { debug: noop, info: noop, warn: noop, error: noop },
  ...overrides,
})

// ---------- minimal mock ----------
function createRegistry() {
  const commands = new Map<string, CanvasCommand>()
  return {
    register(cmd: CanvasCommand) {
      if (commands.has(cmd.id)) throw new Error(Command '' already registered)
      commands.set(cmd.id, cmd)
    },
    unregister(id: string) { commands.delete(id) },
    unregisterSource(source: string) {
      for (const [id, cmd] of commands) {
        if (cmd.source === source) commands.delete(id)
      }
    },
    execute(id: string, ctx: CommandContext, args?: unknown) {
      const cmd = commands.get(id)
      if (!cmd) throw new Error(Command '' not found)
      return cmd.run(ctx, args)
    },
    canExecute(id: string, ctx?: CommandContext): boolean {
      const cmd = commands.get(id)
      if (!cmd) return false
      if (typeof cmd.disabled === 'function') return !cmd.disabled(ctx ?? makeCtx())
      return !cmd.disabled
    },
    has(id: string) { return commands.has(id) },
    get(id: string) { return commands.get(id) ?? null },
    getPublic() {
      return [...commands.values()].filter(c => !c.id.startsWith('_'))
    },
    getAll() { return [...commands.values()] },
  }
}

// ---------- tests ----------
describe('CommandRegistry', () => {
  let registry: ReturnType<typeof createRegistry>

  before(() => { registry = createRegistry() })
  after(() => { registry = createRegistry() })

  it('register and get a command', () => {
    const cmd: CanvasCommand = {
      id: 'test:hello',
      source: 'test',
      title: 'Hello',
      run: () => 'ok',
    }
    registry.register(cmd)
    assert.ok(registry.has('test:hello'))
    assert.equal(registry.get('test:hello')?.title, 'Hello')
  })

  it('execute a command', () => {
    let called = false
    registry.register({
      id: 'test:exec',
      source: 'test',
      run: () => { called = true },
    })
    registry.execute('test:exec', makeCtx())
    assert.ok(called)
  })

  it('execute with args', () => {
    let captured: unknown
    registry.register({
      id: 'test:args',
      source: 'test',
      run: (_ctx, args) => { captured = args },
    })
    registry.execute('test:args', makeCtx(), 42)
    assert.equal(captured, 42)
  })

  it('throw on duplicate id', () => {
    registry.register({
      id: 'test:dup',
      source: 'test',
      run: () => {},
    })
    assert.throws(() => {
      registry.register({
        id: 'test:dup',
        source: 'test2',
        run: () => {},
      })
    }, /already registered/)
  })

  it('unregister by id', () => {
    registry.register({
      id: 'test:remove',
      source: 'test',
      run: () => {},
    })
    assert.ok(registry.has('test:remove'))
    registry.unregister('test:remove')
    assert.ok(!registry.has('test:remove'))
  })

  it('unregisterSource removes all commands from a source', () => {
    registry.register({ id: 'a:1', source: 'pluginA', run: () => {} })
    registry.register({ id: 'a:2', source: 'pluginA', run: () => {} })
    registry.register({ id: 'b:1', source: 'pluginB', run: () => {} })
    registry.unregisterSource('pluginA')
    assert.ok(!registry.has('a:1'))
    assert.ok(!registry.has('a:2'))
    assert.ok(registry.has('b:1'))
  })

  it('getPublic filters internal commands', () => {
    registry.register({ id: '_internal', source: 'test', run: () => {} })
    registry.register({ id: 'visible', source: 'test', run: () => {} })
    const pub = registry.getPublic()
    assert.equal(pub.length, 1)
    assert.equal(pub[0].id, 'visible')
  })

  it('canExecute checks disabled', () => {
    registry.register({
      id: 'test:enabled',
      source: 'test',
      disabled: false,
      run: () => {},
    })
    registry.register({
      id: 'test:disabled',
      source: 'test',
      disabled: true,
      run: () => {},
    })
    assert.ok(registry.canExecute('test:enabled'))
    assert.ok(!registry.canExecute('test:disabled'))
  })

  it('canExecute handles function disabled', () => {
    registry.register({
      id: 'test:fn-disabled',
      source: 'test',
      disabled: (ctx) => !ctx.node,
      run: () => {},
    })
    assert.ok(!registry.canExecute('test:fn-disabled', makeCtx()))
    assert.ok(registry.canExecute('test:fn-disabled', makeCtx({ node: { id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: {} } })))
  })
})
