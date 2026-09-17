/**
 * video 节点数据的文案与文件名约定（纯函数，Node 直接跑）。
 *
 * 这些是用户**看得见**的字符串（状态栏那一行、下载的文件名），所以值得钉住：
 * 尺寸/时长/大小三段缺哪段就少哪段，而不是显示"undefined"或占位符。
 */
import { describe, it, expect } from 'vitest'
import {
  describeVideoMeta,
  downloadFileName,
  finiteOr,
  formatFileSize,
  formatTime,
  frameFileName,
} from '../videoNodeData'

describe('formatTime：秒 → m:ss', () => {
  it('常规值', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(3600)).toBe('60:00')
  })

  it('小数向下取整；负数/非数按 0（不显示 -1:-1 这种）', () => {
    expect(formatTime(9.99)).toBe('0:09')
    expect(formatTime(-5)).toBe('0:00')
    expect(formatTime(Number.NaN)).toBe('0:00')
    expect(formatTime(undefined)).toBe('0:00')
    expect(formatTime('x')).toBe('0:00')
  })
})

describe('formatFileSize：人类可读', () => {
  it('B / KB / MB / GB 各档', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2.0 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe('3.00 GB')
  })

  it('非法值返回空串（调用方据此不渲染这一段，而不是显示 NaN B）', () => {
    expect(formatFileSize(undefined)).toBe('')
    expect(formatFileSize(-1)).toBe('')
    expect(formatFileSize(Number.NaN)).toBe('')
  })
})

describe('describeVideoMeta：状态栏那一行', () => {
  it('三段齐全时用 · 连接', () => {
    expect(describeVideoMeta({ width: 1920, height: 1080, duration: 65, size: 2048 })).toBe(
      '1920×1080 · 1:05 · 2.0 KB',
    )
  })

  it('缺哪段少哪段（不补占位符）', () => {
    expect(describeVideoMeta({ width: 640, height: 480 })).toBe('640×480')
    expect(describeVideoMeta({ duration: 12 })).toBe('0:12')
    expect(describeVideoMeta({ width: 640, height: 480, size: 100 })).toBe('640×480 · 100 B')
  })

  it('一段都没有 → 空串（状态栏不渲染这一行）', () => {
    expect(describeVideoMeta({})).toBe('')
    expect(describeVideoMeta({ width: 0, height: 0, duration: 0 })).toBe('')
  })
})

describe('downloadFileName：下载文件名', () => {
  it('换掉视频扩展名、补 .mp4', () => {
    expect(downloadFileName('clip.mov')).toBe('clip.mp4')
    expect(downloadFileName('my video.webm')).toBe('my video.mp4')
    expect(downloadFileName('no-ext')).toBe('no-ext.mp4')
  })

  it('名字缺失/空白 → 回退 video.mp4（不出现无扩展名的文件）', () => {
    expect(downloadFileName(undefined)).toBe('video.mp4')
    expect(downloadFileName('')).toBe('video.mp4')
    expect(downloadFileName('   ')).toBe('video.mp4')
  })
})

describe('frameFileName：截图产出的图片名', () => {
  it('去扩展名 + 时刻（冒号换成连字符，Windows 文件名不能带冒号）', () => {
    expect(frameFileName('clip.mp4', 65)).toBe('clip_1-05.png')
    expect(frameFileName('clip.mp4', 0)).toBe('clip_0-00.png')
  })

  it('没名字 → video 打头', () => {
    expect(frameFileName(undefined, 3)).toBe('video_0-03.png')
  })
})

describe('finiteOr：数值兜底（null 必须当缺失，不能当 0）', () => {
  it('真数字原样返回', () => {
    expect(finiteOr(5, 9)).toBe(5)
    expect(finiteOr(0, 9)).toBe(0)
    expect(finiteOr('7', 9)).toBe(7)
  })

  it('null / undefined / 空串 / 非数 → 回落', () => {
    expect(finiteOr(null, 9)).toBe(9)
    expect(finiteOr(undefined, 9)).toBe(9)
    expect(finiteOr('', 9)).toBe(9)
    expect(finiteOr('x', 9)).toBe(9)
    expect(finiteOr(Number.NaN, 9)).toBe(9)
  })
})
