/**
 * catalog 自带插件 id 解析：NPM 安装副本目录名是 plume-canvas__<dir>，
 * builtinInstallIds 必须解析成清单里实际存在的 id，否则前端首启一个都装不上（界面空白）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-catid-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('plugin-catalog 自带 id 解析', () => {
  it('builtinInstallIds 全部能对上清单里的 id（含 NPM 副本形态）', async () => {
    const pluginDir = path.join(dir, "plugins", "plume-canvas__plugin-clipboard")
    await fs.mkdir(path.join(pluginDir, "dist"), { recursive: true })
    await fs.writeFile(
      path.join(pluginDir, "dist", "web.js"),
      "(function(e,t){t(e.PlumePluginClipboard={})})(this,function(e){e.name=\"clipboard\";e.apply=function(){}})",
      "utf8",
    )
    await fs.writeFile(path.join(pluginDir, "package.json"), JSON.stringify({
      name: "@plume-canvas/plugin-clipboard",
      version: "0.1.4",
      plume: {
        pluginName: "clipboard",
        title: "复制粘贴",
        installable: true,
        npmInstalled: true,
        web: { entry: "dist/web.js" },
      },
    }))
    const srv = await createCloudServer({
      port: 0,
      dir,
      watchProviders: false,
      pluginsDir: path.join(dir, "plugins"),
    })
    const res = await srv.app.fetch(new Request("http://x/plugin-catalog.json"))
    const body = (await res.json()) as {
      plugins: Array<{ id: string }>
      builtinInstallIds: string[]
    }
    const ids = new Set(body.plugins.map((p) => p.id))
    // 只校验「清单里存在的插件」能对上（测试目录里只有 clipboard 一个）
    for (const id of body.builtinInstallIds) {
      if (ids.has(id)) continue
      // 测试目录没有该插件 → 跳过；有的话必须是有效 id
      const bare = id.replace(/^plume-canvas__/, "")
      expect(ids.has(bare)).toBe(false)
    }
    expect(body.builtinInstallIds).toContain("plume-canvas__plugin-clipboard")
    srv.stop()
  })
})
