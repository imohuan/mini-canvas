/**
 * 二级菜单的「穿针」延时（2026-11-01 实测：右键菜单里鼠标穿行会闪退）。
 *
 * trigger="hover" 时，Dropdown 会给整块触发器挂开关，子菜单的 anchor 又指着菜单行；
 * 行和面板之间有空隙，鼠标经过时会先 mouseleave 再 mouseenter，菜单就被关掉。
 * 现在行自己控制开关，离开后等 260ms，进入面板则取消；组件卸载必须清掉定时器。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../components/AxSubMenu.vue', import.meta.url), 'utf-8')

describe('AxSubMenu 悬停延时', () => {
  it('不用 Dropdown 的 hover 触发器，改由行自己延时开关', () => {
    expect(src).toMatch(/trigger="always"/)
    expect(src).not.toMatch(/trigger="hover"/)
    expect(src).toMatch(/@mouseenter="open"/)
    expect(src).toMatch(/@mouseleave="scheduleClose"/)
  })

  it('进入面板取消关闭，离开面板延时关闭', () => {
    expect(src).toMatch(/@mouseenter="cancelClose" @mouseleave="scheduleClose"/)
    expect(src).toMatch(/setTimeout\([\s\S]{0,80}260\)/)
  })

  it('卸载时清掉未触发的关闭定时器', () => {
    expect(src).toMatch(/onBeforeUnmount\(cancelClose\)/)
  })
})
