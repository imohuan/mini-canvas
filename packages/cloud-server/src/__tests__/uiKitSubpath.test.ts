/**
 * 托管产物里的子页面（/ui-kit/）：要发它自己的 index.html，不能回落成主页面。
 *
 * 为什么要有这条（用户 2026-11-06）：项目页「组件库」用 iframe 打开 /ui-kit/。
 * 原先 readWithin('/ui-kit/') 会去读一个目录，读失败就继续往下，
 * 最后回落到 ui 的主 index.html —— iframe 里嵌套了一个完整的画布应用（套娃 + 无限加载）。
 * 目录要补成目录下的 index.html；补完仍不存在才回落。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { uiRoutes } from '../static.js'

let dir = ''

async function seed(files: Record<string, string>): Promise<string> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-kit-subpath-'))
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, body, 'utf8')
  }
  return dir
}

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
  dir = ''
})

describe('托管 /ui-kit/ 子页面', () => {
  it('目录请求发子页面的 index.html', async () => {
    const dist = await seed({
      'index.html': '<!doctype html><html><body>MAIN</body></html>',
      'ui-kit/index.html': '<!doctype html><html><body>KIT</body></html>',
    })
    const res = await uiRoutes(dist).request('http://x.test/ui-kit/')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('KIT')
    expect(text).not.toContain('MAIN')
  })

  it('不带结尾斜杠也能取到子页面', async () => {
    const dist = await seed({
      'index.html': '<!doctype html><html><body>MAIN</body></html>',
      'ui-kit/index.html': '<!doctype html><html><body>KIT</body></html>',
    })
    const res = await uiRoutes(dist).request('http://x.test/ui-kit')
    const text = await res.text()
    expect(text).toContain('KIT')
  })

  it('子页面的资源与路由都从自己的目录取', async () => {
    const dist = await seed({
      'index.html': '<!doctype html><html><body>MAIN</body></html>',
      'ui-kit/index.html': '<!doctype html><html><body>KIT</body></html>',
      'ui-kit/assets/app.js': 'console.log(1)',
    })
    const js = await uiRoutes(dist).request('http://x.test/ui-kit/assets/app.js')
    expect(js.status).toBe(200)
    expect(await js.text()).toContain('console.log(1)')

    const deep = await uiRoutes(dist).request('http://x.test/ui-kit/some/deep/route')
    expect(await deep.text()).toContain('KIT')
  })
})
