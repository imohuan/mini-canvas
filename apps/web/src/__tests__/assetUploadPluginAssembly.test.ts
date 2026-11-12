/**
 * 插件装配的**冒烟**测试：apply() 不能抛。
 *
 * 为什么单列一条：成品应用的插件装配发生在 App 挂载期，**这里抛一下整个界面就是白屏**
 * （2026-10-13 真机上出现过一次可疑白屏，靠这条把"是不是我的代码"一次判掉）。
 * 只钉"能装起来 + 注册了该注册的命令"，不测命令行为（那些在别处测）。
 */
import { describe, it, expect, vi } from 'vitest'
import { uiAssetUploadPlugin } from '../assetUploadPlugin'

/** 造一个够 apply 用的假作用域 */
function fakeScope() {
  const commands = new Map<string, Record<string, unknown>>()
  const ctx = {
    commands: {
      register: (def: Record<string, unknown>) => {
        commands.set(String(def.id), def)
        return { dispose: () => commands.delete(String(def.id)) }
      },
    },
    selectionRegion: { attach: () => undefined },
    get: () => ({ getNode: () => undefined }),
  }
  return { scope: ctx as never, commands }
}

/**
 * 导出失败的提示。
 *
 * 真实现象（2026-11-05）：导出接口 404 / 403 时，命令只打一条 console.warn，
 * 用户点完完全看不出发生了什么。所以这里钉：失败一定要走到 notify，并带上原因。
 */
describe('uiAssetUploadPlugin：导出节点包失败要让人看见', () => {
  it('★ 接口报错 → notify 带原因（不是只写控制台）', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 404,
      headers: { get: () => 'application/json' },
    }))
    const s = fakeScope()
    const shown: string[] = []
    // useUi() 读的是外壳共享单例上的 showToast；真实外壳会把它接到 notify 服务。
    // 这里替换同一个单例的入口，验证「失败 → 用户看得到」这条链，而不是只断言 console。
    const { useUi } = await import('../composables/ui')
    const prevToast = useUi().showToast
    useUi().showToast = (m: string) => shown.push(m)
    uiAssetUploadPlugin.apply?.(s.scope)
    const cmd = s.commands.get('ui:node-export-pack')! as { run: (c: unknown, p: unknown) => Promise<void> }
    await cmd.run({}, { nodeId: '2' })
    expect(shown.join('\n')).toMatch(/导出节点包失败/)
    expect(shown.join('\n')).toMatch(/404/)
    useUi().showToast = prevToast
    vi.unstubAllGlobals()
  })

  it('★ 导出菜单只对可视化节点出现（图片节点上不该有这条）', () => {
    const s = fakeScope()
    uiAssetUploadPlugin.apply?.(s.scope)
    const cmd = s.commands.get('ui:node-export-pack')! as { nodeVisible?: (n: { type?: string }) => boolean }
    expect(cmd.nodeVisible?.({ type: 'ui' })).toBe(true)
    expect(cmd.nodeVisible?.({ type: 'image' })).toBe(false)
  })
})

describe('uiAssetUploadPlugin 装配', () => {
  it('apply 不抛，并注册了节点右键那几条命令', async () => {
    // loadAssets 会打网络：这里给它一个"永远失败"的 fetch，验证**失败也不影响装配**
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    const s = fakeScope()
    expect(() => uiAssetUploadPlugin.apply?.(s.scope)).not.toThrow()
    await Promise.resolve()
    expect([...s.commands.keys()]).toContain('ui:node-save-to-assets')
    expect([...s.commands.keys()]).toContain('ui:node-export-pack')
    // 「收藏到资产库」已并入 ui:node-save-to-assets（用户 2026-10-14：两条只要一条）——
    // 旧的 ui:node-save-pack 不该再存在（留着就是菜单里多一项重复的）
    expect([...s.commands.keys()]).not.toContain('ui:node-save-pack')
    vi.unstubAllGlobals()
  })
})

