/**
 * 目标（goal）插件的安装器（设计 §3.4.1 / 计划 Task 3.1）。
 *
 * 目标功能不是 cloud-server 自己写的代码，而是 SDK 自带插件 `@penguinharness/goal` 里的两个 hook 脚本：
 *   - `start.mjs`（user_prompt）：写 `<scratchpad>/GOAL.json`，返回第 1 轮的协议文本；
 *   - `stop.mjs`（stop）：每轮结束重读 GOAL.json，决定「继续下一轮」还是收尾。
 * 这两条命令由 SDK 在会话里执行，前提是它们被装进 Agent 的 `<agent_state>/hooks/goal/`
 * （现状是空目录 ⇒ 装了才有目标功能）。
 *
 * 本文件当前只负责**幂等安装**；目标的启动 / 暂停 / 恢复（Task 3.2）随后也落在同一个文件里。
 *
 * 三条硬口径：
 * 1. **绝不抛错**：插件取不到（换依赖版本、裁剪安装）只是「这台服务没有目标功能」，
 *    不该把 cloud-server 拖崩 —— 返回 `installed:false` + 一条日志，启动照常。
 * 2. **幂等**：已装且版本一致时一个字节都不写（启动路径每次都会调它，不能天天重写磁盘）。
 * 3. **manifest 原样安装，只补一处**：给 user_prompt 的每条命令加 `trigger:"host"`
 *    （设计 §3.4.1 的双重保险）。0.2.13 的 SDK 根本不读这个字段（user_prompt 只由宿主显式调
 *    `runUserPromptHook` 时才跑），补它是防将来 SDK 升级后按新版规则把无 trigger 的
 *    user_prompt 当成「每条消息都跑」；`stop` 命令照装照用，一个字段都不动。
 */
import type { HookCommand, HookManifest, InstalledHook, LibraryPlugin } from '@prismshadow/penguin-core'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { GOAL_FILE, GOAL_FILE_PAUSED, endGoalFile, readGoalState, type GoalState } from './goalState.js'
import { readVendoredPlugin, type VendoredPlugin } from './vendorPlugins.js'

/** 插件名（SDK 插件库里的目录名，也是 `hooks/<name>/` 的那一段） */
export const GOAL_HOOK_NAME = 'goal'

/** 本次调用做成的事：首装 / 版本不一致重装 / 已是最新跳过 / 库里没有 / 装的时候出错 */
export type GoalInstallStatus = 'installed' | 'updated' | 'up-to-date' | 'unavailable' | 'failed'

export interface GoalInstallResult {
  /** 调用结束后磁盘上有没有可用的 goal hook 包（首装 / 重装 / 已是最新都算 true） */
  installed: boolean
  status: GoalInstallStatus
  /** 一句话说明（日志与测试断言用） */
  reason: string
  /** 插件版本（库里取不到 goal 时没有） */
  version?: string
}

/** 可注入的 SDK 端口（缺省走真 SDK；测试用来造「库里没有 goal」这类分支） */
export interface GoalInstallDeps {
  /**
   * 仓库内那份插件（缺省读 `vendor/plugins/<name>`）。
   *
   * 可注入是为了让单测能分别覆盖**两个来源**：返回 null 模拟「vendor 里没有，回落 SDK 库」。
   */
  vendoredPlugin?: (name: string) => Promise<VendoredPlugin | null>
  /** SDK 的 `libraryPlugin`：从插件库读一份 goal 插件 */
  libraryPlugin?: (name: string) => LibraryPlugin | undefined
  /** SDK 的 `listInstalledHooks`：读 Agent 已装的 hook 包 */
  listInstalledHooks?: (root: string, projectId: string, agentId: string) => Promise<InstalledHook[]>
  /** SDK 的 `installHook`：把 hook 包装进 `agent_state/hooks/<name>/` */
  installHook?: (
    root: string,
    projectId: string,
    agentId: string,
    manifest: HookManifest,
    files: Record<string, string>,
    icon?: string,
  ) => Promise<void>
}

/** user_prompt 命令上的宿主标记：`trigger` 还不在这版 SDK 的 HookCommand 类型里，单列一个交叉类型 */
type HostTriggeredCommand = HookCommand & { trigger: 'host' }

/**
 * 装的是不是同一版（以库里那份为准）。
 *
 * 用字符串相等，而不是 SDK 的 comparePluginVersions：我们写进去的版本就是库里那份原样透传的，
 * 相等即一致。外来工具装的副本若用了旧拼写（`2026-09-01.1`），这里会判成不一致、重写一次 ——
 * 重写完就是当前拼写，之后一直跳过，代价只是一次多余写入，没有副作用。
 */
function sameVersion(installed: string | undefined, library: string): boolean {
  return typeof installed === 'string' && installed === library
}

/** manifest 原样透传，只给 user_prompt 的每条命令补 `trigger:"host"`（stop / pre_tool_use 一律不碰） */
function withHostTrigger(manifest: HookManifest): HookManifest {
  const userPrompt: HostTriggeredCommand[] = manifest.user_prompt.map((cmd) => ({ ...cmd, trigger: 'host' }))
  return { ...manifest, user_prompt: userPrompt }
}

/**
 * 把没注入的端口补齐：SDK 那份懒 import（与 server.ts 的 loadSdk 同一条口径），
 * vendor 那份直接读仓库目录。三个 SDK 端口都注入时连 import 都不发生。
 */
async function goalSdkPorts(deps: GoalInstallDeps): Promise<Required<GoalInstallDeps>> {
  const { libraryPlugin, listInstalledHooks, installHook } = deps
  const vendoredPlugin = deps.vendoredPlugin ?? readVendoredPlugin
  if (libraryPlugin && listInstalledHooks && installHook) {
    return { libraryPlugin, listInstalledHooks, installHook, vendoredPlugin }
  }
  const sdk = await import('@prismshadow/penguin-core')
  return {
    vendoredPlugin,
    libraryPlugin: libraryPlugin ?? ((name) => sdk.libraryPlugin(name)),
    listInstalledHooks:
      listInstalledHooks ?? ((root, projectId, agentId) => sdk.listInstalledHooks(root, projectId, agentId)),
    installHook:
      installHook ??
      ((root, projectId, agentId, manifest, files, icon) =>
        sdk.installHook(root, projectId, agentId, manifest, files, icon)),
  }
}

/** 「库里没有 / 不带 hook 包」：目标功能缺席，但不是错误（服务照常起），只记日志 */
function unavailable(reason: string): GoalInstallResult {
  console.warn('[agent] goal hook 未安装：' + reason)
  return { installed: false, status: 'unavailable', reason }
}

/**
 * 幂等安装 goal 的 hook 包到 `<root>/<projectId>/agents/<agentId>/agent_state/hooks/goal/`。
 *
 * 三种结局（全部靠返回值表达，都不抛错）：
 *   - 已装且版本一致 → `up-to-date`（一个字节都不写）；版本不一致 → 覆盖重装（`updated`）；
 *   - 库里没有 goal（或它不带 hook 包）→ `unavailable`（记一条日志，服务照常起）；
 *   - 装的时候真出错（磁盘只读等）→ `failed`（记一条日志）。
 *
 * @param root SDK 口径的数据根：cloud-server 传 `agentRoot(dataDir)`（与 createAgent 同一个 root）。
 */
export async function ensureGoalInstalled(
  root: string,
  projectId: string,
  agentId: string,
  deps: GoalInstallDeps = {},
): Promise<GoalInstallResult> {
  try {
    const sdk = await goalSdkPorts(deps)
    /**
     * 插件从哪来：**优先仓库内那份**（vendor/plugins/goal），取不到才回落 SDK 插件库。
     *
     * 为什么优先 vendor（用户口径 2026-10-11）：SDK 那份是 node_modules 里的外部资源 ——
     * 打包产物换环境 / 只发 JS / 依赖没装全，脚本就找不到，目标功能直接缺席。
     * vendor 那份跟着代码走，可 review、可改，是可靠来源；SDK 只当后备。
     */
    const vendored = await sdk.vendoredPlugin(GOAL_HOOK_NAME)
    const fromSdk = vendored ? null : sdk.libraryPlugin(GOAL_HOOK_NAME)
    const manifest = vendored?.manifest ?? fromSdk?.hooks?.manifest
    if (!manifest) {
      if (!fromSdk) return unavailable(`插件库里没有 ${GOAL_HOOK_NAME}（libraryPlugin 返回空）`)
      return unavailable(`${GOAL_HOOK_NAME} 插件不带 hook 包`)
    }
    const files = vendored?.files ?? fromSdk?.hooks?.files ?? {}
    const icon = vendored?.icon ?? fromSdk?.icon
    const installed = (await sdk.listInstalledHooks(root, projectId, agentId)).find(
      (hook) => hook.name === GOAL_HOOK_NAME,
    )
    if (installed && sameVersion(installed.version, manifest.version)) {
      return {
        installed: true,
        status: 'up-to-date',
        reason: `已装 v${manifest.version}，无需重写`,
        version: manifest.version,
      }
    }

    await sdk.installHook(root, projectId, agentId, withHostTrigger(manifest), files, icon)
    const status: GoalInstallStatus = installed ? 'updated' : 'installed'
    return {
      installed: true,
      status,
      reason: `${status === 'updated' ? '版本不一致，已重装' : '已安装'} v${manifest.version}`,
      version: manifest.version,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn('[agent] goal hook 安装失败：' + reason)
    return { installed: false, status: 'failed', reason }
  }
}

// ======================================================================
// 目标的运行时（设计 §3.4.2 / §3.4.4）
// ======================================================================

/** 执行 hook 脚本的一层（可注入，单测用来喂假输出） */
export type HookScriptRunner = (scriptPath: string, input: Record<string, unknown>) => Promise<string>

/**
 * 懒装 hook 后跑一个脚本（与 SDK 内部调它完全同款：stdin 喂 JSON、stdout 收 JSON）。
 *
 * 为什么宿主自己执行 stop.mjs（而不是重写一份判断）：tokens_used 的累加、轮次上限、
 * 预算判定、完成/受阻审计全在那个脚本里，重写必然漂移。
 */
export function makeScriptRunner(hooksDir: string): HookScriptRunner {
  return async (scriptPath, input) => {
    const { spawn } = await import('node:child_process')
    return new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(hooksDir, scriptPath)], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      child.stdout.on('data', (d) => (out += String(d)))
      child.stderr.on('data', (d) => (err += String(d)))
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve(out)
        else reject(new Error('hook 脚本退出码 ' + code + '：' + err.slice(0, 200)))
      })
      child.stdin.end(JSON.stringify(input))
    })
  }
}

/** stop.mjs 的判定结果（与插件输出的形状一致） */
export interface GoalStopDecision {
  decision: 'continue' | 'stop'
  reason?: string
  /** `continue` 时下一轮的输入文本 */
  input?: string
  /** 目标终态的记账（status / round / tokens_used / budget） */
  output?: Record<string, string | number | boolean>
}

/**
 * 问一次 goal 的 stop hook「该继续还是收尾」（宿主自己执行）。
 *
 * 关键前提（设计 §3.4.4）：**GOAL.json 不在时脚本静默退出（什么都不输出）** ——
 * 这正是"暂停"的实现方式：文件被挪走 ⇒ 这里返回 null ⇒ 循环停住。
 * 返回 null = 没有决定（文件不在 / 输出无效），调用方据此停下。
 */
export async function askGoalStop(
  run: HookScriptRunner,
  sessionId: string,
  tracePath: string,
): Promise<GoalStopDecision | null> {
  const raw = (await run('stop.mjs', { hook: 'stop', session_id: sessionId, trace_path: tracePath })).trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const decision = parsed.decision === 'continue' || parsed.decision === 'stop' ? parsed.decision : null
    if (!decision) return null
    return {
      decision,
      ...(typeof parsed.reason === 'string' ? { reason: parsed.reason } : {}),
      ...(typeof parsed.input === 'string' ? { input: parsed.input } : {}),
      ...(parsed.output && typeof parsed.output === 'object'
        ? { output: parsed.output as Record<string, string | number | boolean> }
        : {}),
    }
  } catch {
    return null
  }
}

/**
 * 目标文件的三种形态（读/改/挪走）都收在这里，避免"哪里都写一点"。
 * scratchpadDir 由调用方算（sessionScratchpadPath）。
 */
export class GoalFiles {
  constructor(private readonly scratchpadDir: string) {}

  private get live(): string {
    return path.join(this.scratchpadDir, GOAL_FILE)
  }
  private get paused(): string {
    return path.join(this.scratchpadDir, GOAL_FILE_PAUSED)
  }

  read(): Promise<GoalState | null> {
    return readGoalState(this.scratchpadDir)
  }

  async exists(): Promise<boolean> {
    for (const f of [this.live, this.paused]) {
      try {
        await fs.access(f)
        return true
      } catch {
        /* 继续看下一个 */
      }
    }
    return false
  }

  /**
   * 暂停：把文件改名挪走（内容原样）。
   *
   * 为什么不是改 status：插件只认 active / wrapping_up / complete / blocked，
   * 写别的值会被判成"协议外的坏通道" ⇒ 直接 blocked 收场（不是暂停，是搞砸）。
   * 文件缺席则下一轮结束时 stop.mjs 读不到 ⇒ 静默退出 ⇒ 官方自动连播自然停住。
   */
  async pause(): Promise<boolean> {
    if (!(await fileExists(this.live))) return false
    await fs.rm(this.paused, { force: true })
    await fs.rename(this.live, this.paused)
    return true
  }

  /** 启动：文件改回原名（status / round / tokens_used 原样接上） */
  async resume(): Promise<boolean> {
    if (!(await fileExists(this.paused))) return false
    await fs.rm(this.live, { force: true })
    await fs.rename(this.paused, this.live)
    return true
  }

  /** 结束目标：两份状态文件都删掉（与「暂停」不同，不留可恢复的副本） */
  end(): Promise<boolean> {
    return endGoalFile(this.scratchpadDir)
  }

  /**
   * 暂停态下"守住缺席"：当前轮里模型可能自己写回 GOAL.json（比如它认为完成了），
   * 那样文件就"复活"、官方循环会继续 —— 暂停失效。
   *
   * 所以每轮结束都调一次：发现 live 又出现了就再挪走（保留最新内容，状态仍是暂停）。
   * 返回 true = 这次真的收走了一个复活的文件。
   */
  async enforcePaused(): Promise<boolean> {
    if (!(await fileExists(this.live))) return false
    await fs.rm(this.paused, { force: true })
    await fs.rename(this.live, this.paused)
    return true
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}
