/**
 * 图标解析的契约：触发器与下拉列表必须同一份（用户 2026-11-08 报「列表里全是兜底图标」）。
 *
 * 锁三件事：
 * 1. `icon` 是 SVG / Base64 → 原样用，不去查平台；
 * 2. `icon` 是名字 → 先精确命中平台 key，再模糊认；认不出才退回标题猜测；
 * 3. 什么都不给 → 按标题猜，与老行为一致。
 */
import { describe, expect, it } from 'vitest'
import { resolveActionIcon, type ModelIconServiceLike } from '../node-bottom-bar/actionIcon'
import { resolveModelRowIcon } from '../node-bottom-bar/actionIcon'

const PLATFORMS = ['seedance', 'volcengine', 'kling', 'doubao', 'audio', 'custom']

function makeService(): ModelIconServiceLike {
  return {
    svgOfName: (n) => '<svg data-from="name">' + n + '</svg>',
    platformOfName: (n) => (/seedance/i.test(n) ? 'seedance' : /火山|volc/i.test(n) ? 'volcengine' : 'custom'),
    platformOfIconHint: (h) => {
      const raw = h.trim().toLowerCase()
      if (PLATFORMS.includes(raw)) return raw
      if (/kling|可灵/.test(raw)) return 'kling'
      return ''
    },
    svgOfIconHint: (h) => '<svg data-from="hint">' + h + '</svg>',
  }
}

const SVG = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/></svg>'
const BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('resolveActionIcon：图标优先级', () => {
  const svc = makeService()

  it('icon 是 SVG → 原样用，tone=custom', () => {
    const icon = resolveActionIcon('随便什么名字', SVG, svc, 'image')
    expect(icon.tone).toBe('custom')
    expect(icon.svg).toContain('<rect')
  })

  it('icon 是 Base64 图片 → 换成 <img>', () => {
    const icon = resolveActionIcon('随便什么名字', BASE64, svc, 'image')
    expect(icon.tone).toBe('custom')
    expect(icon.svg).toContain('<img')
    expect(icon.svg).toContain('data:image/png;base64,')
  })

  it('icon 写平台 key → 用它的图标，而不是标题猜的', () => {
    // 标题能被认成 seedance，但 icon 明说是 kling，必须听 icon 的
    const icon = resolveActionIcon('Seedance 2.0 Fast', 'kling', svc, 'video')
    expect(icon.tone).toBe('kling')
    expect(icon.svg).toContain('data-from="hint"')
  })

  it('icon 写中文关键字 → 模糊命中', () => {
    const icon = resolveActionIcon('火山引擎·音频生成', '可灵', svc, 'audio')
    expect(icon.tone).toBe('kling')
  })

  it('icon 认不出 → 退回按标题猜（不拿兜底冒充命中）', () => {
    const icon = resolveActionIcon('豆包 Seedance 2.0', '完全不认识的词', svc, 'video')
    expect(icon.tone).toBe('seedance')
    expect(icon.svg).toContain('data-from="name"')
  })

  it('没给 icon → 按标题猜（老行为）', () => {
    expect(resolveActionIcon('豆包 Seedance 2.0', undefined, svc, 'video').tone).toBe('seedance')
    expect(resolveActionIcon('火山引擎·音频生成', '', svc, 'audio').tone).toBe('volcengine')
  })

  it('agent 未装（没有服务）→ 本地兜底，按节点类型', () => {
    expect(resolveActionIcon('任意', 'seedance', undefined, 'audio').tone).toBe('audio')
    expect(resolveActionIcon('任意', undefined, undefined, 'video').tone).toBe('video')
  })

  it('icon 是危险 SVG（带脚本 / on*）→ 拒绝，回落标题猜', () => {
    const evil = '<svg viewBox="0 0 24 24" onload="alert(1)"><rect/></svg>'
    const icon = resolveActionIcon('豆包 Seedance 2.0', evil, svc, 'video')
    expect(icon.tone).toBe('seedance')
    expect(icon.svg).not.toContain('alert')
  })
})

describe('resolveModelRowIcon：选中的 Agent 模型 → 图标（用户 2026-11-09 trigger 缺图标）', () => {
  const rowSvc: ModelIconServiceLike = {
    svgOfName: (n) => '<svg data-from="name">' + n + '</svg>',
    platformOfName: (n) => (/deepseek/i.test(n) ? 'deepseek' : 'custom'),
    platformOf: (modelId, provider) => (/^deepseek|^ds-/.test(modelId) ? 'deepseek' : /deepseek/.test(provider ?? '') ? 'deepseek' : 'custom'),
    svgOf: (p) => '<svg data-from="brand">' + p + '</svg>',
  }

  it('模型 ID 能认平台 → 品牌图标（deepseek-v4.1-flash → deepseek）', () => {
    const icon = resolveModelRowIcon('deepseek-v4.1-flash', 'openrouter', rowSvc)
    expect(icon.tone).toBe('deepseek')
    expect(icon.svg).toContain('data-from="brand"')
  })

  it('模型 ID 认不出 → 显示名补一手', () => {
    const icon = resolveModelRowIcon('test-model', 'test', rowSvc, 'DeepSeek 官方')
    expect(icon.tone).toBe('deepseek')
    expect(icon.svg).toContain('data-from="name"')
  })

  it('显示名也认不出 → provider 补一手', () => {
    const icon = resolveModelRowIcon('自研模型', 'deepseek官方', rowSvc)
    expect(icon.tone).toBe('deepseek')
  })

  it('全都认不出 → 本地 text 线稿兜底，绝不空白', () => {
    const icon = resolveModelRowIcon('自研模型', '自建网关', rowSvc)
    expect(icon.tone).toBe('text')
    expect(icon.svg.startsWith('<svg')).toBe(true)
  })

  it('Agent 没装（无服务）→ 本地兜底仍给图', () => {
    const icon = resolveModelRowIcon('deepseek-v4', 'x', undefined)
    expect(icon.svg.startsWith('<svg')).toBe(true)
  })
})
