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
    // 清单里要有 plugin-node-ui；它的 build 脚本自己会跑 build:server（不靠人手工 deploy）
    expect(src).toMatch(/BUILTIN_SERVER_PLUGINS\s*=\s*\[[^\]]*plugin-node-ui/)
    const pkg = JSON.parse(
      readFileSync(path.join(REPO, 'packages/plugins/plugin-node-ui/package.json'), 'utf8'),
    )
    expect(pkg.scripts.build).toMatch(/build-server\.mjs|build:server/)
    // 2026-11-12：不再往数据根复制插件，所以这里只核对「产物确实在 assets 里」的检查存在
    expect(src).toMatch(/assets.*plugins.*dist.*server\.js/s)
  })

  it('后台半缺失时明确报错（不静默跳过，让 404 变成看得懂的构建失败）', () => {
    const src = readFileSync(SCRIPT, 'utf8')
    expect(src).toMatch(/dist\/server\.js/)
    expect(src).toMatch(/process\.exit\(1\)/)
  })

  it('★ 每个插件都收进 assets/plugins（不再只收 cloud-client 一个）', () => {
    // 用户口径：发布包里每个插件都要有产物，界面包一个插件都不内置。
    // 旧脚本只收 cloud-client，其余插件「仓库里有、发布包里没有」，发出去就少功能。
    const src = readFileSync(SCRIPT, 'utf8')
    expect(src).toMatch(/plugin-assets\.mjs/)
    expect(src).toMatch(/collectPlugins\(\)/)
    expect(src).toMatch(/copyPluginDir\(/)
    // 与发布打包共用同一套规则：两份入口产物必须同形
    const shared = readFileSync(path.join(REPO, 'packages/cloud-server/scripts/plugin-assets.mjs'), 'utf8')
    // 产物按作者声明的相对路径复制（名字是自由，配置是事实源）
    expect(shared).toMatch(/copyKeepingDirs/)
    expect(shared).toMatch(/plume\.server\.entry|plume\?\.server\?\.entry/)
    expect(shared).toMatch(/plume\.pluginName/)
  })

  it('构建只核对「后台半在 assets 里」，不再往数据根复制（全局目录优先、随包兜底）', () => {
    const src = readFileSync(SCRIPT, 'utf8')
    expect(src).toMatch(/ASSETS, "plugins", d, "dist", "server\.js"/)
    // 不该再出现往 server-plugins 写文件的代码
    expect(src).not.toMatch(/serverPluginsDir\s*=\s*path\.join\(DATA_ROOT/)
  })

  it('★ 插件声明 plume.assets 的附加目录要跟着发（否则 goal hook 静默缺席）', () => {
    // 真实现象（2026-11-12）：plugin-agent 的 vendor-plugins/ 没被收进 assets，
    // 启动日志是「goal hook 未安装：插件库里没有 goal」，目标功能静默缺失。
    const shared = readFileSync(path.join(REPO, 'packages/cloud-server/scripts/plugin-assets.mjs'), 'utf8')
    expect(shared).toMatch(/plume\.assets|plume\?\.assets/)
    expect(shared).toMatch(/copyDeclaredAssets/)

    const agentPkg = JSON.parse(
      readFileSync(path.join(REPO, 'packages/plugins/plugin-agent/package.json'), 'utf8'),
    ) as { plume?: { assets?: unknown } }
    const assets = agentPkg.plume?.assets
    expect(Array.isArray(assets), 'plugin-agent 要在 plume.assets 里声明 vendor-plugins').toBe(true)
    expect(assets).toContain('dist/vendor-plugins')
  })
})
