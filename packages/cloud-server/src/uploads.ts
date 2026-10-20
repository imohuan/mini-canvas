/**
 * 上传体积的上限与「边读边计数」的读取器。
 *
 * ## 为什么单独一层
 *
 * 2026-10-19 实测：资源/资产上传**没有任何大小检查**，匿名请求可以写 200MB 进磁盘，
 * `c.req.arrayBuffer()` 还会把整份文件读进内存（几个并发就能把后台顶到 OOM）。
 * 画布**节点增量写**另有 16MB 上限（`routes/canvasOps.ts`），那条已经够了，不在这里管。
 *
 * ## 为什么不能只信 content-length
 *
 * 它只是调用方自报的。分块传输可以不带，也可以声明一个小的、实际发一个大的。
 * 所以这里读的时候**再计一次数**，超了立刻停。
 */

/** 默认上限：50MB。够放一段短视频 / 一张大图，又不至于一次把盘写满。 */
export const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** 从环境变量读上限（`MINI_CANVAS_MAX_UPLOAD_MB`，非法值回落默认）。 */
export function maxUploadBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = env.MINI_CANVAS_MAX_UPLOAD_MB
  if (!raw) return DEFAULT_MAX_UPLOAD_BYTES
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_UPLOAD_BYTES
  return Math.floor(n * 1024 * 1024)
}

export type ReadBodyResult =
  | { ok: true; bytes: Uint8Array } 
  | { ok: false; reason: 'too-large' | 'empty' | 'unreadable'; limit: number }

/**
 * 读请求体，超过 `limit` 立刻停止（不再往内存里堆）。
 *
 * 先看 content-length：明显超限时连 body 都不读，省得白白传几十 MB。
 * 再看实际读取量：`content-length` 可以撒谎，或根本不存在。
 */
export async function readBodyLimited(
  req: { header(name: string): string | undefined; arrayBuffer(): Promise<ArrayBuffer> },
  limit: number,
): Promise<ReadBodyResult> {
  const declared = Number(req.header('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) {
    return { ok: false, reason: 'too-large', limit }
  }

  let buf: ArrayBuffer
  try {
    buf = await req.arrayBuffer()
  } catch {
    return { ok: false, reason: 'unreadable', limit }
  }
  if (buf.byteLength > limit) return { ok: false, reason: 'too-large', limit }
  if (buf.byteLength === 0) return { ok: false, reason: 'empty', limit }
  return { ok: true, bytes: new Uint8Array(buf) }
}

/** 统一的上传错误响应（413 / 400）。调用方原样返回即可。 */
export function uploadErrorBody(r: Exclude<ReadBodyResult, { ok: true }>): { status: 400 | 413; body: { ok: false; error: string } } {
  if (r.reason === 'too-large') {
    const mb = Math.round((r.limit / 1024 / 1024) * 10) / 10
    return { status: 413, body: { ok: false, error: '文件过大（上限 ' + mb + 'MB）' } }
  }
  if (r.reason === 'empty') return { status: 400, body: { ok: false, error: '空文件' } }
  return { status: 400, body: { ok: false, error: '读取请求体失败' } }
}
