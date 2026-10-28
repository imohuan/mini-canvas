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
  it('① 用和 AxDropdown 同一个 hook（onClickOutside），而不是只靠自家遮罩的 .self', () => {
    expect(modals).toMatch(/import \{\s*onClickOutside\s*\} from '@vueuse\/core'/)
    expect(modals).toMatch(/onClickOutside\(\s*shortcutPanelRef/)
    // 自己手搓 document 监听就是又造了一份轮子
    expect(modals).not.toMatch(/addEventListener\('pointerdown'[^)]*true\)/)
  })

  it('② 触发器自己不算「外面」：点「快捷键」按钮仍由它自己的 toggle 收尾，不会先关再开', () => {
    expect(modals).toMatch(/ignore:\s*\['\[aria-label="快捷键"\]'\]/)
    // ignore 只挂在 pointerdown 上，底栏的 @pointerdown.stop 会让它收不到 —— 回调里必须再挡一次
    expect(modals).toMatch(/onClickOutside\([\s\S]{0,900}closest\('\[aria-label="快捷键"\]'\)/)
  })

  it('③ 真正关闭走同一个 closeShortcutPanel（点外 / Esc / 关闭按钮三处一致）', () => {
    const closers = modals.match(/s\.shortcutsOpen = false/g) ?? []
    expect(closers.length).toBeLessThanOrEqual(1)
    expect(modals).toContain('function closeShortcutPanel')
  })
})
