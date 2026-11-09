import { ref } from 'vue'
import type { Ref } from 'vue'

/** 生成历史条目里预览/详情需要的字段（其余字段由 HistoryModal 自己持有）。 */
export interface HistoryPreviewItem {
  id?: string
  title: string
  kind: string
  time: string
  urls?: string[]
  canvasId?: string
  nodeId?: string
  media?: { width?: number; height?: number; durationMs?: number; bytes?: number }
}

/** 生成详情弹窗需要的完整记录字段。 */
export interface HistoryDetailItem extends HistoryPreviewItem {
  prompts?: Array<{ type: 'tag' | 'prompt'; value: string }>
  values?: Record<string, unknown>
  resources?: Array<{ id?: string; kind: string; name?: string; url?: string; value?: string }>
  finishedAt?: number
  error?: string
}

interface PreviewSelection {
  name: string
  kind: string
  url: string
  list?: string[]
  names?: string[]
  kinds?: string[]
  index?: number
}

/**
 * 生成历史的缩略图地址、可预览判定、同页签清单与点开预览。
 *
 * 从 HistoryModal.vue 原样搬出。只读 ui.histVisible，不另拉全量。
 */
export function useHistoryPreview(
  ui: { histVisible: Ref<HistoryPreviewItem[]>; showToast: (text: string) => void },
) {
  /**
   * 历史条目的缩略图地址。
   *
   * 后台给的 urls 可能是跨端地址（如 web2api 的 `http://localhost:8033/...`），在别处打不开；
   * 优先用同源的画布资源地址（`/api/canvases/<画布>/resources/<文件名>`）—— 那是后台把产物收下后
   * 稳定可取的形态，浏览器同源、一定能加载。拿不到同源地址才退回原 url。
   */
  function thumbOf(item: { kind: string; urls?: string[]; canvasId?: string; nodeId?: string }): string | null {
    const url = item.urls?.[0]
    if (!url) return null
    if (url.startsWith('/')) return url
    const name = url.split('?')[0]?.split('/').pop() || ''
    if (name && item.canvasId) return '/api/canvases/' + item.canvasId + '/resources/' + name
    return url
  }

  /**
   * 这条记录的产物地址**能不能预览**（不真的发请求，只做静态判定）：
   *   · 必须是**本画布服务**的地址（/ 开头）。后台留下的跨端原始地址
   *     （如 web2api 的 http://…:8033/...）在别的环境打不开，切过去必然「加载失败」；
   *     图片走 thumbOf 的「拼资源地址」兜底也一样 —— 后端只认内容哈希文件名，
   *     拼 chat-auto 这类旧文件名必得 400（真机 2026-10-29 实测）。
   *     —— 与「显示异常」开关关着时卡片被隐藏是同一条口径：预览清单里也不该出现。
   */
  function previewableUrl(item: HistoryPreviewItem): string | null {
    const url = item.urls?.[0]
    if (!url) return null
    return url.startsWith('/') ? url : null
  }

  /**
   * 「生成历史卡片预览」的**同页签清单**：当前筛选下（同一个页签 + 排序）能预览的记录
   * 按画面顺序（= 数据顺序，用户看到的顺序）排成一列。
   *
   * 与资产面板的 assetSiblings 同一套取舍：
   *   · **只带当前筛选里的记录** —— 眼睛看到什么，← / → 就只在里面走（所见即所得）；
   *   · 只收有产物的记录 —— 没有产物的（失败/资源走丢）切过去只会一片空白；
   *   · 图片走 thumbOf 同源转换（卡片缩略图用的同一条），视频/音频用原始地址
   *     （改写音视频地址会把 /api/resources/... 拼成画布资源路径 → 加载失败）。
   *
   * 当前这条不在清单里（理论上点开的就是能预览的，异常情况兜底）时返回 null ——
   * 调用方退回单张预览。
   */
  function historyPreviewGroup(item: HistoryPreviewItem): {
    list: string[]
    names: string[]
    kinds: string[]
    index: number
  } | null {
    const rows = ui.histVisible.value.filter((e) => {
      return !!previewableUrl(e)
    })
    if (!rows.some((e) => e.id === item.id)) return null
    return {
      list: rows.map((e) => previewableUrl(e) as string),
      names: rows.map((e) => e.title),
      kinds: rows.map((e) => e.kind),
      index: Math.max(rows.findIndex((e) => e.id === item.id), 0),
    }
  }

  /** 点开的预览：接主题注册的 MediaViewer（图片放大 / 视频 / 音频原生播放） */
  const previewItem = ref<PreviewSelection | null>(null)

  /**
   * 点一张卡：有产物就打开预览；没有产物（失败 / 老记录）就不弹空窗，给个提示。
   *
   * 2026-10-29：带上**同页签清单**（historyPreviewGroup），MediaViewer 自动出现
   * ← / → 与页码、支持键盘 ←→ —— 与资产面板同层预览同一套交互。
   * 清单给不出（异常兜底）就退回单张预览，行为与从前一致。
   */
  function openHistoryItem(item: HistoryPreviewItem): void {
    const url = item.urls?.[0]
    if (!url) {
      ui.showToast('这条记录没有产物（可能失败或已过清理）')
      return
    }
    // 预览地址必须走同源转换（原始 urls 可能是跨端地址打不开）；
    // kind 用原始中文标签即可 —— MediaViewer 里做了归一化。
    // 媒体（视频/音频）的地址本身就可能是画布资源地址，原样给它，别按缩略图规则改写。
    // 图片才按缩略图规则换成同源地址；音视频必须用原始地址（改写会把
    // /api/resources/... 拼成画布资源路径 → 找不到文件 → 卡片「加载失败」）。
    const viewUrl = previewableUrl(item)
    if (!viewUrl) {
      ui.showToast('这条记录没有可预览的产物')
      return
    }
    const group = historyPreviewGroup(item)
    previewItem.value = {
      name: item.title,
      kind: item.kind,
      url: viewUrl,
      ...(group && group.list.length > 1 ? group : {}),
    }
  }

  return { thumbOf, previewableUrl, historyPreviewGroup, previewItem, openHistoryItem }
}
