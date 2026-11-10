/**
 * web2api · 图片生成（provider，自包含单文件）
 *
 * 直接调 web2api 的 HTTP 任务接口（不再走 MCP）：
 *   POST /api/tasks            -> { code, message, data: task }
 *   GET  /api/tasks/:id        -> { code, message, data: task }
 *   POST /api/tasks/:id/cancel -> { code, message, data: { cancelled } }
 *
 * 动作 id 与原前端插件保持一致（web2api:...），旧画布里存过的 actionId 继续有效。
 *
 * 环境变量：
 *   WEB2API_BASE      服务地址，默认 http://localhost:8033
 *   WEB2API_API_KEY   可选；服务端设了 API_KEY 时填同一个
 */

/**
 * 服务地址与密钥：优先「平台管理」页存的配置（__mcProviderConfig，装载时注入），
 * 回落环境变量（老部署兼容），再回落默认值。
 * 多账号：submit 按动作参数里选中的账号 id 取对应那套值（见 accountValues）。
 */
function injected() {
  return typeof __mcProviderConfig === 'undefined' ? { accounts: [], values: {}, byId: {} } : __mcProviderConfig
}
/** 这次任务用哪个账号的值：values.__accountId 优先，没选就第一账号 */
function accountValues(values) {
  const inj = injected()
  const preferred = values && typeof values.__accountId === 'string' ? values.__accountId : ''
  if (preferred && inj.byId && inj.byId[preferred]) return inj.byId[preferred]
  const accounts = inj.accounts || []
  if (accounts.length > 0) return accounts[0].values || {}
  return inj.values || {}
}
function baseOf(values) {
  const b = values && typeof values.baseUrl === 'string' && values.baseUrl.trim()
    ? values.baseUrl.trim()
    : (process.env.WEB2API_BASE || 'http://localhost:8033')
  return String(b).replace(/\/+$/, '')
}
const BASE = baseOf(injected().values || {})

/** 一次 HTTP 调用：统一解 code / 超时 / 人话错误 */
async function api(path, init = {}, timeoutMs = 60000, values) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}) }
    const key = values && values.apiKey ? values.apiKey : process.env.WEB2API_API_KEY
    if (key) headers.Authorization = 'Bearer ' + key
    const res = await fetch(baseOf(values) + path, { ...init, headers, signal: ac.signal })
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
      throw new Error('web2api 请求超时（' + baseOf(values) + '）')
    }
    if (/fetch failed|ECONNREFUSED|Failed to fetch|NetworkError/i.test(msg)) {
      throw new Error('连不上 web2api（' + baseOf(values) + '）。请先启动它，或在「平台」页配置服务地址')
    }
    throw new Error(msg || 'web2api 调用失败')
  } finally {
    clearTimeout(timer)
  }
}

/** 空值不发，免得覆盖服务端默认 */
function cleanValues(values) {
  const out = {}
  for (const [k, v] of Object.entries(values || {})) {
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out
}

/** 值 -> 前缀里的字面量：数字原样，字符串加引号 */
function literalOf(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  if (typeof value === 'boolean') return String(value)
  const s = String(value).trim()
  return s === '' ? undefined : '"' + s.replace(/"/g, '') + '"'
}

/** 拼 chat-auto 前缀：/image(model:"Seedream 4.5", ratio:"16:9") 正文 */
function buildChatAutoPrompt(mode, model, values, body) {
  const parts = []
  const modelLit = literalOf(model)
  if (modelLit !== undefined) parts.push('model:' + modelLit)
  const ratioLit = literalOf(values.ratio)
  if (ratioLit !== undefined) parts.push('ratio:' + ratioLit)
  const styleLit = literalOf(values.style)
  if (styleLit !== undefined) parts.push('style:' + styleLit)
  const head = '/' + mode + (parts.length > 0 ? '(' + parts.join(', ') + ')' : '')
  const text = String(body || '').trim()
  return text ? head + ' ' + text : head
}

/**
 * 上游文本素材 -> 带名字的标签块。
 *
 * 用户口径（2026-11-08）：文本要能**按名字引用**，不要糊成一大段。
 * 连进来的文本给一个名字（节点标题优先，没有就 文本1 / 文本2…），
 * 正文包进 <text name="…"> 里；用户在自己的提示词里写 @标题内容 / @文本1 就能指到它。
 */
/** 资源在数组里的位置就是它的引用索引（从 1 开始）；平台只认序号，不认节点名 */
function refLabel(resource, index) {
  const kind = resource && typeof resource.kind === 'string' ? resource.kind : ''
  const prefix =
    kind === 'image' ? '图片'
    : kind === 'video' ? '视频'
    : kind === 'audio' ? '音频'
    : kind === 'text' ? '文本'
    : '资源'
  return prefix + (index + 1)
}

function textBlocks(input) {
  const out = []
  const resources = input.resources || []
  resources.forEach((r, i) => {
    if (!r || r.kind !== 'text') return
    const value = typeof r.value === 'string' ? r.value : ''
    out.push('<text name="' + refLabel(r, i) + '">\n' + value + '\n</text>')
  })
  return out
}

/** 提示词分段 → 平台要的一段文字（标签按资源在数组里的「类型+序号」展开） */
function promptText(input) {
  const labels = new Map()
  const resources = input.resources || []
  resources.forEach((r, i) => {
    if (r && typeof r.id === 'string' && r.id) labels.set(r.id, refLabel(r, i))
  })
  let out = ''
  for (const seg of input.prompts || []) {
    if (!seg || typeof seg.value !== 'string') continue
    if (seg.type === 'tag') {
      out += '@' + (labels.get(seg.value) || seg.value)
    } else {
      out += seg.value
    }
  }
  return out
}

/**
 * 参考素材 -> 参数（按动作自己声明的 refFields 分发）。
 *
 * refFields 是这份 provider 的「这个平台收什么」：
 *   { image: 'referenceImages' }
 * 没声明的类型 = 这台平台不收，跳过并打一条日志（让用户知道为什么没生效）。
 * 以后接「图/文/视频/音频全收」的模型：给那条动作补 refFields 即可，分发逻辑不动。
 * 注意：web2api 目前**只有**图片与音频两个参考字段，没有视频参考字段。
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
      console.warn('[web2api-image] ' + action.id + ' 的 ' + field + ' 最多 ' + limit + ' 个，已截断')
    }
    params[field] = urls.slice(0, limit)
  }
  if (skipped.length > 0) {
    console.warn(
      '[web2api-image] ' + action.id + ' 不收这些素材，已忽略：' + [...new Set(skipped)].join('、') +
        '（当前平台只收：' + (Object.keys(map).join('、') || '无') + '）',
    )
  }
  return params
}

/** 组一次下单参数 */
function buildParams(action, input) {
  const values = (input.values || {})
  const body = [promptText(input), ...textBlocks(input)].filter((s) => String(s).trim() !== '').join('\n')

  if (action.promptMode === 'chat-auto') {
    const params = { prompt: buildChatAutoPrompt(action.mediaMode || 'image', action.model, values, body) }
    return attachRefs(action, input, params)
  }

  const params = cleanValues(values)
  if (action.model !== undefined && action.model !== '') params.model = action.model
  params.prompt = body
  return attachRefs(action, input, params)
}

/** 任务结果里的产物地址（兼容数组 / 嵌套对象） */
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
    }
  }
  push(result)
  return [...new Set(out)]
}

/** 相对地址补成 web2api 的绝对地址 */
function absolutize(u) {
  const s = String(u || '').trim()
  if (!s) return ''
  if (/^(https?:|data:|blob:)/i.test(s)) return s
  return BASE + (s.startsWith('/') ? s : '/' + s)
}

/** 提交一次任务，返回 taskId */
async function submitTask(action, input) {
  const values = accountValues(input.values)
  const body = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ platform: action.platform, operation: action.operation, params: buildParams(action, input) }),
  }, 60000, values)
  const task = body && body.data
  if (!task || typeof task.id !== 'string' || !task.id) throw new Error('web2api 没有返回任务 id')
  return task.id
}

/** 查一次任务 */
async function pollTask(taskId) {
  // 轮询沿用注入的默认账号地址（任务从属关系由 taskId 保证，账号只决定打到哪台服务）
  const body = await api('/api/tasks/' + encodeURIComponent(taskId), {}, 60000, accountValues())
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

  // paused（等验证码）/ retrying / pending（换号重排）：都在自己往前走，不算失败、不占超时。
  const waiting = status === 'paused' || status === 'retrying' || status === 'pending'
  return {
    status: 'running',
    message: t.message || '生成中…',
    ...(typeof t.progress === 'number' ? { progress: t.progress } : {}),
    taskId,
    ...(waiting ? { waiting: true } : {}),
  }
}

/** 取消服务端任务 */
async function cancelTask(taskId) {
  try {
    await api('/api/tasks/' + encodeURIComponent(taskId) + '/cancel', { method: 'POST' }, 15000, accountValues())
  } catch {
    /* 已是终态 / 服务端不认：本机已取消，不算错 */
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
    { label: '3:2', value: '3:2' },
  ],
}

const ratio_dola = {
  key: 'ratio', kind: 'ratio', label: '比例', type: 'select', default: '1:1',
  options: [
    { label: '1:1', value: '1:1' },
    { label: '2:3', value: '2:3' },
    { label: '3:4', value: '3:4' },
    { label: '4:3', value: '4:3' },
    { label: '9:16', value: '9:16' },
    { label: '16:9', value: '16:9' },
  ],
}

const ratio_chatgpt = {
  key: 'ratio', kind: 'ratio', label: '比例', type: 'select', default: '1:1',
  options: [
    { label: '1:1', value: '1:1' },
    { label: '2:3', value: '2:3' },
    { label: '3:4', value: '3:4' },
    { label: '4:3', value: '4:3' },
    { label: '9:16', value: '9:16' },
    { label: '16:9', value: '16:9' },
  ],
}

const ratio_apimart = {
  key: 'ratio', kind: 'ratio', label: '比例', type: 'select', default: '1:1',
  options: [
    { label: '1:1', value: '1:1' },
    { label: '3:2', value: '3:2' },
    { label: '2:3', value: '2:3' },
    { label: '4:3', value: '4:3' },
    { label: '3:4', value: '3:4' },
    { label: '5:4', value: '5:4' },
    { label: '4:5', value: '4:5' },
    { label: '16:9', value: '16:9' },
    { label: '9:16', value: '9:16' },
    { label: '2:1', value: '2:1' },
    { label: '1:2', value: '1:2' },
    { label: '3:1', value: '3:1' },
    { label: '1:3', value: '1:3' },
    { label: '21:9', value: '21:9' },
    { label: '9:21', value: '9:21' },
  ],
}

const resolution_apimart = {
  key: 'resolution', label: '分辨率', type: 'grid', default: '1k',
  options: [
    { label: '1K (标清)', value: '1k' },
    { label: '2K (高清)', value: '2k' },
    { label: '4K (超清)', value: '4k' },
  ],
}

/** 数量是「1~10 档」，滑块比按钮更好用（10 个按钮排成两行） */
const count_apimart = { key: 'n', label: '数量', type: 'number', default: 1, min: 1, max: 10, step: 1 }

const provider = {
  id: 'web2api-image',
  // 平台展示信息（管理页显示；icon 也作为该平台模型的兜底图标）
  title: 'Web2API · 图片',
  description: '豆包 / Dola / Seedream 网页自动化生图',
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="wcImg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#0891b2"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#wcImg)"/><path d="M9 22V10h4.2c3 0 4.8 1.6 4.8 4.1 0 2.2-1.4 3.7-3.7 4l4.2 3.9h-3.2l-4-3.9V22H9zm3-6.1h1.5c1.3 0 2-.6 2-1.8s-.7-1.8-2-1.8H12v3.6z" fill="#fff"/></svg>',
  // 平台管理页据此渲染配置表单（多账号每套一份；secret 只写不回读）
  config: [
    { key: 'baseUrl', label: '服务地址', type: 'string', default: 'http://localhost:8033',
      placeholder: 'http://localhost:8033', description: 'web2api 服务的根地址。留空 = 用默认地址。' },
    { key: 'apiKey', label: 'API Key', type: 'secret', description: 'web2api 开了 API_KEY 校验时才需要。留空 = 不带鉴权头。' },
  ],
  actions: [
    {
      id: 'web2api:doubao-image-seedream45',
      title: '豆包 Seedream 4.5',
      description: '豆包网页 UI 自动化生图（Seedream 4.5）：比例可选；风格写在提示词里',
      group: 'web2api · 图片',
      nodeTypes: ['image'],
      needsPrompt: true,
      order: 10,
      platform: 'doubao', operation: 'chat-auto',
      promptMode: 'chat-auto', mediaMode: 'image', model: 'Seedream 4.5',
      fields: [ratio_doubao],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 1500, pollTimeoutMs: 600000,
    },
    {
      id: 'web2api:doubao-image-seedream50lite',
      title: '豆包 Seedream 5.0 Lite',
      description: '豆包网页 UI 自动化生图（Seedream 5.0 Lite）：比例可选；风格写在提示词里',
      group: 'web2api · 图片',
      nodeTypes: ['image'],
      needsPrompt: true,
      order: 11,
      platform: 'doubao', operation: 'chat-auto',
      promptMode: 'chat-auto', mediaMode: 'image', model: 'Seedream 5.0 Lite',
      fields: [ratio_doubao],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 1500, pollTimeoutMs: 600000,
    },
    {
      id: 'web2api:doubao-image-seedream40',
      title: '豆包 Seedream 4.0',
      description: '豆包网页 UI 自动化生图（Seedream 4.0）：比例可选；风格写在提示词里',
      group: 'web2api · 图片',
      nodeTypes: ['image'],
      needsPrompt: true,
      order: 12,
      platform: 'doubao', operation: 'chat-auto',
      promptMode: 'chat-auto', mediaMode: 'image', model: 'Seedream 4.0',
      fields: [ratio_doubao],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 1500, pollTimeoutMs: 600000,
    },
    {
      id: 'web2api:dola-image-seedream50pro',
      title: 'Dola Seedream 5.0 Pro',
      description: 'Dola 网页 UI 自动化生图（Seedream 5.0 Pro）；需海外网络',
      group: 'web2api · 图片',
      nodeTypes: ['image'],
      needsPrompt: true,
      order: 13,
      platform: 'dola', operation: 'chat-auto',
      promptMode: 'chat-auto', mediaMode: 'image', model: 'Seedream 5.0 Pro',
      fields: [ratio_dola],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 1500, pollTimeoutMs: 600000,
    },
    {
      id: 'web2api:dola-image-seedream45',
      title: 'Dola Seedream 4.5',
      description: 'Dola 网页 UI 自动化生图（Seedream 4.5）；需海外网络',
      group: 'web2api · 图片',
      nodeTypes: ['image'],
      needsPrompt: true,
      order: 14,
      platform: 'dola', operation: 'chat-auto',
      promptMode: 'chat-auto', mediaMode: 'image', model: 'Seedream 4.5',
      fields: [ratio_dola],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 1500, pollTimeoutMs: 600000,
    },
    {
      id: 'web2api:chatgpt-image',
      title: 'ChatGPT 官方',
      description: 'ChatGPT 官方渠道（image_gen，需登录态）：比例可选；风格写在提示词里',
      group: 'web2api · 图片',
      nodeTypes: ['image'],
      needsPrompt: true,
      order: 15,
      platform: 'chatgpt', operation: 'generate-image',
      promptMode: 'plain',
      fields: [ratio_chatgpt],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 1500, pollTimeoutMs: 600000,
    },
    {
      id: 'web2api:apimart-image',
      title: 'GPT Image 2（API）',
      description: 'APIMart 中转（GPT Image 2）：比例 / 分辨率 / 张数可选',
      group: 'web2api · 图片',
      nodeTypes: ['image'],
      needsPrompt: true,
      order: 16,
      platform: 'apimart', operation: 'generate-image',
      promptMode: 'plain',
      fields: [ratio_apimart, resolution_apimart, count_apimart],
      refFields: { image: 'referenceImages' },
      pollIntervalMs: 1500, pollTimeoutMs: 600000,
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
      // 查不到不是终态：报给用户，由任务的超时兜底
      return { status: 'running', message: err instanceof Error ? err.message : '任务查询失败', taskId }
    }
  },

  async cancel(taskId) {
    await cancelTask(taskId)
  },
}

export default provider


