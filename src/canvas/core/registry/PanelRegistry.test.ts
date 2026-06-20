import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { PanelRegistry } from './PanelRegistry.ts'

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

test('PanelRegistry useValue returns ref bound to store', () => {
  const reg = new PanelRegistry()
  const store = ref<Record<string, Record<string, unknown>>>({ theme: { accent: '#fff' } })
  const accentRef = reg.useValue<string>('theme.accent', store, '#000')
  assert.equal(accentRef.value, '#fff')
  accentRef.value = '#ccc'
  assert.equal(store.value.theme.accent, '#ccc')
})

test('PanelRegistry useValue writes defaultValue when missing', () => {
  const reg = new PanelRegistry()
  const store = ref<Record<string, Record<string, unknown>>>({ theme: {} })
  const ref1 = reg.useValue<boolean>('theme.dark', store, false)
  assert.equal(ref1.value, false)
  assert.equal(store.value.theme.dark, false)
})

test('PanelRegistry useValue with dotted id traverses nested path', () => {
  const reg = new PanelRegistry()
  const store = ref<Record<string, Record<string, unknown>>>({ theme: { colors: { accent: '#abc' } } })
  const accentRef = reg.useValue<string>('theme.colors.accent', store, '#000')
  assert.equal(accentRef.value, '#abc')
})
