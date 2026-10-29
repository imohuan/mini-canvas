/**
 * plugin-video-crop —— 视频真裁剪后台插件（拷进 <数据根>/server-plugins/ 即生效）。
 *
 * 职责：接前端的裁剪请求，调本机 ffmpeg 按框重新编码，把产物存进画布资源并返回地址。
 *
 *   POST /api/video-crop   { canvasId, nodeId, srcUrl, rect:{x,y,width,height} }
 *     → { ok:true, url, resourceId, width, height, fileName }
 *   GET  /api/video-crop/ping
 *     → { ok:true, plugin:'video-crop' }（前端探针：判断后台是否具备真裁剪能力）
 *
 * 设计要点：
 * - **只产出文件，不写节点**：节点数据归前端（撤销栈 / 保存 / 实时同步都在那边）。
 *   后台直接改节点会绕开前端历史，用户按一次撤销只退一半 —— 这条是踩过的坑。
 * - 产物走 saveSlot（slot-<nodeId>.mp4）：同一节点反复裁剪覆盖同一份文件，
 *   不给磁盘堆一次性中间产物（与可视化节点输出同一条规矩）。
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
        const saved = await resources.saveSlot(canvasId, nodeId, out, '.mp4')
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

/** 按文件头认扩展名（ffmpeg 靠它认格式；认不出给 .bin 也能被 ffmpeg 读） */
function guessExt(bytes) {
  if (bytes.length > 11 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return '.mp4'
  if (bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return '.webm'
  return '.bin'
}

