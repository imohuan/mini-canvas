/**
 * imageNodeData —— 数据文案与落盘补丁的纯逻辑契约。
 * 锁的重点：尺寸收敛上限、人类可读大小、下载文件名清洗（脏文件名不能变成没扩展名的文件）。
 */
import { describe, it, expect } from 'vitest'
import { describeImageMeta, downloadFileName, formatFileSize, imageTitleExtra } from '../imageNodeData'

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

describe('imageTitleExtra：标题右侧那一格', () => {
  it('有宽高 → `宽×高`（用户要的"图片宽高插到标题右侧"）', () => {
    expect(imageTitleExtra({ imageWidth: 1920, imageHeight: 1080 })).toBe('1920×1080')
  })

  it('尺寸缺失/非法 → 空串（标题那一格不渲染，而不是显示 undefined×undefined）', () => {
    expect(imageTitleExtra({})).toBe('')
    expect(imageTitleExtra(undefined)).toBe('')
    expect(imageTitleExtra({ imageWidth: 0, imageHeight: 100 })).toBe('')
    expect(imageTitleExtra({ imageWidth: Number.NaN, imageHeight: 100 })).toBe('')
  })

  it('只给尺寸、不带体积（那一格只有 20% 宽，塞进"· 1.2 MB"会被截成半截）', () => {
    expect(imageTitleExtra({ imageWidth: 800, imageHeight: 600, imageSize: 123456 })).toBe('800×600')
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
