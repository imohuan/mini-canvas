/**
 * imageTransform —— 图片的浏览器侧加工（读文件 / 读尺寸 / 裁剪 / 旋转 / 下载）。
 *
 * 归本包私有：这些操作不需要内核能力，只是 canvas 与 FileReader 的薄封装。全部函数在
 * **非浏览器环境（node 单测）里返回 null / 空**，所以插件在无头环境 import 本模块不会炸。
 *
 * 为什么上传一律转 dataURL：objectURL 只在当前文档生命周期有效，刷新即失效。dataURL 写进
 * 节点 data 后能直接落盘、刷新照常显示（代价是 localStorage 体积变大，属已知取舍）。
 */
import { toPixelRect, type Rect } from '@mini-canvas/canvas-render'

/** 加工结果：新的图片地址与它自己的像素尺寸 */
export interface TransformResult {
  dataUrl: string
  width: number
  height: number
}

/** File → dataURL（浏览器）；失败抛错由调用方处理 */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('[image] 当前环境不支持 FileReader'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('[image] 读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 读图片元素的真实像素尺寸。
 * 拿不到（环境不支持/不是图片/加载失败）返回 null，调用方据此跳过尺寸矫正。
 */
export function readImageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null)
      return
    }
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** 把图片地址解成可绘制的位图 + 它的像素尺寸；优先 createImageBitmap（跨域 blob 更稳），退回 <img> */
async function loadSource(url: string): Promise<{ source: CanvasImageSource; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null
  const useBitmap = typeof createImageBitmap === 'function'
  if (useBitmap) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        const blob = await res.blob()
        const bitmap = await createImageBitmap(blob)
        return { source: bitmap, width: bitmap.width, height: bitmap.height }
      }
    } catch {
      /* 退回 <img> 路径 */
    }
  }
  if (typeof Image === 'undefined') return null
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** 建一块画布并把位图画上去 */
function paint(width: number, height: number, draw: (c2d: CanvasRenderingContext2D) => void): string | null {
  if (typeof document === 'undefined' || width <= 0 || height <= 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const c2d = canvas.getContext('2d')
  if (!c2d) return null
  draw(c2d)
  const dataUrl = canvas.toDataURL('image/png')
  return dataUrl.startsWith('data:image') ? dataUrl : null
}

/** 释放位图（ImageBitmap 需要显式 close，<img> 不用） */
function release(source: CanvasImageSource): void {
  const maybe = source as { close?: () => void }
  if (typeof maybe.close === 'function') maybe.close()
}

/**
 * 按裁剪框（图片像素坐标）裁出新的 dataURL。
 * `baseWidth/baseHeight` 是 data 里记的显示尺寸：原图真实像素与它不一致时按比例换算，
 * 保证"用户框到的内容"与"实际裁下的内容"一致（v1 ImageCropper 同款处理）。
 * 失败（环境不支持/取图失败/结果为空）返回 null，调用方保留原图并提示。
 */
export async function cropToDataUrl(
  url: string,
  rect: Rect,
  baseWidth: number,
  baseHeight: number,
): Promise<TransformResult | null> {
  const loaded = await loadSource(url)
  if (!loaded) return null
  try {
    const scaleX = baseWidth > 0 ? loaded.width / baseWidth : 1
    const scaleY = baseHeight > 0 ? loaded.height / baseHeight : 1
    const px = toPixelRect({
      x: rect.x * scaleX,
      y: rect.y * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    })
    const sx = Math.min(Math.max(px.x, 0), Math.max(loaded.width - 1, 0))
    const sy = Math.min(Math.max(px.y, 0), Math.max(loaded.height - 1, 0))
    const sw = Math.min(px.width, loaded.width - sx)
    const sh = Math.min(px.height, loaded.height - sy)
    if (sw <= 0 || sh <= 0) return null
    const dataUrl = paint(sw, sh, (c2d) => c2d.drawImage(loaded.source, sx, sy, sw, sh, 0, 0, sw, sh))
    if (!dataUrl) return null
    return { dataUrl, width: sw, height: sh }
  } finally {
    release(loaded.source)
  }
}

/**
 * 顺时针旋转 90° 的整数倍，产出新的 dataURL（宽高随 90/270 交换）。
 * degrees 归一化到 [0,360)；0 或非浏览器环境返回 null（调用方按"没变化"处理）。
 */
export async function rotateToDataUrl(url: string, degrees: number): Promise<TransformResult | null> {
  const deg = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360
  if (deg === 0) return null
  const loaded = await loadSource(url)
  if (!loaded) return null
  try {
    const swap = deg === 90 || deg === 270
    const outW = swap ? loaded.height : loaded.width
    const outH = swap ? loaded.width : loaded.height
    const dataUrl = paint(outW, outH, (c2d) => {
      if (deg === 90) {
        c2d.translate(outW, 0)
        c2d.rotate(Math.PI / 2)
      } else if (deg === 180) {
        c2d.translate(outW, outH)
        c2d.rotate(Math.PI)
      } else {
        c2d.translate(0, outH)
        c2d.rotate((3 * Math.PI) / 2)
      }
      c2d.drawImage(loaded.source, 0, 0)
    })
    if (!dataUrl) return null
    // 旋转后原尺寸标记失效（宽高可能互换），故这里按输出位图的实际尺寸回报
    return { dataUrl, width: outW, height: outH }
  } finally {
    release(loaded.source)
  }
}

/** 触发浏览器下载（非浏览器环境 no-op） */
export function downloadImage(url: string, fileName: string): boolean {
  if (typeof document === 'undefined' || !url) return false
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  return true
}

/**
 * 打开系统选图框并等用户选完（仅浏览器；非浏览器/取消都返回 null）。
 * 供"命令触发上传"用：命令与按钮走同一个上传实现，差别只是文件从哪来。
 */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.style.display = 'none'
    document.body.appendChild(input)
    const finish = (file: File | null): void => {
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    // 用户直接关掉面板时不会触发 change，这里兜底清理（不阻塞命令返回）
    input.addEventListener('cancel', () => finish(null))
    input.click()
  })
}
