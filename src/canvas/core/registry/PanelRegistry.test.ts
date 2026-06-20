import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { PanelRegistry } from './PanelRegistry.ts'

type StoreShape = { core: Record<string, unknown>; plugins: Record<string, Record<string, unknown>> }
function makeStore(init?: { core?: Record<string, unknown>; plugins?: Record<string, Record<string, unknown>> }) {
  return ref<StoreShape>({
    core: init?.core ?? {},
    plugins: init?.plugins ?? {},
  })
}

test('PanelRegistry registerSetting stores definition', () => {
  const reg = new PanelRegistry()
  reg.registerSetting('theme', {
    id: 'theme.accent',
    source: 'theme',
    title: '强调色',
    type: 'color',
    defaultValue: '#3b82f6',
  })
  const all = reg.getAll()
  assert.equal(all.length, 1)
  assert.equal(all[0].id, 'theme.accent')
  assert.equal(all[0].type, 'color')
})

test('PanelRegistry unregisterSource removes only that source', () => {
  const reg = new PanelRegistry()
  reg.registerSetting('a', { id: 'a.x', source: 'a', title: 'X', type: 'boolean' })
  reg.registerSetting('b', { id: 'b.y', source: 'b', title: 'Y', type: 'text' })
  reg.unregisterSource('a')
  const all = reg.getAll()
  assert.equal(all.length, 1)
  assert.equal(all[0].source, 'b')
})

test('PanelRegistry useValue returns ref bound to store (plugins path)', () => {
  const reg = new PanelRegistry()
  const store = makeStore({ plugins: { theme: { accent: '#fff' } } })
  const accentRef = reg.useValue<string>('theme.accent', store, '#000')
  assert.equal(accentRef.value, '#fff')
  accentRef.value = '#ccc'
  assert.equal(store.value.plugins.theme.accent, '#ccc')
})

test('PanelRegistry useValue writes defaultValue when missing (plugins path)', () => {
  const reg = new PanelRegistry()
  const store = makeStore({ plugins: { theme: {} } })
  const ref1 = reg.useValue<boolean>('theme.dark', store, false)
  assert.equal(ref1.value, false)
  assert.equal(store.value.plugins.theme.dark, false)
})

test('PanelRegistry useValue with dotted id traverses nested path (plugins path)', () => {
  const reg = new PanelRegistry()
  const store = makeStore({ plugins: { theme: { colors: { accent: '#abc' } } } })
  const accentRef = reg.useValue<string>('theme.colors.accent', store, '#000')
  assert.equal(accentRef.value, '#abc')
})

test('PanelRegistry useValue returns ref bound to store (core path)', () => {
  const reg = new PanelRegistry()
  const store = makeStore({ core: { edgeColor: '#3b82f6' } })
  const colorRef = reg.useValue<string>('core.edgeColor', store, '#000')
  assert.equal(colorRef.value, '#3b82f6')
  colorRef.value = '#ef4444'
  assert.equal(store.value.core.edgeColor, '#ef4444')
})

test('PanelRegistry useValue writes defaultValue when missing (core path)', () => {
  const reg = new PanelRegistry()
  const store = makeStore()
  const ref1 = reg.useValue<number>('core.edgeLineWidth', store, 2)
  assert.equal(ref1.value, 2)
  assert.equal(store.value.core.edgeLineWidth, 2)
})

test('PanelRegistry useValue does not cross-contaminate core and plugins', () => {
  const reg = new PanelRegistry()
  const store = makeStore({
    core: { edgeColor: '#3b82f6' },
    plugins: { theme: { accent: '#111' } },
  })
  const coreRef = reg.useValue<string>('core.edgeColor', store, '#000')
  const pluginRef = reg.useValue<string>('theme.accent', store, '#000')
  assert.equal(coreRef.value, '#3b82f6')
  assert.equal(pluginRef.value, '#111')
  coreRef.value = '#fff'
  assert.equal(store.value.core.edgeColor, '#fff')
  assert.equal(store.value.plugins.theme.accent, '#111')
})
