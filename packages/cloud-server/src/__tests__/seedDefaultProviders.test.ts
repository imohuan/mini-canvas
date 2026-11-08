/**
 * 随包默认 provider 的铺入规则 —— 只补缺失，绝不覆盖。
 *
 * 为什么这条必须有：provider 是**用户可改的运行时代码**。如果启动时无脑覆盖，
 * 用户改过的模型清单/地址下次启动就没了；反过来如果完全不铺，装包的人拿到一个
 * 空的 providers 目录，"装完就能生成"也就不成立。
 */
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { seedDefaultProviders } from '../providers/load'

async function tmpdir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

describe('seedDefaultProviders', () => {
  it('把源目录的 .js 复制到目标（目录不存在就建）', async () => {
    const src = await tmpdir('providers-src-')
    const dst = path.join(await tmpdir('providers-dst-'), 'providers')
    await fs.writeFile(path.join(src, 'a.js'), 'export default {}', 'utf8')
    await fs.writeFile(path.join(src, 'b.js'), 'export default {}', 'utf8')
    // 非 .js 与下划线开头的不参与
    await fs.writeFile(path.join(src, 'README.md'), 'x', 'utf8')
    await fs.writeFile(path.join(src, '_wip.js'), 'x', 'utf8')

    const copied = await seedDefaultProviders(src, dst)
    expect(copied.sort()).toEqual(['a.js', 'b.js'])
    expect((await fs.readdir(dst)).sort()).toEqual(['a.js', 'b.js'])
  })

  it('目标已存在的同名文件不覆盖（用户改过的优先）', async () => {
    const src = await tmpdir('providers-src-')
    const dst = await tmpdir('providers-dst-')
    await fs.writeFile(path.join(src, 'a.js'), 'default version', 'utf8')
    await fs.writeFile(path.join(dst, 'a.js'), 'user version', 'utf8')

    const copied = await seedDefaultProviders(src, dst)
    expect(copied).toEqual([])
    expect(await fs.readFile(path.join(dst, 'a.js'), 'utf8')).toBe('user version')
  })

  it('源目录不存在时返回空，不抛（没随包默认件也算正常）', async () => {
    const dst = await tmpdir('providers-dst-')
    const copied = await seedDefaultProviders(path.join(dst, 'nope'), dst)
    expect(copied).toEqual([])
  })
})
