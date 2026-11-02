/**
 * 组件库调试标记的契约：
 * 1. 读取编译期注入的定位属性；
 * 2. 气泡默认位置在圆点上方，越界翻到下方；
 * 3. 调试层不劫持点击。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { readFileSync } from 'node:fs'
import UiKitDebugOverlay from '../UiKitDebugOverlay.vue'
import { parseDebugLoc } from '@mini-canvas/ui-kit-shadcn'

const SRC = readFileSync(new URL('../UiKitDebugOverlay.vue', import.meta.url), 'utf-8')
/** 只看代码、不看注释：注释里也会出现 pointer-events 字样 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

describe('组件库使用标记', () => {
  it('路径和行列号按最后两个冒号拆分（兼容 Windows 盘符）', () => {
    expect(parseDebugLoc('C:/repo/packages/ui/src/X.vue:28:11', 'Button')).toEqual({
      component: 'Button',
      file: 'C:/repo/packages/ui/src/X.vue',
      line: 28,
      column: 11,
    })
  })

  it('调试层整层不接鼠标事件', async () => {
    const app = createSSRApp({ render: () => h(UiKitDebugOverlay) })
    const html = await renderToString(app)
    expect(html).toContain('ukdo-layer')
    expect(html).not.toContain('pointer-events: auto')
  })

  /**
   * 气泡浮在组件上方。一旦它能接事件，就会把下面的真按钮整个盖住 ——
   * 实测右上「设置」曾被气泡挡住点不动。这条按代码钉死，别再改回去。
   */
  it('说明气泡也不接鼠标事件（挡住业务按钮的坑）', () => {
    const body = CODE.slice(CODE.indexOf('.ukdo-body'))
    expect(body).toContain('pointer-events: none')
    expect(body).not.toContain('pointer-events: auto')
  })

  /**
   * 2026-11-02 用户反馈：在设置面板里打开开关后完全看不到圆点。
   * 根因是调试层看到 `[role="dialog"]` 就整层让位 —— 但设置面板本身正是最需要看标记的地方。
   * 这条按代码钉死：扫描逻辑里不允许再出现"有 dialog 就清空"的分支。
   */
  it('有设置面板打开时仍然显示标记（不整层让位）', () => {
    expect(CODE).not.toContain('[role="dialog"]')
  })
})
