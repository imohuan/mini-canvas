/**
 * 底栏 AI 工具用哪颗模型（用户 2026-11-20）。
 *
 * 三条规则必须钉死：
 * 1. 单独配了、模型可用 → 用单独那颗；
 * 2. 没单独配 → 用通用模型；
 * 3. 单独那颗失效（被删 / 没密钥）→ 回落到通用模型，而不是报错。
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeAiModelConfig,
  resolveAiActionModel,
  normalizeAiModelChoice,
  emptyAiModelConfig,
} from '../aiActions'

const usable = (c: { provider: string; modelId: string }) => c.modelId !== 'gone'

describe('normalizeAiModelConfig：坏数据不抛错', () => {
  it('全空 / 非对象 → 空配置', () => {
    expect(normalizeAiModelConfig(undefined)).toEqual(emptyAiModelConfig())
    expect(normalizeAiModelConfig('x')).toEqual(emptyAiModelConfig())
    expect(normalizeAiModelConfig([])).toEqual(emptyAiModelConfig())
  })

  it('provider / modelId 任一为空就丢掉', () => {
    expect(normalizeAiModelChoice({ provider: 'local', modelId: '' })).toBeNull()
    expect(normalizeAiModelChoice({ provider: '', modelId: 'hy3' })).toBeNull()
    expect(normalizeAiModelChoice({ provider: 'local', modelId: ' hy3 ' })).toEqual({ provider: 'local', modelId: 'hy3' })
  })

  it('保留通用 + 每个按钮的那份', () => {
    const out = normalizeAiModelConfig({
      default: { provider: 'local', modelId: 'hy3' },
      perAction: { translate: { provider: 'local', modelId: 'hy3' }, bad: { provider: 'x' } },
    })
    expect(out.default).toEqual({ provider: 'local', modelId: 'hy3' })
    expect(Object.keys(out.perAction)).toEqual(['translate'])
  })
})

describe('resolveAiActionModel：单按钮 → 通用 → 后台默认', () => {
  const config = {
    default: { provider: 'local', modelId: 'general' },
    perAction: {
      translate: { provider: 'local', modelId: 'own' },
      broken: { provider: 'local', modelId: 'gone' },
    },
  }

  it('单独配了且可用 → 用单独那颗', () => {
    expect(resolveAiActionModel('translate', config, usable)).toEqual({ provider: 'local', modelId: 'own' })
  })

  it('没单独配 → 用通用模型', () => {
    expect(resolveAiActionModel('optimize', config, usable)).toEqual({ provider: 'local', modelId: 'general' })
  })

  it('单独那颗失效 → 回落通用模型（不报错）', () => {
    expect(resolveAiActionModel('broken', config, usable)).toEqual({ provider: 'local', modelId: 'general' })
  })

  it('通用也失效 → null（请求不带 model，后台用默认）', () => {
    const onlyBroken = { default: { provider: 'local', modelId: 'gone' }, perAction: {} }
    expect(resolveAiActionModel('x', onlyBroken, usable)).toBeNull()
  })
})
