import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { CommandRegistry } from "./CommandRegistry.ts"
import type { CanvasCommand, CommandContext } from "./types"

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

// ---------- tests ----------
describe("CommandRegistry", () => {
  let registry: CommandRegistry

  before(() => { registry = new CommandRegistry() })
  after(() => { registry = new CommandRegistry() })

  it("register and get a command", () => {
    const cmd: CanvasCommand = {
      id: "test:hello",
      source: "test",
      title: "Hello",
      run: () => {},
    }
    registry.register(cmd)
    assert.ok(registry.has("test:hello"))
    assert.equal(registry.get("test:hello")?.title, "Hello")
  })

  it("execute a command", async () => {
    let called = false
    registry.register({
      id: "test:exec",
      source: "test",
      run: () => { called = true },
    })
    await registry.execute("test:exec", makeCtx())
    assert.ok(called)
  })

  it("execute with args", async () => {
    let captured: unknown
    registry.register({
      id: "test:args",
      source: "test",
      run: (_ctx, args) => { captured = args },
    })
    await registry.execute("test:args", makeCtx(), 42)
    assert.equal(captured, 42)
  })

  it("execute unknown command throws", async () => {
    await assert.rejects(
      () => registry.execute("nonexistent", makeCtx()),
      /Command not found/,
    )
  })

  it("duplicate id overwrites", () => {
    registry.register({
      id: "test:dup",
      source: "test",
      run: () => {},
    })
    registry.register({
      id: "test:dup",
      source: "test2",
      run: () => {},
    })
    // 后注册的覆盖先注册的
    assert.equal(registry.get("test:dup")?.source, "test2")
  })

  it("unregister by id", () => {
    registry.register({
      id: "test:remove",
      source: "test",
      run: () => {},
    })
    assert.ok(registry.has("test:remove"))
    registry.unregister("test:remove")
    assert.ok(!registry.has("test:remove"))
  })

  it("unregisterSource removes all commands from a source", () => {
    registry.register({ id: "a:1", source: "pluginA", run: () => {} })
    registry.register({ id: "a:2", source: "pluginA", run: () => {} })
    registry.register({ id: "b:1", source: "pluginB", run: () => {} })
    registry.unregisterSource("pluginA")
    assert.ok(!registry.has("a:1"))
    assert.ok(!registry.has("a:2"))
    assert.ok(registry.has("b:1"))
  })

  it("getPublic returns only commands with title", () => {
    registry.register({ id: "_hidden", source: "test", run: () => {} })
    registry.register({ id: "shown", source: "test", title: "Shown", run: () => {} })
    const pub = registry.getPublic()
    const ids = pub.map(c => c.id)
    assert.ok(ids.includes("shown"))
    assert.ok(!ids.includes("_hidden"))
  })

  it("canExecute checks disabled boolean", () => {
    registry.register({
      id: "test:enabled",
      source: "test",
      disabled: false,
      run: () => {},
    })
    registry.register({
      id: "test:disabled",
      source: "test",
      disabled: true,
      run: () => {},
    })
    assert.ok(registry.canExecute("test:enabled"))
    assert.ok(!registry.canExecute("test:disabled"))
  })

  it("canExecute handles function disabled", () => {
    registry.register({
      id: "test:fn-disabled",
      source: "test",
      disabled: (ctx) => !ctx.node,
      run: () => {},
    })
    assert.ok(!registry.canExecute("test:fn-disabled", makeCtx()))
    assert.ok(registry.canExecute("test:fn-disabled", makeCtx({
      node: { id: "n1", type: "text", position: { x: 0, y: 0 }, data: {} },
    })))
  })

  it("execute catches run errors via logger", async () => {
    let loggedError = false
    registry.register({
      id: "test:throws",
      source: "test",
      run: () => { throw new Error("boom") },
    })
    const ctx = makeCtx({
      logger: { debug: noop, info: noop, warn: noop, error: () => { loggedError = true } },
    })
    await registry.execute("test:throws", ctx)
    assert.ok(loggedError)
  })

  it("visible command still executable via code", async () => {
    let called = false
    registry.register({
      id: "test:invisible",
      source: "test",
      title: "Invisible",
      visible: false,
      run: () => { called = true },
    })
    await registry.execute("test:invisible", makeCtx())
    assert.ok(called)
  })
})