/**
 * `icon` 写成名字时的查表（provider 用它指定「我要这个平台的图标」）。
 *
 * 顺序不能反：先精确命中平台 key，再模糊认关键字；
 * 认不出必须回空串 —— 回 `custom` 会让调用方以为命中了自建网关，
 * 于是所有拼错的名字都显示成同一个图标，还没法回落到标题猜测。
 */
import { describe, expect, it } from 'vitest'
import { createModelIconService } from '../modelIconService'

const svc = createModelIconService()

describe('platformOfIconHint：icon 写名字时的解析', () => {
  it('平台 key 原样命中', () => {
    for (const key of ['seedance', 'volcengine', 'kling', 'doubao', 'openai', 'custom']) {
      expect(svc.platformOfIconHint(key), key).toBe(key)
    }
  })

  it('大小写 / 前后空白不影响', () => {
    expect(svc.platformOfIconHint('  SeedAnce  ')).toBe('seedance')
    expect(svc.platformOfIconHint('KLING')).toBe('kling')
  })

  it('中文名与关键字模糊命中', () => {
    expect(svc.platformOfIconHint('火山引擎')).toBe('volcengine')
    expect(svc.platformOfIconHint('可灵')).toBe('kling')
    expect(svc.platformOfIconHint('豆包')).toBe('doubao')
  })

  it('认不出回空串（不是 custom）', () => {
    expect(svc.platformOfIconHint('完全不认识的词')).toBe('')
    expect(svc.platformOfIconHint('')).toBe('')
    expect(svc.platformOfIconHint('   ')).toBe('')
  })

  it('svgOfIconHint 给出真图标（有 viewBox 的 svg）', () => {
    const svg = svc.svgOfIconHint('seedance')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('viewBox')
    // 带渐变（内部有 id）的图标：同一张图并排出现时 id 不能撞车
    expect(svc.svgOfIconHint('gemini')).not.toBe(svc.svgOfIconHint('gemini'))
  })
})
