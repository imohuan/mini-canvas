/**
 * 多选标记的两项配置必须真的出现在本插件的 Config（设置页面）里。
 *
 * 注意：**颜色已不是配置项**（用户要求删掉「多选标记颜色」）—— 它改吃主题的强调色
 * （--ui-accent），在「常规/主题配色」里统一调，不再单列一格。所以这里只查大小与开关两项。
 *
 * 为什么单独一条：multiRadio.ts 的纯函数测的是"给了配置怎么算"，但用户要的是
 * "能在设置页面里调"。若只加纯函数而忘了在 Config 里声明，设置面板上什么都看不到 —— 这个
 * 断链只有"直接查 Config"才测得出来（对齐 multi-select 的 multiSelectConfig.test 做法）。
 */
import { describe, it, expect } from 'vitest'
import { Config } from '../../../index'
import {
  MULTI_RADIO_KEYS,
  DEFAULT_MULTI_RADIO,
  MULTI_RADIO_SIZE_MIN,
  MULTI_RADIO_SIZE_MAX,
} from '../multiRadio'

describe('多选标记的 Config 声明（设置页面里要能看到这两项）', () => {
  it('两项都在 Config 里（大小 / 低缩放显示）', () => {
    for (const key of Object.values(MULTI_RADIO_KEYS)) {
      expect(Config[key], key + ' 未在 Config 里声明').toBeDefined()
    }
    // 颜色键已删除：不该再出现在 Config 里
    expect(Config['nodeMultiRadioColor']).toBeUndefined()
  })

  it('控件类型对得上：大小=数字、开关=布尔', () => {
    expect(Config[MULTI_RADIO_KEYS.size].type).toBe('number')
    expect(Config[MULTI_RADIO_KEYS.showInLowDetail].type).toBe('boolean')
  })

  it('两项归在「节点/多选标记」一组（设置页面里排在一起）', () => {
    for (const key of Object.values(MULTI_RADIO_KEYS)) {
      expect(Config[key].group).toBe('节点/多选标记')
    }
  })

  it('默认值与组件读到的默认值同源（不各写一份）', () => {
    expect(Config[MULTI_RADIO_KEYS.size].default).toBe(DEFAULT_MULTI_RADIO.size)
    expect(Config[MULTI_RADIO_KEYS.showInLowDetail].default).toBe(
      DEFAULT_MULTI_RADIO.showInLowDetail,
    )
  })

  it('大小滑块的上下限与纯函数收的边界一致（拖到头就是那个值）', () => {
    expect(Config[MULTI_RADIO_KEYS.size].min).toBe(MULTI_RADIO_SIZE_MIN)
    expect(Config[MULTI_RADIO_KEYS.size].max).toBe(MULTI_RADIO_SIZE_MAX)
  })

  it('两项都有中文 label 与 description（设置页面不是裸键名）', () => {
    for (const key of Object.values(MULTI_RADIO_KEYS)) {
      expect(Config[key].label).toBeTruthy()
      expect(Config[key].description).toBeTruthy()
    }
  })
})
