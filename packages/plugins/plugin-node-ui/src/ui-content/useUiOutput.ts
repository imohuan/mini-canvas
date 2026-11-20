export type UiOutputField = 'videoUrl' | 'audioUrl' | 'text' | 'imageUrl'

import { outputTypeForName } from '../uiData'
import { resourceRefOfUrl } from '@plume-canvas/canvas-data'

/**
 * 按产物名字认类型（决定写哪个地址字段）。
 *
 * 判定只问 outputTypeForName（→ canvas-data 的 mediaTypeOfName），这里只做"类型 → 字段名"的翻译，
 * 不再自己重复一遍后缀表。
 */
export function outputFieldForName(name: string): UiOutputField {
  const kind = outputTypeForName(name)
  return kind === 'video' ? 'videoUrl' : kind === 'audio' ? 'audioUrl' : kind === 'text' ? 'text' : 'imageUrl'
}

export interface UseUiOutputOptions {
  nodeId: string
  canvasId: string
  baseUrl(): string
  updateNodeRuntime(id: string, data: Record<string, unknown>): void
}

/**
 * 同源产物地址 → 逻辑引用 `<画布id>/<hashName>`；认不出形状返回 undefined。
 *
 * 为什么 UI 节点也要写引用：产物地址只是引用的投影（用户口径 2026-11-20）。
 * 只写地址的话，保存时会被"有引用就删地址副本"的清理删掉，节点反而变空；
 * 下游与恢复流程都按引用取件。
 */
export function resourceRefFromUiUrl(url: string): string | undefined {
  return resourceRefOfUrl(url)
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
    // 产物一落地就把输出类型定下来：右侧端口的类型与「能不能连到下游」都跟着它走
    const patch: Record<string, unknown> = { uiOutputUrl: url, uiOutputType: outputTypeForName(name) }
    // 引用是长期身份；地址只是它的投影。两份一起写，画面当帧就能显示，保存后也不会丢。
    const ref = resourceRefFromUiUrl(url)
    if (ref) patch.resourceId = ref
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
