/**
 * 画布内资源字段的检查 —— 现在只剩"有没有还没上传的本地地址"这一件事。
 *
 * 节点里的持久引用是**逻辑 ID**（`<画布id>/<哈希>`），地址由 resolve 现拼；
 * 迁移期老存档/老产物里仍可能是同源 URL。这里不解析形态，只负责认出后台拿不到的
 * 那两种本地地址（dataURL / blob:）—— 它们必须先上传成画布资源才能下单。
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
