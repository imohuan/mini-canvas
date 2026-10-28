/**
 * 快捷键面板「点面板外面就关」（用户口径 2026-10-28：
 * 「就和 AxDropdown 一样」—— 点容器外部关掉当前面板）。
 *
 * 为什么要钉源码：面板原本只靠自己那层 `fixed inset-0` 遮罩的 `.self` 判定，
 * 但外壳的顶栏/底栏/状态条（`--layer-app-chrome` 700）比面板（z-index 90）高，
 * 点它们时事件先被外壳接走，遮罩根本收不到 pointerdown —— 面板不关。
 * 这条现象在真机上能复现，却跑不进 node 单测；所以把「关闭判定不依赖层级」这个
 * 结构契约钉在源码上，配合 review 里的真机验证。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

const modals = read('../components/areas/ModalsArea.vue')

describe('快捷键面板：点面板外部（含外壳按钮）就关', () => {
  it('① 用捕获阶段的文档级「点外」监听判定，而不是只靠自家遮罩的 .self', () => {
    // 捕获阶段监听：外壳按钮（层级比遮罩高、还带 @pointerdown.stop）也拦不住这次判定
    expect(modals).toMatch(/addEventListener\('pointerdown',[^)]*,\s*true\)/)
    expect(modals).toMatch(/removeEventListener\('pointerdown',[^)]*,\s*true\)/)
    expect(modals).toMatch(/closest\('\.shortcut-modal'\)/)
  })

  it('② 触发器自己不算「外面」：点「快捷键」按钮仍由它自己的 toggle 收尾，不会先关再开', () => {
    expect(modals).toMatch(/closest\('\[aria-label="快捷键"\]'\)/)
  })

  it('③ 真正关闭走同一个 closeShortcutPanel（点外 / Esc / 关闭按钮三处一致）', () => {
    const closers = modals.match(/s\.shortcutsOpen = false/g) ?? []
    expect(closers.length).toBeLessThanOrEqual(1)
    expect(modals).toContain('function closeShortcutPanel')
  })
})
