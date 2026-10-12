/**
 * 「云端连接按运行环境决定是否自带」的守卫。
 *
 * 用户口径：「如果是 cloud-server 启动的服务，那这个 cloud-client 应该放在自带中直接启动」。
 * 也就是：**后台自己发界面的那种部署**，一打开就该连着后台，而不是让用户先去面板点一次安装；
 * 而 **ui 单独 dev / 别人自己托管** 时不自动装（否则本地单跑画布会去连一个不存在的后台）。
 *
 * 判据是 cloud-server 在它发出去的 index.html 里插的那行 meta（服务端"自报身份"），
 * 前端只读不猜 —— 看 URL / 端口都不准（dev 走代理、端口会顺延，同源时分不出来）。
 *
 * 这条把两个方向都钉住：有标记就必须多出 cloud-client；没标记就必须**一个都不多**。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { APP_PLUGINS, CLOUD_HOST_FLAG, builtinPluginsForUiHost, isCloudServerHosted, resolveAppPlugins } from '../assembly'

/** 造一个最小的 document 替身：只实现 querySelector（本模块只用它） */
function stubDocument(meta: string | null): void {
  const fake = {
    querySelector(sel: string) {
      if (sel !== 'meta[name="' + CLOUD_HOST_FLAG + '"]') return null
      return meta === null ? null : { getAttribute: () => meta }
    },
  }
  ;(globalThis as { document?: unknown }).document = fake
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document
})

describe('云端连接是否作为自带件开机启动', () => {
  it('没有 document（Node / SSR）→ 判为"非托管"，不追加任何自带件', () => {
    expect(isCloudServerHosted()).toBe(false)
    expect(builtinPluginsForUiHost()).toEqual([])
    expect(resolveAppPlugins()).toEqual(APP_PLUGINS)
  })

  it('cloud-server 托管（有宿主标记）→ 云端连接作为自带件直接启动', () => {
    stubDocument('cloud-server')
    expect(isCloudServerHosted()).toBe(true)
    const extra = builtinPluginsForUiHost()
    expect(extra.map((p) => p.name)).toEqual(['cloud-client'])
    // 最终清单 = 静态装配 + 它，且顺序上排在后面（冷启动按数组顺序）
    const all = resolveAppPlugins()
    expect(all.length).toBe(APP_PLUGINS.length + 1)
    expect(all[all.length - 1]?.name).toBe('cloud-client')
  })

  it('标记内容不是 cloud-server（别的宿主自己插的）→ 不认，不追加', () => {
    stubDocument('something-else')
    expect(isCloudServerHosted()).toBe(false)
    expect(builtinPluginsForUiHost()).toEqual([])
  })

  it('静态清单本身不含 cloud-client（它只经运行期判断进来）', () => {
    const names = APP_PLUGINS.map((p) => (p as { name?: string }).name)
    expect(names).not.toContain('cloud-client')
  })
})
