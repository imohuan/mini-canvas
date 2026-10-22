/**
 * 工具卡片「极端长文字」契约（用户实测 2026-10-22，截图里标题被挤成两行、
 * 紫色徽章撑出卡片外）。
 *
 * 根因：卡片头行是 flex 行，但标题与徽章都没有单行约束 —— 徽章带着一长串
 * 「节点名 · #id」不肯缩，把标题挤成竖排或两行；徽章自身也不裁，直接越过卡片右缘。
 *
 * 本文件锁三件事（包内 vitest 跑 node 环境，样式只能源码级守卫）：
 *   ① 头行三段：标题与徽章都必须单行省略，且都能缩（min-width: 0）；
 *   ② 头行容器要允许收缩（min-width: 0），否则子项再写 min-width 也白搭；
 *   ③ 同一张卡片里的其它单行文字（媒体标题 / 副标题、行标签、类型统计、
 *      详情里的工具名）都带省略号，极端长文本不会撑出卡片。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const body = readFileSync(path.resolve(HERE, '../components/ToolViewBody.vue'), 'utf8')

/** 取一条以 selector 开头的样式块（只在本文件里用，够简单） */
function rule(selector: string): string {
  const at = body.indexOf(selector + ' {')
  expect(at, '找不到样式块：' + selector).toBeGreaterThanOrEqual(0)
  const end = body.indexOf('}', at)
  return body.slice(at, end + 1)
}

describe('工具卡片：极端长文字不撑破卡片（用户截图 2026-10-22）', () => {
  it('头行容器能收缩（min-width: 0），子项才有机会省略', () => {
    expect(rule('.tvc-head')).toContain('min-width: 0')
  })

  it('标题单行省略：white-space / overflow / text-overflow 三件齐全', () => {
    const title = rule('.tvc-title')
    expect(title).toContain('white-space: nowrap')
    expect(title).toContain('overflow: hidden')
    expect(title).toContain('text-overflow: ellipsis')
    expect(title).toContain('min-width: 0')
  })

  it('徽章是单行胶囊：限宽 + 省略号，长「节点名 · #id」不会越出卡片右缘', () => {
    const badges = [...body.matchAll(/\.tvc-badge \{([^}]*)\}/g)].map((m) => m[1])
    expect(badges.length).toBeGreaterThan(0)
    const all = badges.join('\n')
    expect(all).toContain('white-space: nowrap')
    expect(all).toContain('overflow: hidden')
    expect(all).toContain('text-overflow: ellipsis')
    // 可压缩：不写 min-width:0 时，flex 子项的最小宽度是内容宽，省略号永远不出现
    expect(all).toContain('min-width: 0')
    expect(all).toContain('max-width')
  })

  it('卡片内其余单行文本都有省略号（媒体标题 / 副标题、行标题 / 副标题、类型统计、工具名）', () => {
    for (const sel of [
      '.tvc-media-title',
      '.tvc-media-sub',
      '.tvc-row-title',
      '.tvc-row-sub',
      '.tvc-img-sum',
      '.tvc-details-tool',
    ]) {
      const r = rule(sel)
      expect(r, sel + ' 缺少 text-overflow').toContain('text-overflow: ellipsis')
      expect(r, sel + ' 缺少 nowrap').toContain('white-space: nowrap')
    }
  })

  it('进度文字（任务 message 可能是一整句）单行省略，不挤掉进度条', () => {
    const text = rule('.tvc-progress-text')
    expect(text).toContain('min-width: 0')
    expect(text).toContain('max-width')
    expect(text).toContain('overflow: hidden')
    expect(text).toContain('text-overflow: ellipsis')
    expect(text).toContain('white-space: nowrap')
  })

  it('窄卡片兜底：卡片根 / 内容区 / 媒体行都允许收缩（min-width: 0）', () => {
    for (const sel of ['.tvc', '.tvc-body', '.tvc-media', '.tvc-media-text']) {
      expect(rule(sel), sel + ' 缺少 min-width: 0').toContain('min-width: 0')
    }
  })

  it('行尾标签不无限长：限宽 + 省略号（tag 是用户/画布给的名字，可能很长）', () => {
    const tag = rule('.tvc-row-tag')
    expect(tag).toContain('max-width')
    expect(tag).toContain('white-space: nowrap')
    expect(tag).toContain('text-overflow: ellipsis')
  })
})
