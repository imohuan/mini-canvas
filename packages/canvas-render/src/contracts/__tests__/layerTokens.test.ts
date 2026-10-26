import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { LAYERS } from '../layers'

/**
 * layerTokens —— 锁住 CSS 出口（ui-theme.css 的 --layer-* 变量）与 TS 唯一事实源（LAYERS）一致。
 *
 * 为什么需要：纯 CSS 读不到 TS 常量，只好把同一组数值以变量形式再给一份。
 * 「两份相同」只能靠测试保证 —— 否则改了一处、另一处不动，样式与逻辑就会悄悄分叉，
 * 又回到「没人说得清整体层序」的老问题。
 */
const cssPath = fileURLToPath(new URL('../../styles/ui-theme.css', import.meta.url))
const css = readFileSync(cssPath, 'utf8')

/** 从 CSS 文本里取某个自定义属性的数值 */
function cssValue(name: string): number | undefined {
  const m = css.match(new RegExp('--' + name + ':\\s*(-?\\d+)'))
  return m ? Number(m[1]) : undefined
}

/** 层名 → CSS 变量名（kebab-case） */
const EXPECTED: Array<[keyof typeof LAYERS, string]> = [
  ['groupBase', 'layer-group-base'],
  ['groupNested', 'layer-group-nested'],
  ['edge', 'layer-edge'],
  ['node', 'layer-node'],
  ['nodeSelected', 'layer-node-selected'],
  ['edgeSelected', 'layer-edge-selected'],
  ['tempEdge', 'layer-temp-edge'],
  ['edgeTop', 'layer-edge-top'],
  ['tempNode', 'layer-temp-node'],
  ['nodeToolbar', 'layer-node-toolbar'],
  ['overlay', 'layer-overlay'],
  ['appFloat', 'layer-app-float'],
  ['appChrome', 'layer-app-chrome'],
  ['gesture', 'layer-gesture'],
  ['modal', 'layer-modal'],
  ['modalTop', 'layer-modal-top'],
]

describe('layerTokens：CSS --layer-* 与 LAYERS 同源', () => {
  for (const [layerName, cssVar] of EXPECTED) {
    it(`--${cssVar} 等于 LAYERS.${layerName}`, () => {
      expect(cssValue(cssVar), `ui-theme.css 缺少 --${cssVar}`).toBe(LAYERS[layerName])
    })
  }

  it('每个 LAYERS 键都有对应 CSS 变量（新增层时不会漏掉 CSS 出口）', () => {
    const mapped = new Set(EXPECTED.map(([k]) => k))
    for (const key of Object.keys(LAYERS) as Array<keyof typeof LAYERS>) {
      expect(mapped.has(key), `LAYERS.${key} 没有对应的 --layer-* 变量`).toBe(true)
    }
  })
})
