/**
 * 平台图标的识别契约（用户 2026-11-07）。
 *
 * 这一轮的三条硬要求：
 * 1. 图标只有一份，放在 Agent（modelBrandIcons + modelIconService）；
 * 2. 带网关前缀的模型必须认得出（hy3、auto/hy3、workbuddy-ai/hy3 都是腾讯混元）；
 * 3. 同一张图重复出现时不能因为渐变 id 撞车而变空白。
 */
import { describe, expect, it } from 'vitest'
import {
  MODEL_BRAND_ICONS,
  brandName,
  brandPlatforms,
  brandSvg,
  detectPlatform,
  stripProviderPrefix,
} from '../ui/render/modelBrandIcons'
import { createModelIconService } from '../ui/render/modelIconService'

describe('网关前缀：先剥再认', () => {
  it('去掉 auto / workbuddy-ai / kiro / 供应商命名空间', () => {
    expect(stripProviderPrefix('auto/hy3')).toBe('hy3')
    expect(stripProviderPrefix('workbuddy-ai/glm-5.3')).toBe('glm-5.3')
    expect(stripProviderPrefix('kiro/auto')).toBe('auto')
    expect(stripProviderPrefix('accounts/fireworks/models/kimi-k3')).toBe('kimi-k3')
    expect(stripProviderPrefix('tencent/hy4-preview')).toBe('hy4-preview')
    expect(stripProviderPrefix('z-ai/glm-5.3')).toBe('glm-5.3')
  })

  it('没有前缀时原样返回', () => {
    expect(stripProviderPrefix('deepseek-v4-pro')).toBe('deepseek-v4-pro')
    expect(stripProviderPrefix('')).toBe('')
  })
})

describe('平台识别：对话模型', () => {
  it('HY3 / HY4 是腾讯混元（旧规则会落 custom）', () => {
    expect(detectPlatform('hy3', 'local')).toBe('hunyuan')
    expect(detectPlatform('hy4', 'local')).toBe('hunyuan')
    expect(detectPlatform('hy4-preview', 'local')).toBe('hunyuan')
    expect(detectPlatform('auto/hy3', 'local')).toBe('hunyuan')
    expect(detectPlatform('workbuddy-ai/hy4-preview', 'local')).toBe('hunyuan')
    expect(detectPlatform('tencent/hy3', 'openrouter')).toBe('hunyuan')
  })

  it('其它常见平台', () => {
    expect(detectPlatform('deepseek-v4-pro', 'local')).toBe('deepseek')
    expect(detectPlatform('glm-5.2', 'local')).toBe('zhipu')
    expect(detectPlatform('kimi-k3', 'local')).toBe('kimi')
    expect(detectPlatform('MiniMax-M3', 'minimax')).toBe('minimax')
    expect(detectPlatform('gpt-5.6-luna', 'local')).toBe('openai')
    expect(detectPlatform('claude-opus-5', 'local')).toBe('claude')
    expect(detectPlatform('grok-4.5', 'local')).toBe('grok')
    expect(detectPlatform('step-5-preview', 'local')).toBe('stepfun')
  })
})

describe('平台识别：视频 / 生图模型', () => {
  it('Seedance 与 Seedream 分开认', () => {
    expect(detectPlatform('seedance-v2.0', 'doubao')).toBe('seedance')
    expect(detectPlatform('doubao-seedream-45', 'doubao')).toBe('doubao')
    expect(detectPlatform('seed-2.1-pro', 'tokendance')).toBe('doubao')
  })

  it('各家视频模型各有平台', () => {
    expect(detectPlatform('veo-3.1', 'google')).toBe('veo')
    expect(detectPlatform('sora-2', 'openai')).toBe('sora')
    expect(detectPlatform('kling-v3', 'custom')).toBe('kling')
    expect(detectPlatform('hailuo-02', 'custom')).toBe('hailuo')
    expect(detectPlatform('runway-gen4', 'custom')).toBe('runway')
    expect(detectPlatform('pika-2.5', 'custom')).toBe('pika')
    expect(detectPlatform('luma-ray3', 'custom')).toBe('luma')
    expect(detectPlatform('vidu-q1', 'custom')).toBe('vidu')
    expect(detectPlatform('pixverse-v5', 'custom')).toBe('pixverse')
    expect(detectPlatform('dola-seedance25', 'custom')).toBe('dola')
  })

  it('真认不出才落 custom', () => {
    expect(detectPlatform('space-bunny', 'local')).toBe('custom')
    expect(detectPlatform('git-commit', 'local')).toBe('custom')
  })
})

describe('图标数据', () => {
  it('视频 / 生图平台都有图标', () => {
    const platforms = brandPlatforms()
    for (const key of ['seedance', 'veo', 'sora', 'kling', 'hailuo', 'runway', 'pika', 'luma', 'vidu', 'pixverse', 'dola', 'jimeng']) {
      expect(platforms).toContain(key)
      expect(MODEL_BRAND_ICONS[key]?.svg?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('品牌图标带颜色（不是全黑单色版）', () => {
    // 抽样：这几家官方就是彩色标志
    for (const key of ['deepseek', 'claude', 'kling', 'hailuo', 'seedance', 'volcengine', 'doubao']) {
      expect(MODEL_BRAND_ICONS[key]!.svg).toMatch(/#[0-9a-fA-F]{3,8}|url\(#/)
    }
  })

  it('每个平台都有展示名', () => {
    for (const key of brandPlatforms()) {
      expect(brandName(key).trim().length).toBeGreaterThan(0)
    }
  })
})

describe('brandSvg：重复出现也不能空白', () => {
  it('同一张渐变图标取两次，渐变 id 不同', () => {
    const a = brandSvg('kling')
    const b = brandSvg('kling')
    expect(a).toContain('<svg')
    expect(b).toContain('<svg')
    // 取 id="..."
    const idOf = (s: string) => (s.match(/id="([^"]+)"/) ?? [])[1] ?? ''
    expect(idOf(a)).not.toBe('')
    expect(idOf(a)).not.toBe(idOf(b))
  })

  it('渐变引用跟着换成同一次的新 id', () => {
    const svg = brandSvg('hunyuan')
    const ids = [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
    const refs = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])
    if (refs.length > 0) {
      for (const ref of refs) expect(ids).toContain(ref)
    }
  })

  it('Dola 只有官方 PNG：内联成 <image>', () => {
    const svg = brandSvg('dola')
    expect(svg).toContain('<image ')
    expect(svg).toContain('data:image/png;base64,')
  })

  it('认不出的平台给兜底图形，不返回空串', () => {
    const svg = brandSvg('not-a-platform')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.length).toBeGreaterThan(50)
  })
})

describe('modelIconService：给其它插件用的形状', () => {
  const svc = createModelIconService()

  it('按模型 ID 取图', () => {
    expect(svc.platformOf('auto/hy3', 'local')).toBe('hunyuan')
    expect(svc.svgOfModel('hy3', 'local')).toContain('<svg')
  })

  it('按底栏动作名取图（中文标题）', () => {
    expect(svc.platformOfName('豆包 Seedance 2.0 Fast')).toBe('seedance')
    expect(svc.platformOfName('Dola Seedream 5.0 Pro')).toBe('dola')
    expect(svc.platformOfName('ChatGPT 官方')).toBe('openai')
    expect(svc.platformOfName('火山引擎·音频生成')).toBe('volcengine')
    expect(svc.platformOfName('豆包 Seedream 4.5')).toBe('doubao')
    expect(svc.platformOfName('某个自研动作')).toBe('custom')
  })

  it('名字取图也有完整 SVG', () => {
    expect(svc.svgOfName('可灵 Kling 2.1')).toContain('<svg')
  })
})

