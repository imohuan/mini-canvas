/**
 * 风格库 / 特效库的「资源目录」空值时要有占位提示。
 *
 * 真实现象（2026-11-05 截图）：风格库资源目录输入框是空的，右边紧挨着
 * 特效库资源目录却有值。两个字段的默认值都在代码里（I:/Assets/...），
 * 但输入框显示的是**当前保存值**；保存成空串后，框里就什么都没有。
 * 不给占位提示时，用户分不清「没填」「填了空」「默认值是多少」。
 */
import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_EFFECT_ROOT, DEFAULT_ROOT } from './index'

describe('素材库目录字段的占位提示', () => {
  it('★ 风格库目录空着时提示默认路径', () => {
    expect(Config.styleLibraryRoot.placeholder).toBe(DEFAULT_ROOT)
  })

  it('★ 特效库目录同理', () => {
    expect(Config.effectLibraryRoot.placeholder).toBe(DEFAULT_EFFECT_ROOT)
  })
})
