/**
 * 外壳插槽挂载点契约。
 *
 * 槽位必须挂在**各区域组件内部**（DockArea / StatusArea），而不是 App 的外壳层 ——
 * 只有在里面，插件按钮才与内置按钮同排、同面板（2026-10-28 用户实测：挂外层会浮在面板外）。
 * 内置 UI 用 SlotAnchor 声明，与插件条目一起由 SlotComposer 排序：
 * 宿主锚点漏了 → 内置按钮从外壳消失；槽名写错 → 插件按钮静默不显示。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8')
const dock = readFileSync(fileURLToPath(new URL('../components/areas/DockArea.vue', import.meta.url)), 'utf8')
const status = readFileSync(fileURLToPath(new URL('../components/areas/StatusArea.vue', import.meta.url)), 'utf8')

describe('外壳插槽挂载点', () => {
  it('状态条走 shell.status 的可排序槽，且内置项都是 SlotAnchor', () => {
    expect(app).not.toContain('slot="shell.status"')
    expect(status).toContain('<SlotComposer slot="shell.status"')
    for (const id of ['host/assets', 'host/organize', 'host/minimap', 'host/edges', 'host/snap', 'host/zoom']) {
      expect(status).toContain('id="' + id + '"')
    }
  })

  it('底栏走 shell.dock 的可排序槽，且内置项都是 SlotAnchor', () => {
    expect(app).not.toContain('slot="shell.dock"')
    // 底栏模板是多行写法：只断言标签本身与槽名都在
    expect(dock).toContain('<SlotComposer')
    expect(dock).toContain('slot="shell.dock"')
    for (const id of ['host/add', 'host/move', 'host/library', 'host/roles', 'host/history', 'host/shortcuts']) {
      expect(dock).toContain('id="' + id + '"')
    }
    // Agent 圆球是独立按钮（用户口径）：不在排序容器里，也不使用 SlotAnchor
    expect(dock).not.toContain('id="host/agent"')
    expect(dock).toContain('aria-label="Agent 对话"')
  })
})
