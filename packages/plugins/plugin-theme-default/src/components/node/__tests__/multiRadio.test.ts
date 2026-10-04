/**
 * 多选标记（节点左上角那个圆圈）的外观契约：大小 / 低缩放下是否显示。
 *
 * **颜色不再是配置项**（用户要求删掉「多选标记颜色」）：那个圆圈改吃**主题的强调色**
 * （CSS 里 `color: var(--ui-accent)`），于是自动跟随「常规/主题配色」里用户选的强调色、
 * 也自动随亮/暗主题切换。所以本契约只剩两件事，且都是纯函数（零 Vue / 零 DOM）：
 * 1. 读配置 → 拿到 { size, showInLowDetail }（一项坏了只回落那一项）；
 * 2. 收到单项变化 → 只改那一项（不认识的键原样返回同一引用，不触发无谓重渲染）；
 * 3. 算样式 → 大小按屏幕像素写死（配合 1/zoom 反缩放，屏幕上恒定）。
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
  it('一项都没有 → 全用默认值（大小 18、低缩放不显示）', () => {
    expect(resolveMultiRadio(() => undefined)).toEqual({
      size: 18,
      showInLowDetail: false,
    })
  })

  it('读到配置就用配置（大小 / 开关）', () => {
    const cfg = {
      [MULTI_RADIO_KEYS.size]: 32,
      [MULTI_RADIO_KEYS.showInLowDetail]: true,
    }
    expect(resolveMultiRadio((k) => cfg[k as keyof typeof cfg])).toEqual({
      size: 32,
      showInLowDetail: true,
    })
  })

  it('大小非法（NaN / 负数 / 字符串）回落默认，不影响开关', () => {
    for (const bad of [Number.NaN, -5, '32', null] as unknown[]) {
      const r = resolveMultiRadio((k) =>
        k === MULTI_RADIO_KEYS.size ? bad : true,
      )
      expect(r.size).toBe(DEFAULT_MULTI_RADIO.size)
      expect(r.showInLowDetail).toBe(true)
    }
  })

  it('大小超出上限 → 收进上限（不写出离谱尺寸）', () => {
    expect(resolveMultiRadio((k) => (k === MULTI_RADIO_KEYS.size ? 999 : undefined)).size).toBe(48)
  })

  it('开关非布尔 → 回落默认（半套脏值不该被当成 true）', () => {
    expect(
      resolveMultiRadio((k) => (k === MULTI_RADIO_KEYS.showInLowDetail ? 'yes' : undefined))
        .showInLowDetail,
    ).toBe(false)
  })
})

describe('applyMultiRadioChange：设置面板改一项', () => {
  const base = { size: 18, showInLowDetail: false }

  it('改大小 → 只改大小', () => {
    expect(applyMultiRadioChange(base, MULTI_RADIO_KEYS.size, 24)).toEqual({ ...base, size: 24 })
  })

  it('改开关 → 只改开关', () => {
    expect(applyMultiRadioChange(base, MULTI_RADIO_KEYS.showInLowDetail, true)).toEqual({
      ...base,
      showInLowDetail: true,
    })
  })

  it('不认识的键（别的插件的配置）→ 原样返回同一引用（不触发重渲染）', () => {
    expect(applyMultiRadioChange(base, 'edgeColor', '#000000')).toBe(base)
    // 颜色键已删除：即便有人塞进来，也当"不认识"，原样返回
    expect(applyMultiRadioChange(base, 'nodeMultiRadioColor', '#ff0000')).toBe(base)
  })

  it('改坏值 → 回落默认，而不是把坏值吞下去', () => {
    expect(applyMultiRadioChange(base, MULTI_RADIO_KEYS.size, 'big').size).toBe(
      DEFAULT_MULTI_RADIO.size,
    )
  })
})

describe('multiRadioStyle：贴到元素上的样式', () => {
  it('大小按配置写 px，缩放按 1/max(zoom, 阈值) 反缩放（屏幕上大小恒定）', () => {
    const s = multiRadioStyle({ size: 18, zoom: 1, minZoom: 0.5 })
    expect(s.width).toBe('18px')
    expect(s.height).toBe('18px')
    expect(s.transform).toBe('scale(1)')
    expect(s.transformOrigin).toBe('left top')
  })

  it('缩到 0.2x → 反缩放 2 倍（按阈值 0.5 封顶，不再无限放大）', () => {
    expect(multiRadioStyle({ size: 18, zoom: 0.2, minZoom: 0.5 }).transform).toBe('scale(2)')
  })

  it('缩放非法（0 / NaN）→ 按阈值算，不产生 Infinity', () => {
    for (const bad of [0, Number.NaN]) {
      expect(multiRadioStyle({ size: 18, zoom: bad, minZoom: 0.5 }).transform).toBe('scale(2)')
    }
  })

  it('不再带出颜色（颜色走 CSS 的 var(--ui-accent)，不在这里算）', () => {
    expect(multiRadioStyle({ size: 18, zoom: 1, minZoom: 0.5 })).not.toHaveProperty('color')
  })
})
