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
