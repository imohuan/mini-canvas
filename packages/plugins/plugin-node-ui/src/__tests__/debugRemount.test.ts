/**
 * 调试连接 · 前端半的行为锁（源码守卫，真机自动化测试抓到的 bug）：
 *
 * 「点了同意调试，SDK 还是连不上」—— frameDoc 在调试态翻转时追加了 SDK 脚本，
 * 但 iframe 只换 srcdoc 属性时浏览器**不会重跑脚本**；重挂（key=gen）只挂在
 * html 变化上，调试态翻转漏了 → SDK 永远不执行。锁死：frameDoc 变化必须 gen+1。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const host = readFileSync(path.resolve(HERE, '../UiContent.vue'), 'utf8')

describe('调试态切换必须重挂 iframe', () => {
  it('frameDoc 变化 → gen+1（重挂），与 html 变化同款', () => {
    expect(host).toMatch(/watch\(frameDoc, \(\) => \{ gen\.value \+= 1 \}\)/)
    // 且重挂注释说明根因（防止未来被当冗余删掉）
    expect(host).toContain('浏览器**不会重跑脚本**')
  })
})
