/**
 * 图标清单接口 —— 告诉 provider 作者「到底能写哪些名字」。
 *
 * 为什么要有它：`icon` 支持写平台名（`seedance` / `火山引擎`），但这份知识原先只存在于
 * 前端代码和一份 Markdown 里。写 provider 的人只能翻源码或猜。这里把三样东西公开出来：
 *
 *   GET /api/agent/icons                  → { platforms: [{ key, name, aliases }] }
 *   GET /api/agent/icons/:hint            → { hint, key, name, matched } 或 404
 *   GET /api/agent/icons.svg              → { platforms: [{ key, name, svg }] }
 *
 * `:hint` 查的正是 `icon` 字段会走的那套匹配（`platformOfIconHint`），所以
 * 「这个写法到底认不认得出」可以直接问它，不用写进 provider 再试。
 */
import { Hono } from 'hono'
import { createModelIconService } from '../../ui/render/modelIconService.js'
import { MODEL_BRAND_ICONS } from '../../ui/render/modelBrandIcons.js'

/**
 * 每个平台能认哪些写法。
 *
 * 与 `platformOfIconHint` 共用同一张规则表，这里只是把它**反过来**列给人看：
 * 规则是「正则 → key」，注释里写不出中文别名，所以别名单独维护一份。
 * 新增平台时两处都要改 —— 由 `iconCatalog.test.ts` 锁住（漏一个就红）。
 */
export const ICON_ALIASES: Record<string, string[]> = {
  dola: ['Dola', 'dola'],
  seedance: ['Seedance', '即梦视频', '豆包 Seedance'],
  doubao: ['豆包', 'Doubao', '即梦', 'Seedream'],
  veo: ['Veo', 'Google Veo'],
  sora: ['Sora'],
  kling: ['可灵', 'Kling'],
  hailuo: ['海螺', 'Hailuo'],
  runway: ['Runway'],
  pika: ['Pika'],
  luma: ['Luma', 'Dream Machine'],
  vidu: ['Vidu'],
  pixverse: ['PixVerse'],
  midjourney: ['Midjourney', 'MJ'],
  openai: ['OpenAI', 'ChatGPT', 'GPT Image', 'APIMart'],
  volcengine: ['火山引擎', '火山', 'Volcengine'],
  qwen: ['通义千问', '通义', '万相', 'Qwen', 'Wanx'],
  hunyuan: ['腾讯混元', '混元', 'Hunyuan'],
  zhipu: ['智谱', 'GLM', 'Zhipu'],
  kimi: ['Kimi'],
  moonshot: ['Moonshot'],
  deepseek: ['DeepSeek'],
  claude: ['Claude', 'Anthropic'],
  gemini: ['Gemini', 'Google'],
  grok: ['Grok', 'xAI'],
  minimax: ['MiniMax'],
  wenxin: ['文心一言', '文心', 'ERNIE'],
  stepfun: ['阶跃星辰', '阶跃', 'StepFun'],
  yi: ['零一万物', 'Yi'],
  mistral: ['Mistral'],
  jimeng: ['Jimeng'],
  custom: ['custom', '自建网关'],
}

export function iconRoutes(): Hono {
  const app = new Hono()
  const service = createModelIconService()

  /** 全部平台：key + 展示名 + 能认的别名 */
  app.get('/api/agent/icons', (c) => {
    const platforms = Object.keys(MODEL_BRAND_ICONS).map((key) => ({
      key,
      name: MODEL_BRAND_ICONS[key]?.name ?? key,
      aliases: ICON_ALIASES[key] ?? [],
    }))
    return c.json({ ok: true, count: platforms.length, platforms })
  })

  /** 带图标的完整清单（排查「为什么我这行是通用图标」时看它） */
  app.get('/api/agent/icons.svg', (c) => {
    const platforms = Object.keys(MODEL_BRAND_ICONS).map((key) => ({
      key,
      name: MODEL_BRAND_ICONS[key]?.name ?? key,
      svg: service.svgOf(key),
    }))
    return c.json({ ok: true, platforms })
  })

  /**
   * 单条查询：`icon: 'xxx'` 到底会认成哪个平台。
   *
   * 认不出回 `matched: false` 与 `key: ''`，**不是 404** ——
   * 「这个写法认不出」是个正常答案，不是资源不存在。
   */
  app.get('/api/agent/icons/:hint', (c) => {
    const hint = c.req.param('hint')
    const key = service.platformOfIconHint(hint)
    return c.json({
      ok: true,
      hint,
      matched: key !== '',
      key,
      name: key ? (MODEL_BRAND_ICONS[key]?.name ?? key) : '',
    })
  })

  return app
}

