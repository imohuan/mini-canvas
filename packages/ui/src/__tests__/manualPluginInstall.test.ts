/**
 * 插件装载方式的守卫 —— 锁住「用户自己装，应用不替他装」。
 *
 * 背景（用户要求 2026-10-11）：「我希望是我自己进行安装，而不是强制安装自带的那种」。
 * 以前 ui 的 onReady 会去 /plugin-manifest.json 读一份清单，然后**挨个 install**；
 * 用户在自己没点过任何东西的情况下就被装上了一批插件（尤其云端客户端会立刻接管画布存档、
 * 连上后台，行为变化很大）。
 *
 * 现在：外部插件一律走「设置 → 插件」面板手动装（plugin-manager 读 /plugin-catalog.json）。
 * 这条把"应用侧不许再自己装"钉成测试 —— 这种"偷偷装回来"的回归肉眼很难发现
 * （装上了、功能能跑，看不到任何异常，只是用户失去了选择权）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const UI_SRC = path.resolve(here, '..', 'composables', 'ui.ts')

describe('外部插件：由用户手动安装，应用不自动装', () => {
  const source = readFileSync(UI_SRC, 'utf8')

  it('应用启动路径不再读 /plugin-manifest.json 去自动安装', () => {
    // 允许注释里提到这条路由（说明为什么不再用），但不许有真正的装载调用。
    // 判据：installExternalPlugins 的函数体里不能再出现 fetch('/plugin-manifest.json')。
    const body = source.slice(source.indexOf('async function installExternalPlugins'))
    const fnBody = body.slice(0, body.indexOf('\n  }'))
    expect(fnBody.includes("fetch('/plugin-manifest.json')"), '启动时不该再按清单自动装插件').toBe(false)
    expect(/\.install\(\{\s*url/.test(fnBody), '启动时不该再调用 manager.install 自动装插件').toBe(false)
  })

  it('ui 侧不读插件清单（读清单并装载的只有「插件管理」面板）', () => {
    // 面板在 plugin-cloud-client 包里读 /plugin-catalog.json；ui 应用侧两条清单都不该自己拉。
    // 允许出现路由名（注释里说明来历），但不许有真正的 fetch 调用。
    expect(source.includes("fetch('/plugin-catalog.json')"), 'ui 不该自己拉插件清单').toBe(false)
    expect(source.includes('"/plugin-catalog.json"'), 'ui 不该自己拉插件清单').toBe(false)
  })
})
