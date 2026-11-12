/**
 * 粘贴规范（用户 2026-10-28）：
 *
 * ① 普通粘贴（Ctrl+V）：复制的是标签 → 粘贴出来还是标签。
 * ② 纯文本粘贴（Ctrl+Shift+V）：强制当文本，@图片1 之类**不**转成标签。
 *
 * 这两条的区别只在按键，剪贴板内容一样。所以实现是「keydown 记标记 → paste 消费」。
 * 这里钉住标记的消费语义：读一次就清空，不会污染下一次普通粘贴。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { isPlainTextPasteEvent, markPlainTextPaste } from '../useEditor.ts'

const fakeEvent = {} as ClipboardEvent

afterEach(() => {
  // 清掉可能残留的标记，避免用例互相影响
  isPlainTextPasteEvent(fakeEvent)
})

describe('纯文本粘贴标记', () => {
  it('没按键 → 普通粘贴（返回 false）', () => {
    expect(isPlainTextPasteEvent(fakeEvent)).toBe(false)
  })

  it('按了 Ctrl+Shift+V → 纯文本粘贴（返回 true）', () => {
    markPlainTextPaste()
    expect(isPlainTextPasteEvent(fakeEvent)).toBe(true)
  })

  it('标记只消费一次：下一次粘贴回到普通模式', () => {
    markPlainTextPaste()
    expect(isPlainTextPasteEvent(fakeEvent)).toBe(true)
    expect(isPlainTextPasteEvent(fakeEvent)).toBe(false)
  })
})

