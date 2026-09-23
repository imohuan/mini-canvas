/** ColorField 的 SSR 冒烟契约：颜色字段不能退回原生 input，第三方 Chrome 必须带 alpha 轨道。 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { Chrome } from '@ckpack/vue-color'
import ColorField from '../ColorField.vue'

describe('ColorField', () => {
  it('触发器显示棋盘格色块、规范颜色和透明度百分比，不是原生 color input', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () => h(ColorField, { modelValue: '#3b82f680', ariaLabel: '连线颜色', inputId: 'sf-edge' }),
      }),
    )
    expect(html).toContain('cf-trigger')
    expect(html).toContain('id="sf-edge"')
    expect(html).toContain('#3b82f680')
    expect(html).toContain('50%')
    expect(html).toContain('cf-swatch')
    expect(html).not.toContain('type="color"')
  })

  it('第三方 Chrome 取色器带透明度轨道和棋盘格（用户可见、可调）', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(Chrome, { modelValue: '#3b82f680' }) }),
    )
    expect(html).toContain('vc-chrome-alpha-wrap')
    expect(html).toContain('vc-checkerboard')
    expect(html).toContain('vc-alpha-gradient')
  })
})
