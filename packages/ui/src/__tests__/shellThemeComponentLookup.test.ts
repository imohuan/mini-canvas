/**
 * 外壳的通用组件一律按名从 ui 目录取。
 *
 * 用户口径：主题组件要能从上下文注册 / 按名取到；ui-shell 不能静态 import
 * 默认主题的 .vue —— 否则换一套主题后，调试层 / 预览层还是旧皮，而且依赖方向
 * 会从「入口 → 插件」变成「入口 → 某一份默认皮实现」。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

const app = read('../App.vue')
const assetUiSlot = read('../components/AssetUiSlot.vue')
const historyModal = read('../components/areas/modals-area/HistoryModal.vue')

describe('外壳通用组件按名取件', () => {
  it('外壳组件不 import 默认主题的 .vue', () => {
    for (const [name, src] of [
      ['App.vue', app],
      ['AssetUiSlot.vue', assetUiSlot],
      ['HistoryModal.vue', historyModal],
    ] as const) {
      expect(src, name).not.toMatch(/from ['"]@mini-canvas\/plugin-theme-components\/components\//)
    }
  })

  it('调试层、预览层都从 ui 目录取（含首帧兜底）', () => {
    expect(app).toContain("useUiComponentOutside('slotDebugOverlay')")
    expect(app).toContain("useUiComponentOutside('uiKitDebugOverlay')")
    expect(assetUiSlot).toContain("useUiComponentOutside('mediaViewer')")
    expect(historyModal).toContain("useUiComponentOutside('mediaViewer')")
  })

  it('默认主题登记了这两个名字（换主题时能一起换）', () => {
    const theme = read('../../../plugins/plugin-theme-components/src/index.ts')
    expect(theme).toContain('ui.add("slotDebugOverlay"')
    expect(theme).toContain('ui.add("uiKitDebugOverlay"')
    expect(theme).toContain('ui.add("mediaViewer"')
  })
})
