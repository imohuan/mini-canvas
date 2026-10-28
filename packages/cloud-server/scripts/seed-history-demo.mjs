/**
 * 一次性脚本：给指定画布的生成历史补几条**示例记录**（带提示词 / 参数 / 参考素材）。
 *
 * 为什么需要它：历史里的这些字段是今天才加的，之前的生成任务没有记录，
 * 详情弹窗只能显示"没有保存" —— 看不到真实效果。这里按真实形状写 3 条
 * （图片 / 视频 / 音频），引用的资源都**确实存在于该画布**，可以直接预览。
 *
 * 用法：pnpm -C packages/cloud-server exec tsx scripts/seed-history-demo.mjs <画布id>
 * 安全：只追加，不覆盖已有记录；产物文件按内容哈希去重存，可重复运行。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  imageSizeFromBytes,
  videoSizeFromBytes,
  videoDurationFromBytes,
  audioDurationFromBytes,
} from '../src/tasks/mediaSize.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataRoot = path.resolve(here, '..', '.mini-canvas')
const canvasId = process.argv[2] ?? '824e779f34314f86'
const canvasDir = path.join(dataRoot, 'canvases', canvasId)
const resourcesDir = path.join(canvasDir, 'resources')
const historyFile = path.join(canvasDir, 'history.json')

/** 读资源目录，按后缀挑候选 */
async function listByExt(exts) {
  const names = await fs.readdir(resourcesDir).catch(() => [])
  return names.filter((n) => exts.includes(path.extname(n).toLowerCase()))
}

/** 产物地址（同源，前端可直接加载） */
const urlOf = (name) => '/api/canvases/' + canvasId + '/resources/' + name

/**
 * 把别的画布里的资源复制进本画布，返回本画布的文件名。
 *
 * 为什么必须复制：资源地址是 /api/canvases/<画布>/resources/<名>；写别画布的名字，
 * 前端会按"本画布 + 那个名字"去取，取不到就是 404（真机踩到：示例视频整卡空白）。
 * 按内容哈希命名（与 saveResource 一致），重复运行不会堆文件。
 */
async function adopt(srcCanvasId, name) {
  const bytes = await fs.readFile(path.join(dataRoot, 'canvases', srcCanvasId, 'resources', name)).catch(() => null)
  if (!bytes) return undefined
  const crypto = await import('node:crypto')
  const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 16)
  const target = hash + path.extname(name)
  const abs = path.join(resourcesDir, target)
  const exists = await fs.access(abs).then(() => true).catch(() => false)
  if (!exists) await fs.writeFile(abs, bytes)
  return target
}

async function probe(fileName) {
  const bytes = new Uint8Array(await fs.readFile(path.join(resourcesDir, fileName)))
  const ext = path.extname(fileName).toLowerCase()
  const media = { bytes: bytes.length }
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
    const s = imageSizeFromBytes(bytes)
    if (s) Object.assign(media, s)
  } else if (ext === '.mp4' || ext === '.mov') {
    const s = videoSizeFromBytes(bytes)
    if (s) Object.assign(media, s)
    const d = videoDurationFromBytes(bytes)
    if (d) media.durationMs = d
  } else {
    const d = audioDurationFromBytes(bytes, fileName)
    if (d) media.durationMs = d
  }
  return media
}

const images = await listByExt(['.png', '.jpg', '.jpeg', '.webp'])
if (images.length === 0) {
  console.error('画布里没有图片资源，无法生成示例记录：' + resourcesDir)
  process.exit(1)
}

// 视频优先从本画布找；找不到就去别的画布找，找到后**复制进本画布**（地址必须同画布）
let videos = await listByExt(['.mp4', '.mov'])
let videoCanvasId = canvasId
if (videos.length === 0) {
  const others = await fs.readdir(path.join(dataRoot, 'canvases')).catch(() => [])
  for (const other of others) {
    const dir = path.join(dataRoot, 'canvases', other, 'resources')
    const names = await fs.readdir(dir).catch(() => [])
    const hit = names.find((n) => /\.(mp4|mov)$/i.test(n))
    if (hit) {
      videos = [hit]
      videoCanvasId = other
      break
    }
  }
}

// 别的画布的媒体文件要复制进本画布，否则 /api/canvases/<本画布>/resources/<名> 会 404
let videoFile = videos[0]
if (videos.length > 0 && videoCanvasId !== canvasId) {
  videoFile = await adopt(videoCanvasId, videos[0])
  if (!videoFile) {
    console.warn('复制视频失败，跳过视频示例')
    videos = []
  }
}

const now = Date.now()
const entries = []

/** 图片示例：人物立绘，带完整参数与两张参考图 */
{
  const out = images[0]
  const media = await probe(out)
  entries.push({
    id: randomUUID(),
    jobId: randomUUID(),
    canvasId,
    nodeId: 'demo-image-' + randomUUID().slice(0, 6),
    actionId: 'web2api:apimart-image',
    title: '豆包 Seedream 4.5（示例）',
    kind: 'image',
    status: 'done',
    rating: 'passed',
    urls: [urlOf(out)],
    prompt: '一位穿米色针织开衫的年轻女性站在窗边，晨光从侧后方照进来，柔和逆光，浅景深，写实摄影风格',
    values: { ratio: '2:3', quality: '2K', count: 1, style: '写实摄影' },
    resources: [
      { kind: 'image', url: urlOf(images[1] ?? out) },
      { kind: 'image', url: urlOf(images[2] ?? out) },
      { kind: 'text', value: '参考风格：日系柔和逆光，低饱和，胶片颗粒' },
    ],
    media,
    createdAt: now - 42 * 60 * 1000,
    finishedAt: now - 40 * 60 * 1000,
  })
}

/** 视频示例：横版，带时长（只有画布里真有 mp4 时才加） */
if (videos.length > 0) {
  const out = videoFile
  const bytes = new Uint8Array(await fs.readFile(path.join(resourcesDir, out)))
  const media = { bytes: bytes.length }
  const size = videoSizeFromBytes(bytes)
  if (size) Object.assign(media, size)
  const dur = videoDurationFromBytes(bytes)
  if (dur) media.durationMs = dur
  entries.push({
    id: randomUUID(),
    jobId: randomUUID(),
    canvasId,
    nodeId: 'demo-video-' + randomUUID().slice(0, 6),
    actionId: 'web2api:apimart-video',
    title: '豆包 Seedance 2.0 Fast（示例）',
    kind: 'video',
    status: 'done',
    rating: 'passed',
    urls: [urlOf(out)],
    prompt: '镜头缓慢推近，女孩在洒满阳光的房间里缓缓转身，发丝被风吹动，电影感运镜',
    values: { ratio: '16:9', duration: '5s', resolution: '1080p', motion: 'medium' },
    resources: [
      { kind: 'image', url: urlOf(images[0]) },
      { kind: 'text', value: '参考运镜：缓慢推近 + 轻微手持' },
    ],
    media,
    createdAt: now - 26 * 60 * 1000,
    finishedAt: now - 22 * 60 * 1000,
  })
}

/**
 * 音频示例：语音合成。
 *
 * 音频产物必须**真的是音频文件** —— 以前偷懒借用了视频地址，详情与播放都说得过去，
 * 但卡片上的类型角标与"时长"对不上（真机发现视频文件被当成音频）。
 * 本画布没有音频资源时，就从别的画布复制一份进来。
 */
{
  let audioFile
  const localAudio = await listByExt(['.mp3', '.wav', '.m4a', '.aac', '.ogg'])
  if (localAudio.length > 0) audioFile = localAudio[0]
  else {
    const others = await fs.readdir(path.join(dataRoot, 'canvases')).catch(() => [])
    for (const other of others) {
      const dir = path.join(dataRoot, 'canvases', other, 'resources')
      const names = await fs.readdir(dir).catch(() => [])
      const hit = names.find((n) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(n))
      if (hit) {
        audioFile = await adopt(other, hit)
        break
      }
    }
  }
  if (!audioFile) {
    console.warn('找不到任何音频资源，跳过音频示例')
  } else {
    const bytes = new Uint8Array(await fs.readFile(path.join(resourcesDir, audioFile)))
  entries.push({
    id: randomUUID(),
    jobId: randomUUID(),
    canvasId,
    nodeId: 'demo-audio-' + randomUUID().slice(0, 6),
    actionId: 'web2api:doubao-tts',
    title: '豆包 · 语音合成（示例）',
    kind: 'audio',
    status: 'done',
    rating: 'passed',
    urls: [urlOf(audioFile)],
    prompt: '用温柔的女声朗读：清晨的第一缕阳光落在窗台，新的一天开始了。',
    values: { voice: '温暖女声', speed: 1, format: 'mp3' },
    resources: [{ kind: 'text', value: '音色参考：柔和、语速偏慢、句尾轻微上扬' }],
    media: { bytes: bytes.length, ...(audioDurationFromBytes(bytes, audioFile) ? { durationMs: audioDurationFromBytes(bytes, audioFile) } : {}) },
    createdAt: now - 10 * 60 * 1000,
    finishedAt: now - 9 * 60 * 1000,
  })
  }
}

const existing = await fs.readFile(historyFile, 'utf8').then(JSON.parse).catch(() => [])
const next = [...entries, ...(Array.isArray(existing) ? existing : [])]
await fs.writeFile(historyFile, JSON.stringify(next), 'utf8')
console.log('已追加示例历史 ' + entries.length + ' 条 → ' + historyFile)
console.log(JSON.stringify(entries.map((e) => ({ kind: e.kind, media: e.media })), null, 1))
