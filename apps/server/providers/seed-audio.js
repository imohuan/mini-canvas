/**
 * 51KIK（Router Brain）· seed-audio-1.0 音频生成（provider，自包含单文件）。
 *
 * 只走「参考音频 + 自然语言描述」这一条路：
 *   - 参考音频按连接顺序编号，提示词里写 @音频1 / @音频2 引用（平台规定，顺序必须一致）；
 *   - 描述直接写在提示词里，例如「一个四十岁低沉沙哑的男人，语速很慢」。
 *   两者可以混用：@音频1 定音色，描述定情绪 / 语速 / 场景。
 *
 * 接口：POST https://51kik.com/audio/v1/generations（同步返回音频地址，约 10～20 秒）。
 * 实测：references 里放 data URL 可以直接用，不需要先上传。
 *
 * 环境变量：KIK_BASE / KIK_API_KEY（平台管理页里存的配置优先）。
 */

const MAX_PROMPT = 3000
const MAX_REFS = 3
const MAX_REF_BYTES = 10 * 1024 * 1024

function injected() {
  return typeof __mcProviderConfig === 'undefined' ? { accounts: [], values: {}, byId: {} } : __mcProviderConfig
}

function accountValues(values) {
  const inj = injected()
  const preferred = values && typeof values.__accountId === 'string' ? values.__accountId : ''
  if (preferred && inj.byId && inj.byId[preferred]) return inj.byId[preferred]
  const fallback = inj.defaultId && inj.byId && inj.byId[inj.defaultId]
  if (fallback) return fallback
  const accounts = inj.accounts || []
  if (accounts.length > 0) return accounts[0].values || {}
  return inj.values || {}
}

function baseOf(values) {
  const b = values && typeof values.baseUrl === 'string' && values.baseUrl.trim()
    ? values.baseUrl.trim()
    : process.env.KIK_BASE || 'https://51kik.com'
  return String(b).replace(/\/+$/, '')
}

function keyOf(values) {
  if (values && typeof values.apiKey === 'string' && values.apiKey.trim()) return values.apiKey.trim()
  return process.env.KIK_API_KEY || ''
}

async function callJson(url, init, timeoutMs, values) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    }
    const key = keyOf(values)
    if (key) headers.Authorization = 'Bearer ' + key
    const res = await fetch(url, { ...init, headers, signal: ac.signal })
    const text = await res.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      throw new Error('51KIK 返回的不是 JSON（HTTP ' + res.status + '）')
    }
    if (!res.ok) {
      const msg = body && body.error && body.error.message
      throw new Error(translateError(msg || 'HTTP ' + res.status, res.status))
    }
    return body || {}
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('51KIK 请求超时（' + Math.round(timeoutMs / 1000) + ' 秒）')
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (/fetch failed|ECONNREFUSED|Failed to fetch|NetworkError/i.test(msg)) {
      throw new Error('连不上 51KIK（' + baseOf(values) + '），请检查网络或平台里填的服务地址')
    }
    throw new Error(msg || '51KIK 调用失败')
  } finally {
    clearTimeout(timer)
  }
}

/** 把网关的英文报错翻成能照做的中文 */
function translateError(msg, status) {
  const m = String(msg)
  if (status === 401) return 'API Key 无效，请到「平台」页重新填 51KIK 的 Key'
  if (status === 403) return '这个 API Key 被限制了（可能是 IP 白名单）'
  if (status === 404) return '模型不存在或没有可用线路：' + m
  if (status === 429) return '请求太频繁了，等一会儿再试'
  // 余额不足是 400 里最常见的一种：原话是 Insufficient available credits for precharge
  if (/insufficient .*credit/i.test(m)) {
    const need = /required:?\s*([\d.]+)/i.exec(m)?.[1]
    const have = /available:?\s*(-?[\d.]+)/i.exec(m)?.[1]
    return (
      '51KIK 账户余额不够了' +
      (have !== undefined ? '（可用 ' + have + ' 积分）' : '') +
      (need ? '，这次大约需要 ' + need + ' 积分' : '') +
      '。充值后再试；有任务还没结算时也可以等一会儿。'
    )
  }
  if (/prompt/i.test(m) && /empty|required/i.test(m)) return '提示词不能为空'
  if (/reference|audio/i.test(m) && /too (long|large)|exceed/i.test(m)) {
    return '参考音频超限：最多 3 段，每段不超过 30 秒、10 MB（' + m + '）'
  }
  return m
}

function dataUrlInfo(url) {
  const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(String(url || ''))
  if (!m) return null
  const bytes = m[2] ? Math.floor((m[3].length * 3) / 4) : decodeURIComponent(m[3]).length
  return { mime: m[1] || '', bytes }
}

/**
 * 连进来的音频 → references 数组，并按数组顺序编号。
 *
 * 平台只认序号（@音频1 对应 references[0]），所以编号和数组必须是同一次遍历的产物；
 * 分成两遍很容易错位（用户实测过：错一位就变成别人在说话）。
 */
function collectAudios(input) {
  const audios = []
  const indexById = new Map()
  const skipped = []
  for (const r of input.resources || []) {
    if (!r) continue
    if (r.kind !== 'audio') {
      if (r.kind) skipped.push(r.kind)
      continue
    }
    const url = typeof r.url === 'string' ? r.url.trim() : ''
    if (!url) {
      skipped.push('空音频')
      continue
    }
    const n = audios.length + 1
    if (n > MAX_REFS) break
    const info = dataUrlInfo(url)
    if (info && info.bytes > MAX_REF_BYTES) {
      throw new Error('参考音频「' + (r.name || '未命名') + '」超过 10 MB，请换短一点的片段')
    }
    audios.push({ type: 'audio', url })
    if (typeof r.id === 'string' && r.id) indexById.set(r.id, n)
  }
  if (skipped.length > 0) {
    console.warn('[seed-audio] 这个模型只收参考音频，已忽略：' + [...new Set(skipped)].join('、'))
  }
  return { audios, indexById }
}

/**
 * 提示词分段 → 平台文本。
 *
 * 输入框里点选音频节点会留下 { type:'tag', value:'资源id' }，这里换成 @音频N；
 * 普通文字原样保留。不在音频列表里的 tag 换成空串（不能留个指向不存在音频的 @音频9）。
 */
function buildPrompt(input, indexById) {
  let out = ''
  for (const seg of input.prompts || []) {
    if (!seg || typeof seg.value !== 'string') continue
    if (seg.type === 'tag') {
      const n = indexById.get(seg.value)
      if (n) out += '@音频' + n
      else console.warn('[seed-audio] 提示词里的素材 ' + seg.value + ' 不是参考音频，已省略')
    } else {
      out += seg.value
    }
  }
  return out
}

function collectUrls(body) {
  const out = []
  const push = (v) => {
    if (typeof v === 'string') {
      if (/^(https?:|data:)/i.test(v)) out.push(v)
    } else if (Array.isArray(v)) {
      for (const item of v) push(item)
    } else if (v && typeof v === 'object') {
      push(v.url)
      push(v.audioUrl)
      push(v.audio)
    }
  }
  push(body && body.data)
  return [...new Set(out)]
}

function collectDuration(body) {
  const u = body && body.usage
  if (u && typeof u.duration === 'number') return u.duration
  const d = body && body.data && body.data[0]
  if (d && typeof d.duration === 'number') return d.duration
  return null
}

const action = {
  id: 'seed-audio:generate',
  title: 'seed-audio-1.0 · 音频生成',
  description: '参考音色 + 自然语言描述。写 @音频1 用这段声音，描述里写情绪、语速、场景；纯描述也能生成音效',
  group: '51kik · 音频',
  nodeTypes: ['audio'],
  needsPrompt: true,
  order: 30,
  model: 'seed-audio-1.0',
  pollIntervalMs: 3000,
  pollTimeoutMs: 600000,
  fields: [
    {
      key: 'format', label: '格式', type: 'grid', default: 'mp3',
      options: [
        { label: 'MP3', value: 'mp3' },
        { label: 'WAV', value: 'wav' },
        { label: 'PCM', value: 'pcm' },
        { label: 'OGG', value: 'ogg_opus' },
      ],
      description: 'MP3 体积小、到处都能放；WAV 音质原始但文件大；OGG 只支持 48k 采样率。',
    },
    {
      key: 'sampleRate', label: '采样率', type: 'select', default: 24000,
      options: [
        { label: '16 kHz', value: 16000 },
        { label: '24 kHz', value: 24000 },
        { label: '32 kHz', value: 32000 },
        { label: '44.1 kHz', value: 44100 },
        { label: '48 kHz', value: 48000 },
      ],
      description: '越高越清晰、文件越大。人声用 24 kHz 就够，音乐 / 音效用 44.1 kHz。',
    },
    {
      key: 'speechRate', label: '语速', type: 'number', min: -50, max: 100, step: 5, default: 0,
      description: '0 是原速；-50 是 0.5 倍慢，100 是 2 倍快。',
    },
    {
      key: 'pitchRate', label: '音调', type: 'number', min: -12, max: 12, step: 1, default: 0,
      description: '往下调声音更低沉，往上调更尖。',
    },
    {
      key: 'loudnessRate', label: '音量', type: 'number', min: -50, max: 100, step: 5, default: 0,
      description: '0 是原始音量；-50 减半，100 加倍。',
    },
  ],
  templates: [
    {
      id: 'seed-audio:tpl-ref',
      name: '参考音色读台词',
      description: '选一段音频，用它本来的声音说话',
      prompt: '@音频1 用这个声音说：今天的雨下得好大啊，你带伞了吗？',
    },
    {
      id: 'seed-audio:tpl-dialog',
      name: '两人对话',
      description: '参考音色 + 描述出来的男声，一来一回',
      prompt:
        '@音频1 用这个甜美轻快的少女声说：你终于回来啦，我等了你好久。\n' +
        '然后一个四十多岁的低沉沙哑中年男人，语速很慢、带着一点疲惫，接着说：路上堵车，我也没办法啊。',
    },
    {
      id: 'seed-audio:tpl-scene',
      name: '纯描述音效',
      description: '不连参考音频也能用：雨夜、街道、远处车流',
      prompt: '雨夜的街道，雨点密密地打在铁皮雨棚上，远处有汽车驶过溅起水花，偶尔一声闷雷。',
    },
    {
      id: 'seed-audio:tpl-narrator',
      name: '旁白男声',
      description: '纯描述的音色，适合纪录片旁白',
      prompt: '一个三十多岁的男中音做纪录片旁白，语速平稳、声音厚实、略带克制，说：这里是长江的源头，海拔六千米，风从冰川上吹过。',
    },
  ],
}

export default {
  id: 'seed-audio',
  title: '51KIK · 音频生成',
  description: '豆包 seed-audio-1.0：参考音色 + 自然语言描述，生成对白、旁白和音效',
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="seedAud" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#seedAud)"/><g fill="#fff"><rect x="8" y="14" width="2.6" height="4" rx="1.3"/><rect x="12.2" y="10" width="2.6" height="12" rx="1.3"/><rect x="16.4" y="7" width="2.6" height="18" rx="1.3"/><rect x="20.6" y="11" width="2.6" height="10" rx="1.3"/><rect x="24.8" y="14.5" width="2.6" height="3" rx="1.3"/></g></svg>',
  config: [
    {
      key: 'baseUrl', label: '服务地址', type: 'string', default: 'https://51kik.com',
      placeholder: 'https://51kik.com', description: '51KIK 网关的根地址，留空用默认。',
    },
    {
      key: 'apiKey', label: 'API Key', type: 'secret',
      description: '在 51KIK 控制台创建的 sk- 开头密钥，只存在服务端。',
    },
  ],
  actions: [action],

  async submit(actionDef, input) {
    try {
      const values = accountValues(input.values)
      const v = input.values || {}
      const { audios, indexById } = collectAudios(input)

      let prompt = buildPrompt(input, indexById)
      // 连了参考音频但提示词没写 @音频N：补一句引用，否则模型不知道要学哪段声音
      if (audios.length > 0 && !/@音频\d/.test(prompt)) {
        prompt = '参考 @音频1 的音色、语气和说话方式。\n' + prompt
      }
      prompt = prompt.trim()
      if (!prompt) {
        return { error: '请写一句台词或描述，例如：@音频1 用这个声音说：你好呀。' }
      }
      if ([...prompt].length > MAX_PROMPT) {
        return { error: '提示词太长了（' + [...prompt].length + ' 字），最多 ' + MAX_PROMPT + ' 字' }
      }

      const audioConfig = {
        format: typeof v.format === 'string' && v.format ? v.format : 'mp3',
        sample_rate: num(v.sampleRate, 24000),
        speech_rate: num(v.speechRate, 0),
        pitch_rate: num(v.pitchRate, 0),
        loudness_rate: num(v.loudnessRate, 0),
      }

      const body = {
        model: actionDef.model || 'seed-audio-1.0',
        prompt,
        stream: false,
        task: false,
        upstream_options: { audio_config: audioConfig },
      }
      if (audios.length > 0) body.references = audios

      const res = await callJson(baseOf(values) + '/audio/v1/generations', {
        method: 'POST',
        body: JSON.stringify(body),
      }, 300000, values)

      if (res && typeof res.task_id === 'string' && res.task_id) {
        return { taskId: res.task_id }
      }
      const urls = collectUrls(res)
      if (urls.length === 0) {
        const e = res && res.error && res.error.message
        return { error: e ? translateError(e, 502) : '生成完成但没有拿到音频地址' }
      }
      console.log('[seed-audio] 生成完成 ' + (collectDuration(res) ?? '?') + ' 秒，参考音频 ' + audios.length + ' 段')
      return { done: true, urls }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async poll(taskId, actionDef) {
    try {
      const values = accountValues()
      const body = await callJson(baseOf(values) + '/audio/v1/tasks/' + encodeURIComponent(taskId), {}, 60000, values)
      const status = String((body && body.task_status) || '')
      if (status === 'success') {
        const urls = collectUrls(body)
        if (urls.length === 0) return { status: 'error', error: '任务成功但没有音频地址' }
        return { status: 'done', urls }
      }
      if (status === 'failed') {
        const msg = body && body.error && body.error.message
        return { status: 'error', error: msg || '生成失败' }
      }
      if (status === 'cancelled') return { status: 'error', error: '任务已取消' }
      return { status: 'running', message: '生成中…', taskId }
    } catch (err) {
      return { status: 'running', message: err instanceof Error ? err.message : '查询失败', taskId }
    }
  },
}

function num(v, fallback) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}
