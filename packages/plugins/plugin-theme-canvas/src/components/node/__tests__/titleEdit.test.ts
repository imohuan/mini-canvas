/**
 * titleEdit.test —— 标题就地改名的纯逻辑契约。
 *
 * 两条都是"踩过坑才写下来"的规则，单测锁死语义：
 * - 标题是单行：粘贴/输入里的换行必须收敛成空格，否则 contenteditable 会长出多行把行高撑破。
 * - 进编辑时"适当聚焦"= 只在节点没完整露在视野里才挪视图，避免每次改名都强行滚动画布。
 */
import { describe, it, expect } from 'vitest'
import { isRectFullyVisible, normalizeTitleText, resolveTitleText } from '../titleEdit'

describe('resolveTitleText（标题元素此刻该显示什么）', () => {
  it('非编辑态：显示外部 label', () => {
    expect(resolveTitleText(false, '文本', '草稿')).toBe('文本')
  })

  it('编辑中：显示草稿，不被外部 label 覆盖（用户正在打的字不能被抹掉）', () => {
    expect(resolveTitleText(true, '文本', '我改了一半')).toBe('我改了一半')
  })

  it('编辑中即便外部 label 变了，也以草稿为准', () => {
    expect(resolveTitleText(true, '被外部改了', '用户在打的')).toBe('用户在打的')
  })

  it('非编辑态且 label 为空 → 空串（不渲染 undefined）', () => {
    expect(resolveTitleText(false, undefined, '')).toBe('')
  })
})

describe('normalizeTitleText（标题文本归一化，单行）', () => {
  it('去掉首尾空白', () => {
    expect(normalizeTitleText('  文本  ')).toBe('文本')
  })

  it('换行/回车收敛成单个空格（标题只有一行）', () => {
    expect(normalizeTitleText('第一行\n第二行')).toBe('第一行 第二行')
    expect(normalizeTitleText('第一行\r\n第二行')).toBe('第一行 第二行')
  })

  it('制表符与连续空白收敛成单个空格', () => {
    expect(normalizeTitleText('a\t\t b')).toBe('a b')
    expect(normalizeTitleText('a    b')).toBe('a b')
  })

  it('contenteditable 常见的 &nbsp;（\u00a0）按空白处理', () => {
    expect(normalizeTitleText('文本\u00a0\u00a0图片')).toBe('文本 图片')
  })

  it('全空白归一成空串（调用方据此清除自定义标题）', () => {
    expect(normalizeTitleText('   ')).toBe('')
    expect(normalizeTitleText('\n')).toBe('')
  })
})

describe('isRectFullyVisible（进编辑时判断要不要挪视图）', () => {
  const view = { x: 0, y: 0, w: 800, h: 600 }

  it('完全在视野内 → true', () => {
    expect(isRectFullyVisible({ x: 100, y: 100, w: 200, h: 120 }, view)).toBe(true)
  })

  it('与视野边缘正好齐平 → 仍算可见（不必挪视图）', () => {
    expect(isRectFullyVisible({ x: 0, y: 0, w: 800, h: 600 }, view)).toBe(true)
  })

  it('任一边越界 → false', () => {
    expect(isRectFullyVisible({ x: -1, y: 100, w: 200, h: 120 }, view)).toBe(false)
    expect(isRectFullyVisible({ x: 100, y: -1, w: 200, h: 120 }, view)).toBe(false)
    expect(isRectFullyVisible({ x: 700, y: 100, w: 200, h: 120 }, view)).toBe(false)
    expect(isRectFullyVisible({ x: 100, y: 500, w: 200, h: 120 }, view)).toBe(false)
  })

  it('pad 收缩判定：边缘贴近时按预留余量算越界（标题在卡片上方，需要留白）', () => {
    const nearTop = { x: 100, y: 10, w: 200, h: 120 }
    expect(isRectFullyVisible(nearTop, view, 0)).toBe(true)
    expect(isRectFullyVisible(nearTop, view, 24)).toBe(false)
  })
})
