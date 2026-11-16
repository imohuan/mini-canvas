/**
 * 参数下拉的摘要（用户 2026-11-16）：「没有必要显示每一个选项的值」。
 *
 * 截图里那行是 `MP3 · 24 kHz · 0 · 0 · 0` —— 五个值全铺出来，
 * 把左边的模型名挤成「seed-audio-1.0 · 音频…」。
 * 现在默认值不出现：要么写「参数 5」，要么只写改动过的那一两个。
 */
import { describe, expect, it } from 'vitest'
import { paramSummary } from '../node-bottom-bar/paramSummary'

const FIELDS = [
  { key: 'format', label: '格式', type: 'grid', default: 'mp3', options: [{ label: 'MP3', value: 'mp3' }, { label: 'WAV', value: 'wav' }] },
  { key: 'sampleRate', label: '采样率', type: 'select', default: 24000, options: [{ label: '24 kHz', value: 24000 }] },
  { key: 'speechRate', label: '语速', type: 'number', default: 0 },
  { key: 'pitchRate', label: '音调', type: 'number', default: 0 },
  { key: 'loudnessRate', label: '音量', type: 'number', default: 0 },
]

const DEFAULTS = { format: 'mp3', sampleRate: 24000, speechRate: 0, pitchRate: 0, loudnessRate: 0 }

describe('参数下拉摘要', () => {
  it('全是默认值时不铺一串 0，只说「参数 5」', () => {
    const s = paramSummary({ fields: FIELDS, values: DEFAULTS })
    expect(s).toBe('参数 5')
    expect(s).not.toContain('24 kHz')
  })

  it('只显示改过的值（格式改成 WAV 就只说 WAV）', () => {
    const s = paramSummary({ fields: FIELDS, values: { ...DEFAULTS, format: 'wav' } })
    expect(s).toBe('WAV')
  })

  it('改了两个就显示两个，中间用 · 连接', () => {
    const s = paramSummary({ fields: FIELDS, values: { ...DEFAULTS, format: 'wav', speechRate: 20 } })
    expect(s).toBe('WAV · 语速 20')
  })

  it('改得再多也只露 2 个，剩下的用 +N 收尾', () => {
    const s = paramSummary({
      fields: FIELDS,
      values: { ...DEFAULTS, format: 'wav', sampleRate: 48000, speechRate: 20 },
    })
    expect(s).toContain('+1')
  })

  it('没有参数时返回空串（调用方自己回落到「参数」）', () => {
    expect(paramSummary({ fields: [], values: {} })).toBe('')
  })
})
