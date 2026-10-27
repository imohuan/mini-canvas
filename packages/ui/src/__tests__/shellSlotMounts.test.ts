/**
 * 外壳插槽挂载点契约。
 *
 * 槽位必须挂在**各区域组件内部**（DockArea / StatusArea），而不是 App 的外壳层 ——
 * 只有在里面，插件按钮才与内置按钮同排、同面板（2026-10-28 用户实测：挂外层会浮在面板外）。
 * 这里锁槽名 + 挂载位置，防止后续重构把某个入口漏掉（漏了不会报错，只是插件按钮静默消失）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8')
const dock = readFileSync(fileURLToPath(new URL('../components/areas/DockArea.vue', import.meta.url)), 'utf8')
const status = readFileSync(fileURLToPath(new URL('../components/areas/StatusArea.vue', import.meta.url)), 'utf8')

describe('外壳插槽挂载点', () => {
  it('状态条末尾的 shell.status.end 挂在 StatusArea 内部（面板里）', () => {
    expect(app).not.toContain('<SlotHost slot="shell.status.end"')
    expect(status).toContain('<SlotHost slot="shell.status.end"')
  })

  it('底栏首尾的 shell.dock.start / shell.dock.end 挂在 DockArea 内部（面板里）', () => {
    expect(app).not.toContain('<SlotHost slot="shell.dock.')
    expect(dock).toContain('<SlotHost slot="shell.dock.start"')
    expect(dock).toContain('<SlotHost slot="shell.dock.end"')
  })
})
