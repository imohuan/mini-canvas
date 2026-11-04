/**
 * 应用 Provider 层级契约。
 *
 * 根级 Provider 包住 RouterView，项目页与画布页读同一份上下文；
 * 画布工作台 App.vue 不再自己启动宿主。
 * 这里锁的是“层级和参数到底归谁”，不测像素。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8')
const root = readFileSync(fileURLToPath(new URL('../Root.vue', import.meta.url)), 'utf8')
const provider = readFileSync(fileURLToPath(new URL('../AppProvider.vue', import.meta.url)), 'utf8')

describe('应用装配层级', () => {
  it('唯一的根 Provider 包住 RouterView', () => {
    expect(root).toContain('<AppProvider')
    expect(root.indexOf('<RouterView')).toBeGreaterThan(root.indexOf('<AppProvider'))
    expect(root.indexOf('</AppProvider>')).toBeGreaterThan(root.indexOf('<RouterView'))
  })

  it('项目页与画布页共用同一个 Provider（Provider 不再在画布路由里）', () => {
    expect(app).not.toContain('<CanvasProvider')
    expect(provider).toContain('<CanvasProvider')
    expect(provider).toContain(':plugins="plugins"')
    expect(provider).toContain(':adapter="adapter"')
    expect(provider).toContain(':seed="seedDefaultCanvas"')
    expect(provider).toContain('window-key="MiniCanvasUI"')
  })

  it('CanvasHost 不再携带启动参数', () => {
    const host = app.slice(app.indexOf('<CanvasHost'), app.indexOf('</CanvasHost>'))
    expect(host).not.toContain(':plugins=')
    expect(host).not.toContain(':adapter=')
    expect(host).not.toContain(':seed=')
    expect(host).not.toContain('window-key=')
    expect(host).not.toContain(':ref=')
  })

  it('设置面板仍在 CanvasHost 的 #ui 内', () => {
    const host = app.slice(app.indexOf('<CanvasHost'), app.indexOf('</CanvasHost>'))
    expect(host).toContain('<SettingsHost')
  })

  it('App 从根上下文取宿主，并接上外壳生命周期', () => {
    expect(app).toContain('useCanvasContext()')
    expect(app).toContain('bindHost(host)')
    expect(app).toContain('setReadyHost(host)')
    expect(app).toContain('ui.setHostEl({ host })')
    expect(app).toContain('void ui.onReady()')
  })

  /**
   * 插件管理的安装句柄要在**宿主就绪**时接上，而不是等「设置 → 插件」页挂载。
   * 否则启动阶段按安装名单补装（小地图 / 自动布局…）全部报「宿主没有提供 host.manager」，
   * 用户看到的是「插件装了、刷新又没了」。
   */
  it('Provider 的 ready 里就绑上插件管理的安装句柄', () => {
    const ready = app.slice(app.indexOf('function bindHost'), app.indexOf('bindHost(host)'))
    expect(ready).toContain("'plugin-manager'")
    expect(ready).toContain('bindManager(host.manager)')
  })
})
