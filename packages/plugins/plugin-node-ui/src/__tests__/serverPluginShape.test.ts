/**
 * 后台半的「插件形状」：必须同时导出 name 与 apply。
 *
 * 真实现象（2026-11-05）：把 dist/server.js 放进 server-plugins 后，重启日志是
 *   「后台插件加载失败 plugin-node-ui.js：不是合法后台插件（需导出 name 与 apply）」
 * 于是 /api/node-packages/* 全部 404，前端「导出节点包」只剩一句打包失败。
 * 前端半一直正常，坏掉的是后台半的模块形状 —— 只有真加载一次才看得见。
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../server'

describe('node-ui 后台半的模块形状', () => {
  it('★ 导出 apply（cloud-server 的外挂加载器靠它装插件）', () => {
    expect(typeof apply).toBe('function')
  })

  it('★ 导出 name（加载器按它判「是不是合法后台插件」并去重）', async () => {
    const mod = (await import('../server')) as Record<string, unknown>
    expect(typeof mod.name).toBe('string')
    expect(String(mod.name).trim()).not.toBe('')
  })
})
