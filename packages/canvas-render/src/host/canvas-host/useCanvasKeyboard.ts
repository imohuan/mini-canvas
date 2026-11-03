import { findCommandByKeys } from '@mini-canvas/kernel'

export function useCanvasKeyboard(opts: {
  commands: () => { listCommands(): Array<{ id: string }>; runCommand(id: string): unknown } | undefined
  executeContext: () => unknown
  syncFromStore: () => void
}) {
  // —— 键盘：Delete 删选中、Ctrl/Cmd+Z 撤销/重做（编辑输入框内不劫持）——
  function onKeydown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
    // 通用快捷键：扫描已注册命令的 keys，命中即 execute（Delete/Ctrl+Z 等命令的 keys 由插件声明）
    // 传内核 ctx 作为执行上下文：命令的 when 不满足时**让位**给同键的其它命令（如选中 3D 节点时
    // f/r 归节点用，没选中时仍走画布的聚焦/适应视图），同键多个可用命令按 order 定优先级。
    const commands = opts.commands()
    if (!commands) return
    const hit = findCommandByKeys(commands.listCommands() as never, e, opts.executeContext() as never)
    if (hit) {
      // deferToNative：该键交给平台原生事件（如 Ctrl/Cmd+V → paste）。
      // 不 preventDefault、不 execute —— preventDefault 会让浏览器不再派发原生 paste
      // （真机实测），而剪贴板内容只有原生事件读得到。真正的工由下面的 onPaste 仲裁场派发。
      if ((hit as { deferToNative?: boolean }).deferToNative) return
      e.preventDefault()
      commands.runCommand(hit.id)
      opts.syncFromStore()
    }
  }

  return { onKeydown }
}
