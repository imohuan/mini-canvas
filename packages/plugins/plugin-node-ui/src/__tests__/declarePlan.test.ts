/**
 * planDeclared —— 写界面时"顺手补声明"的那一步（双保险的兜底）。
 *
 * 为什么必须测它：AI 会忘写声明，忘了的后果是"界面画出来了、点一下 403"。
 * 这条兜底一旦静默失效，坏法极其难查（界面看着完全正常）。
 *
 * 注意这里测的是**纯计算**：读节点已经被移出本模块 —— 第一版让本模块自己去读 doc，
 * 真机上那条路读不到东西、静默什么都不做（2026-10-13 踩到）。
 * 现在输入是"HTML + 现有声明"，输出是"该写成什么"，读与写都归调用方。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planDeclared } from '../task/declarePlan'

let dir = ''

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-plan-'))
  await fs.writeFile(path.join(dir, 'scale.mjs'), 'export const run = () => 1\n')
  await fs.writeFile(path.join(dir, 'crop.mjs'), 'export const run = () => 1\n')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const CALL_SCALE = 'fetch(b, { body: JSON.stringify({ type: "call", name: "scale", methods: "run" }) })'

describe('planDeclared —— 算出"写完界面后声明该长什么样"', () => {
  it('界面调了 scale、节点没声明 → 给出新声明，added 只报新补的那个', async () => {
    const plan = await planDeclared(CALL_SCALE, undefined, dir, 1000)
    expect(plan).not.toBeNull()
    expect(plan!.added).toEqual(['scale'])
    expect(Object.keys(plan!.next)).toEqual(['scale'])
    // 声明里带上内容摘要：打包时据此判断"本机那份和包里那份是不是同一个"
    expect(plan!.next.scale.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('AI 自己已经声明过 → 返回 null（调用方一个字都不写）', async () => {
    expect(await planDeclared(CALL_SCALE, { scale: { sha256: 'keep-me' } }, dir, 1000)).toBeNull()
  })

  it('新增一个没声明过的 → 只补那一个，老条目的哈希原样保留', async () => {
    const plan = await planDeclared('{ name: "scale" }, { name: "crop" }', { scale: { sha256: 'old' } }, dir, 1000)
    expect(plan).not.toBeNull()
    expect(plan!.added).toEqual(['crop'])
    expect(plan!.next.scale.sha256).toBe('old')
    expect(Object.keys(plan!.next).sort()).toEqual(['crop', 'scale'])
  })

  it('界面里没有已知脚本名 → null（"顺手补"绝不变成"顺手改数据"）', async () => {
    expect(await planDeclared('<div>{ name: "我的输入框" }</div>', undefined, dir, 1000)).toBeNull()
  })

  it('脚本目录不存在 → null（不炸、也不凭空造声明）', async () => {
    expect(await planDeclared(CALL_SCALE, undefined, path.join(dir, '没有这个目录'), 1000)).toBeNull()
  })
})

