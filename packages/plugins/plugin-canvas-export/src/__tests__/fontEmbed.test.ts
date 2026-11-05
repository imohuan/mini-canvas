import { describe, it, expect } from 'vitest'
import {
  buildFontFaceCss,
  parseFontFaceCss,
  parseUnicodeRanges,
  selectFontFaces,
  type FontFaceRule,
} from '../fontEmbed'

const googleCss = `
@font-face {
  font-family: 'Noto Sans SC';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/notosanssc/v41/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
@font-face {
  font-family: 'Noto Sans SC';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/notosanssc/v41/cjk.woff2) format('woff2');
  unicode-range: U+4E00-9FFF;
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 600;
  src: url(https://fonts.gstatic.com/s/inter/v13/inter.woff2) format('woff2');
}
`

function face(overrides: Partial<FontFaceRule>): FontFaceRule {
  return {
    family: 'Noto Sans SC',
    weight: '400',
    style: 'normal',
    display: 'swap',
    src: 'https://fonts.gstatic.com/s/notosanssc/v41/cjk.woff2',
    format: 'woff2',
    unicodeRanges: [[0x4e00, 0x9fff]],
    unicodeRangeText: 'U+4E00-9FFF',
    ...overrides,
  }
}

describe('fontEmbed：只选本次导出真正会用到的字体分片', () => {
  it('解析 @font-face（含 src / format / unicode-range）', () => {
    const faces = parseFontFaceCss(googleCss)
    expect(faces).toHaveLength(3)
    expect(faces[0]).toMatchObject({
      family: 'Noto Sans SC',
      weight: '400',
      format: 'woff2',
      src: 'https://fonts.gstatic.com/s/notosanssc/v41/latin.woff2',
    })
    expect(faces[1]?.unicodeRanges).toEqual([[0x4e00, 0x9fff]])
    expect(faces[2]?.unicodeRanges).toEqual([])
  })

  it('unicode-range 支持区间、单值和通配写法', () => {
    expect(parseUnicodeRanges('U+0000-00FF, U+0131')).toEqual([
      [0x0000, 0x00ff],
      [0x0131, 0x0131],
    ])
    expect(parseUnicodeRanges('U+4??')).toEqual([[0x0400, 0x04ff]])
  })

  it('中文标题只选中 CJK 分片，不把整套 404 个分片都抓下来', () => {
    const faces = parseFontFaceCss(googleCss)
    const picked = selectFontFaces(faces, new Set(['noto sans sc']), new Set([0x6807, 0x9898]))
    expect(picked.map((x) => x.face.src)).toEqual(['https://fonts.gstatic.com/s/notosanssc/v41/cjk.woff2'])
  })

  it('英文加粗只选对应字重；没有 unicode-range 的字体按使用情况保留', () => {
    const faces = parseFontFaceCss(googleCss)
    const picked = selectFontFaces(faces, new Set(['inter']), new Set([0x48]))
    expect(picked).toHaveLength(1)
    expect(picked[0]?.face.weight).toBe('600')
  })

  it('超出上限时优先保留命中字符最多的分片', () => {
    const many = [
      face({ src: 'https://x/a.woff2', unicodeRanges: [[0x4e00, 0x4e01]] }),
      face({ src: 'https://x/b.woff2', unicodeRanges: [[0x4e00, 0x4e10]] }),
      face({ src: 'https://x/c.woff2', unicodeRanges: [[0x4e00, 0x4e02]] }),
    ]
    const chars = new Set([0x4e00, 0x4e01, 0x4e02])
    const picked = selectFontFaces(many, new Set(['noto sans sc']), chars, 2)
    expect(picked.map((x) => x.face.src)).toEqual(['https://x/b.woff2', 'https://x/c.woff2'])
  })

  it('生成 CSS 时使用 data URL，并保留 unicode-range', () => {
    const css = buildFontFaceCss(
      [{ face: face({}), matched: 2 }],
      new Map([['https://fonts.gstatic.com/s/notosanssc/v41/cjk.woff2', 'data:font/woff2;base64,AAAA']]),
    )
    expect(css).toContain('font-family:"Noto Sans SC"')
    expect(css).toContain("font-weight:400")
    expect(css).toContain("format('woff2')")
    expect(css).toContain('data:font/woff2;base64,AAAA')
    expect(css).toContain('unicode-range:U+4E00-9FFF')
  })
})
