import {
  CLIPBOARD_COPY_KIND,
  CLIPBOARD_COPY_KEY,
  CLIPBOARD_CUT_KEY,
  CLIPBOARD_PASTE_KIND,
  CLIPBOARD_PASTE_KEY,
  buildClipboardWritePayload,
  buildClipboardPastePayload,
  dispatchClipboardWrite,
  dispatchClipboardPaste,
  type ClipboardWriteHandler,
  type ClipboardPasteHandler,
} from '@mini-canvas/canvas-data'
import type { CanvasHostHandle } from '../createMiniCanvasHost'

export function useCanvasClipboard(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  syncFromStore: () => void
}) {
  /**
   * 原生 paste 仲裁：一次粘贴只有一个赢家（按注册场 order）。
   *
   * 为什么由宿主收这一个事件：插件的"粘贴"动作要经过统一分发（铁律 7，插件不自绑 window）。
   * 宿主读一次原生事件、归一成 payload，按 order 升序问各处理器，第一个接管的赢。
   * 谁注册、谁先：file-drop 的图片/视频(10) > clipboard 的内存节点(20) > file-drop 的纯文本(30)。
   */
  function onPaste(e: ClipboardEvent): void {
    const t = e.target as HTMLElement | null
    // 输入框/可编辑区内的粘贴归它们自己（与 onKeydown、各插件的 isEditableTarget 同规则）
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
    const h = opts.hostRef.value
    if (!h) return
    const entries = h.ctx
      .registryOf<ClipboardPasteHandler>(CLIPBOARD_PASTE_KIND)
      .list(CLIPBOARD_PASTE_KEY)
    if (entries.length === 0) return
    dispatchClipboardPaste(entries, buildClipboardPastePayload(e))
    opts.syncFromStore()
  }

  /**
   * 页面里是否有非折叠的文本选择（普通文本被用户选中时，copy/cut 应归浏览器默认行为，
   * 画布不得把它覆盖成节点数据 —— 用户报的"在页面上选中文字复制也被拦截"就是这条）。
   * 输入框/可编辑区的选择由 onKeydown/onPaste 的 tagName 检查放行，这里只兜普通文本。
   */
  function hasPlainTextSelection(): boolean {
    const sel = window.getSelection?.()
    if (!sel || sel.isCollapsed) return false
    // 空的 range（有些浏览器在画布空白处给 isCollapsed=false 但无文本）不算选中
    return sel.rangeCount > 0 && sel.toString().length > 0
  }

  /** 原生 copy/cut 仲裁：命中 deferToNative 的命令键由这里统一接管写剪贴板（见 onKeydown 注释） */
  function onClipboardWrite(e: ClipboardEvent, key: string): void {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
    // 页面上有用户选中的普通文本 → 放行浏览器默认复制/剪切（拷走选中的文字）
    if (hasPlainTextSelection()) return
    const h = opts.hostRef.value
    if (!h) return
    const entries = h.ctx
      .registryOf<ClipboardWriteHandler>(CLIPBOARD_COPY_KIND)
      .list(key)
    if (entries.length === 0) return
    dispatchClipboardWrite(entries, buildClipboardWritePayload(e))
  }
  function onCopy(e: ClipboardEvent): void {
    onClipboardWrite(e, CLIPBOARD_COPY_KEY)
  }
  function onCut(e: ClipboardEvent): void {
    onClipboardWrite(e, CLIPBOARD_CUT_KEY)
  }

  return { onPaste, onCopy, onCut }
}
