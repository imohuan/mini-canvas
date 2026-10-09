/**
 * 工具记录的落盘与回放 —— 用户口径（2026-10-03）：
 *   「刷新之后，这边的效果像是正在加载的状态，都不对」。
 *
 * 根因：转录里工具只存了一行 text，回放时分不出
 *   · 还在跑 / 早就跑完（界面据此画转圈还是画结果）；
 *   · 原本是卡片（要审批的重活）还是紧凑一行。
 * 于是刷新后每条历史工具都变成一个转圈的卡片。
 * 这里把「结构化存 + 原地补 output + 收尾打完成标记」三件事钉住。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentSessionStore } from '../agent/sessionStore'

let dir: string
let store: AgentSessionStore

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-' + 'tool-'))
  store = new AgentSessionStore(dir)
  await store.ensure('c1', { id: 's1', title: '新会话', createdAt: 1, provider: 'p', modelId: 'm' })
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('工具调用落盘', () => {
  it('带标记的首句入标题时被剥成 @名字（历史列表不出现机器串）', async () => {
    // 直接用 store 验不了 runtime 的 maybeAutoTitle（那是私有方法），
    // 这里锁的是**数据层契约**：标题就是「剥完标记的原文」——runtime 只负责剥。
    await store.appendTurn('c1', 's2', { role: 'user', text: '@图片 4 根据参考图生成', ts: 2 })
    // 模拟 runtime 的标题剥法（与 stripMarkupToPlain 同一正则口径）
    const raw = '@[node:图片 4](430c8f1f00bd4aba#12) 根据参考图生成'
    const stripped = raw.replace(/@\[([a-zA-Z][a-zA-Z0-9_-]*):([^\]]+)\](?:\([^)]*\))?/g, (_m, _k, name) => '@' + name)
    expect(stripped).toBe('@图片 4 根据参考图生成')
    expect(await store.rename('c1', 's2', stripped.slice(0, 24))).toBe(true)
    const rec = await store.get('c1', 's2')
    expect(rec!.title).toBe('@图片 4 根据参考图生成')
    expect(rec!.title).not.toContain('@[')
  })

  it('结构化存：名字/参数都留着（回放才还原得出样子）', async () => {
    await store.appendTurn('c1', 's1', {
      role: 'tool',
      text: 'exec_command({\"cmd\":\"ls\"})',
      tool: { id: 't1', name: 'exec_command', arguments: '{\"cmd\":\"ls\"}' },
      ts: 1,
    })
    const rec = await store.get('c1', 's1')
    expect(rec!.turns[0].tool).toEqual({ id: 't1', name: 'exec_command', arguments: '{\"cmd\":\"ls\"}' })
  })

  it('结果原地补到**同一条**上（不新开一条，否则回放里会出现孤立结果）', async () => {
    await store.appendTurn('c1', 's1', {
      role: 'tool', text: 'x', tool: { id: 't1', name: 'exec_command', arguments: '{}' }, ts: 1,
    })
    const ok = await store.patchTool('c1', 's1', 't1', { output: 'hello' })
    expect(ok).toBe(true)
    const rec = await store.get('c1', 's1')
    // 仍然只有一条工具记录
    expect(rec!.turns.filter((t) => t.role === 'tool')).toHaveLength(1)
    expect(rec!.turns[0].tool!.output).toBe('hello')
  })

  it('补一个不存在的工具 id → 返回 false（不静默写坏数据）', async () => {
    expect(await store.patchTool('c1', 's1', 'nope', { output: 'x' })).toBe(false)
  })

  it('finishTools：一轮结束后所有工具都标完成（含没吐 output 的那些）', async () => {
    await store.appendTurn('c1', 's1', { role: 'tool', text: 'a', tool: { id: 't1', name: 'a', arguments: '{}' }, ts: 1 })
    await store.appendTurn('c1', 's1', { role: 'tool', text: 'b', tool: { id: 't2', name: 'b', arguments: '{}', output: 'r' }, ts: 2 })
    await store.finishTools('c1', 's1')
    const rec = await store.get('c1', 's1')
    expect(rec!.turns.every((t) => t.role !== 'tool' || t.done === true)).toBe(true)
  })

  it('finishTools 不碰非工具条目（别给用户消息也盖上完成戳）', async () => {
    await store.appendTurn('c1', 's1', { role: 'user', text: '在吗', ts: 1 })
    await store.appendTurn('c1', 's1', { role: 'assistant', text: '在', ts: 2 })
    await store.finishTools('c1', 's1')
    const rec = await store.get('c1', 's1')
    expect(rec!.turns[0].done).toBeUndefined()
    expect(rec!.turns[1].done).toBeUndefined()
  })
})
