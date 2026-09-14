/**
 * imageNodeData —— 数据文案与落盘补丁的纯逻辑契约。
 * 锁的重点：尺寸收敛上限、人类可读大小、下载文件名清洗（脏文件名不能变成没扩展名的文件）。
 */
import { describe, it, expect } from 'vitest'
import { describeImageMeta, downloadFileName, formatFileSize } from '../imageNodeData'

describe('formatFileSize / describeImageMeta', () => {
  it('分级显示 B / KB / MB', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2.0 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('非法大小返回空串（调用方据此不渲染）', () => {
    expect(formatFileSize(undefined)).toBe('')
    expect(formatFileSize(-1)).toBe('')
    expect(formatFileSize(Number.NaN)).toBe('')
  })

  it('尺寸 + 大小拼成一行；都没有则为空', () => {
    expect(describeImageMeta({ width: 1920, height: 1080, size: 2048 })).toBe('1920×1080 · 2.0 KB')
    expect(describeImageMeta({ width: 1920, height: 1080 })).toBe('1920×1080')
    expect(describeImageMeta({})).toBe('')
  })
})

describe('downloadFileName：下载名清洗', () => {
  it('去掉 v1 遗留的操作后缀并补 .png', () => {
    expect(downloadFileName('photo.png_crop')).toBe('photo.png')
    expect(downloadFileName('photo.jpg')).toBe('photo.png')
  })

  it('中文名与无扩展名都可用', () => {
    expect(downloadFileName('风景')).toBe('风景.png')
  })

  it('缺失/空白名回退 image.png', () => {
    expect(downloadFileName(undefined)).toBe('image.png')
    expect(downloadFileName('   ')).toBe('image.png')
    expect(downloadFileName('.png')).toBe('image.png')
  })
})
