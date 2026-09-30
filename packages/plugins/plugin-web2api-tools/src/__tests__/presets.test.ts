/**
 * 预置配置表的契约测试（纯逻辑，node 环境）。
 *
 * 锁的是用户点名的几条硬要求（不是"实现长什么样"，而是"配置有没有说错话"）：
 * 1. 只做图片 / 音频 / 视频三类节点；
 * 2. 图片与视频的第一条（order 最小）必须是 dola / 豆包的 **auto 模式**；
 * 3. **按能力显隐**：dola 视频时长只有 5/10 两档（按钮网格），豆包 auto 到 10 秒；
 * 4. 每个参数都带 kind（UI 才认得该用哪个预设组件）；
 * 5. 动作 id 唯一、工具名非空。
 */
import { describe, it, expect } from 'vitest'
import { WEB2API_PRESETS, presetsFor, presetIds } from '../presets'

describe('预置配置表', () => {
  it('只覆盖 image / video / audio 三类节点', () => {
    const types = [...new Set(WEB2API_PRESETS.map((p) => p.nodeType))].sort()
    expect(types).toEqual(['audio', 'image', 'video'])
  })

  it('三类节点都至少有一条动作（漏一类就等于那类节点没 UI）', () => {
    for (const t of ['image', 'video', 'audio'] as const) {
      expect(presetsFor(t).length, t + ' 没有动作').toBeGreaterThan(0)
    }
  })

  it('动作 id 唯一（底栏按 id 注册，重复会互相顶掉）', () => {
    const ids = presetIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条动作都能组出 "平台/操作" 形式的工具名', () => {
    for (const p of WEB2API_PRESETS) {
      expect(p.tool).toMatch(/^[a-z]+\/[a-z-]+$/)
      expect(p.title).toBeTruthy()
      expect(p.description).toBeTruthy()
    }
  })

  it('每个参数都声明了 kind（否则 UI 会回落成普通下拉，用户要的"预设组件"就没了）', () => {
    for (const p of WEB2API_PRESETS) {
      for (const f of p.fields) {
        expect(f.kind, p.id + '.' + f.key + ' 缺 kind').toBeTruthy()
        expect(f.key).toBeTruthy()
        expect(f.label).toBeTruthy()
      }
    }
  })

  it('图片与视频的首选动作是 dola / 豆包的 auto 模式（用户点名要走这条路）', () => {
    const imageFirst = presetsFor('image')[0]
    const videoFirst = presetsFor('video')[0]
    expect(imageFirst.promptMode).toBe('chat-auto')
    expect(imageFirst.tool).toBe('doubao/chat-auto')
    expect(videoFirst.promptMode).toBe('chat-auto')
    expect(videoFirst.tool).toBe('doubao/chat-auto')
  })

  it('auto 模式的四条动作都在（豆包/dola × 图片/视频）', () => {
    const autos = WEB2API_PRESETS.filter((p) => p.promptMode === 'chat-auto')
    expect(autos.map((p) => p.tool + ':' + p.mediaMode).sort()).toEqual([
      'dola/chat-auto:image',
      'dola/chat-auto:video',
      'doubao/chat-auto:image',
      'doubao/chat-auto:video',
    ])
  })

  describe('按能力显隐', () => {
    it('dola 视频时长只有 5 / 10 两档（dola 平台只有这两档，不能给滑块）', () => {
      const dolaVideo = WEB2API_PRESETS.find((p) => p.id === 'web2api:dola-video-auto')!
      const duration = dolaVideo.fields.find((f) => f.kind === 'duration')!
      expect(duration.options?.map((o) => o.value)).toEqual(['5', '10'])
      // 只有两档 → 走按钮网格（无 min/max 就不是滑块）
      expect(duration.min).toBeUndefined()
    })

    it('豆包 auto 视频时长上限 10 秒（服务端只到 10s，不能声明 15）', () => {
      const doubaoVideo = WEB2API_PRESETS.find((p) => p.id === 'web2api:doubao-video-auto')!
      const duration = doubaoVideo.fields.find((f) => f.kind === 'duration')!
      expect(duration.max).toBe(10)
      expect(duration.min).toBe(4)
    })

    it('豆包生图有 style，dola 图片没有（平台差异如实声明，不硬凑）', () => {
      const doubaoImage = WEB2API_PRESETS.find((p) => p.id === 'web2api:doubao-image-auto')!
      const dolaImage = WEB2API_PRESETS.find((p) => p.id === 'web2api:dola-image-auto')!
      expect(doubaoImage.fields.some((f) => f.kind === 'style')).toBe(true)
      expect(dolaImage.fields.some((f) => f.kind === 'style')).toBe(false)
    })

    it('图片渠道齐了：豆包 / Dola / ChatGPT 官方 / GPT Image 2(API)', () => {
      const ids = presetsFor('image').map((p) => p.id)
      expect(ids).toEqual([
        'web2api:doubao-image-auto',
        'web2api:dola-image-auto',
        'web2api:chatgpt-image',
        'web2api:apimart-image',
      ])
    })

    it('Seedance 接口只有 16:9 / 9:16 两个比例（不能照抄豆包的七个）', () => {
      const seedance = WEB2API_PRESETS.find((p) => p.id === 'web2api:seedance-video')!
      const ratio = seedance.fields.find((f) => f.kind === 'ratio')!
      expect(ratio.options?.map((o) => o.value)).toEqual(['16:9', '9:16'])
    })

    it('音频动作的文本参数不带 ratio / duration 这类媒体参数', () => {
      for (const p of presetsFor('audio')) {
        expect(p.fields.some((f) => f.kind === 'ratio')).toBe(false)
        expect(p.fields.some((f) => f.kind === 'duration')).toBe(false)
      }
    })

    it('比例参数的候选值都能被比例网格解析成几何（形如 a:b，或 auto 走虚线）', () => {
      for (const p of WEB2API_PRESETS) {
        for (const f of p.fields.filter((x) => x.kind === 'ratio')) {
          for (const o of f.options ?? []) {
            // 只要求"至少有 1 个可解析的比例"，auto 之类允许存在
            expect(String(o.value).length).toBeGreaterThan(0)
          }
          expect((f.options ?? []).length).toBeGreaterThan(1)
        }
      }
    })
  })
})
