/**
 * assetRefOpen —— 「一条引用被点了」之后，应用层要做的**纯换算**（零 Vue、零 DOM，可单测）。
 *
 * 两个换算各有各的坑，单独放一份才盯得住：
 *   ① `ext` → 预览器种类（png→图片 / mp4→视频 / mp3→音频）；认不出当图片（资产里最常见的就是图）。
 *   ② 本机绝对路径 → 浏览器**打开得了**的地址。引用标记里给的是绝对路径（因为要能复制给本机
 *      Agent 直接用），但浏览器加载不了本机路径 —— 必须换算回同源的 HTTP 面。
 *
 * 判断「是文件还是文件夹」不在这里：那由**标记里有没有 ext** 决定（消费方分流），
 * 见 packages/plugins/plugin-agent/src/refClickEvents.ts。
 */

/** 扩展名 → MediaViewer 认的 kind */
export const KIND_OF_EXT: Record<string, string> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', svg: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', m4v: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio',
  txt: 'text', md: 'text', json: 'text',
}

/** 媒体种类（认不出当图片） */
export function kindOfExt(ext: string | undefined): string {
  return KIND_OF_EXT[(ext ?? '').toLowerCase()] ?? 'image'
}

/**
 * 本机绝对路径 → 同源可取地址。
 *
 * 后端的两类字节各有自己的 HTTP 面（见 cloud-server 的 assets / canvasResources 路由）：
 *   `<root>/assets/files/<hash><ext>`            → /api/assets/files/<hash><ext>
 *   `<root>/canvases/<画布id>/resources/<名>`     → /api/canvases/<画布id>/resources/<名>
 * 取路径最后一段就是那个文件名，所以两种形态都能从路径本身反推；
 * 而**已经是这种 HTTP 面**的地址再算一次是恒等的（同一个文件名、同一个路由），不用特判。
 *
 * 唯一要特判的是**外部地址**（别的服务的 `http://…`）：原样用，不拿它的尾段去猜本地路由
 *（踩过：以 `/` 开头的本机绝对路径被误当成「已经是相对地址」原样返回，浏览器随即打不开）。
 */
export function assetUrlOf(path: string | undefined): string {
  const raw = (path ?? '').replace(/\\/g, '/')
  if (!raw) return ''
  if (/^(https?:)?\/\//i.test(raw)) return raw
  const name = raw.split('/').pop() ?? ''
  if (!name) return ''
  const res = /\/canvases\/([^/]+)\/resources\//.exec(raw)
  if (res) return '/api/canvases/' + res[1] + '/resources/' + name
  return '/api/assets/files/' + name
}
