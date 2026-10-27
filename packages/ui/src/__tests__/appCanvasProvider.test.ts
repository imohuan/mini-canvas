/**
 * App 的 Provider 层级契约。
 *
 * 用户口径（2026-10-27）：不做兼容，Context 初始化放最外层；
 * 因此这里锁的是“层级和参数到底归谁”，不测像素：
 * - Provider 包住 CanvasShell；
 * - CanvasHost 不再携带启动参数；
 * - 设置面板仍在 CanvasHost 的 #ui 内（它依赖渲染上下文）；
 * - 旧 onReady 的工作由 Provider 的 ready 接住。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8')

describe('App 装配层级', () => {
  it('Provider 在 CanvasShell 外面', () => {
    expect(app.indexOf('<CanvasProvider')).toBeGreaterThan(-1)
    expect(app.indexOf('<CanvasShell')).toBeGreaterThan(app.indexOf('<CanvasProvider'))
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

  it('Provider 的 ready 负责旧 onReady 工作', () => {
    expect(app).toContain('@ready="onProviderReady"')
    expect(app).toContain('setReadyHost(host)')
    expect(app).toContain('ui.setHostEl({ host })')
    expect(app).toContain('void ui.onReady()')
  })
})
