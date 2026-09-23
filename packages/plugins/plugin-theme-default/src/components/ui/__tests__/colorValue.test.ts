/**
 * colorValue —— 颜色值的解析 / 规范化（取色控件与各消费方的共同地基）。
 *
 * 用户诉求："我需要这里显示它的透明度，也可以进行设置"。
 * 透明度靠 8 位 hex（#rrggbbaa）承载；本模块是"用户选的颜色"与"存进 settings 的字符串"
 * 之间唯一那道转换，所以每一条边界都在这里钉死：
 *   1. 合法写法都认（#rgb / #rgba / #rrggbb / #rrggbbaa，大小写不敏感）；
 *   2. 规范化输出只有两种形态 —— **不透明一律回落 6 位**（老存档、老消费者照旧），
 *      真调了透明度才写 8 位；
 *   3. 脏值不写坏数据（回落到给定默认色，默认色本身也脏则回到 #000000）。
 */
import { describe, it, expect } from 'vitest'
import {
  colorAlpha,
  formatHexColor,
  isHexColor,
  normalizeHexColor,
  parseHexColor,
} from '../colorValue'

describe('isHexColor：认全四种合法写法，拒绝其它一切', () => {
  it('收 3 / 4 / 6 / 8 位（含大小写混写）', () => {
    for (const ok of ['#fff', '#FFF', '#fff8', '#FFf8', '#3b82f6', '#3B82F6', '#3b82f680', '#3B82F680']) {
      expect(isHexColor(ok), ok).toBe(true)
    }
  })

  it('拒非字符串、缺 #、位数不对、带非法字符', () => {
    for (const bad of [undefined, null, 12, '', 'fff', '#ff', '#fffff', '#fffffff', '#gggggg', '#3b82f6 ', 'rgb(1,2,3)', 'red']) {
      expect(isHexColor(bad), String(bad)).toBe(false)
    }
  })
})

describe('parseHexColor：拆成 r/g/b/a 四元组', () => {
  it('6 位 → a 恒为 1', () => {
    expect(parseHexColor('#3b82f6')).toEqual({ r: 0x3b, g: 0x82, b: 0xf6, a: 1 })
  })

  it('3 位按位复制成 6 位（#abc = #aabbcc）', () => {
    expect(parseHexColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 })
  })

  it('4 位是 3 位 + 透明度（#f008 → a = 0x88/255）', () => {
    const c = parseHexColor('#f008')!
    expect([c.r, c.g, c.b]).toEqual([0xff, 0x00, 0x00])
    expect(c.a).toBeCloseTo(0x88 / 255, 10)
  })

  it('8 位取后两位当透明度', () => {
    const c = parseHexColor('#3b82f680')!
    expect([c.r, c.g, c.b]).toEqual([0x3b, 0x82, 0xf6])
    expect(c.a).toBeCloseTo(0x80 / 255, 10)
  })

  it('非法值返回 undefined（调用方据此回落，不抛异常）', () => {
    expect(parseHexColor('oops')).toBeUndefined()
    expect(parseHexColor('#12345')).toBeUndefined()
  })
})

describe('formatHexColor：不透明写 6 位，半透明才写 8 位', () => {
  it('a >= 1 → #rrggbb（小写）', () => {
    expect(formatHexColor({ r: 59, g: 130, b: 246, a: 1 })).toBe('#3b82f6')
    expect(formatHexColor({ r: 59, g: 130, b: 246, a: 1.4 })).toBe('#3b82f6')
  })

  it('a < 1 → #rrggbbaa（小写，两位十六进制）', () => {
    expect(formatHexColor({ r: 59, g: 130, b: 246, a: 0.5 })).toBe('#3b82f680')
    expect(formatHexColor({ r: 59, g: 130, b: 246, a: 0 })).toBe('#3b82f600')
  })

  it('负透明度夹到 0（不写出越界的第四位）', () => {
    expect(formatHexColor({ r: 0, g: 0, b: 0, a: -3 })).toBe('#00000000')
  })

  it('单通道越界 / 小数通道按 0..255 夹取并取整', () => {
    expect(formatHexColor({ r: 300, g: -20, b: 127.6, a: 1 })).toBe('#ff0080')
  })
})

describe('normalizeHexColor：用户选什么都能收敛成规范写法', () => {
  it('大写 / 缩写 / 8 位都收敛成小写规范形态', () => {
    expect(normalizeHexColor('#3B82F6', '#000000')).toBe('#3b82f6')
    expect(normalizeHexColor('#ABC', '#000000')).toBe('#aabbcc')
    expect(normalizeHexColor('#3B82F680', '#000000')).toBe('#3b82f680')
  })

  it('不透明的 8 位（FF）回落成 6 位 —— 老存档与老消费者的形态不变', () => {
    expect(normalizeHexColor('#3B82F6FF', '#000000')).toBe('#3b82f6')
  })

  it('脏值 → 给定默认色；默认色本身也脏 → #000000', () => {
    expect(normalizeHexColor('oops', '#94a3b8')).toBe('#94a3b8')
    expect(normalizeHexColor(undefined, '#94a3b8')).toBe('#94a3b8')
    expect(normalizeHexColor('oops', 'also-bad')).toBe('#000000')
  })

  it('规范化是幂等的（同一值反复过手不变形）', () => {
    for (const v of ['#3b82f680', '#abc', '#3B82F6', '#00000000']) {
      const once = normalizeHexColor(v, '#000000')
      expect(normalizeHexColor(once, '#000000'), v).toBe(once)
    }
  })
})

describe('colorAlpha：给消费方读"这个颜色有多透"', () => {
  it('6 / 3 位视为完全不透明', () => {
    expect(colorAlpha('#3b82f6')).toBe(1)
    expect(colorAlpha('#abc')).toBe(1)
  })

  it('8 位读后两位', () => {
    expect(colorAlpha('#3b82f680')).toBeCloseTo(0x80 / 255, 10)
    expect(colorAlpha('#00000000')).toBe(0)
  })

  it('读不出来时当不透明（渲染成实色比渲染成隐形更安全）', () => {
    expect(colorAlpha('oops')).toBe(1)
    expect(colorAlpha(undefined)).toBe(1)
  })
})
