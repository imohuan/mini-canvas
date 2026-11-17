/**
 * 火山引擎（豆包语音）· seed-audio-1.0 音频生成 —— 直连官方接口。
 *
 * 接口：POST https://openspeech.bytedance.com/api/v3/tts/create
 * 鉴权（两种控制台都支持）：
 *   - 新版控制台：X-Api-Key 单头；
 *   - 旧版控制台：X-Api-App-Id + X-Api-Access-Key 双头。
 * 可选 X-Api-Request-Id 做追踪（响应头里会带 X-Tt-Logid，用于找客服定位）。
 * 同步返回：{ audio(base64), url(2 小时有效), duration, original_duration, subtitle? }
 *
 * 两种生成方式，可以混用：
 *   - 参考音频：连进来的音频按顺序放进 references，提示词里写 @音频1 / @音频2 引用；
 *   - 自然语言：直接在提示词里描述音色、情绪、语速、场景（也能纯描述生成音效）。
 * references 的顺序必须与 @音频N 的编号一致，所以编号和数组出自同一次遍历。
 */

const DEFAULT_BASE = 'https://openspeech.bytedance.com'
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
    : process.env.VOLC_AUDIO_BASE || DEFAULT_BASE
  return String(b).replace(/\/+$/, '')
}

/** 新版控制台的 API Key（X-Api-Key） */
function keyOf(values) {
  if (values && typeof values.apiKey === 'string' && values.apiKey.trim()) return values.apiKey.trim()
  return process.env.VOLC_API_KEY || ''
}

/** 旧版控制台的 App ID / Access Key（双头鉴权，两个都要） */
function legacyOf(values) {
  const appId = (values && typeof values.appId === 'string' && values.appId.trim()) || process.env.VOLC_APP_ID || ''
  const accessKey =
    (values && typeof values.accessKey === 'string' && values.accessKey.trim()) || process.env.VOLC_ACCESS_KEY || ''
  return appId && accessKey ? { appId, accessKey } : null
}

/** 有没有可用的鉴权（任一一种即可） */
function hasAuth(values) {
  return Boolean(keyOf(values) || legacyOf(values))
}

/** 火山要求带一个请求追踪号；没有内置 uuid 模块就直接拼一个够用的 */
function traceId() {
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  let s = ''
  for (let i = 0; i < 32; i++) s += hex()
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20)
}

async function callJson(url, init, timeoutMs, values) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const key = keyOf(values)
    const legacy = legacyOf(values)
    const headers = {
      'Content-Type': 'application/json',
      ...(key ? { 'X-Api-Key': key } : {}),
      // 旧版控制台：App ID + Access Key 双头（与单头同时给也没关系，服务端认哪个都行）
      ...(legacy ? { 'X-Api-App-Id': legacy.appId, 'X-Api-Access-Key': legacy.accessKey } : {}),
      'X-Api-Request-Id': traceId(),
      ...(init.headers || {}),
    }
    const res = await fetch(url, { ...init, headers, signal: ac.signal })
    const text = await res.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      throw new Error('火山引擎返回的不是 JSON（HTTP ' + res.status + '）')
    }
    // 火山在业务失败时也可能回 200，错误码在 body.code 里
    const code = body && typeof body.code === 'number' ? body.code : 0
    const logId = res.headers.get('x-tt-logid') || ''
    if (!res.ok || code !== 0) {
      const msg = (body && body.message) || 'HTTP ' + res.status
      throw new Error(translateError(msg, code || res.status) + (logId ? '（logid ' + logId + '）' : ''))
    }
    return body || {}
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('火山引擎请求超时（' + Math.round(timeoutMs / 1000) + ' 秒），长文本可能要更久')
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (/fetch failed|ECONNREFUSED|Failed to fetch|NetworkError|ENOTFOUND|ETIMEDOUT/i.test(msg)) {
      throw new Error('连不上火山引擎（' + baseOf(values) + '），请检查网络或代理设置')
    }
    throw new Error(msg || '火山引擎调用失败')
  } finally {
    clearTimeout(timer)
  }
}

/** 把火山的错误码 / 英文原话翻成能照做的中文 */
function translateError(msg, code) {
  const m = String(msg)
  if (code === 401 || /unauthor|invalid.*key|api key/i.test(m)) {
    return 'API Key 无效或没有开通这个服务：请到火山控制台确认 Key 与「音频生成」服务已开通'
  }
  if (code === 403 || /forbidden|permission/i.test(m)) return '这个 API Key 没有权限调用音频生成（可能是服务未开通或 IP 白名单）'
  if (code === 429 || /rate|qps|too many/i.test(m)) return '请求太频繁了，等一会儿再试'
  if (/quota|balance|insufficient|arrear/i.test(m)) return '火山账户余额或配额不足：' + m
  if (/text_prompt/i.test(m)) return '提示词不合规或被拒绝：' + m
  if (/reference|audio_data|audio_url/i.test(m)) {
    return '参考音频有问题：最多 3 段、每段 ≤ 30 秒 / 10 MB，格式限 wav / mp3 / pcm / ogg_opus（' + m + '）'
  }
  if (/speaker/i.test(m)) return '音色 ID 不存在或不支持：' + m
  return m
}

function dataUrlInfo(url) {
  const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(String(url || ''))
  if (!m) return null
  const bytes = m[2] ? Math.floor((m[3].length * 3) / 4) : decodeURIComponent(m[3]).length
  return { mime: m[1] || '', bytes }
}

/** data URL → 纯 base64（火山 references[].audio_data 只收裸 base64） */
function base64Of(url) {
  const s = String(url || '')
  const m = /^data:[^;,]*;base64,([\s\S]*)$/i.exec(s)
  if (m) return m[1]
  const plain = /^data:[^;,]*,[\s\S]*$/i.exec(s)
  if (plain) return ''
  return ''
}

/**
 * 连进来的音频 → references，并按数组顺序编号（@音频1 = references[0]）。
 * 编号与数组必须出自同一次遍历，分成两遍很容易错位（错一位就换成别人在说话）。
 */
function collectAudios(input) {
  const refs = []
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
    const n = refs.length + 1
    if (n > MAX_REFS) break
    const info = dataUrlInfo(url)
    if (info && info.bytes > MAX_REF_BYTES) {
      throw new Error('参考音频「' + (r.name || '未命名') + '」超过 10 MB，请换短一点的片段')
    }
    const b64 = base64Of(url)
    // 宿主一般已经把资源解析成 data URL；万一给了可访问的 http 地址就走 audio_url
    refs.push(b64 ? { audio_data: b64 } : { audio_url: url })
    if (typeof r.id === 'string' && r.id) indexById.set(r.id, n)
  }
  if (skipped.length > 0) {
    console.warn('[seed-audio-volc] 这个模型只收参考音频，已忽略：' + [...new Set(skipped)].join('、'))
  }
  return { refs, indexById }
}

/** 提示词分段 → text_prompt（tag 换成 @音频N，普通文字原样） */
function buildPrompt(input, indexById) {
  let out = ''
  for (const seg of input.prompts || []) {
    if (!seg || typeof seg.value !== 'string') continue
    if (seg.type === 'tag') {
      const n = indexById.get(seg.value)
      if (n) out += '@音频' + n
      else console.warn('[seed-audio-volc] 提示词里的素材 ' + seg.value + ' 不是参考音频，已省略')
    } else {
      out += seg.value
    }
  }
  return out
}

/** 采样率按格式兜底：ogg_opus 只支持 48000，wav/pcm 默认 40000，mp3 默认 44100 */
function sampleRateFor(format, value) {
  const n = typeof value === 'number' ? value : Number(value)
  if (format === 'ogg_opus') return 48000
  if (Number.isFinite(n) && n > 0) return n
  if (format === 'mp3') return 44100
  return 40000
}

function mimeFor(format) {
  switch (format) {
    case 'wav':
      return 'audio/wav'
    case 'mp3':
      return 'audio/mpeg'
    case 'ogg_opus':
      return 'audio/ogg'
    case 'pcm':
      return 'audio/L16'
    default:
      return 'audio/mpeg'
  }
}

const action = {
  id: 'seed-audio-volc:generate',
  title: 'Seed Audio 1.0（官方）',
  description: '火山引擎直连。写 @音频1 用这段声音，描述里写情绪、语速、场景；纯描述也能生成音效',
  group: '火山引擎 · 音频',
  nodeTypes: ['audio'],
  needsPrompt: true,
  order: 20,
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
      description: 'MP3 体积小；WAV 音质原始但文件大；OGG 只支持 48k 采样率。',
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
      description: '越高越清晰、文件越大。人声 24 kHz 够用；选 OGG 会强制 48 kHz。',
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
      id: 'seed-audio-volc:tpl-ref',
      name: '参考音色读台词',
      description: '选一段音频，用它本来的声音说话',
      prompt: '@音频1 用这个声音说：今天的雨下得好大啊，你带伞了吗？',
    },
    {
      id: 'seed-audio-volc:tpl-dialog',
      name: '两人对话',
      description: '参考音色 + 描述出来的男声，一来一回',
      prompt:
        '@音频1 用这个甜美轻快的少女声说：你终于回来啦，我等了你好久。\n' +
        '然后一个四十多岁的低沉沙哑中年男人，语速很慢、带着一点疲惫，接着说：路上堵车，我也没办法啊。',
    },
    {
      id: 'seed-audio-volc:tpl-scene',
      name: '纯描述音效',
      description: '不连参考音频也能用：雨夜、街道、远处车流',
      prompt: '雨夜的街道，雨点密密地打在铁皮雨棚上，远处有汽车驶过溅起水花，偶尔一声闷雷。',
    },
    {
      id: 'seed-audio-volc:tpl-narrator',
      name: '旁白男声',
      description: '纯描述的音色，适合纪录片旁白',
      prompt: '一个三十多岁的男中音做纪录片旁白，语速平稳、声音厚实、略带克制，说：这里是长江的源头，海拔六千米，风从冰川上吹过。',
    },
  ],
}

export default {
  id: 'seed-audio-volc',
  title: '火山引擎 · 音频生成',
  description: '豆包 seed-audio-1.0 官方接口：参考音色 + 自然语言描述，生成对白、旁白和音效',
  // 与豆包语音同一颗品牌图标（图标表里查 doubao）
  icon: 'doubao',
  config: [
    {
      key: 'baseUrl', label: '服务地址', type: 'string', default: DEFAULT_BASE,
      placeholder: DEFAULT_BASE, description: '默认就是官方地址，一般不用改。',
    },
    {
      key: 'apiKey', label: 'API Key', type: 'secret',
      description: '新版控制台 → API Key 管理里创建的那串（X-Api-Key）。用旧版控制台就填下面两项。',
    },
    {
      key: 'appId', label: 'App ID（旧版）', type: 'secret',
      description: '旧版控制台 → 应用管理的 App ID。与下面的 Access Key 一起用，和 API Key 二选一。',
    },
    {
      key: 'accessKey', label: 'Access Key（旧版）', type: 'secret',
      description: '旧版控制台应用里的 Access Key / Access Token。',
    },
  ],
  actions: [action],

  async submit(actionDef, input) {
    try {
      const values = accountValues(input.values)
      const v = input.values || {}
      if (!hasAuth(values)) {
        return {
          error:
            '还没填火山的鉴权：新版控制台填 API Key；旧版控制台填 App ID + Access Key（到「设置 → 平台」里填）',
        }
      }

      const { refs, indexById } = collectAudios(input)
      let prompt = buildPrompt(input, indexById)
      // 连了参考音频却没写 @音频N：补一句，否则模型不知道要学哪段声音
      if (refs.length > 0 && !/@音频\d/.test(prompt)) {
        prompt = '参考 @音频1 的音色、语气和说话方式。\n' + prompt
      }
      prompt = prompt.trim()
      if (!prompt) {
        return { error: '请写一句台词或描述，例如：@音频1 用这个声音说：你好呀。' }
      }
      if ([...prompt].length > MAX_PROMPT) {
        return { error: '提示词太长了（' + [...prompt].length + ' 字），最多 ' + MAX_PROMPT + ' 字' }
      }

      const format = typeof v.format === 'string' && v.format ? v.format : 'mp3'
      const body = {
        model: actionDef.model || 'seed-audio-1.0',
        text_prompt: prompt,
        audio_config: {
          format,
          sample_rate: sampleRateFor(format, v.sampleRate),
          speech_rate: num(v.speechRate, 0),
          pitch_rate: num(v.pitchRate, 0),
          loudness_rate: num(v.loudnessRate, 0),
        },
        watermark: {},
      }
      if (refs.length > 0) body.references = refs

      const res = await callJson(baseOf(values) + '/api/v3/tts/create', {
        method: 'POST',
        body: JSON.stringify(body),
      }, 300000, values)

      const urls = []
      if (typeof res.url === 'string' && res.url) urls.push(res.url)
      // 没有外链但给了 base64：转成 data URL，后台会收进画布资源目录
      if (urls.length === 0 && typeof res.audio === 'string' && res.audio) {
        urls.push('data:' + mimeFor(format) + ';base64,' + res.audio)
      }
      if (urls.length === 0) return { error: '生成完成但没有拿到音频地址' }

      const dur = typeof res.original_duration === 'number' ? res.original_duration : res.duration
      console.log('[seed-audio-volc] 生成完成 ' + (dur ?? '?') + ' 秒，参考音频 ' + refs.length + ' 段')
      return { done: true, urls }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },
}

function num(v, fallback) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}
