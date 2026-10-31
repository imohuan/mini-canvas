/**
 * `tone: 'info'` 必须真的能用（文档、预览、CSS 都按这个值写）。
 *
 * 这个测试守三件事：类型里有 info、notify 卡片有 is-info 样式、messages 有 is-info 样式。
 * 少了任何一件，用户照抄示例就会得到「类型报错」或「选了 info 和默认没区别」。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(resolve(here, rel), 'utf-8')

describe('info 色调是完整的一档', () => {
  it('UiKitTone 包含 info', () => {
    const types = read('../../shared/types.ts')
    expect(types, "类型里没有 'info'，但文档与预览都在用").toMatch(/UiKitTone[\s\S]{0,160}'info'/)
  })

  it('notify 有 is-info 样式（否则选 info 与默认没有区别）', () => {
    expect(read('../notify/notify.css')).toMatch(/\.mck-notify\.is-info\b/)
    // 卡片通过 NotifyCard.vue 渲染；tone 必须落到 class 上，才能命中上面的样式。
    expect(read('../notify/NotifyCard.vue')).toMatch(/'is-' \+ tone/)
  })

  it('messages 有 is-info 样式', () => {
    expect(read('../messages/messages.css')).toMatch(/\.mck-message\.is-info\b/)
  })
})
