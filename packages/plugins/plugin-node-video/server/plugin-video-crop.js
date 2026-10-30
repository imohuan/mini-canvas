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
 *   POST /api/video-audio  { canvasId, nodeId, srcUrl }
 *     → { ok:true, url, resourceId, duration, fileName }
 *     （抽出音轨存成 mp3；视频没有音轨 → 400 并说明原因）
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
 * ## 部署（别手工拷源码副本了）
 *
 * 本插件现在是「前后台成对」的：包内 build 会把它打进 dist/server.js
 * （见 scripts/build-server.mjs），清单据此给出可信 sha256；
 * 再跑包内的 deploy:server 脚本，经 /api/server-plugins/install 热装到跑着的后台
 * （默认 http://127.0.0.1:8865）。
 *
 * 为什么不能只拷源码：安装接口只认清单里的可信哈希，而清单读的是 dist/server.js；
 * 手工拷的副本没有对应 hash，热装时还会因为「同名插件已在跑」失败。
 * 旧版本手工副本（plugin-video-crop.js）要先经卸载接口摘掉，否则内存里占着 video-crop 这个名字。
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
/**
 * 资源名白名单，与 cloud-server 的 isSafeResourceName **完全同口径**（两种形态）：
 *   ① 内容寻址：16 位 hex + 可选扩展名（上传 / 生成产物 / 后台自己 save 出来的）
 *   ② 覆盖槽位：slot-<槽位id> + 可选扩展名（可视化节点这类"原地更新同一份文件"的产物）
 *
 * 为什么必须认第 ②：画布里不少视频就是槽位产物（例如 slot-54.mp4）。只认哈希形态时，
 * 这些节点点「剪辑」会被判成"源视频不是画布资源"，后台对真实存在的文件拒绝服务
 * （用户 2026-10-30 实测报的正是这条）。判据只做**单段文件名白名单**，不放行路径分隔符，
 * 真正的读盘仍由 canvasResources.read 再校验一次。
 */
const HASH_NAME_RE = /^[0-9a-f]{16}(\.[a-z0-9]+)?$/i
const SLOT_NAME_RE = /^slot-[A-Za-z0-9_-]{1,64}(\.[a-z0-9]+)?$/

/** 资源名是否合法（与 cloud-server 的 isSafeResourceName 同口径） */
export function isSafeResourceName(name) {
  return HASH_NAME_RE.test(name) || SLOT_NAME_RE.test(name)
}

/** 从节点存的同源 URL 里取资源名；非画布资源地址返回 undefined */
export function parseResourceName(url, canvasId) {
  if (typeof url !== 'string') return undefined
  for (const marker of ['/api/canvases/' + canvasId + '/resources/', '/canvases/' + canvasId + '/resources/']) {
    const i = url.indexOf(marker)
    if (i < 0) continue
    const name = url.slice(i + marker.length).split('?')[0].split('#')[0]
    if (isSafeResourceName(name)) return name
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
   * 抽音轨：视频 → mp3（用户口径 2026-10-30：视频节点上要有一个"转音频"的按钮）。
   *
   * 为什么在后台做：浏览器里没有"只取音轨、不重录"的能力（MediaRecorder 要实时播完整段），
   * ffmpeg 一条命令就够。产物走内容寻址（save），与裁剪 / 切段同一条路径。
   *
   * 为什么是 mp3：画布资源扩展名白名单里音频只有 .mp3 / .wav，写 .m4a 会被抹成无扩展名，
   * 播放器认不出类型。mp3 兼容面最广、体积也合理。
   *
   * 没有音轨的视频很常见（AI 生成的无声片段）：ffmpeg 会失败，这里翻译成一句能看懂的话，
   * 而不是把编码器 stderr 丢给用户。
   */
  ctx.routes.post('/api/video-audio', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object') return c.json({ ok: false, error: 'body 不是 JSON' }, 400)
    const { canvasId, nodeId, srcUrl } = body
    if (typeof canvasId !== 'string' || !CANVAS_ID_RE.test(canvasId)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    if (typeof nodeId !== 'string' || !NODE_ID_RE.test(nodeId)) return c.json({ ok: false, error: '非法节点 id' }, 400)
    if (running.has(nodeId)) return c.json({ ok: false, error: 'busy', message: '该节点已有视频任务在跑' }, 409)
    const name = parseResourceName(srcUrl, canvasId)
    if (!name) return c.json({ ok: false, error: '源视频不是画布资源（本地/外链地址暂不支持转音频）' }, 400)

    const src = await resources.read(canvasId, name)
    if (!src) return c.json({ ok: false, error: '源视频不存在' }, 404)

    const promise = runFfmpegAudio(Buffer.from(src))
      .then(async (out) => {
        const saved = await resources.save(canvasId, out, '.mp3')
        // 时长以文件为准（mp3 编码器会在尾部补几毫秒静音）；拿不到就不写，让前端按需再读
        const real = await probeDuration(out).catch(() => undefined)
        return {
          ok: true,
          url: saved.url,
          resourceId: canvasId + '/' + saved.hashName,
          duration: round3(real && real > 0 ? real : 0),
          fileName: 'audio-' + name,
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

/**
 * 起 ffmpeg：只抽音轨，编码成 mp3（画面整条丢掉）。
 *
 * 三处刻意：
 * - 明确不要视频流：不加也能出音轨，但加了之后 ffmpeg 不必解码画面，快得多；
 * - mp3 用可变码率（质量档 2，约 190kbps）：人声与音乐都够，体积比固定码率小；
 * - **没有音轨**时 ffmpeg 会以 "does not contain any stream" 失败 ——
 *   这是用户能理解的情况（无声视频），翻译成中文提示，别把 stderr 原样扔出去。
 */
function runFfmpegAudio(bytes) {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mc-audio-'))
    const src = path.join(dir, 'src' + guessExt(bytes))
    const dst = path.join(dir, 'out.mp3')
    const cleanup = () => { void fs.rm(dir, { recursive: true, force: true }).catch(() => undefined) }
    fs.writeFile(src, bytes)
      .then(() => {
        const ff = spawn('ffmpeg', [
          '-y', '-hide_banner', '-loglevel', 'error',
          '-i', src,
          '-vn',
          '-map', '0:a:0?',
          '-c:a', 'libmp3lame', '-q:a', '2',
          dst,
        ], { windowsHide: true })
        let stderr = ''
        ff.stderr.on('data', (d) => { stderr += String(d) })
        ff.on('error', (err) => { cleanup(); reject(new Error('ffmpeg 启动失败（后台没装 ffmpeg？）: ' + err.message)) })
        ff.on('close', async (code) => {
          if (code !== 0) {
            cleanup()
            const noAudio = /does not contain any stream|matches no streams/i.test(stderr)
            reject(new Error(noAudio ? '这段视频没有音轨，转不出音频' : 'ffmpeg 退出码 ' + code + ': ' + stderr.slice(-400)))
            return
          }
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

