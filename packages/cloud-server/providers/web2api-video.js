/**
 * web2api · 视频生成（provider，自包含单文件）
 *
 * 与 web2api-image.js 同一套 HTTP 协议（POST /api/tasks 下单、GET 查进度、cancel 取消）。
 * 单独成文件的原因：图片与视频的轮询节奏、超时预算差得远（视频 30~45 分钟），
 * 拆开后改一边不会影响另一边。公共逻辑按「不能相对 import」的规矩各自复制一份。
 *
 * 环境变量：WEB2API_BASE / WEB2API_API_KEY（见 web2api-image.js 说明）。
 */

const BASE = (process.env.WEB2API_BASE || 'http://localhost:8033').replace(/\/+$/, '')

async function api(path, init = {}, timeoutMs = 60000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}) }
    const key = process.env.WEB2API_API_KEY
    if (key) headers.Authorization = 'Bearer ' + key
    const res = await fetch(BASE + path, { ...init, headers, signal: ac.signal })
    const text = await res.text()
    let body
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      throw new Error('web2api 返回的不是 JSON（HTTP ' + res.status + '）')
    }
    if (body && typeof body.code === 'number' && body.code !== 0) {
      throw new Error(body.message || 'web2api 错误 ' + body.code)
    }
    if (!res.ok) throw new Error(body?.message || 'web2api HTTP ' + res.status)
    return body
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('web2api 请求超时（' + BASE + '）')
    }
    if (/fetch failed|ECONNREFUSED|Failed to fetch|NetworkError/i.test(msg)) {
      throw new Error('连不上 web2api（' + BASE + '）。请先启动它，或设置 WEB2API_BASE')
    }
    throw new Error(msg || 'web2api 调用失败')
  } finally {
    clearTimeout(timer)
  }
}

function cleanValues(values) {
  const out = {}
  for (const [k, v] of Object.entries(values || {})) {
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out
}

function literalOf(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  if (typeof value === 'boolean') return String(value)
  const s = String(value).trim()
  return s === '' ? undefined : '"' + s.replace(/"/g, '') + '"'
}

function numericOf(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return value
}

/** /video(model:"Seedance 2.0 Fast", ratio:"16:9", durationSec:10) 正文 */
function buildChatAutoPrompt(model, values, body) {
  const parts = []
  const modelLit = literalOf(model)
  if (modelLit !== undefined) parts.push('model:' + modelLit)
  const ratioLit = literalOf(values.ratio)
  if (ratioLit !== undefined) parts.push('ratio:' + ratioLit)
  const durLit = literalOf(numericOf(values.durationSec))
  if (durLit !== undefined) parts.push('durationSec:' + durLit)
  const styleLit = literalOf(values.style)
  if (styleLit !== undefined) parts.push('style:' + styleLit)
  const head = '/video' + (parts.length > 0 ? '(' + parts.join(', ') + ')' : '')
  const text = String(body || '').trim()
  return text ? head + ' ' + text : head
}

/**
 * 上游文本素材 -> 带名字的标签块（与图片那份同一口径）。
 * 连进来的文本给一个名字（节点标题优先，没有就 文本1 / 文本2…），
 * 正文包进 <text name="…">；用户在提示词里写 @标题内容 / @文本1 就能指到它。
 */
function textBlocks(input) {
  const out = []
  let n = 0
  for (const r of input.resources || []) {
    if (r.kind !== 'text') continue
    n += 1
    const raw = typeof r.name === 'string' ? r.name.trim() : ''
    const name = raw !== '' ? raw : '文本' + n
    const value = typeof r.value === 'string' ? r.value : ''
    out.push('<text name="' + name + '">\n' + value + '\n</text>')
  }
  return out
}

/**
 * 参考素材 -> 参数（按动作声明的 refFields 分发）。
 *
 * ⚠️ web2api 目前**没有视频参考字段**（所有 meta.ts 的 acceptance 只有 image / audio）。
 * 所以视频节点连进来时：跳过 + 打日志说明，而不是像以前那样混进 referenceImages
 * （那会让 web2api 把一个 mp4 当图片解析，报「图片不存在」或生成出垃圾）。
 */
function attachRefs(action, input, params) {
  const map = action.refFields || {}
  const buckets = {}
  const skipped = []
  for (const r of input.resources || []) {
    if (r.kind === 'text') continue
    const field = map[r.kind]
    if (!field || typeof r.url !== 'string' || !r.url) {
      if (r.kind) skipped.push(r.kind)
      continue
    }
    if (!buckets[field]) buckets[field] = []
    buckets[field].push(r.url)
  }
  for (const [field, urls] of Object.entries(buckets)) {
    const limit = field === 'referenceAudios' ? 3 : 16
    if (urls.length > limit) {
      console.warn('[web2api-video] ' + action.id + ' 的 ' + field + ' 最多 ' + limit + ' 个，已截断')
    }
    params[field] = urls.slice(0, limit)
  }
  if (skipped.length > 0) {
    console.warn(
      '[web2api-video] ' + action.id + ' 不收这些素材，已忽略：' + [...new Set(skipped)].join('、') +
        '（当前平台只收：' + (Object.keys(map).join('、') || '无') + '）',
    )
  }
  return params
}

function buildParams(action, input) {
  const values = (input.values || {})
  const body = [input.prompt || '', ...textBlocks(input)].filter((s) => String(s).trim() !== '').join('\n')

  if (action.promptMode === 'chat-auto') {
    const params = { prompt: buildChatAutoPrompt(action.model, values, body) }
    return attachRefs(action, input, params)
  }

  const params = cleanValues(values)
  if (action.model !== undefined && action.model !== '') params.model = action.model
  params.prompt = body
  return attachRefs(action, input, params)
}

function collectUrls(result) {
  const out = []
  const push = (v) => {
    if (typeof v === 'string') {
      if (/^(https?:|data:|\/)/i.test(v)) out.push(v)
    } else if (Array.isArray(v)) {
      for (const item of v) push(item)
    } else if (v && typeof v === 'object') {
      push(v.url)
      push(v.uri)
      push(v.src)
      push(v.urls)
      push(v.downloadUrl)
      push(v.resource)
      push(v.videoUrl)
    }
  }
  push(result)
  return [...new Set(out)]
}

function absolutize(u) {
  const s = String(u || '').trim()
  if (!s) return ''
  if (/^(https?:|data:|blob:)/i.test(s)) return s
  return BASE + (s.startsWith('/') ? s : '/' + s)
}

async function submitTask(action, input) {
  const body = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ platform: action.platform, operation: action.operation, params: buildParams(action, input) }),
  })
  const task = body && body.data
  if (!task || typeof task.id !== 'string' || !task.id) throw new Error('web2api 没有返回任务 id')
  return task.id
}

async function pollTask(taskId) {
  const body = await api('/api/tasks/' + encodeURIComponent(taskId))
  const t = body && body.data
  if (!t || typeof t !== 'object') return { status: 'running', message: '任务查询返回空', taskId }
  const status = String(t.status || '')

  if (status === 'completed' || status === 'success' || status === 'done') {
    const urls = collectUrls(t.result).map(absolutize).filter(Boolean)
    if (urls.length === 0) return { status: 'error', error: '任务完成但没有产出资源', taskId }
    return { status: 'done', urls, taskId }
  }
  if (status === 'failed') return { status: 'error', error: t.message || '任务执行失败', taskId }
  if (status === 'cancelled') return { status: 'error', error: t.message || '任务已取消', taskId }

  const waiting = status === 'paused' || status === 'retrying' || status === 'pending'
  return {
    status: 'running',
    message: t.message || '生成中…',
    ...(typeof t.progress === 'number' ? { progress: t.progress } : {}),
    taskId,
    ...(waiting ? { waiting: true } : {}),
  }
}

async function cancelTask(taskId) {
  try {
    await api('/api/tasks/' + encodeURIComponent(taskId) + '/cancel', { method: 'POST' }, 15000)
  } catch {
    /* 已是终态：本机已取消，不算错 */
  }
}


const ratio_doubao = {
  key: 'ratio', kind: 'ratio', label: '比例', type: 'select', default: '16:9',
  options: [
    { label: '1:1', value: '1:1' },
    { label: '3:4', value: '3:4' },
    { label: '4:3', value: '4:3' },
    { label: '9:16', value: '9:16' },
    { label: '16:9', value: '16:9' },
    { label: '21:9', value: '21:9' },
  ],
}

const duration_doubao_auto = {
  key: 'durationSec', kind: 'duration', label: '时长', type: 'number',
  min: 4, max: 10, step: 1, default: 5, unit: '秒',
}

/** dola 只有 5 / 10 两档 */
const duration_dola_auto = {
  key: 'durationSec', kind: 'duration', label: '时长', type: 'number', default: 5,
  options: [{ label: '5秒', value: '5' }, { label: '10秒', value: '10' }],
}

const duration_doubao_api = {
  key: 'duration', kind: 'duration', label: '时长', type: 'number',
  min: 4, max: 15, step: 1, default: 10, unit: '秒',
}

const duration_seedance = {
  key: 'duration', kind: 'duration', label: '时长', type: 'number',
  min: 4, max: 180, step: 1, default: 5, unit: '秒',
}

const ratio_seedance = {
  key: 'ratio', kind: 'ratio', label: '比例', type: 'select', default: '16:9',
  options: [{ label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }],
}

const camera_doubao = {
  key: 'cameraMovement', kind: 'camera', label: '运镜', type: 'select',
  options: [
    { label: '固定镜头', value: '固定镜头' },
    { label: '镜头环绕', value: '镜头环绕拍摄' },
    { label: '镜头移动', value: '镜头移动' },
    { label: '镜头聚焦', value: '镜头聚焦' },
  ],
}

const provider = {
  id: 'web2api-video',
  actions: [
    {
      id: 'web2api:doubao-video-fast',
      title: '豆包 Seedance 2.0 Fast',
      description: '豆包网页 UI 自动化生视频：比例 / 时长 4-10 秒',
      group: 'web2api · 视频',
      nodeTypes: ['video'],
      needsPrompt: true,
      order: 10,
      platform: 'doubao', operation: 'chat-auto',
      promptMode: 'chat-auto', mediaMode: 'video', model: 'Seedance 2.0 Fast',
      fields: [ratio_doubao, duration_doubao_auto],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 4000, pollTimeoutMs: 1800000,
    },
    {
      id: 'web2api:doubao-video-mini',
      title: '豆包 Seedance 2.0 Mini',
      description: '豆包网页 UI 自动化生视频（Seedance 2.0 Mini）：比例 / 时长 4-10 秒',
      group: 'web2api · 视频',
      nodeTypes: ['video'],
      needsPrompt: true,
      order: 11,
      platform: 'doubao', operation: 'chat-auto',
      promptMode: 'chat-auto', mediaMode: 'video', model: 'Seedance 2.0 Mini',
      fields: [ratio_doubao, duration_doubao_auto],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 4000, pollTimeoutMs: 1800000,
    },
    {
      id: 'web2api:dola-video-seedance25',
      title: 'Dola Seedance 2.5',
      description: 'Dola 网页 UI 自动化生视频：时长只有 5 / 10 秒；需海外网络',
      group: 'web2api · 视频',
      nodeTypes: ['video'],
      needsPrompt: true,
      order: 12,
      platform: 'dola', operation: 'chat-auto',
      promptMode: 'chat-auto', mediaMode: 'video', model: 'Seedance 2.5',
      fields: [ratio_doubao, duration_dola_auto],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 4000, pollTimeoutMs: 1800000,
    },
    {
      id: 'web2api:dola-video-seedance20',
      title: 'Dola Seedance 2.0',
      description: 'Dola 网页 UI 自动化生视频：时长只有 5 / 10 秒；需海外网络',
      group: 'web2api · 视频',
      nodeTypes: ['video'],
      needsPrompt: true,
      order: 13,
      platform: 'dola', operation: 'chat-auto',
      promptMode: 'chat-auto', mediaMode: 'video', model: 'Seedance 2.0',
      fields: [ratio_doubao, duration_dola_auto],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 4000, pollTimeoutMs: 1800000,
    },
    {
      id: 'web2api:dola-video-seedance10',
      title: 'Dola Seedance 1.0',
      description: 'Dola 网页 UI 自动化生视频：时长只有 5 / 10 秒；需海外网络',
      group: 'web2api · 视频',
      nodeTypes: ['video'],
      needsPrompt: true,
      order: 14,
      platform: 'dola', operation: 'chat-auto',
      promptMode: 'chat-auto', mediaMode: 'video', model: 'Seedance 1.0',
      fields: [ratio_doubao, duration_dola_auto],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 4000, pollTimeoutMs: 1800000,
    },
    {
      id: 'web2api:doubao-video-api-mini',
      title: '豆包 Seedance 2.0 Mini（接口）',
      description: '豆包接口式文生视频（异步轮询）：比例 / 时长 / 运镜',
      group: 'web2api · 视频',
      nodeTypes: ['video'],
      needsPrompt: true,
      order: 15,
      platform: 'doubao', operation: 'generate-video',
      promptMode: 'plain', model: 'seedance_v2.0_mini',
      fields: [ratio_doubao, duration_doubao_api, camera_doubao],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 10000, pollTimeoutMs: 2700000,
    },
    {
      id: 'web2api:doubao-video-api-fast',
      title: '豆包 Seedance 2.0 Fast（接口）',
      description: '豆包接口式文生视频（异步轮询）：比例 / 时长 / 运镜',
      group: 'web2api · 视频',
      nodeTypes: ['video'],
      needsPrompt: true,
      order: 16,
      platform: 'doubao', operation: 'generate-video',
      promptMode: 'plain', model: 'seedance_v2.0',
      fields: [ratio_doubao, duration_doubao_api, camera_doubao],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 10000, pollTimeoutMs: 2700000,
    },
    {
      id: 'web2api:seedance-video-fast',
      title: 'Seedance Fast',
      description: 'Seedance 平台接口式文生视频：时长最长 180 秒',
      group: 'web2api · 视频',
      nodeTypes: ['video'],
      needsPrompt: true,
      order: 17,
      platform: 'seedance', operation: 'generate-video',
      promptMode: 'plain', model: 'fast',
      fields: [ratio_seedance, duration_seedance],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 10000, pollTimeoutMs: 2700000,
    },
    {
      id: 'web2api:seedance-video-20',
      title: 'Seedance 2.0',
      description: 'Seedance 平台接口式文生视频：时长最长 180 秒',
      group: 'web2api · 视频',
      nodeTypes: ['video'],
      needsPrompt: true,
      order: 18,
      platform: 'seedance', operation: 'generate-video',
      promptMode: 'plain', model: '2.0',
      fields: [ratio_seedance, duration_seedance],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 10000, pollTimeoutMs: 2700000,
    },
  ],

  async submit(action, input) {
    try {
      return { taskId: await submitTask(action, input) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async poll(taskId) {
    try {
      return await pollTask(taskId)
    } catch (err) {
      return { status: 'running', message: err instanceof Error ? err.message : '任务查询失败', taskId }
    }
  },

  async cancel(taskId) {
    await cancelTask(taskId)
  },
}

export default provider


