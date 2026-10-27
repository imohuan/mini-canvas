/**
 * 外壳插槽挂载点契约。
 *
 * 三块红框区域只在外壳里各留一个 SlotHost，插件通过 ctx.slots.register 填充；
 * 这里锁槽名，防止后续重构把某个入口漏掉（漏了不会报错，只是插件按钮静默消失）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8')

describe('外壳插槽挂载点', () => {
  it('状态条末尾有 shell.status.end', () => {
    expect(app).toContain('<SlotHost slot="shell.status.end"')
  })

  it('底栏首尾有 shell.dock.start / shell.dock.end', () => {
    expect(app).toContain('<SlotHost slot="shell.dock.start"')
    expect(app).toContain('<SlotHost slot="shell.dock.end"')
  })
})
