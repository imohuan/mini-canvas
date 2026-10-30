/**
 * cloud-client 的设置订阅必须随插件卸载退掉（2026-10-30 扫描发现）。
 *
 * apply() 里 `settings.onChange(...)` 的返回值被丢掉了：插件热卸之后它还在听
 * settings，用户改一次「服务地址」就会调一次已经卸载的 api 实例（reloadActions）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../plugin.ts', import.meta.url), 'utf-8')

describe('cloud-client 设置订阅', () => {
  it('onChange 的句柄被接住，并在 ctx.effect 清理里 dispose', () => {
    expect(src, 'onChange 的返回值又被丢掉了').not.toMatch(/^\s*settings\?\.onChange\?\.\(\(key, value\)/m)
    expect(src, '没有接住 settings.onChange 的句柄').toMatch(/const offSettings\s*=\s*settings\?\.onChange/)
    const cleanup = src.slice(src.indexOf('ctx.effect(() => () => {'), src.indexOf('export const cloudClientPlugin'))
    expect(cleanup, '卸载时没有退设置订阅').toMatch(/offSettings\?\.dispose\?\.\(\)/)
  })
})
