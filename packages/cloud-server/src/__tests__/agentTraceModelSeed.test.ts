/**
 * 切换模型的 Trace 种子必须覆盖父会话的模型引用（code review 2026-10-11 抓到的 P1）。
 *
 * 后果链（不修的话）：seedForkTrace 在父 Trace 存在时整体照抄父 meta ——
 * provider/model_id 是**旧模型**；而宿主记录、界面分段、模型下拉都显示新模型。
 * SDK resume 出来的会话仍向旧模型发请求，用户眼里就是「切了模型没效果」。
 *
 * 这里直接打 seedForkTrace 这一层（fork 与切模型共用）：父存在时，种子给了模型就覆盖。
 * fork 路由传的是父自己的模型，覆盖 = no-op，行为不变。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { seedForkTrace, tracesDirOf } from '../agent/traceFork.js'

let root: string

/**
 * 与 traceFork.dateDirOf 同一口径：由会话 id 推日期子目录。
 *
 * 用真会话 id（session-2026-10-11-…）而不是占位名，否则种子会落到**今天**的目录，
 * 而断言去 2026-10-11 找文件 —— 这正是这条测试第一次跑红的原因。
 */
function dateDir(sessionId: string): string {
  const m = /^session-(\d{4}-\d{2}-\d{2})/.exec(sessionId)
  return m ? m[1]! : new Date().toISOString().slice(0, 10)
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-model-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 造一份父 Trace（首行 session_meta 钉着旧模型） */
async function seedParent(parentId: string): Promise<void> {
  const dir = path.join(tracesDirOf(root), dateDir(parentId))
  await fs.mkdir(dir, { recursive: true })
  const lines = [
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'session_meta', payload: { session_id: parentId, provider: 'old', model_id: 'old-model', agent_state: 'x', workspace: 'y' } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'model_msg', payload: { type: 'text', role: 'user', text: 'hi', stop_reason: 'completed' } }),
  ]
  await fs.writeFile(dir + '/' + parentId + '_001.jsonl', lines.join('\n') + '\n', 'utf8')
}

async function readMeta(forkId: string): Promise<Record<string, unknown>> {
  const dir = path.join(tracesDirOf(root), dateDir(forkId))
  const text = await fs.readFile(dir + '/' + forkId + '_001.jsonl', 'utf8')
  return (JSON.parse(text.split('\n')[0]!) as { payload: Record<string, unknown> }).payload
}

describe('切模型的 Trace 种子模型覆盖', () => {
  it('父 Trace 存在时，种子给的 provider/model_id 覆盖父 meta（否则 SDK 仍向旧模型发请求）', async () => {
    const parentId = 'session-2026-10-11-00-00-00-parent'
    const forkId = 'session-2026-10-11-00-00-01-fork'
    await seedParent(parentId)
    await seedForkTrace(root, {
      parentSessionId: parentId,
      forkSessionId: forkId,
      canvasId: 'c1',
      turns: [],
      provider: 'new',
      modelId: 'new-model',
    })
    const meta = await readMeta(forkId)
    expect(meta.provider).toBe('new')
    expect(meta.model_id).toBe('new-model')
  })

  it('fork（不带新模型 / 与父相同）时不覆盖：行为与从前一致', async () => {
    const parentId = 'session-2026-10-11-00-00-02-parent'
    const forkId = 'session-2026-10-11-00-00-03-fork'
    await seedParent(parentId)
    await seedForkTrace(root, {
      parentSessionId: parentId,
      forkSessionId: forkId,
      canvasId: 'c1',
      turns: [],
    })
    const meta = await readMeta(forkId)
    expect(meta.provider).toBe('old')
    expect(meta.model_id).toBe('old-model')
  })
})

