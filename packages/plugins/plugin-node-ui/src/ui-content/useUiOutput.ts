export type UiOutputField = 'videoUrl' | 'audioUrl' | 'text' | 'imageUrl'

/** 按产物名字认类型（与原 UiContent 的 applyOutput 同一套映射）。 */
export function outputFieldForName(name: string): UiOutputField {
  const ext = (name.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? '').toLowerCase()
  return ext === 'mp4' || ext === 'webm' || ext === 'mov' ? 'videoUrl'
    : ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'm4a' ? 'audioUrl'
      : ext === 'txt' || ext === 'md' || ext === 'json' || ext === 'csv' ? 'text'
        : 'imageUrl'
}

export interface UseUiOutputOptions {
  nodeId: string
  canvasId: string
  baseUrl(): string
  updateNodeRuntime(id: string, data: Record<string, unknown>): void
}

export function useUiOutput(options: UseUiOutputOptions) {
  /** 这个地址是不是本画布的资源（调试页回报产物时用；防止把节点指到别处）。 */
  function isOwnResourceUrl(url: string): boolean {
    const rel = '/api/canvases/' + encodeURIComponent(options.canvasId) + '/resources/'
    if (url.startsWith(rel)) return true
    const base = options.baseUrl()
    return !!base && url.startsWith(base + rel)
  }

  /** 按产物名字认类型，写进节点（产物不进历史，且带版本号让下游重新取） */
  function applyOutput(url: string, name: string, text?: string): string {
    const field = outputFieldForName(name)
    const bust = url.indexOf('?') >= 0 ? '&v=' : '?v='
    const patch: Record<string, unknown> = { uiOutputUrl: url }
    if (field === 'text') {
      if (text !== undefined) patch.text = text
    } else {
      patch[field] = url + bust + Date.now()
    }
    options.updateNodeRuntime(options.nodeId, patch)
    return url
  }

  return { isOwnResourceUrl, applyOutput }
}
