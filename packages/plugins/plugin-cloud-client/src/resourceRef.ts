/**
 * 画布内资源字段的检查 —— 现在只剩"有没有还没上传的本地地址"这一件事。
 *
 * 资源地址一律是**同源 URL**（/api/canvases/<画布id>/resources/<hash>）：上传/生成时由
 * resource adapter 直接给出，写盘、渲染都用它。所以这里不再需要任何形态解析，
 * 只负责认出后台拿不到的那两种本地地址（dataURL / blob:）。
 */
import { RESOURCE_URL_FIELDS } from './keys.js'

/**
 * 有没有还没上传的本地地址（dataURL / blob:）。
 *
 * 后台拿不到这两种地址 —— 所以下单前必须先上传成画布资源（换成服务器 URL）。
 */
export function pendingUploadFields(data: Record<string, unknown> | undefined): string[] {
  if (!data) return []
  const out: string[] = []
  for (const field of RESOURCE_URL_FIELDS) {
    const v = data[field]
    if (typeof v === 'string' && /^(data:|blob:)/i.test(v)) out.push(field)
  }
  return out
}
