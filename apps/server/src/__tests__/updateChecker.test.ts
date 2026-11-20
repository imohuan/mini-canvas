/**
 * updateChecker —— 更新检查器（发布体系 Task 2）。
 *
 * 只提示不自动装（用户口径 2026-11-20）：
 * checkAll 汇总「已装插件 + server 自身」的最新版与本地版比对，
 * 有新版就列出来；装不装由用户在插件管理页手动决定。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compareVersions, createUpdateChecker } from '../updater/checker.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-checker-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('compareVersions', () => {
  it('1.2.0 < 1.3.0', () => expect(compareVersions('1.2.0', '1.3.0')).toBe(-1))
  it('1.0.0 = 1.0.0', () => expect(compareVersions('1.0.0', '1.0.0')).toBe(0))
  it('2.0.0 > 1.9.9', () => expect(compareVersions('2.0.0', '1.9.9')).toBe(1))
  it('1.0.0-beta 与 1.0.0（有后缀按小处理）', () => expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1))
})

/** 假 npmClient：packument 恒返回 latest=2.0.0 */
const fakeClient = (latestMap: Record<string, string>) => ({
  packument: async (name: string) => ({
    name,
    'dist-tags': { latest: latestMap[name] ?? '0.0.0' },
    versions: { [latestMap[name] ?? "0.0.0"]: { version: latestMap[name] ?? "0.0.0", tarball: "x" } },
    time: {},
  }),
})

describe('createUpdateChecker', () => {
  it('已装插件有新版 → 报告列出', async () => {
    const rec = path.join(dir, '.npm-installed.json')
    await fs.writeFile(rec, JSON.stringify({ 'plugin-a': { pkg: 'plugin-a', version: '1.0.0', installedAt: '2026-01-01' } }))
    const checker = createUpdateChecker({
      npmClient: fakeClient({ "plugin-a": "2.0.0" }),
      installedRecordFile: rec,
      serverPkgName: "@plume-canvas/server",
      currentServerVersion: "0.1.0",
      builtinManifest: { plugins: { "plugin-a": "latest" } },
    })
    const report = await checker.checkAll()
    expect(report.plugins).toContainEqual({ pkg: 'plugin-a', local: '1.0.0', latest: '2.0.0', builtin: true })
  })

  it('已是最新 → 不进报告', async () => {
    const rec = path.join(dir, '.npm-installed.json')
    await fs.writeFile(rec, JSON.stringify({ 'plugin-a': { pkg: 'plugin-a', version: '2.0.0', installedAt: '2026-01-01' } }))
    const checker = createUpdateChecker({
      npmClient: fakeClient({ "plugin-a": "2.0.0" }),
      installedRecordFile: rec,
      serverPkgName: "@plume-canvas/server",
      currentServerVersion: "0.1.0",
      builtinManifest: { plugins: {} },
    })
    const report = await checker.checkAll()
    expect(report.plugins).toEqual([])
  })

  it('server 有新版 → report.server 出现', async () => {
    const rec = path.join(dir, '.npm-installed.json')
    await fs.writeFile(rec, JSON.stringify({}))
    const checker = createUpdateChecker({
      npmClient: fakeClient({ "@plume-canvas/server": "0.2.0" }),
      installedRecordFile: rec,
      serverPkgName: "@plume-canvas/server",
      currentServerVersion: "0.1.0",
      builtinManifest: { plugins: {} },
    })
    const report = await checker.checkAll()
    expect(report.server).toEqual({ current: '0.1.0', latest: '0.2.0' })
  })

  it('packument 查失败的单项跳过，不炸整体', async () => {
    const rec = path.join(dir, '.npm-installed.json')
    await fs.writeFile(rec, JSON.stringify({ 'plugin-a': { pkg: 'plugin-a', version: '1.0.0', installedAt: '2026-01-01' } }))
    const badClient = {
      packument: async () => { throw new Error("network down") },
    }
    const checker = createUpdateChecker({
      npmClient: badClient,
      installedRecordFile: rec,
      serverPkgName: "@plume-canvas/server",
      currentServerVersion: "0.1.0",
      builtinManifest: { plugins: {} },
    })
    const report = await checker.checkAll()
    expect(report.plugins).toEqual([])
    expect(report.server).toBeUndefined()
  })
})
