/**
 * imageBitmap —— 图片位图的浏览器侧底座（取图 / 画布 / 释放），供裁剪、旋转、扩展共用。
 *
 * 从 imageTransform 里抽出来单独一层的原因：扩展（outpaint）需要"把原图画到**另一块尺寸的**
 * 透明画布上"，这与裁剪/旋转的"在同样内容上重绘"是同一个底座，但调用形态不同
 * （扩展的绘制偏移由调用方决定）。抽出来后三处共用同一份"取图 + 建画布 + 释放"的细节，
 * 不必各写一遍（以前 release/close 这类细节就差点漏掉一处）。
 *
 * 全部函数在**非浏览器环境（node 单测）里安全返回 null**，所以插件在无头环境 import 不会炸。
 */

/** 可绘制位图 + 它的真实像素尺寸 */
export interface DrawableSource {
  source: CanvasImageSource
  width: number
  height: number
}

/**
 * 把图片地址解成可绘制的位图 + 真实像素尺寸。
 * 优先 createImageBitmap（跨域 blob 更稳），退回 <img>；都拿不到返回 null。
 */
export async function loadDrawableSource(url: string): Promise<DrawableSource | null> {
  if (typeof document === 'undefined' || !url) return null
  if (typeof createImageBitmap === 'function') {
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

/** 释放位图（ImageBitmap 需要显式 close，<img> 不用） */
export function releaseDrawable(source: CanvasImageSource): void {
  const maybe = source as { close?: () => void }
  if (typeof maybe.close === 'function') maybe.close()
}

/**
 * 建一块画布、交给 draw 画、产出 PNG dataURL。
 *
 * 画布默认**透明**（不填底色）—— 扩展出来的区域必须是透明的，
 * 交给生成模型时它才知道"这块是要你补内容的地方"（填白会变成"这是一块白画布"）。
 */
export function paintCanvas(
  width: number,
  height: number,
  draw: (c2d: CanvasRenderingContext2D) => void,
): string | null {
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

