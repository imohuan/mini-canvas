/**
 * Provider 的 zIndexBase 必须真的影响浮层层级。
 *
 * 现状：resolveConfig 算出了 zIndex.{dropdown,popover,modal,toast}（90000/90010/90100/90200），
 * docs/provider.md 也把它写进参数表，但**没有任何组件读它** ——
 * 浮层 CSS 全是写死的 94000 / 95000 / 99000 / 99900。
 *
 * 后果：宿主把组件库嵌进自己的层级体系时（比如画布浮窗在 95000），
 * 传 :z-index-base="200000" 想把对话框抬上去，完全没效果 —— 这类「参数接得上、行为不接」
 * 的坑类型检查也发现不了。
 *
 * 这里钉住两层：
 *   1. Provider 把那四档写成 CSS 变量（--mck-z-*）；
 *   2. 每个浮层的 z-index 读变量（带原来的数字兜底）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf-8')

describe('Provider 的 zIndexBase 落到浮层', () => {
  it('Provider 输出 --mck-z-* 变量', () => {
    const plugin = read('../../provider/config.ts')
    for (const key of ['dropdown', 'popover', 'modal', 'toast']) {
      expect(plugin, '缺少 --mck-z-' + key + ' 变量').toMatch(new RegExp("'--mck-z-" + key + "'"))
    }
  })

  it('浮层样式读变量而不是写死数字', () => {
    const cases: Array<[string, string]> = [
      ['../dropdown/dropdown.css', 'dropdown'],
      ['../tooltip/tooltip.css', 'popover'],
      ['../dialog/dialog.css', 'modal'],
      ['../messages/messages.css', 'toast'],
    ]
    for (const [rel, tier] of cases) {
      const css = read(rel)
      expect(css, rel + ' 的 z-index 还是写死的（zIndexBase 传了也没用）').toMatch(
        new RegExp('z-index:\\s*var\\(--mck-z-' + tier + '\\b'),
      )
    }
  })

  it('NotifyHost 把 toast 档位传给 vue-sonner', () => {
    // 通知容器已经交给 sonner，z-index 由 <Toaster :style> 注入；
    // 这里钉住它确实读 Provider 的 toast 档（而不是 sonner 自带的 999999999）
    // 并且写在 computed 的 toasterStyle 里，传给 <Toaster>。
    const host = read('../notify/NotifyHost.vue')
    expect(host).toMatch(/toasterStyle[\s\S]{0,200}zIndex\.value\.toast/)
    expect(host).toMatch(/:style="toasterStyle"/)
  })
})
