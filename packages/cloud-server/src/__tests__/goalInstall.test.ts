/**
 * goal 安装器（Task 3.1，设计 §3.4.1）。测四件事：
 * 1. 装完 hooks.json 的形状：user_prompt 带 `trigger:'host'`、stop 仍在、manifest 其余原样；
 * 2. 幂等：连装两次不炸、第二次一个字节都不写（用 hooks.json 的 mtime 断言）；
 * 3. 版本升级会重装（并覆盖回当前版本）；
 * 4. 插件库里没有 goal / 插件不带 hook 包时不抛错，只记日志（服务照常起）。
 * 5. 不碰别的 hook 包（卸载 goal 时不会把别人一起带走的前提）。
 *
 * 全部在临时目录里跑：root 传 `<临时目录>/agent`（与 server.ts 的 agentRoot(dataDir) 同形），
 * 绝不碰真实数据根。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ensureGoalInstalled,
  GOAL_HOOK_NAME,
  type GoalInstallDeps,
} from '../agent/goal'

/** SDK 口径：hooks 目录挂在 <root>/<projectId>/agents/<agentId>/agent_state/hooks */
const PROJECT_ID = 'mini-canvas'
const AGENT_ID = 'canvas-agent'

let dataDir: string
let root: string
let hooksDir: string

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-goal-install-'))
  root = path.join(dataDir, 'agent')
  hooksDir = path.join(root, PROJECT_ID, 'agents', AGENT_ID, 'agent_state', 'hooks')
})

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true })
})

const goalHooksJson = () => path.join(hooksDir, GOAL_HOOK_NAME, 'hooks.json')

async function readHooksJson(): Promise<any> {
  return JSON.parse(await fs.readFile(goalHooksJson(), 'utf8'))
}

/** 直接把一份 hooks.json 写到磁盘（模拟旧版本 / 外来工具装的副本） */
async function writeHooksJson(manifest: unknown): Promise<void> {
  await fs.mkdir(path.dirname(goalHooksJson()), { recursive: true })
  await fs.writeFile(goalHooksJson(), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}

describe('goal 安装器：装完的形状', () => {
  it('装完能被 SDK 读回：user_prompt 带 trigger:host、stop 保留、manifest 原样', async () => {
    const result = await ensureGoalInstalled(root, PROJECT_ID, AGENT_ID)
    expect(result.installed).toBe(true)
    expect(result.status).toBe('installed')
    expect(result.version).toBe('2026.09.01.1')

    // SDK 自己的读入口能认出来（hooks.json 存在 + 名字对了）
    const sdk = await import('@prismshadow/penguin-core')
    const installed = await sdk.listInstalledHooks(root, PROJECT_ID, AGENT_ID)
    const goal = installed.find((h) => h.name === GOAL_HOOK_NAME)
    expect(goal).toBeDefined()
    expect(goal?.version).toBe('2026.09.01.1')

    const manifest = await readHooksJson()
    // 唯一的一处补丁：user_prompt 每条命令都带 trigger:'host'（设计 §3.4.1 的双重保险）
    expect(manifest.user_prompt).toHaveLength(1)
    expect(manifest.user_prompt[0].command).toBe('start.mjs')
    expect(manifest.user_prompt[0].timeout).toBe(60)
    expect(manifest.user_prompt[0].trigger).toBe('host')
    // stop 命令照装（暂停不靠改 manifest 实现，见 §3.4.4）
    expect(manifest.stop).toEqual([{ command: 'stop.mjs', timeout: 60 }])
    expect(manifest.pre_tool_use).toEqual([])
    // 其余字段原样
    expect(manifest.name).toBe('goal')
    expect(manifest.version).toBe('2026.09.01.1')
    expect(typeof manifest.description).toBe('string')
  })

  it('hook 脚本与插件图标都落了盘（会话要真能执行 start/stop）', async () => {
    await ensureGoalInstalled(root, PROJECT_ID, AGENT_ID)
    const dir = path.join(hooksDir, GOAL_HOOK_NAME)
    const names = (await fs.readdir(dir)).sort()
    expect(names).toEqual(['hooks.json', 'icon.svg', 'lib.mjs', 'start.mjs', 'stop.mjs'])
  })
})

describe('goal 安装器：幂等', () => {
  it('连装两次不炸，第二次跳过（hooks.json 的 mtime 没变）', async () => {
    const first = await ensureGoalInstalled(root, PROJECT_ID, AGENT_ID)
    expect(first.status).toBe('installed')
    const before = await fs.stat(goalHooksJson())
    const rawBefore = await fs.readFile(goalHooksJson(), 'utf8')

    const second = await ensureGoalInstalled(root, PROJECT_ID, AGENT_ID)
    expect(second.status).toBe('up-to-date')
    expect(second.installed).toBe(true)

    const after = await fs.stat(goalHooksJson())
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(await fs.readFile(goalHooksJson(), 'utf8')).toBe(rawBefore)
  })
})

describe('goal 安装器：版本', () => {
  it('磁盘上版本不一致 → 重装成库里的版本，并补上 trigger', async () => {
    // 假装是旧版 SDK 装的：manifest 原样、没有 trigger
    await writeHooksJson({
      name: GOAL_HOOK_NAME,
      description: 'old',
      version: '2020.01.01.1',
      stop: [{ command: 'stop.mjs', timeout: 60 }],
      pre_tool_use: [],
      user_prompt: [{ command: 'start.mjs', timeout: 60 }],
    })

    const result = await ensureGoalInstalled(root, PROJECT_ID, AGENT_ID)
    expect(result.status).toBe('updated')
    const manifest = await readHooksJson()
    expect(manifest.version).toBe('2026.09.01.1')
    expect(manifest.user_prompt[0].trigger).toBe('host')
  })
})

describe('goal 安装器：插件缺席不拦启动', () => {
  it('libraryPlugin 返回空 → 不抛错，installed:false（真 SDK 端口注入）', async () => {
    const sdk = await import('@prismshadow/penguin-core')
    const result = await ensureGoalInstalled(root, PROJECT_ID, AGENT_ID, {
      libraryPlugin: () => undefined,
      listInstalledHooks: (r, p, a) => sdk.listInstalledHooks(r, p, a),
      installHook: (r, p, a, m, f, i) => sdk.installHook(r, p, a, m, f, i),
    })
    expect(result.installed).toBe(false)
    expect(result.status).toBe('unavailable')
    expect(result.reason).toContain('goal')
    // 什么都没写
    await expect(fs.readdir(hooksDir)).rejects.toThrow()
  })

  it('插件不带 hook 包 → 不抛错，installed:false', async () => {
    const result = await ensureGoalInstalled(root, PROJECT_ID, AGENT_ID, {
      libraryPlugin: () =>
        ({
          name: GOAL_HOOK_NAME,
          description: 'no hooks',
          version: '2026.09.01.1',
          preinstall: true,
          skills: [],
        }) as any,
      listInstalledHooks: async () => [],
      installHook: async () => {
        throw new Error('不该被调到')
      },
    })
    expect(result.installed).toBe(false)
    expect(result.status).toBe('unavailable')
  })

  it('安装本身出错（磁盘炸了）→ 不抛错，记一条日志', async () => {
    const result = await ensureGoalInstalled(root, PROJECT_ID, AGENT_ID, {
      installHook: async () => {
        throw new Error('EACCES: 只读盘')
      },
    })
    expect(result.installed).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.reason).toContain('EACCES')
  })
})

describe('goal 安装器：不碰别的 hook', () => {
  it('装了 goal 之后，Agent 已有的其它 hook 包原样还在', async () => {
    const sdk = await import('@prismshadow/penguin-core')
    const other = path.join(hooksDir, 'other')
    await fs.mkdir(other, { recursive: true })
    await fs.writeFile(
      path.join(other, 'hooks.json'),
      JSON.stringify({
        name: 'other',
        description: '别人的 hook',
        version: '2026.01.01.1',
        stop: [{ command: 'x.mjs' }],
        pre_tool_use: [],
        user_prompt: [],
      }) + '\n',
      'utf8',
    )

    await ensureGoalInstalled(root, PROJECT_ID, AGENT_ID)
    const names = (await sdk.listInstalledHooks(root, PROJECT_ID, AGENT_ID)).map((h) => h.name)
    expect(names).toEqual(['goal', 'other'])
    expect(JSON.parse(await fs.readFile(path.join(other, 'hooks.json'), 'utf8')).version).toBe('2026.01.01.1')
  })
})

describe('goal 安装器：注入端口', () => {
  it('端口可注入（测试不必依赖真实插件库）', async () => {
    const written: { manifest: unknown; files: Record<string, string> }[] = []
    const deps: GoalInstallDeps = {
      libraryPlugin: () => ({
        name: GOAL_HOOK_NAME,
        description: 'fake',
        version: '2026.10.01.1',
        preinstall: true,
        skills: [],
        icon: '<svg/>',
        hooks: {
          manifest: {
            name: GOAL_HOOK_NAME,
            description: 'fake',
            version: '2026.10.01.1',
            stop: [{ command: 'stop.mjs', timeout: 60 }],
            pre_tool_use: [],
            user_prompt: [{ command: 'start.mjs', timeout: 60 }],
          },
          files: { 'stop.mjs': '// stop' },
        },
      }),
      listInstalledHooks: async () => [],
      installHook: async (_r, _p, _a, manifest, files) => {
        written.push({ manifest, files })
      },
    }
    const result = await ensureGoalInstalled(root, PROJECT_ID, AGENT_ID, deps)
    expect(result).toMatchObject({ installed: true, status: 'installed', version: '2026.10.01.1' })
    expect(written).toHaveLength(1)
    expect((written[0].manifest as any).user_prompt[0].trigger).toBe('host')
    expect((written[0].manifest as any).stop).toEqual([{ command: 'stop.mjs', timeout: 60 }])
    expect(written[0].files).toEqual({ 'stop.mjs': '// stop' })
  })
})
