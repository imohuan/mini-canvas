/**
 * 浮层互斥的「同组豁免」契约（用户 2026-11-18 报的 BUG）。
 *
 * 现场：底栏参数面板里再点一个下拉，**第二次**点它的触发器时整个参数面板会消失。
 *
 * 根因不在点击拦截上，而在互斥表：链（谁在谁里面打开的）是靠 provide/inject
 * 往下传的，而插槽内容不属于外层浮层组件的子孙 —— ToolParamGroup 把参数控件放进
 * <Popover> 的默认插槽，那些 Select 的组件父级是 ToolParamGroup，inject 拿不到
 * Popover 提供的链。内层下拉于是认为「我跟它没关系」，打开时把参数面板一起关掉。
 *
 * 这里钉住两件事：
 *   1. 同一组（面板 + 面板里的下拉）不互相关闭；
 *   2. 不相干的兄弟浮层仍然互斥（不能因为放宽就变成「可以同时开两个菜单」）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { samePopupGroup } from '../theme/popup/exclusive'

const GROUP = { plumeCanvasGroup: true }
const PANEL = { token: 'panel' }
const INNER = { token: 'inner' }
const SIBLING = { token: 'sibling' }

describe('浮层互斥：同组豁免', () => {
  it('面板与面板里的下拉属于同一组', () => {
    // 面板自己的链带着组 token；内层下拉从面板子树里拿到同一条链
    expect(samePopupGroup([GROUP, PANEL], [GROUP, INNER])).toBe(true)
  })

  it('不相干的两个浮层不属于同一组（互斥仍然生效）', () => {
    expect(samePopupGroup([GROUP, PANEL], [SIBLING])).toBe(false)
    expect(samePopupGroup([PANEL], [SIBLING])).toBe(false)
  })

  it('组 token 只认带了标记的那个，不会被普通 token 冒充', () => {
    expect(samePopupGroup([{ plumeCanvasGroup: false }], [{ plumeCanvasGroup: false }])).toBe(false)
  })
})

describe('互斥表真的接上了分组判定', () => {
  const src = readFileSync(new URL('../theme/popup/exclusive.ts', import.meta.url), 'utf-8')
  const claim = src.slice(src.indexOf('export function claimExclusive'), src.indexOf('export function releaseExclusive'))

  it('claim 时跳过同组浮层', () => {
    expect(claim, '没有同组豁免，内层下拉会把参数面板关掉').toMatch(/samePopupGroup\(entry\.chain, other\.chain\)/)
  })

  it('同组豁免写在关闭动作之前（否则已经关了再 continue 没用）', () => {
    const skip = claim.indexOf('samePopupGroup')
    const close = claim.indexOf('other.close()')
    expect(skip).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(-1)
    expect(skip).toBeLessThan(close)
  })
})
