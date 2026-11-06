/**
 * 模型图标契约（用户 2026-11-06）：底栏模型下拉每一行都要有图标，
 * 且按模型家族认出图形 —— 不能所有模型共用一颗「图片」图标。
 *
 * 这里的断言只看「认成哪一家」和「一定有图形」，具体 SVG 路径属于设计资产，
 * 改形状不必改测试。
 */
import { describe, expect, it } from 'vitest'
import { detectModelTone, modelIcon, modelIconOf } from '../node-bottom-bar/modelIcons'

describe('模型图标：认家族', () => {
  it('Seedream 图片模型 → seedream（含豆包 / Dola 前缀）', () => {
    expect(detectModelTone('豆包 Seedream 4.5')).toBe('seedream')
    expect(detectModelTone('Dola Seedream 5.0 Pro')).toBe('seedream')
  })

  it('Seedance 视频模型 → seedance（先于 Seedream 判定）', () => {
    expect(detectModelTone('豆包 Seedance 2.0 Fast')).toBe('seedance')
    expect(detectModelTone('Seedance Fast')).toBe('seedance')
  })

  it('常见第三方视频 / 图片模型各有一家', () => {
    expect(detectModelTone('可灵 Kling 2.1')).toBe('kling')
    expect(detectModelTone('Sora 2')).toBe('sora')
    expect(detectModelTone('Veo 3')).toBe('veo')
    expect(detectModelTone('Runway Gen-4')).toBe('runway')
    expect(detectModelTone('海螺 Hailuo')).toBe('hailuo')
    expect(detectModelTone('Midjourney v7')).toBe('midjourney')
    expect(detectModelTone('通义万相')).toBe('qwen')
  })

  it('对话 / 生图渠道仍认得出', () => {
    expect(detectModelTone('ChatGPT 官方')).toBe('openai')
    expect(detectModelTone('GPT Image 2（API）')).toBe('openai')
    expect(detectModelTone('豆包·语音合成')).toBe('audio')
    expect(detectModelTone('火山引擎·音频生成')).toBe('volcengine')
  })

  it('认不出名字时按节点类型兜底，绝不留空白', () => {
    expect(detectModelTone('某个自研模型', 'image')).toBe('image')
    expect(detectModelTone('某个自研模型', 'video')).toBe('video')
    expect(detectModelTone('某个自研模型', 'audio')).toBe('audio')
    expect(detectModelTone('某个自研模型')).toBe('text')
  })
})

describe('模型图标：图形', () => {
  it('每个家族都给一段 <svg>（v-html 直接可用）', () => {
    const tones = ['seedream', 'seedance', 'openai', 'dola', 'kling', 'sora', 'veo', 'image', 'video', 'text'] as const
    for (const tone of tones) {
      const icon = modelIcon(tone)
      expect(icon.tone).toBe(tone)
      expect(icon.svg.startsWith('<svg')).toBe(true)
      expect(icon.svg).toContain('viewBox="0 0 24 24"')
      // 线稿图标：不写死 fill 颜色，交给 CSS 的 data-tone 上色
      expect(icon.svg).not.toContain('fill="#')
    }
  })

  it('动作项取图走同一个入口', () => {
    expect(modelIconOf('Dola Seedance 2.5', 'video').tone).toBe('seedance')
    expect(modelIconOf('图片→线稿（ffmpeg）', 'image').tone).toBe('image')
  })
})
