import { createApp, h } from 'vue'
import type { Component, App as VueApp } from 'vue'
import { mediaAspect, formatDuration, formatBytes, esc } from './historyCardText'

export interface HistoryCardItem {
  id?: string
  title: string
  kind: string
  time: string
  urls?: string[]
  canvasId?: string
  nodeId?: string
  media?: { width?: number; height?: number; durationMs?: number; bytes?: number }
}

export interface HistoryCardCallbacks {
  isBatchMode: () => boolean
  selectedIds: () => string[]
  onCardClick: (item: HistoryCardItem) => void
  onAudioCardClick: (item: HistoryCardItem) => void
  onToggleSelected: (id: string) => void
  onDetail: (item: HistoryCardItem) => void
  onBroken: (card: HTMLElement, item: HistoryCardItem) => void
  onRelayout: () => void
  previewComponent: (name: string) => Component | undefined
  registerCardApp: (card: HTMLElement, app: VueApp) => void
}

/**
 * 生成历史卡片的 DOM 构建。
 *
 * 从 HistoryModal.vue 原样搬出；只是把组件状态改成回调，卡片结构、事件与 class 不变。
 */
export function createHistoryCardDom(
  callbacks: HistoryCardCallbacks,
  extend?: { onOpenPreview: (item: HistoryCardItem) => void },
) {
  /** 批量模式下的勾选覆盖层（点它切换选中；不在批量模式不出现） */
  function buildCheckOverlay(id: string): HTMLElement {
    const el = document.createElement('span')
    el.className = 'hist-card-check' + (callbacks.selectedIds().includes(id) ? ' is-on' : '')
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    el.addEventListener('click', (ev) => {
      ev.stopPropagation()
      callbacks.onToggleSelected(id)
    })
    return el
  }

  function buildFactsLine(item: HistoryCardItem): HTMLElement {
    const row = document.createElement('div')
    row.className = 'hist-card-facts'
    const parts: string[] = []
    if (item.media?.width && item.media?.height) parts.push(item.media.width + '×' + item.media.height)
    const dur = formatDuration(item.media?.durationMs)
    if (dur) parts.push(dur)
    const size = formatBytes(item.media?.bytes)
    if (size) parts.push(size)
    row.innerHTML =
      '<span class="hist-card-kind">' + esc(item.kind) + '</span>' +
      '<span class="hist-card-fact-text">' + esc(parts.join(' · ')) + '</span>'
    return row
  }

  function finishCard(card: HTMLElement, item: HistoryCardItem): HTMLElement {
    card.classList.add('hist-card--facts-out')
    if (!card.querySelector('.hist-card-fallback')) card.appendChild(buildFactsLine(item))
    return card
  }

  function buildErrorCard(item: HistoryCardItem, opts?: { missingResource?: boolean }): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'hist-card-fallback' + (opts?.missingResource ? '' : ' is-error')
    if (item.id) wrap.dataset.histId = item.id
    wrap.innerHTML =
      '<span class="hist-card-fallback-icon">!</span>' +
      '<strong>' + esc(item.title) + '</strong>' +
      (opts?.missingResource
        ? '<span class="hist-card-meta">资源走丢 · 无法预览</span>'
        : '<span class="hist-card-meta hist-card-meta--danger">生成异常 · 无产物</span>') +
      '<span class="hist-card-meta">' + esc(item.kind) + ' · ' + esc(item.time) + '</span>'
    wrap.addEventListener('click', () => callbacks.onCardClick(item))
    wrap.appendChild(buildDetailButton(item))
    return wrap
  }

  function buildDetailButton(item: HistoryCardItem): HTMLElement {
    const btn = document.createElement('button')
    btn.className = 'hist-card-detail'
    btn.type = 'button'
    btn.title = '查看生成参数'
    btn.setAttribute('aria-label', '查看生成参数：' + item.title)
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      callbacks.onDetail(item)
    })
    return btn
  }

  return { buildCheckOverlay, buildFactsLine, finishCard, buildErrorCard, buildDetailButton }
}
