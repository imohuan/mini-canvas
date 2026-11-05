/**
 * 自带插件的后台半（dist/server.js）必须随构建一起落进数据目录的 server-plugins。
 *
 * 真实现象（2026-11-05，分支 codex/app-shell-layering）：右键「导出节点包」
 * 报 `打包失败（HTTP 403）` / 后台直接 404 `接口不存在: /api/node-packages/build`。
 * 原因是 plugin-node-ui 是「自带」插件，前端随应用冷启动，后台半却只有当人手工跑
 * `deploy:server` 时才装得进去 —— 一键启动脚本里没有这一步。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../..')
const SCRIPT = path.join(REPO, 'packages/cloud-server/scripts/build-assets-parallel.mjs')

describe('自带后台半随构建部署', () => {
  it('★ 构建资源时把 plugin-node-ui 的后台半放进 server-plugins', () => {
    const src = readFileSync(SCRIPT, 'utf8')
    // 要真的调用构建 + 复制，而不是只在注释里提一句
    // 清单里要有 plugin-node-ui；构建任务真的跑它的 build:server（不靠人手工 deploy）
    expect(src).toMatch(/BUILTIN_SERVER_PLUGINS\s*=\s*\[[^\]]*plugin-node-ui/)
    expect(src).toMatch(/script:\s*"build:server"/)
    expect(src).toMatch(/server-plugins/)
    expect(src).toMatch(/copyFile|cp\(/)
  })

  it('后台半缺失时明确报错（不静默跳过，让 404 变成看得懂的构建失败）', () => {
    const src = readFileSync(SCRIPT, 'utf8')
    expect(src).toMatch(/dist\/server\.js/)
    expect(src).toMatch(/process\.exit\(1\)/)
  })
})
