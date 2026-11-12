/**
 * 生成详情里的参考素材 / 产物要按**能真正加载的媒体**预览。
 *
 * 现场（2026-11-11）：音频参考素材只显示了一长串 `/api/canvases/.../resources/...mp3`，
 * 用户看不出这是音频、也听不了。历史里的地址是同源相对链接，可以直接交给播放器。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { historyMediaKind, historyMediaLabel } from '../components/areas/modals-area/historyDetailMedia'

describe('historyMediaKind', () => {
  it('相对链接按扩展名认类型（不依赖 kind 字段）', () => {
    expect(historyMediaKind({ url: '/api/canvases/c1/resources/a.mp3' })).toBe('audio')
    expect(historyMediaKind({ url: '/api/canvases/c1/resources/a.wav?t=1' })).toBe('audio')
    expect(historyMediaKind({ url: '/api/canvases/c1/resources/a.mp4' })).toBe('video')
    expect(historyMediaKind({ url: '/api/canvases/c1/resources/a.webp' })).toBe('image')
  })

  it('地址后缀能纠正写错的 kind（历史里有旧数据把视频当 image）', () => {
    expect(historyMediaKind({ kind: 'image', url: '/x/y.mp4' })).toBe('video')
    expect(historyMediaKind({ kind: '', url: '/x/y.png' })).toBe('image')
  })

  it('没有地址但有文字 → 文本；中文旧标签仍认', () => {
    expect(historyMediaKind({ kind: 'text', value: '参考风格' })).toBe('text')
    expect(historyMediaKind({ kind: '音频', url: '/api/assets/stream?id=1' })).toBe('audio')
    expect(historyMediaKind({ kind: '视频', url: '/api/assets/stream?id=2' })).toBe('video')
    expect(historyMediaKind({ kind: '图片', url: '/api/assets/stream?id=3' })).toBe('image')
  })

  it('中文标签用于面板显示', () => {
    expect(historyMediaLabel('audio')).toBe('音频')
    expect(historyMediaLabel('other')).toBe('其他')
  })
})

describe('详情面板用真实媒体预览（不只显示地址）', () => {
  const detail = readFileSync(
    new URL('../components/areas/modals-area/HistoryDetailDialog.vue', import.meta.url),
    'utf-8',
  )

  it('音频 / 视频 / 图片都有预览分支；地址只做兜底', () => {
    expect(detail, '没有取音频预览件').toMatch(/useUiComponent\('audioPreview'\)/)
    expect(detail, '没有取视频预览件').toMatch(/useUiComponent\('videoPreview'\)/)
    expect(detail, '音频没有交给播放器').toMatch(/r\.kind === 'audio'[\s\S]{0,240}AudioPreview/)
    expect(detail, '视频没有交给播放器').toMatch(/r\.kind === 'video'[\s\S]{0,240}VideoPreview/)
    const imageBranch = detail.slice(
      detail.indexOf("r.kind === 'image'"),
      detail.indexOf("r.kind === 'video'"),
    )
    expect(imageBranch, '图片没有直接显示').toContain('<img')
    const audioBranch = detail.slice(
      detail.indexOf("r.kind === 'audio'"),
      detail.indexOf("r.kind === 'text'"),
    )
    expect(audioBranch, '音频分支仍只显示地址').not.toContain('hist-detail-ref-url')
  })

  it('点媒体能打开全屏预览（复用历史那只 MediaViewer）', () => {
    expect(detail, '详情没有向外发预览事件').toMatch(/emit\('preview'|emit\("preview"/)
    const modal = readFileSync(
      new URL('../components/areas/modals-area/HistoryModal.vue', import.meta.url),
      'utf-8',
    )
    expect(modal, '历史弹窗没有接详情的预览事件').toMatch(/@preview="openHistoryPreview"/)
  })
})
