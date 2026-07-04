import { computed, type ComputedRef } from 'vue'

export interface ImageDisplayGeometry {
  /** 图片在容器内的绘制宽度（px） */
  dw: number
  /** 图片在容器内的绘制高度（px） */
  dh: number
  /** 图片在容器内的水平偏移（px） */
  ox: number
  /** 图片在容器内的垂直偏移（px） */
  oy: number
  /** 图片到容器的缩放比 = dw / iw */
  scale: number
}

/**
 * 计算 object-contain 下图片在容器内的显示几何信息。
 * 图片始终保持原始宽高比，在容器内居中、完全可见。
 */
export function useImageDisplay(
  containerW: ComputedRef<number>,
  containerH: ComputedRef<number>,
  imageWidth: number,
  imageHeight: number,
): ComputedRef<ImageDisplayGeometry> {
  return computed(() => {
    const cw = Math.max(containerW.value, 1)
    const ch = Math.max(containerH.value, 1)
    const iw = Math.max(imageWidth, 1)
    const ih = Math.max(imageHeight, 1)
    const ca = cw / ch
    const ia = iw / ih

    let dw: number, dh: number, ox: number, oy: number
    if (ia > ca) {
      dw = cw; dh = cw / ia; ox = 0; oy = (ch - dh) / 2
    } else {
      dh = ch; dw = ch * ia; ox = (cw - dw) / 2; oy = 0
    }

    return { dw, dh, ox, oy, scale: dw / iw }
  })
}
