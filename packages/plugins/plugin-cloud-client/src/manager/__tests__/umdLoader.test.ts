import { describe, it, expect } from 'vitest'
import { bustCache, createUmdLoader, pickPluginModule, PLUGIN_GLOBAL_PREFIX } from '../umdLoader'

describe('pickPluginModule —— 从 UMD 命名空间里挑出插件本体', () => {
  it('全局值自己就是插件', () => {
    const p = { name: 'x', apply() {} }
    expect(pickPluginModule(p)).toBe(p)
  })

  it('插件是命名空间里的某个属性（命名不固定）', () => {
    const inner = { name: 'image-compare', apply() {} }
    expect(pickPluginModule({ name: 'ns', nodeImageComparePlugin: inner })).toBe(inner)
  })

  it('只有 setup 没有 apply 也算（旧式插件）', () => {
    const p = { name: 'legacy', setup() {} }
    expect(pickPluginModule({ legacy: p })).toBe(p)
  })

  it('找不到合格模块 → undefined（调用方给清晰错误，不静默）', () => {
    expect(pickPluginModule({ IMAGE_COMPARE_NODE_TYPE: 'x' })).toBeUndefined()
    expect(pickPluginModule('str')).toBeUndefined()
    expect(pickPluginModule(null)).toBeUndefined()
  })
})

/** 极简假 document：只管 createElement / head.appendChild 与触发 onload */
function fakeDocument(): { document: Document; scripts: Array<{ src: string; fire(): void; fail(): void }> } {
  const scripts: Array<{ src: string; fire(): void; fail(): void }> = []
  const document = {
    createElement() {
      const el: Record<string, unknown> = {}
      const rec = { src: '', fire: () => (el.onload as () => void)?.( ), fail: () => (el.onerror as () => void)?.() }
      Object.defineProperty(el, 'src', { get: () => rec.src, set: (v: string) => { rec.src = v } })
      scripts.push(rec)
      return el
    },
    head: { appendChild: () => undefined },
  } as unknown as Document
  return { document, scripts }
}

describe('createUmdLoader —— <script> 加载 + 从新增全局取模块', () => {
  it('加载成功后从脚本新挂的全局里拿到插件', async () => {
    const { document, scripts } = fakeDocument()
    const win: Record<string, unknown> = {}
    const load = createUmdLoader({ document, win })
    const p = load('http://h/plugins/demo/demo.js')
    // 脚本执行会挂全局；这里在 fire 前挂（模拟同步脚本执行）
    win[PLUGIN_GLOBAL_PREFIX + 'Demo'] = { name: 'demo', apply() {} }
    scripts[0]!.fire()
    await expect(p).resolves.toMatchObject({ name: 'demo' })
  })

  it('脚本加载失败 → reject（带地址，便于排查）', async () => {
    const { document, scripts } = fakeDocument()
    const load = createUmdLoader({ document, win: {} })
    const p = load('http://h/bad.js')
    scripts[0]!.fail()
    await expect(p).rejects.toThrow(/加载插件脚本失败/)
  })

  it('给了 globalName 提示 → 按名取（多插件并存也不挑错）', async () => {
    const { document, scripts } = fakeDocument()
    // 预置一个「上一个插件」的全局，模拟重装/并存：无提示时可能挑错，有提示则精确命中
    const win: Record<string, unknown> = {
      [PLUGIN_GLOBAL_PREFIX + 'Wrong']: { name: 'wrong', apply() {} },
    }
    const load = createUmdLoader({ document, win })
    const p = load('http://h/plugins/b/b.js', PLUGIN_GLOBAL_PREFIX + 'Right')
    win[PLUGIN_GLOBAL_PREFIX + 'Right'] = { name: 'right', apply() {} }
    scripts[0]!.fire()
    await expect(p).resolves.toMatchObject({ name: 'right' })
  })

  it('脚本加载成功但没挂插件全局 → reject（不静默成功）', async () => {
    const { document, scripts } = fakeDocument()
    const load = createUmdLoader({ document, win: {} })
    const p = load('http://h/empty.js')
    scripts[0]!.fire()
    await expect(p).rejects.toThrow(/没找到插件模块/)
  })
})

describe('bustCache', () => {
  it('追加 ?t=；已有 query 用 &', () => {
    expect(bustCache('http://h/a.js', 123)).toBe('http://h/a.js?t=123')
    expect(bustCache('http://h/a.js?v=1', 123)).toBe('http://h/a.js?v=1&t=123')
  })
})
