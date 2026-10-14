/**
 * 脚本的「下划线 = 未验证」约定（用户 2026-10-14 口径）。
 *
 * 生产环境踩到的真问题：Agent 每次写脚本前先看清单，但清单里混着**半成品**与
 * **老 API 版本的脚本** —— 拿起来一调就失败，白费一轮。
 * 三条规则：① 新脚本文件名先加下划线；② 跑通才去掉；③ 工具只列**不带**下划线的。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DRAFT_PREFIX, isDraftScriptName, listAllScriptNames, listScriptNames, toDraftName } from '../task/scripts'
import { listDraftScripts, listFunctions } from '../task/runs'

let dir = ''

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-draft-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('下划线的判据', () => {
  it('前缀是下划线；只认打头的', () => {
    expect(DRAFT_PREFIX).toBe('_')
    expect(isDraftScriptName('_scale')).toBe(true)
    expect(isDraftScriptName('scale')).toBe(false)
    expect(isDraftScriptName('sc_ale')).toBe(false)
  })

  it('toDraftName：把已验证的名字变成在建的（已在建则原样）', () => {
    expect(toDraftName('scale')).toBe('_scale')
    expect(toDraftName('_scale')).toBe('_scale')
  })
})

describe('★ 两份清单：可用 vs 全部', () => {
  beforeEach(async () => {
    await fs.writeFile(path.join(dir, 'scale.mjs'), 'export const run = () => 1\n')
    await fs.writeFile(path.join(dir, '_wip.mjs'), 'export const run = () => 2\n')
    await fs.writeFile(path.join(dir, '.hidden.mjs'), 'export const run = () => 3\n')
  })

  it('listScriptNames（给 AI 的**可用**清单）只含不带下划线的', async () => {
    expect(await listScriptNames(dir)).toEqual(['scale'])
  })

  it('listAllScriptNames（作者调试用）连在建的一起给，隐藏文件仍不看', async () => {
    expect(await listAllScriptNames(dir)).toEqual(['_wip', 'scale'])
  })
})

describe('★ listFunctions 过滤在建脚本（生产踩的那个坑）', () => {
  beforeEach(async () => {
    await fs.writeFile(
      path.join(dir, 'scale.mjs'),
      ['export const docs = { run: { what: "已验证的" } }', 'export async function run() { return 1 }', ''].join('\n'),
    )
    // 半成品：本该不被人拿去做东西
    await fs.writeFile(
      path.join(dir, '_wip.mjs'),
      ['export const docs = { run: { what: "半成品" } }', 'export async function run() { throw new Error("没写完") }', ''].join('\n'),
    )
  })

  it('只列已验证的脚本 —— 半成品不出现在"可发现"清单里', async () => {
    const fns = await listFunctions(dir)
    expect(fns.map((f) => f.script)).toEqual(['scale'])
  })

  it('listDraftScripts 单独把在建的列出来（作者要看自己还有哪些没验完）', async () => {
    const drafts = await listDraftScripts(dir)
    expect(drafts.map((d) => d.name)).toEqual(['_wip'])
    expect(drafts[0].methods).toEqual(['run'])
  })
})
