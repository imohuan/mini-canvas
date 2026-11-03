export interface MediaViewerKeyboardOptions {
  hasItem: () => boolean
  close: () => void
  prevImage: () => void
  nextImage: () => void
  canZoom: () => boolean
  hasTools: () => boolean
  zoomIn: () => void
  zoomOut: () => void
  resetTransform: () => void
  rotateImg: () => void
  toggleFlip: () => void
}

/** 键盘（AxImageViewer 同款键位）：返回处理函数，由入口负责注册/注销。 */
export function useMediaViewerKeyboard(options: MediaViewerKeyboardOptions) {
  function handleKeydown(e: KeyboardEvent): void {
    if (!options.hasItem()) return
    switch (e.key) {
      case "Escape": e.stopPropagation(); options.close(); break
      case "ArrowLeft": case "a": case "A": options.prevImage(); break
      case "ArrowRight": case "d": case "D": options.nextImage(); break
      case "+": case "=": if (options.canZoom()) options.zoomIn(); break
      case "-": if (options.canZoom()) options.zoomOut(); break
      case "0": if (options.canZoom()) options.resetTransform(); break
      case "r": case "R": if (options.hasTools()) options.rotateImg(); break
      case "f": case "F": if (options.hasTools()) options.toggleFlip(); break
    }
  }

  return { handleKeydown }
}

