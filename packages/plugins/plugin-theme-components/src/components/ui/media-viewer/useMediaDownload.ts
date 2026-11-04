import type { MediaViewerItem } from "./types"

export interface MediaDownloadOptions {
  currentUrl: () => string
  item: () => MediaViewerItem | null
}

/** 下载（AxImageViewer 同款：fetch 转 blob；跨域失败退开新窗口）。 */
export function useMediaDownload(options: MediaDownloadOptions) {
  // ===== 下载（AxImageViewer 同款：fetch 转 blob；跨域失败退开新窗口） =====
  async function download(): Promise<void> {
    const url = options.currentUrl()
    if (!url) return
    try {
      const resp = await fetch(url)
      const blob = await resp.blob()
      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = objUrl
      a.download = options.item()?.name || "image"
      a.click()
      URL.revokeObjectURL(objUrl)
    } catch {
      window.open(url, "_blank")
    }
  }

  return { download }
}

