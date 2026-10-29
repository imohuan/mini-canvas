/**
 * plugin-video-crop —— 视频真裁剪后台插件（拷进 <数据根>/server-plugins/ 即生效）。
 *
 * 职责：接前端的裁剪请求，调本机 ffmpeg 按框重新编码，把产物存进画布资源并返回地址。
 *
 *   POST /api/video-crop   { canvasId, nodeId, srcUrl, rect:{x,y,width,height} }
 *     → { ok:true, url, resourceId, width, height, fileName }
 *   POST /api/video-cut    { canvasId, nodeId, srcUrl, start, end }
 *     → { ok:true, url, resourceId, duration, fileName }
 *     （按时间切段：start/end 秒，只保留这一段重新编码；画面尺寸不变，
 *       所以宽高不回传 —— 前端从源节点抄，切不出新尺寸）
 *   GET  /api/video-crop/ping
 *     → { ok:true, plugin:'video-crop' }（前端探针：判断后台是否具备真裁剪能力）
 *
 * 设计要点：
 * - **只产出文件，不写节点**：节点数据归前端（撤销栈 / 保存 / 实时同步都在那边）。
 *   后台直接改节点会绕开前端历史，用户按一次撤销只退一半 —— 这条是踩过的坑。
 * - 产物走**内容寻址**（save：文件名 = 内容哈希）：每次裁剪都是新 URL，
 *   缓存（视频帧图按 URL 做键）自然失效，预览不会停在旧画面。
 *   为什么不用 saveSlot：槽位地址不变、内容会变，前端那套按 URL 缓存缩略图的机制
 *   会把旧帧一直显示下去（用户 2026-10-30 实测报的「底栏预览还是原来的效果」）。
 * - 同一节点同时只允许一个 ffmpeg 任务（进程内 Map 判重），重复请求返回 busy。
 * - 裁剪参数交给 ffmpeg 的 crop filter（w:h:x:y）；yuv420p 要求宽高/偏移为偶数，
 *   这里统一向下取偶（最多丢 1px，肉眼不可见）。
 *
 * 部署：本文件是「源码副本」。实际加载位置是 <数据根>/server-plugins/plugin-video-crop.js
 * （默认 packages/cloud-server/.mini-canvas/）。拷过去后**重启服务**生效（热装见 /api/server-plugins）。
 */
import { spawn } from 'node:child_process'
import { promises as fs, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const name = 'video-crop'

/** 画布 id 白名单（与 canvasPaths.CANVAS_ID_RE 同款；外挂插件不能 import 本包，就地内联） */
const CANVAS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** 节点 id 白名单（同上口径：单段、无路径分隔符） */
const NODE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** 内容寻址资源名（16 位 hex + 可选扩展名）—— 源视频必须是画布资源 */
const HASH_NAME_RE = /^[0-9a-f]{16}(\.[a-z0-9]+)?$/i

/** 从节点存的同源 URL 里取资源名；非画布资源地址返回 undefined */
function parseResourceName(url, canvasId) {
  if (typeof url !== 'string') return undefined
  for (const marker of ['/api/canvases/' + canvasId + '/resources/', '/canvases/' + canvasId + '/resources/']) {
    const i = url.indexOf(marker)
    if (i < 0) continue
    const name = url.slice(i + marker.length).split('?')[0].split('#')[0]
    if (HASH_NAME_RE.test(name)) return name
  }
  return undefined
}

/** 偶数对齐（yuv420p 的宽高与色度偏移都要偶数；最多丢 1px） */
function even(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0))
  return v - (v % 2)
}

/** 秒值收敛到 3 位小数（与前端 readClipRange 同口径，避免落盘脏值） */
function round3(v) {
  return Math.round(Number(v) * 1000) / 1000
}

/** 正在跑的任务：nodeId → Promise（同节点判重） */
const running = new Map()

export function apply(ctx) {
  const resources = ctx.get('canvasResources')

  ctx.routes.post('/api/video-crop', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object') return c.json({ ok: false, error: 'body 不是 JSON' }, 400)
    const { canvasId, nodeId, srcUrl, rect } = body
    if (typeof canvasId !== 'string' || !CANVAS_ID_RE.test(canvasId)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    if (typeof nodeId !== 'string' || !NODE_ID_RE.test(nodeId)) return c.json({ ok: false, error: '非法节点 id' }, 400)
    if (running.has(nodeId)) return c.json({ ok: false, error: 'busy', message: '该节点已有裁剪任务在跑' }, 409)
    const name = parseResourceName(srcUrl, canvasId)
    if (!name) return c.json({ ok: false, error: '源视频不是画布资源（本地/外链地址暂不支持真裁剪）' }, 400)
    const r = rect && typeof rect === 'object' ? rect : {}
    const x = even(r.x)
    const y = even(r.y)
    const width = even(r.width)
    const height = even(r.height)
    if (width <= 0 || height <= 0) return c.json({ ok: false, error: '裁剪框无效' }, 400)

    const src = await resources.read(canvasId, name)
    if (!src) return c.json({ ok: false, error: '源视频不存在' }, 404)

    const promise = runFfmpegCrop(Buffer.from(src), { x, y, width, height })
      .then(async (out) => {
        const saved = await resources.save(canvasId, out, '.mp4')
        return { ok: true, url: saved.url, resourceId: canvasId + '/' + saved.hashName, width, height, fileName: 'crop-' + name }
      })
      .finally(() => running.delete(nodeId))
    running.set(nodeId, promise)
    try {
      const result = await promise
      return c.json(result, result.ok ? 200 : 500)
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  ctx.routes.get('/api/video-crop/ping', (c) => c.json({ ok: true, plugin: 'video-crop' }))

  /**
   * 按时间切一段（真换文件）：start/end 秒，重编码成新 mp4。
   *
   * 与裁剪共用 running（同节点只允许一个 ffmpeg）；产物同样走内容寻址（save）。
   * 为什么不原地改节点：节点数据归前端 —— 见文件头「设计要点」。
   */
  ctx.routes.post('/api/video-cut', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object') return c.json({ ok: false, error: 'body 不是 JSON' }, 400)
    const { canvasId, nodeId, srcUrl } = body
    if (typeof canvasId !== 'string' || !CANVAS_ID_RE.test(canvasId)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    if (typeof nodeId !== 'string' || !NODE_ID_RE.test(nodeId)) return c.json({ ok: false, error: '非法节点 id' }, 400)
    const start = Number(body.start)
    const end = Number(body.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return c.json({ ok: false, error: '剪辑范围不是数字' }, 400)
    if (start < 0) return c.json({ ok: false, error: '开始时间不能小于 0' }, 400)
    const length = end - start
    // 至少 0.1 秒（与前端 MIN_CLIP_DURATION 同一口径）：再短 ffmpeg 出不了可用视频
    if (length < 0.1) return c.json({ ok: false, error: '剪辑范围太短（至少 0.1 秒）' }, 400)
    if (running.has(nodeId)) return c.json({ ok: false, error: 'busy', message: '该节点已有视频任务在跑' }, 409)
    const name = parseResourceName(srcUrl, canvasId)
    if (!name) return c.json({ ok: false, error: '源视频不是画布资源（本地/外链地址暂不支持真剪辑）' }, 400)

    const src = await resources.read(canvasId, name)
    if (!src) return c.json({ ok: false, error: '源视频不存在' }, 404)

    const promise = runFfmpegCut(Buffer.from(src), start, length)
      .then(async (out) => {
        const saved = await resources.save(canvasId, out, '.mp4')
        // 实际时长以文件为准（ffmpeg 按帧切，与请求的 end-start 会差几十毫秒）。
        // 前端把它写进 videoDuration，播放器的区间就是真实长度，不会在结尾被截掉一点。
        const real = await probeDuration(out).catch(() => undefined)
        return {
          ok: true,
          url: saved.url,
          resourceId: canvasId + '/' + saved.hashName,
          duration: round3(real && real > 0 ? real : length),
          fileName: 'cut-' + name,
        }
      })
      .finally(() => running.delete(nodeId))
    running.set(nodeId, promise)
    try {
      const result = await promise
      return c.json(result, result.ok ? 200 : 500)
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })
}

/** 起 ffmpeg：crop + 重编码 H.264（音频流原样复制；时长不变，只裁画面） */
function runFfmpegCrop(bytes, rect) {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mc-crop-'))
    const src = path.join(dir, 'src' + guessExt(bytes))
    const dst = path.join(dir, 'out.mp4')
    const cleanup = () => { void fs.rm(dir, { recursive: true, force: true }).catch(() => undefined) }
    fs.writeFile(src, bytes)
      .then(() => {
        const ff = spawn('ffmpeg', [
          '-y', '-hide_banner', '-loglevel', 'error',
          '-i', src,
          '-vf', 'crop=' + rect.width + ':' + rect.height + ':' + rect.x + ':' + rect.y,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-c:a', 'copy', '-movflags', '+faststart',
          dst,
        ], { windowsHide: true })
        let stderr = ''
        ff.stderr.on('data', (d) => { stderr += String(d) })
        ff.on('error', (err) => { cleanup(); reject(new Error('ffmpeg 启动失败（后台没装 ffmpeg？）: ' + err.message)) })
        ff.on('close', async (code) => {
          if (code !== 0) { cleanup(); reject(new Error('ffmpeg 退出码 ' + code + ': ' + stderr.slice(-400))); return }
          try {
            const out = await fs.readFile(dst)
            cleanup()
            resolve(out)
          } catch (err) { cleanup(); reject(err) }
        })
      })
      .catch(reject)
  })
}

/**
 * 起 ffmpeg：按时间切一段 + 重编码 H.264。
 *
 * 为什么用**输入前 -ss**：它让 ffmpeg 快速跳到目标附近，再从前一个关键帧解码、
 * 精确剪到 start（画面准），比输出前 seek 快得多。
 * 音频跟着重编码成 aac：`-c:a copy` 在切点会带进编码器延迟（起头一小段杂音或静音），
 * 切段本来就短，那点偏移比一次 aac 编码更明显。
 * @param start 起始秒；@param length 保留秒数（end - start）
 */
function runFfmpegCut(bytes, start, length) {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mc-cut-'))
    const src = path.join(dir, 'src' + guessExt(bytes))
    const dst = path.join(dir, 'out.mp4')
    const cleanup = () => { void fs.rm(dir, { recursive: true, force: true }).catch(() => undefined) }
    fs.writeFile(src, bytes)
      .then(() => {
        const ff = spawn('ffmpeg', [
          '-y', '-hide_banner', '-loglevel', 'error',
          '-ss', String(start),
          '-i', src,
          '-t', String(length),
          '-map', '0:v:0', '-map', '0:a:0?',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k',
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          dst,
        ], { windowsHide: true })
        let stderr = ''
        ff.stderr.on('data', (d) => { stderr += String(d) })
        ff.on('error', (err) => { cleanup(); reject(new Error('ffmpeg 启动失败（后台没装 ffmpeg？）: ' + err.message)) })
        ff.on('close', async (code) => {
          if (code !== 0) { cleanup(); reject(new Error('ffmpeg 退出码 ' + code + ': ' + stderr.slice(-400))); return }
          try {
            const out = await fs.readFile(dst)
            cleanup()
            resolve(out)
          } catch (err) { cleanup(); reject(err) }
        })
      })
      .catch(reject)
  })
}

/** 用 ffprobe 量出视频真实时长（秒）；失败给 undefined（调用方回落请求的长度） */
function probeDuration(bytes) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mc-probe-'))
    const src = path.join(dir, 'probe.mp4')
    const cleanup = () => { void fs.rm(dir, { recursive: true, force: true }).catch(() => undefined) }
    fs.writeFile(src, bytes)
      .then(() => {
        const ff = spawn('ffprobe', [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          src,
        ], { windowsHide: true })
        let stdout = ''
        ff.stdout.on('data', (d) => { stdout += String(d) })
        ff.on('error', () => { cleanup(); resolve(undefined) })
        ff.on('close', (code) => {
          cleanup()
          const v = Number(stdout.trim())
          resolve(code === 0 && Number.isFinite(v) && v > 0 ? v : undefined)
        })
      })
      .catch(() => { cleanup(); resolve(undefined) })
  })
}

/** 按文件头认扩展名（ffmpeg 靠它认格式；认不出给 .bin 也能被 ffmpeg 读） */
function guessExt(bytes) {
  if (bytes.length > 11 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return '.mp4'
  if (bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return '.webm'
  return '.bin'
}

