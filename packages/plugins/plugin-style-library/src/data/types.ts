/**
 * types —— 风格库的**数据契约**（纯类型，无 Vue、无 DOM）。
 *
 * 前端 UI 只认这里的形状；数据从后台半（src/server.ts）经 /api/style-library/* 取。
 */

/** 列表里的一张卡（= 一条风格） */
export interface StyleCard {
  id: number | string
  name: string
  author: string
  category: string
  tags: string[]
  commercial: boolean
  exclusive: boolean
  runCount: number
  likeCount: number
  imageCount: number
  /** 封面（服务端同源地址） */
  cover: string
  /** 全部媒体地址（同源；懒加载只看可视区） */
  images: string[]
  /**
   * 效果预览视频（同源地址；与 images 平行，可能为空）。
   * 特效库每条有 mp4 效果演示；风格库没有 → 空数组。点全屏预览时优先放视频。
   */
  videos: string[]
}

/** /meta 的返回 */
export interface StyleMeta {
  ok: boolean
  root: string
  source: 'index' | 'scan' | 'empty'
  itemCount: number
  fileCount: number
  categories: Array<{ name: string; count: number }>
  scannedAt: string
  error?: string
}

/** /items 的返回 */
export interface StylePage {
  ok: boolean
  offset: number
  limit: number
  total: number
  hasMore: boolean
  items: StyleCard[]
}

/** 排序方式（与后台约定同一套字符串） */
export type StyleSort = 'default' | 'hot' | 'like'
