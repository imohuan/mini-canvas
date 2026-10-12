/**
 * 插件管理的「自带件身份」守卫。
 *
 * 背景（用户实测报的）：插件管理原先是 plugin-cloud-client 包内部的一个目录（src/manager/），
 * 于是**服务端扫插件目录时扫不到它** —— 「设置 → 插件」的本地清单与自带分类里都没有它，
 * 用户看得到面板、却在列表里找不到这个面板本身。
 *
 * 修法：拆成独立包，并在 package.json 声明 miniCanvas.builtin: true（自带件）
 * + pluginName: 'plugin-manager'（内核里的运行名）。
 *
 * 这条把「身份声明」钉成测试：这两个字段是服务端清单与设置面板唯一的判据，
 * 少一个它就从列表里消失，而面板本身照常工作 —— 属于"看不出错、但用户找不到"的静默回归。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as {
  name: string
  miniCanvas?: { builtin?: boolean; pluginName?: string; title?: string; installable?: boolean }
}

describe('plugin-manager 的清单身份', () => {
  it('声明为自带件（builtin）—— 否则扫不到它，面板里就找不到面板自己', () => {
    expect(pkg.miniCanvas?.builtin).toBe(true)
    // 自带件不能同时声明 installable：那是"可装卸"的标记，两者语义互斥
    expect(pkg.miniCanvas?.installable).toBeUndefined()
  })

  it('pluginName 与插件源码 export 的 name 一致（面板按它认「已装」）', async () => {
    const mod = (await import('../pluginManagerPlugin')) as { name: string }
    expect(pkg.miniCanvas?.pluginName).toBe(mod.name)
    expect(mod.name).toBe('plugin-manager')
    // 这条要 import 插件本体，会连带编译它的 .vue（设置面板那两个组件）。
    // 单独跑约 1.3s，但**四个包并行跑时**（.vue 编译抢 CPU）会顶到 vitest 默认的 5s 超时边上，
    // 变成"偶发假失败"。给足余量：这是慢在编译、不是逻辑问题。
  }, 30000)

  it('是独立包（不再寄居在 plugin-cloud-client 内部）', () => {
    expect(pkg.name).toBe('@mini-canvas/plugin-manager')
  })
})
