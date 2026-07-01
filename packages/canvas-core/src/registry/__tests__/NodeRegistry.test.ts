import test from "node:test"
import assert from "node:assert/strict"
import { NodeRegistry } from "../NodeRegistry.ts"

test("NodeRegistry registers full node definition", () => {
  const registry = new NodeRegistry()
  const comp = {} as any

  registry.register({
    type: "image",
    node: comp,
    label: "图片",
    defaultSize: { cardWidth: 360, cardHeight: 270 },
    menuItem: { label: "图片", description: "创建图片节点", icon: "image" },
    canReceiveInput: true,
    resizable: false,
  })

  const found = registry.get("image")
  assert.ok(found)
  assert.equal(found!.node, comp)
  assert.deepEqual(found!.defaultSize, { cardWidth: 360, cardHeight: 270 })
  assert.equal(found!.menuItem.label, "图片")
})

test("NodeRegistry menu items are derived from registered nodes", () => {
  const registry = new NodeRegistry()
  registry.register({ type: "text", label: "文本", defaultSize: { cardWidth: 300, cardHeight: 320 }, menuItem: { label: "文本", description: "创建文本节点", icon: "text" } })
  registry.register({ type: "stage", label: "导演台", defaultSize: { cardWidth: 320, cardHeight: 320 }, menuItem: { label: "导演台", description: "创建编排节点", icon: "layers", badge: "NEW" } })

  assert.deepEqual(registry.getMenuItems().map(item => item.id), ["text", "stage"])
  assert.equal(registry.getMenuItems()[1].badge, "NEW")
})

test("NodeRegistry fallback for unknown type", () => {
  const registry = new NodeRegistry()
  assert.deepEqual(registry.getDefaultSize("unknown"), { cardWidth: 256, cardHeight: 256 })
  assert.equal(registry.canReceiveInput("unknown"), true)
  assert.equal(registry.canProduceOutput("unknown"), true)
  assert.equal(registry.isResizable("unknown"), false)
})

test("NodeRegistry unregister removes definition", () => {
  const registry = new NodeRegistry()
  registry.register({ type: "text", label: "文本", defaultSize: { cardWidth: 300, cardHeight: 320 }, menuItem: { label: "文本" } })
  registry.unregister("text")
  assert.equal(registry.get("text"), null)
})

test("NodeRegistry acceptsInputs returns declared types", () => {
  const registry = new NodeRegistry()
  registry.register({
    type: "panorama",
    label: "360全景",
    defaultSize: { cardWidth: 640, cardHeight: 400 },
    menuItem: { label: "360全景" },
    acceptsInputs: ["image"],
  })
  assert.deepEqual(registry.getAcceptsInputs("panorama"), ["image"])
})

test("NodeRegistry acceptsInputs returns undefined when not declared", () => {
  const registry = new NodeRegistry()
  registry.register({
    type: "image",
    label: "图片",
    defaultSize: { cardWidth: 360, cardHeight: 270 },
    menuItem: { label: "图片" },
  })
  assert.equal(registry.getAcceptsInputs("image"), undefined)
})