/**
 * web2api · 音频生成（provider，自包含单文件）
 *
 * 两条动作都是**同步**完成的：web2api 的 tts / generate-audio 直接返回音频资源，
 * 没有 taskId，所以 submit 拿到产物后直接回 { done: true, urls }。
 * 万一服务端以后改回异步（返回 taskId），这里也能退化到轮询。
 *
 * 环境变量：WEB2API_BASE / WEB2API_API_KEY。
 */

const BASE = (process.env.WEB2API_BASE || 'http://localhost:8033').replace(/\/+$/, '')

async function api(path, init = {}, timeoutMs = 120000) {
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
    if (!res.ok) throw new Error(body && body.message ? body.message : 'web2api HTTP ' + res.status)
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

/**
 * 上游文本素材 → 带名字的标签块。
 *
 * 用户口径（2026-11-08）：文本不要悄悄拼成一大段，要能「按名字引用」——
 *   连进来的文本给一个名字（节点标题优先，没有就 文本1 / 文本2…），
 *   正文包在标籤里交给上游；用户在自己的提示词里写 @标题内容 / @文本1 就能指到它。
 *
 * 为什么用标签而不是纯文本：纯文本拼在一起后，模型分不清哪段是「资料」、
 * 哪段是「我的指令」，也对应不上引用名。标签把边界和名字都写清楚。
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
 * 一张参考音频 → web2api 能读的地址。
 *
 * 为什么不能直接把 data URL 丢给 referenceAudios：火山引擎那条走的是
 * resolveRefPath（只认本机文件 / 相对路径），不像图片那样会落盘 data URL。
 * 所以这里先经 web2api 的上传接口换成它本机的 /<hash>.<ext>，再下单。
 *
 * 三种输入：
 *   - 已经是 /<hash>.<ext> 或 /api/resources/uploads/...  → 原样（就在它本机）
 *   - data:...                                            → 直接上传字节
 *   - http(s)://...                                       → 先取字节再上传
 */
async function toLocalRef(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  if (s.startsWith('/api/resources/uploads/')) return s
  if (/^\/[^/]/.test(s) && !s.startsWith('/api/')) return s

  let buf
  let mime = ''
  let filename = ''
  if (/^data:/i.test(s)) {
    const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(s)
    if (!m) throw new Error('参考音频的 data URL 格式不对')
    mime = m[1] || ''
    buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8')
  } else {
    const res = await fetch(s)
    if (!res.ok) throw new Error('下载参考音频失败 HTTP ' + res.status)
    buf = Buffer.from(await res.arrayBuffer())
    mime = res.headers.get('content-type') || ''
    filename = s.split('?')[0].split('/').pop() || ''
  }
  if (buf.length === 0) throw new Error('参考音频是空文件')

  const form = new FormData()
  form.append('file', new Blob([buf], { type: mime || 'application/octet-stream' }), filename || 'ref.bin')
  const headers = {}
  const key = process.env.WEB2API_API_KEY
  if (key) headers.Authorization = 'Bearer ' + key
  const res = await fetch(BASE + '/api/resources/upload', { method: 'POST', headers, body: form })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error('上传参考音频失败：web2api 返回的不是 JSON')
  }
  if (body && typeof body.code === 'number' && body.code !== 0) {
    throw new Error(body.message || '上传参考音频失败（web2api 错误 ' + body.code + '）')
  }
  const data = body && body.data
  const local = data && (data.path || data.relativeUrl)
  if (!local || typeof local !== 'string') throw new Error('上传参考音频失败：web2api 没返回可用地址')
  return local
}

/**
 * 参考素材 → 参数（按动作自己声明的 refFields 分发）。
 *
 * refFields 就是这份 provider 的「这台平台收什么」：
 *   { image: 'referenceImages', audio: 'referenceAudios' }
 * 没声明的类型 = 这台平台不收，跳过并记一条日志（不静默吞掉、也不炸掉整单）。
 * 以后接一个「图 / 文 / 视频 / 音频全收」的模型：给那条动作补一行 refFields 就行，
 * 下面的分发逻辑不用动。
 */
async function attachRefs(action, input, params) {
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
    // 上限照平台声明：火山参考音频最多 3 段；图片类各平台最多 16 张
    const limit = field === 'referenceAudios' ? 3 : 16
    const picked = urls.slice(0, limit)
    if (urls.length > limit) {
      console.warn('[web2api-audio] ' + action.id + ' 的 ' + field + ' 最多 ' + limit + ' 个，已截断')
    }
    params[field] = field === 'referenceAudios' ? await Promise.all(picked.map(toLocalRef)) : picked
  }

  if (skipped.length > 0) {
    console.warn(
      '[web2api-audio] ' + action.id + ' 不收这些素材，已忽略：' + [...new Set(skipped)].join('、') +
        '（当前平台只收：' + (Object.keys(map).join('、') || '无') + '）',
    )
  }
  return params
}

/** 音频类工具收 text（不是 prompt）：正文 = 用户输入 + 带名字的文本标签块 */
async function buildParams(action, input) {
  const params = cleanValues(input.values || {})
  if (action.model !== undefined && action.model !== '') params.model = action.model
  params.text = [input.prompt || '', ...textBlocks(input)].filter((s) => String(s).trim() !== '').join('\n')
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
      push(v.audioUrl)
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
    message: t.message || '合成中…',
    ...(typeof t.progress === 'number' ? { progress: t.progress } : {}),
    taskId,
    ...(waiting ? { waiting: true } : {}),
  }
}

const format_volc = {
  key: 'format', kind: 'format', label: '格式', type: 'select', default: 'wav',
  options: [
    { label: 'WAV', value: 'wav' },
    { label: 'MP3', value: 'mp3' },
    { label: 'OGG Opus', value: 'ogg_opus' },
  ],
}

/** 豆包音色：与 web2api 的 voices 表必须一致，否则「照名字选、出来另一个人」 */
const speaker_doubao = {
  key: 'speaker', kind: 'speaker', label: '音色', type: 'select',
  default: 'zh_female_xiaohe_conversation_wvae_bigtts',
  options: [
    { label: '温柔桃子（升级版）', value: 'zh_female_wenroutaozi_v2_mars_bigtts' },
    { label: '磁性俊宇（升级版）', value: 'zh_male_nuanxinshizhe_mars_bigtts' },
    { label: '阳光甜妹（升级版）', value: 'zh_female_xiaohe_conversation_wvae_bigtts' },
    { label: '知性小棠', value: 'zh_female_wenroutaozi_mars_bigtts' },
    { label: '邻家女孩', value: 'zh_female_f261_conversation_wvae_bigtts' },
    { label: '魅力苏菲', value: 'zh_female_sophie_conversation_wvae_bigtts' },
    { label: '撒娇学妹', value: 'zh_female_yuanqinvyou_wvae_bigtts' },
    { label: '邻家男孩', value: 'zh_male_linjiananhai_moon_bigtts' },
    { label: '悠悠君子', value: 'zh_male_M100_conversation_wvae_bigtts' },
    { label: '温暖阿虎', value: 'zh_male_ahu_conversation_wvae_bigtts' },
    { label: '少年梓辛', value: 'zh_male_m286_conversation_wvae_bigtts' },
    { label: '阳光阿辰', value: 'zh_male_qingyiyuxuan_mars_bigtts' },
    { label: '腹黑霸总', value: 'ICL_c021bc19bf92' },
    { label: '冷酷霸总', value: 'ICL_e0b9b93ee322' },
    { label: '傲娇霸总', value: 'zh_male_aojiaobazong_wvae_bigtts' },
    { label: '霸道总裁', value: 'ICL_d4d40acd33dd' },
    { label: '温柔子言', value: 'zh_male_cheng_mars_bigtts' },
    { label: '率性阿哲', value: 'zh_male_litiebanzi_mars_bigtts' },
    { label: '温柔陆辰', value: 'ICL_df4fc4d1ce4b' },
    { label: '深夜播客', value: 'zh_male_shenyeboke_wvae_bigtts' },
    { label: '甜美小雪', value: 'ICL_6acf86286e24' },
    { label: '清冷阿梦', value: 'ICL_6d6550b0b6f3' },
    { label: '东方浩然', value: 'zh_male_dongfanghaoran_moon_bigtts' },
    { label: '病娇少爷', value: 'ICL_72afa6c5dc07' },
    { label: '清爽男大', value: 'zh_male_junlangxize_mars_bigtts' },
    { label: '清朗宇澄', value: 'ICL_9b3bc6941076' },
    { label: '奶音俊少', value: 'ICL_932b3f52bf3d' },
    { label: '沉稳皓轩', value: 'ICL_5a413fbc14fc' },
    { label: '温柔俊彦', value: 'ICL_0ce6ef379e73' },
    { label: '青涩沐阳', value: 'ICL_afedffe4586c' },
    { label: '睿语舟舟', value: 'ICL_4ce34d3f60f4' },
    { label: '湾区大叔', value: 'zh_male_gangpu_conversation_wvae_bigtts' },
    { label: '随性先生', value: 'ICL_b718c1050dd1' },
    { label: '渊博小叔', value: 'zh_male_m219_conversation_wvae_bigtts' },
    { label: '俊朗男友', value: 'ICL_1eed9233299f' },
    { label: '磁性阿铭', value: 'BV154_streaming' },
    { label: '奶酷小宇', value: 'ICL_b22cd40ccd3e' },
    { label: '暖阳阿晨', value: 'ICL_7a33516fe388' },
    { label: '低音小北', value: 'ICL_989e59f0082a' },
    { label: '男闺蜜俊熙', value: 'ICL_7ba54f5a883e' },
    { label: '深情霸总', value: 'ICL_6e69deb80ce5' },
    { label: '文静毛毛', value: 'zh_female_maomao_conversation_wvae_bigtts' },
    { label: '北京大妞', value: 'zh_female_beijingdaniu_mars_bigtts' },
    { label: '清甜瑶瑶', value: 'zh_female_F466_mars_bigtts' },
    { label: '活泼可昕', value: 'zh_female_F765_mars_bigtts' },
    { label: '水刃公子', value: 'ICL_da6a164900d4' },
    { label: '灵兔少女', value: 'ICL_eaf8dd4a3a0d' },
    { label: '蓝曜修士', value: 'ICL_4fba48c6d3cc' },
    { label: '咆哮小哥', value: 'ICL_21c82f5cbb7b' },
    { label: '解家花少', value: 'ICL_1289539b58cb' },
    { label: '闷油瓶小哥', value: 'ICL_ffed9fc2fee7' },
    { label: '墨镜黑哥', value: 'ICL_ba24ccf23bc7' },
    { label: '安全哥', value: 'ICL_4b1feb0ced67' },
    { label: '藕霸小童', value: 'zh_male_nezha' },
    { label: '雷霆女神', value: 'zh_female_leidian' },
    { label: '山哥播音', value: 'BV433_streaming' },
    { label: '顾姐', value: 'zh_female_guli_stream_gpu' },
    { label: '小品艺术家', value: 'BV223_streaming' },
    { label: '王小也', value: 'zh_male_wangye' },
    { label: '奶芙波波', value: 'BV428_streaming' },
    { label: '星鼠仔', value: 'zh_male_milaoshu' },
    { label: '麦小鸭', value: 'zh_male_tanglaoya' },
    { label: '黯刃秦主', value: 'ICL_cd62e63dcdab' },
    { label: '绯樱神巫', value: 'ICL_19abc3128fbb' },
    { label: '光头憨憨', value: 'ICL_8d858c1560ed' },
    { label: '智慧小羊', value: 'ICL_f35ff006eb05' },
    { label: '火舞魅娘', value: 'ICL_be2856499af4' },
    { label: '沪上傲女', value: 'ICL_7b76e4aafb6c' },
    { label: '冷酷哥哥', value: 'ICL_3bb18f934f4e' },
    { label: '高冷御姐', value: 'zh_female_leidian_conversation_wvae_bigtts' },
    { label: '快乐小东', value: 'zh_male_xudong_conversation_wvae_bigtts' },
    { label: '柔美女友', value: 'zh_female_sajiaonvyou_wvae_bigtts' },
    { label: '爽快思思', value: 'zh_female_sinong_conversation_wvae_bigtts' },
    { label: '妩媚御姐', value: 'ICL_da05661f8c64' },
    { label: '活泼女孩', value: 'ICL_11c6b3f0bd6d' },
    { label: '甜心小美', value: 'ICL_bad46416a2b7' },
    { label: '魅力女友', value: 'zh_female_meilinvyou_wvae_bigtts' },
    { label: '可爱女生', value: 'ICL_49240bb7f5ac' },
    { label: '川渝小伙', value: 'zh_male_sichuanskn' },
    { label: '南音阳仔', value: 'zh_male_nanchangygn' },
    { label: '湘都朗少', value: 'zh_male_changshakln' },
    { label: '桂乡甜妞', value: 'zh_female_guangxiwrn' },
    { label: '京腔侃爷', value: 'zh_male_M392_conversation_wvae_bigtts' },
    { label: '清新女声', value: 'zh_female_qingxin_clone2' },
    { label: '小甜妹', value: 'zh_female_taozi_conversation_v4_wvae_bigtts' },
    { label: '温柔姐姐', value: 'zh_female_xiaonan_lv_clone2' },
    { label: '桃花庵主', value: 'zh_male_renmao_mars_bigtts' },
    { label: '精灵向导', value: 'ICL_1beb294a9e3e' },
    { label: '清朗公子', value: 'ICL_d8c94c04d627' },
    { label: '内敛才俊', value: 'ICL_e991be511569' },
    { label: '清澈梓梓', value: 'zh_female_qingchezizi_moon_bigtts' },
    { label: '不羁雅痞', value: 'ICL_205cc3ca1152' },
    { label: '媚娇俏娘', value: 'ICL_4634ac0d9e82' },
    { label: '动漫小羊', value: 'zh_female_dongmanxiaoyang_moon_bigtts' },
    { label: '成熟姐姐', value: 'ICL_fd7fd93fb7b8' },
    { label: '恶魔女仆', value: 'ICL_bf4e1d132b48' },
    { label: '小丑', value: 'ICL_c1cee47f0150' },
    { label: '蛇发女妖', value: 'ICL_24dff5266b30' },
  ],
}

function speed(key, label, min, max, def) {
  return { key, kind: 'speed', label, type: 'number', min, max, step: 5, default: def }
}

export default {
  id: 'web2api-audio',
  actions: [
    {
      id: 'web2api:doubao-tts',
      title: '豆包·语音合成',
      description: '文本转语音（不开浏览器，不耗视频积分）：选音色即可',
      group: 'web2api · 音频',
      nodeTypes: ['audio'],
      needsPrompt: true,
      order: 10,
      platform: 'doubao', operation: 'tts',
      promptMode: 'plain',
      fields: [speaker_doubao],
      // 豆包 TTS 没有参考音频字段（meta.ts 只有 text / speaker）
      refFields: {},
      pollIntervalMs: 2000, pollTimeoutMs: 600000,
    },
    {
      id: 'web2api:volcengine-audio',
      title: '火山引擎·音频生成',
      description: 'seed-audio 音频生成：格式 / 语速 / 音量 / 音调可调',
      group: 'web2api · 音频',
      nodeTypes: ['audio'],
      needsPrompt: true,
      order: 11,
      platform: 'volcengine', operation: 'generate-audio',
      promptMode: 'plain',
      fields: [format_volc, speed('speechRate', '语速', -50, 100, 0), speed('pitchRate', '音调', -12, 12, 0), speed('loudnessRate', '音量', -50, 100, 0)],
      // 火山引擎收参考音频（最多 3 段）：连进来的音频节点会走这里
      refFields: { audio: 'referenceAudios' },
      pollIntervalMs: 2000, pollTimeoutMs: 600000,
    },
  ],

  async submit(action, input) {
    try {
      const body = await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ platform: action.platform, operation: action.operation, params: await buildParams(action, input) }),
      })
      const task = body && body.data
      if (!task) return { error: 'web2api 没有返回任务信息' }

      // 同步完成：任务记录里已带产物，直接收工
      const status = String(task.status || '')
      if (status === 'completed' || status === 'success' || status === 'done') {
        const urls = collectUrls(task.result).map(absolutize).filter(Boolean)
        if (urls.length > 0) return { done: true, urls }
        return { error: '合成完成但没有产出音频' }
      }
      if (status === 'failed') return { error: task.message || '合成失败' }

      // 异步（服务端以后若改成任务化）：按 taskId 轮询
      if (typeof task.id === 'string' && task.id) return { taskId: task.id }
      return { error: 'web2api 没有返回任务 id 或音频地址' }
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
    try {
      await api('/api/tasks/' + encodeURIComponent(taskId) + '/cancel', { method: 'POST' }, 15000)
    } catch {
      /* 已是终态 */
    }
  },
}


