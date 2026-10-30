/**
 * 上传弹窗关闭时必须回收本地预览的 objectURL。
 *
 * 现状：选图时给每张图 createObjectURL 当缩略图，只有「单张移除」和「保存成功」两条路会 revoke。
 * 用户最常见的动作是**选完图直接关窗**（Esc / 取消 / 点遮罩）—— 这批 objectURL 一直活着，
 * 每张都钉着一份完整的图片字节。多试几次选大图，标签页内存就下不来。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../components/AssetUploadDialog.vue', import.meta.url), 'utf-8')

describe('上传弹窗关闭时回收预览地址', () => {
  it('onBeforeUnmount 里 revoke 掉所有本地预览', () => {
    const from = source.indexOf('onBeforeUnmount(')
    expect(from, '找不到 onBeforeUnmount').toBeGreaterThan(-1)
    const block = source.slice(from, source.indexOf('\n})', from) + 3)
    expect(block, '卸载时没有回收 objectURL（选完图直接关窗会泄漏）').toMatch(/revokeObjectURL/)
  })
})
