/**
 * cardFrame —— 卡片边框/选中环宽度的决策契约（纯函数，Node 直接跑）。
 *
 * 背景（用户提问）："我不明白 为什么图片插件会有边框?? 什么地方需要他？"
 * 查明：边框来自**共享外壳**（BaseNode 的 `.v2-card`），本意是让节点从画布背景上浮起来，
 * 同时承载选中态/非法连接的边框高亮。所有节点类型共用，所以它不是图片插件加的。
 * 但对**内容铺满整张卡**的类型（图片）来说，边框只会变成内容边缘一圈多余的缝
 * —— 用户实测到的"图片边上还有一像素边距"就是它。
 *
 * 于是类型可以声明 frameless（"我不要卡片边框"），由类型自己决定，外壳不猜。
 * 本文件锁两件事：
 * 1. frameless 的类型边框宽度为 0（用户要的"图片贴边"）；
 * 2. 去掉边框**不影响选中环** —— 选中环是 ::after 的 box-shadow，本来就不吃边框，
 *    所以图片节点选中了照样看得见（这条是删边框时最容易被忽略的回归点）。
 */
import { describe, it, expect } from 'vitest'
import { resolveCardFrame } from '../cardFrame'

describe('普通类型：保留卡片边框', () => {
  it('边框宽度 = 1px ÷ 缩放（反向缩放，屏幕上恒为 1px）', () => {
    expect(resolveCardFrame({ zoom: 1, frameless: false, selected: false }).borderWidth).toBe('1px')
    expect(resolveCardFrame({ zoom: 0.5, frameless: false, selected: false }).borderWidth).toBe('2px')
    expect(resolveCardFrame({ zoom: 2, frameless: false, selected: false }).borderWidth).toBe('0.5px')
  })

  it('圆角仍是 8px（本次只动边框，圆角不变）', () => {
    expect(resolveCardFrame({ zoom: 1, frameless: false, selected: false }).borderRadius).toBe('8px')
  })

  it('不透明类型：表面 = 外壳默认色，投影保留（连接线从卡片后穿过被挡 = 预期行为）', () => {
    const f = resolveCardFrame({ zoom: 1, frameless: false, selected: false })
    expect(f.surface).toContain('--canvas-node-surface')
    expect(f.shadow).toContain('--canvas-node-shadow-subtle')
    expect(f.contentSurface).toBe('#eee')
  })
})

describe('transparent 类型（分组）：卡片表面透明', () => {
  it('表面 transparent + 无投影（连接线从卡片区域透出来）', () => {
    const f = resolveCardFrame({ zoom: 1, frameless: false, transparent: true, selected: false })
    expect(f.surface).toBe('transparent')
    expect(f.shadow).toBe('none')
    // 内容裁剪层（#eee 兜底底）也要透明 —— 否则选中态 z 提升后照样遮住连线
    expect(f.contentSurface).toBe('transparent')
    // 分组仍要边框（视觉上是"容器"的一圈轮廓）
    expect(f.borderWidth).toBe('1px')
  })

  it('选中环不受影响（与 frameless 同一条契约：环独立于边框/底色）', () => {
    const f = resolveCardFrame({ zoom: 1, frameless: false, transparent: true, selected: true })
    expect(f.outlineWidth).toBe('2px')
  })
})

describe('frameless 类型（图片）：没有边框', () => {
  it('边框宽度为 0（内容贴边，不再有那一圈缝）', () => {
    expect(resolveCardFrame({ zoom: 1, frameless: true, selected: false }).borderWidth).toBe('0px')
  })

  it('任意缩放下都是 0（不会因为 zoom 又冒出边框）', () => {
    for (const zoom of [0.2, 0.5, 1, 2]) {
      expect(resolveCardFrame({ zoom, frameless: true, selected: false }).borderWidth).toBe('0px')
    }
  })

  it('圆角照旧（贴边不等于变直角）', () => {
    expect(resolveCardFrame({ zoom: 1, frameless: true, selected: false }).borderRadius).toBe('8px')
  })
})

describe('选中环不受边框影响（删边框最容易漏的回归点）', () => {
  it('选中 → 环宽 = 2px ÷ 缩放；没选中 → 0', () => {
    expect(resolveCardFrame({ zoom: 1, frameless: false, selected: true }).outlineWidth).toBe('2px')
    expect(resolveCardFrame({ zoom: 2, frameless: false, selected: true }).outlineWidth).toBe('1px')
    expect(resolveCardFrame({ zoom: 1, frameless: false, selected: false }).outlineWidth).toBe('0px')
  })

  it('frameless + 选中 → 环仍然要画出来（图片节点选中必须看得见）', () => {
    expect(resolveCardFrame({ zoom: 1, frameless: true, selected: true }).outlineWidth).toBe('2px')
  })
})

describe('缩放值非法时不产生坏 CSS', () => {
  it('zoom=0 / NaN → 不做除零，回落成 1px 档', () => {
    expect(resolveCardFrame({ zoom: 0, frameless: false, selected: false }).borderWidth).toBe('1px')
    expect(resolveCardFrame({ zoom: Number.NaN, frameless: false, selected: false }).borderWidth).toBe('1px')
  })
})
