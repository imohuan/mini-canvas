import { describe, it, expect } from 'vitest'
import { SettingsStore } from '@plume-canvas/kernel'
import { SaveServiceImpl } from '../storage/SaveService'
import { MemoryStorageAdapter } from '../storage/memoryAdapter'
import { createSettingsPersist, SETTINGS_SAVE_KEY } from '../settingsPersist'

function makePair() {
  const store = new SettingsStore()
  const save = new SaveServiceImpl(new MemoryStorageAdapter())
  return { store, save }
}

describe('SettingsPersist 配置持久化桥', () => {
  it('restore 把上次保存值注入：先注入快照后 define 的插件项以保存值为初值', async () => {
    const { store, save } = makePair()
    save.set(SETTINGS_SAVE_KEY, { edgeColor: '#ff0000' }, 'config')
    await save.flush()
    const persist = createSettingsPersist(store, save)
    await persist.restore()
    store.define('g', { edgeColor: { type: 'color', default: '#000' } }, 'p')
    expect(store.get('edgeColor')).toBe('#ff0000')
    persist.dispose()
  })
  it('运行期 set 自动写入保存快照；dispose 后不再写', async () => {
    const { store, save } = makePair()
    store.define('g', { x: { type: 'number', default: 1 } }, 'p')
    const persist = createSettingsPersist(store, save)
    await persist.restore()
    store.set('x', 5)
    await save.flush()
    expect(await save.get(SETTINGS_SAVE_KEY, 'config')).toEqual({ x: 5 })
    persist.dispose()
    store.set('x', 9)
    await save.flush()
    expect(await save.get(SETTINGS_SAVE_KEY, 'config')).toEqual({ x: 5 }) // 不再更新
  })
  /**
   * 恢复过程中的就地纠正要落盘。
   *
   * 真实场景：cloud-client 的 apply 里有个 onChange，收到非法服务地址（用户存成过一个汉字）
   * 就改回空串。restore 注入快照时正好触发它，但那一刻桥还没 subscribe —— 不补这一次对账，
   * 脏值会一直留在 localStorage 里，每次启动都重新触发一遍。
   */
  it('restore 期间插件就地纠正的值会写回存档', async () => {
    const { store, save } = makePair()
    save.set(SETTINGS_SAVE_KEY, { address: 'dirty' }, 'config')
    await save.flush()
    store.define('g', { address: { type: 'text', default: '' } }, 'p')
    // 模拟插件：一旦收到变化就把它改回空串（发生在 setSavedSnapshot 的同步通知里）
    store.onChange((key, value) => {
      if (key === 'address' && value !== '') store.set('address', '')
    })
    const persist = createSettingsPersist(store, save)
    await persist.restore()
    await save.flush()
    expect(store.get('address')).toBe('')
    expect(await save.get(SETTINGS_SAVE_KEY, 'config')).toEqual({ address: '' })
    persist.dispose()
  })

  it('persistNow 落盘当前全部值；resetKey 恢复默认并清快照', async () => {
    const { store, save } = makePair()
    store.define('g', { x: { type: 'number', default: 1 }, y: { type: 'text', default: 'a' } }, 'p')
    store.set('x', 3)
    store.set('y', 'b')
    const persist = createSettingsPersist(store, save)
    await persist.restore()
    await persist.persistNow()
    expect(await save.get(SETTINGS_SAVE_KEY, 'config')).toEqual({ x: 3, y: 'b' })
    expect(persist.resetKey('x')).toBe(true)
    expect(store.get('x')).toBe(1) // 回默认
    await save.flush()
    const after = await save.get(SETTINGS_SAVE_KEY, 'config')
    expect(after).toEqual({ y: 'b' })
    expect(persist.resetKey('nope')).toBe(false)
    persist.dispose()
  })
  it('未保存过时 restore no-op；热卸插件重装后仍恢复用户值', async () => {
    const { store, save } = makePair()
    const persist = createSettingsPersist(store, save)
    await persist.restore()
    expect(store.getSavedSnapshot()).toEqual({})
    store.define('g', { k: { type: 'text', default: 'd' } }, 'p')
    store.set('k', 'user-value')
    await save.flush()
    store.removeByScope('p')
    store.define('g', { k: { type: 'text', default: 'd' } }, 'p')
    expect(store.get('k')).toBe('user-value') // snapshot 里的用户值重装生效
    persist.dispose()
  })

  it('配置后端从本地切到云端后自动重读：刷新/换后端不丢云端设置', async () => {
    // 模拟启动：本地内存后端（空）先 restore
    const { store, save } = makePair()
    store.define('g', { x: { type: 'number', default: 1 } }, 'p')
    const persist = createSettingsPersist(store, save)
    await persist.restore()
    expect(store.get('x')).toBe(1)

    // 云插件把 config 域切到云端；云端早已存过用户的设置
    const cloud = new MemoryStorageAdapter()
    cloud.set('config:settings', { x: 42 })
    save.useAdapter('config', cloud)
    await new Promise((r) => setTimeout(r, 0)) // 让桥的异步重读跑完
    expect(store.get('x')).toBe(42)
    persist.dispose()
  })

  it('后端切到尚未存过的空白云时，把本地当前值推上去（首次上云不丢设置）', async () => {
    const { store, save } = makePair()
    store.define('g', { y: { type: 'text', default: 'd' } }, 'p')
    const persist = createSettingsPersist(store, save)
    await persist.restore()
    store.set('y', 'local-value')
    await save.flush()

    const cloud = new MemoryStorageAdapter()
    save.useAdapter('config', cloud)
    await new Promise((r) => setTimeout(r, 0))
    await save.flush()
    expect(await cloud.get('config:settings')).toEqual({ y: 'local-value' })
    persist.dispose()
  })
})
