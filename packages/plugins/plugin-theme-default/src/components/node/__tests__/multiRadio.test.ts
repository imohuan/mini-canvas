/**
 * 多选标记（节点左上角那个圆圈）的外观契约：大小 / 颜色 / 低缩放下是否显示。
 *
 * 用户原话：“这个多选标识变小一些，并且支持改变颜色，在这个插件的 Config 中提供对应配置
 * 同时支持大小 size；并且支持一个开关 —— 当前在低缩放下不显示，我希望你支持一个开关支持显示”。
 *
 * 三件事都写成纯函数（本文件直接跑，零 Vue / 零 DOM）：
 * 1. 读配置 → 拿到 { size, color, showInLowDetail }（一项坏了只回落那一项）；
 * 2. 收到单项变化 → 只改那一项（不认识的键原样返回同一引用，不触发无谓重渲染）；
 * 3. 算样式 → 大小按屏幕像素写死（配合 1/zoom 反缩放，屏幕上恒定），颜色交给 CSS 变量兜底。
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MULTI_RADIO,
  MULTI_RADIO_KEYS,
  resolveMultiRadio,
  applyMultiRadioChange,
  multiRadioStyle,
} from '../multiRadio'

describe('resolveMultiRadio：从配置读外观', () => {
  it('一项都没有 → 全用默认值（大小 18、主题选中色、低缩放不显示）', () => {
    expect(resolveMultiRadio(() => undefined)).toEqual({
      size: 18,
      color: DEFAULT_MULTI_RADIO.color,
      showInLowDetail: false,
    })
  })

  it('读到配置就用配置（大小 / 颜色 / 开关）', () => {
    const cfg = {
      [MULTI_RADIO_KEYS.size]: 32,
      [MULTI_RADIO_KEYS.color]: '#ff0000',
      [MULTI_RADIO_KEYS.showInLowDetail]: true,
    }
    expect(resolveMultiRadio((k) => cfg[k as keyof typeof cfg])).toEqual({
      size: 32,
      color: '#ff0000',
      showInLowDetail: true,
    })
  })

  it('大小非法（NaN / 负数 / 字符串）各自回落默认，不影响其它项', () => {
    const color = '#123456'
    for (const bad of [Number.NaN, -5, '32', null] as unknown[]) {
      const r = resolveMultiRadio((k) =>
        k === MULTI_RADIO_KEYS.size ? bad : color,
      )
      expect(r.size).toBe(DEFAULT_MULTI_RADIO.size)
      expect(r.color).toBe(color)
    }
  })

  it('大小超出上限 → 收进上限（不写出离谱尺寸）', () => {
    const r = resolveMultiRadio((k) =>
      k === MULTI_RADIO_KEYS.size ? 999 : undefined,
    )
    expect(r.size).toBe(48)
  })

  it('颜色非法（非 hex / 空串）→ 回落（CSS 里那串变量兜底值）', () => {
    for (const bad of ['red', '', '#12345', undefined]) {
      expect(resolveMultiRadio((k) => (k === MULTI_RADIO_KEYS.color ? bad : undefined)).color).toBe(
        DEFAULT_MULTI_RADIO.color,
      )
    }
  })

  it('开关非布尔 → 回落默认（半套脏值不该被当成 true）', () => {
    expect(
      resolveMultiRadio((k) => (k === MULTI_RADIO_KEYS.showInLowDetail ? 'yes' : undefined))
        .showInLowDetail,
    ).toBe(false)
  })
})

describe('applyMultiRadioChange：设置面板改一项', () => {
  const base = { size: 18, color: '#111827', showInLowDetail: false }

  it('改大小 → 只改大小', () => {
    expect(applyMultiRadioChange(base, MULTI_RADIO_KEYS.size, 24)).toEqual({
      ...base,
      size: 24,
    })
  })

  it('改颜色 → 只改颜色', () => {
    expect(applyMultiRadioChange(base, MULTI_RADIO_KEYS.color, '#00ff00')).toEqual({
      ...base,
      color: '#00ff00',
    })
  })

  it('改开关 → 只改开关', () => {
    expect(applyMultiRadioChange(base, MULTI_RADIO_KEYS.showInLowDetail, true)).toEqual({
      ...base,
      showInLowDetail: true,
    })
  })

  it('不认识的键（别的插件的配置）→ 原样返回同一引用（不触发重渲染）', () => {
    expect(applyMultiRadioChange(base, 'edgeColor', '#000000')).toBe(base)
  })

  it('改坏值 → 回落默认，而不是把坏值吞下去', () => {
    expect(applyMultiRadioChange(base, MULTI_RADIO_KEYS.size, 'big').size).toBe(
      DEFAULT_MULTI_RADIO.size,
    )
    expect(applyMultiRadioChange(base, MULTI_RADIO_KEYS.color, 'red').color).toBe(
      DEFAULT_MULTI_RADIO.color,
    )
  })
})

describe('multiRadioStyle：贴到元素上的样式', () => {
  it('大小按配置写 px，缩放按 1/max(zoom, 阈值) 反缩放（屏幕上大小恒定）', () => {
    const s = multiRadioStyle({ size: 18, color: '#111827', zoom: 1, minZoom: 0.5 })
    expect(s.width).toBe('18px')
    expect(s.height).toBe('18px')
    expect(s.transform).toBe('scale(1)')
    expect(s.transformOrigin).toBe('left top')
  })

  it('缩到 0.2x → 反缩放 2 倍（按阈值 0.5 封顶，不再无限放大）', () => {
    expect(multiRadioStyle({ size: 18, color: '#111827', zoom: 0.2, minZoom: 0.5 }).transform).toBe(
      'scale(2)',
    )
  })

  it('缩放非法（0 / NaN）→ 按阈值算，不产生 Infinity', () => {
    for (const bad of [0, Number.NaN]) {
      expect(
        multiRadioStyle({ size: 18, color: '#111827', zoom: bad, minZoom: 0.5 }).transform,
      ).toBe('scale(2)')
    }
  })

  it('颜色原样带出去（圆环/圆点走 currentColor）', () => {
    expect(
      multiRadioStyle({ size: 24, color: '#ff0000', zoom: 1, minZoom: 0.5 }).color,
    ).toBe('#ff0000')
  })
})
