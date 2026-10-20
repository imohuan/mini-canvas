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

/** 请求对象的最小形状（Hono 的 c.req 满足它；测试可以传替身） */
export interface LimitedBodySource {
  header(name: string): string | undefined
  arrayBuffer(): Promise<ArrayBuffer>
  /** 原始 Web ReadableStream（Hono 的 c.req.raw.body）；有它就**边读边计数** */
  stream?: ReadableStream<Uint8Array> | null
}

/**
 * 读请求体，超过 `limit` **立刻**停止。
 *
 * 三种来源按优先级：
 *   1. `content-length` 已经超限 → 连 body 都不读，直接 413；
 *   2. 有原始流（`c.req.raw.body`）→ 逐块读、累计，超了立刻 `cancel()`；
 *   3. 只有 `arrayBuffer()`（老宿主 / 测试替身）→ 读完再判断（兜底）。
 *
 * 为什么 2 很重要：分块传输可以不带 content-length，也可以声明一个小的、
 * 实际发一个大的。只靠 arrayBuffer() 的话，整个 body 会先被读进内存才进这个函数，
 * 413 来得太晚（进程可能已经 OOM）。
 */
export async function readBodyLimited(req: LimitedBodySource, limit: number): Promise<ReadBodyResult> {
  const rawLen = req.header('content-length')
  if (rawLen !== undefined && rawLen !== '') {
    const declared = Number(rawLen)
    if (Number.isFinite(declared) && declared > limit) return { ok: false, reason: 'too-large', limit }
  }

  if (req.stream) return readStreamLimited(req.stream, limit)

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

/** 逐块读流；累计超过上限立刻取消，后续块不再收 */
async function readStreamLimited(stream: ReadableStream<Uint8Array>, limit: number): Promise<ReadBodyResult> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > limit) {
        // 主动断开：不把剩下的几十 MB 继续收进内存，也让对端知道别再发了
        await reader.cancel().catch(() => undefined)
        return { ok: false, reason: 'too-large', limit }
      }
      chunks.push(value)
    }
  } catch {
    await reader.cancel().catch(() => undefined)
    return { ok: false, reason: 'unreadable', limit }
  }
  if (total === 0) return { ok: false, reason: 'empty', limit }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return { ok: true, bytes: out }
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
