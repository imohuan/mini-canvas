import test from 'node:test'
import assert from 'node:assert/strict'
import { EdgeCuttingPlugin } from '../EdgeCuttingPlugin.ts'
import type { PluginContext } from '../../types.ts'

class FakeClassList {
  private classes = new Set<string>()

  add(...tokens: string[]) {
    tokens.forEach(token => this.classes.add(token))
  }

  remove(...tokens: string[]) {
    tokens.forEach(token => this.classes.delete(token))
  }

  contains(token: string) {
    return this.classes.has(token)
  }
}

class FakeElement extends EventTarget {
  classList = new FakeClassList()
  style = { cssText: '', setProperty() {} }
  textContent = ''
  children: FakeElement[] = []

  appendChild<T extends FakeElement>(child: T): T {
    this.children.push(child)
    return child
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = children
  }

  setAttribute() {}
  remove() {}
  closest() { return null }
}

class FakeDocument extends EventTarget {
  body = new FakeElement()
  head = new FakeElement()
  visibilityState = 'visible'

  createElement() {
    return new FakeElement()
  }

  createElementNS() {
    return new FakeElement()
  }

  querySelector() {
    return null
  }
}

class FakeWindow extends EventTarget {
  innerWidth = 1024
  innerHeight = 768
  setTimeout = setTimeout
}

class FakeKeyboardEvent extends Event {
  key: string

  constructor(type: string, init: { key: string }) {
    super(type, { cancelable: true })
    this.key = init.key
  }
}

class FakePointerEvent extends Event {
  button: number
  altKey: boolean
  clientX: number
  clientY: number

  constructor(type: string, init: { button?: number; altKey?: boolean; clientX?: number; clientY?: number } = {}) {
    super(type, { cancelable: true })
    this.button = init.button ?? 0
    this.altKey = init.altKey ?? false
    this.clientX = init.clientX ?? 0
    this.clientY = init.clientY ?? 0
  }
}

function installPlugin() {
  const fakeDocument = new FakeDocument()
  const fakeWindow = new FakeWindow()
  const pane = new FakeElement()

  Object.assign(globalThis, {
    document: fakeDocument,
    window: fakeWindow,
    HTMLElement: FakeElement,
    SVGPathElement: FakeElement,
    SVGSVGElement: FakeElement,
    KeyboardEvent: FakeKeyboardEvent,
    PointerEvent: FakePointerEvent,
  })

  const context = {
    panels: { registerSetting() {} },
    store: { toRef: (_key: string, value: unknown) => ({ value }) },
    dom: { getPane: () => pane },
    actions: { getEdges: () => [], removeEdges() {} },
    emit() {},
    logger: { info() {}, error() {}, warn() {}, debug() {} },
  } as unknown as PluginContext

  const result = EdgeCuttingPlugin.install(context, { enabled: true })
  return { fakeDocument, fakeWindow, pane, uninstall: result?.uninstall }
}

test('does not start cutting from stale Alt state when the current pointer event has no Alt', () => {
  const { fakeDocument, fakeWindow, pane, uninstall } = installPlugin()
  fakeWindow.dispatchEvent(new FakeKeyboardEvent('keydown', { key: 'Alt' }))

  const pointerDown = new FakePointerEvent('pointerdown', { altKey: false, button: 0 })
  pane.dispatchEvent(pointerDown)

  assert.equal(pointerDown.defaultPrevented, false)
  assert.equal(fakeDocument.body.classList.contains('edge-cutting-active'), false)
  uninstall?.()
})

test('clears Alt cutting mode when the window loses focus', () => {
  const { fakeDocument, fakeWindow, uninstall } = installPlugin()
  fakeWindow.dispatchEvent(new FakeKeyboardEvent('keydown', { key: 'Alt' }))
  assert.equal(fakeDocument.body.classList.contains('edge-cutting-active'), true)

  fakeWindow.dispatchEvent(new Event('blur'))

  assert.equal(fakeDocument.body.classList.contains('edge-cutting-active'), false)
  uninstall?.()
})

test('clears stale Alt mode when the window gets focus again', () => {
  const { fakeDocument, fakeWindow, uninstall } = installPlugin()
  fakeWindow.dispatchEvent(new FakeKeyboardEvent('keydown', { key: 'Alt' }))
  assert.equal(fakeDocument.body.classList.contains('edge-cutting-active'), true)

  fakeWindow.dispatchEvent(new Event('focus'))

  assert.equal(fakeDocument.body.classList.contains('edge-cutting-active'), false)
  uninstall?.()
})

test('clears stale Alt mode on pointer movement when Alt is no longer pressed', () => {
  const { fakeDocument, fakeWindow, uninstall } = installPlugin()
  fakeWindow.dispatchEvent(new FakeKeyboardEvent('keydown', { key: 'Alt' }))
  assert.equal(fakeDocument.body.classList.contains('edge-cutting-active'), true)

  fakeWindow.dispatchEvent(new FakePointerEvent('pointermove', { altKey: false }))

  assert.equal(fakeDocument.body.classList.contains('edge-cutting-active'), false)
  uninstall?.()
})
