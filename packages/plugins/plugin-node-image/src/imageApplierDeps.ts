/**
 * imageApplierDeps —— image 写入器用的 ImageRunDeps 装配（从 createImageOps 的服务接线复用）。
 *
 * 为什么单独一个文件：写入器（plugin-bottom-bar 的 applier）需要量尺寸 + 走 graph 写回，
 * 这两个能力都在 createImageOps 的接线里（read/write/measure），不必再抄一遍。
 */
import { createImageOps, type ImageOpsContext } from './imageOps'
import type { ImageRunDeps } from './imageRun'
import type { ServiceGetter } from './imageOps'

/** 量图片真实像素（与 ImageContent.vue 同一套浏览器 API；node 测试里由 deps.measure 注入假货） */
async function measureImage(url: string): Promise<{ width: number; height: number } | null> {
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

/** 用内核服务装配写入器依赖（读/写/量尺寸/上限四件） */
export function createImageOpsWriteDeps(svc: ServiceGetter): ImageRunDeps {
  const ops: ImageOpsContext = createImageOps(svc)
  return {
    readData: (nodeId) => ops.read(nodeId),
    writeData: (nodeId, data, size) => ops.write(nodeId, data, size),
   measure: (url) => measureImage(url),
    fitLimits: ops.fitLimits,
  }
}
