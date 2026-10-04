/**
 * audioWindow —— 长条纹波形的"可视窗口"计算（零 DOM、零 Vue、Node 可单测）。
 *
 * 用户要的效果（原话）："它是一个非常长的波纹，但你这边可视区域只有一部分。播放的时候，
 * 根据当前的进度计算可视区域，然后显示对应可视区域下的波纹"。也就是**背景波纹在播放时滑动**。
 *
 * 做法：整条波形仍然只有 100 个桶（存进节点的就是它），但**显示时只取一段**再铺满卡片宽度：
 * 节点宽度固定，音频有长有短，于是"可视窗口"就决定了这一段里包含多少个桶。
 * 窗口越窄 → 每根竖条越粗、看起来越像"放大镜里的波纹"；越宽 → 越像整首歌的缩略图。
 *
 * 两个边界是本模块存在的理由（各写一条测试钉住）：
 * 1. **短音频整条显示**：2 秒的东西只让你看四分之一，用户会觉得波形丢了；
 * 2. **长音频有下限**：3 分钟的歌按"10 秒窗口"换算只剩 5 个桶，屏幕上就是 5 根粗条，
 *    既不像波形也没信息量。所以窗口最少不低于 MIN_VISIBLE_BUCKETS 个桶。
 */

import { WAVEFORM_BUCKETS } from './waveform'

/** 默认可视窗口时长（秒）：短于它的音频整条显示，长于它的按这个窗口滑动 */
export const DEFAULT_WINDOW_SECONDS = 20

/** 可视桶数下限：再长的音频也不少于这么多桶（否则只剩几根粗条） */
export const MIN_VISIBLE_BUCKETS = 20

/**
 * 该显示多少个桶。
 *
 * - 时长未知/非法 → 整条（不知道多长就别裁）；
 * - 短于窗口秒数 → 整条；
 * - 否则按 总桶数 * 窗口秒数 / 时长 换算，再夹到 [MIN_VISIBLE_BUCKETS, total]。
 *
 * @param duration 音频总时长（秒）
 */
export function visibleBucketCount(duration: number, total = WAVEFORM_BUCKETS, windowSeconds = DEFAULT_WINDOW_SECONDS): number {
  const n = Math.max(1, Math.floor(total))
  if (!Number.isFinite(duration) || duration <= 0) return n
  if (duration <= windowSeconds) return n
  const raw = (n * windowSeconds) / duration
  const clamped = Math.min(n, Math.max(MIN_VISIBLE_BUCKETS, Math.floor(raw)))
  return Math.max(1, clamped)
}

/**
 * 可视窗口的左端（单位：桶）。
 *
 * 尽量把**当前播放位置放在窗口正中**（用户拖动时能同时看到前后），然后夹进
 * [0, total - visible]：开头不左越界、结尾不右越界。
 *
 * 为什么窗口不小于整条时直接返回 0：短音频整条显示，没有"窗口"这回事。
 */
export function windowStartBucket(currentBucket: number, visible: number, total = WAVEFORM_BUCKETS): number {
  const n = Math.max(1, Math.floor(total))
  const v = Math.max(1, Math.floor(visible))
  if (v >= n) return 0
  if (!Number.isFinite(currentBucket) || currentBucket <= 0) return 0
  const centered = currentBucket - v / 2
  return Math.min(Math.max(0, centered), n - v)
}

/**
 * 视口内的相对位置（0..1）→ **绝对进度**（0..1）。
 *
 * 拖动把手与点击波形共用这一条换算 —— 之前它们用的是"整条百分比"，在窗口模式下就与画面
 * 对不上了（实测反馈的"滑动效果异常"）。这里按视口左端 + 视口内偏移算，边缘也准。
 *
 * @param fraction 视口内的相对位置（0 = 视口最左，1 = 视口最右）
 * @param startBucket 视口左端（桶）
 * @param visible 视口宽度（桶）
 */
export function seekRatio(fraction: number, startBucket: number, visible: number, total = WAVEFORM_BUCKETS): number {
  const n = Math.max(1, Math.floor(total))
  const v = Math.max(1, Math.floor(visible))
  const start = Number.isFinite(startBucket) ? startBucket : 0
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  return Math.min(1, Math.max(0, (start + f * v) / n))
}

/**
 * 播放头在**视口内**的相对位置（0..1）。
 *
 * 为什么不能像原来那样"窗口模式恒等于 0.5"：窗口在开头/结尾会被夹住（不越界），
 * 那时播放头并不在窗口正中 —— 硬钉在中间会和实际进度脱节（就是用户看到的那处异常）。
 * 这里按 (播放头 - 视口左端) / 视口宽度 算，夹到 0..1。
 */
export function headFraction(currentBucket: number, startBucket: number, visible: number): number {
  const v = Math.max(1, Math.floor(visible))
  const start = Number.isFinite(startBucket) ? startBucket : 0
  const cur = Number.isFinite(currentBucket) ? currentBucket : 0
  return Math.min(1, Math.max(0, (cur - start) / v))
}

/** 一个渲染帧要用的视口：左端 + 宽度 + 播放头/分界在视口内的相对位置 */
export interface AudioViewport {
  /** 视口左端（桶，整数） */
  start: number
  /** 视口宽度（桶） */
  visible: number
  /** 当前播放位置在视口内的相对位置（0..1） */
  fraction: number
}

/**
 * 算一帧的视口 —— 组件的**唯一**一处窗口换算。
 *
 * 为什么必须只有这一处：波形铺满宽度、已播色块宽度、播放头位置，三者必须用**同一个**视口和
 * **同一把**尺子；分开算过一次，结果就是"波形只铺了左边一小块、竖线却停在中间"（实测 bug）。
 *
 * 左端取整：进 viewBox 的 x 若是小数，波形每帧都会亚像素抖动。
 */
export function audioViewport(
  currentBucket: number,
  total = WAVEFORM_BUCKETS,
  duration = 0,
  windowSeconds = DEFAULT_WINDOW_SECONDS,
): AudioViewport {
  const n = Math.max(1, Math.floor(total))
  const visible = visibleBucketCount(duration, n, windowSeconds)
  const start = Math.floor(windowStartBucket(currentBucket, visible, n))
  return { start, visible, fraction: headFraction(currentBucket, start, visible) }
}
