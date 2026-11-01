/**
 * assembleAgent —— 把一个数据根装配成可用的 Agent 服务组（Runtime / Hub / 队列 / 目标 / 配置）。
 *
 * 为什么单独成文件：`createCloudServer` 里原来这 160 行直接写在装配函数体内，
 * 而 `agent: false` 的开关只跳过了两条路由 —— 对象照样构造、SDK 照样预热、
 * goal hook 照样写盘。把装配收成一个「开关为真才调用」的工厂后：
 * - 关闭时一个 Agent 对象都不存在；
 * - 将来把后台归属移进 plugin-agent 时，搬的是这一个文件，不动宿主。
 */
import { AgentConfigService } from './config.js'
import { AgentSessionStore } from './sessionStore.js'
import { SessionHub } from './sessionHub.js'
import { AgentRuntime } from './runtime.js'
import { QueueScheduler } from './queueScheduler.js'
import { GoalRuntime, goalHooksDir, findSessionTrace } from './goalRuntime.js'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot, sessionScratchpadPath } from './agentPaths.js'
import { tracesDirOf } from './traceFork.js'
import { ensureGoalInstalled } from './goal.js'
import type { AgentHostPorts } from '../ports.js'
import { setVendorPluginsDir } from './vendorPlugins.js'

export interface AgentServices {
  config: AgentConfigService
  sessions: AgentSessionStore
  hub: SessionHub
  runtime: AgentRuntime
  queue: QueueScheduler
  goal: GoalRuntime
  /** 单轮对话按需加载 SDK 的入口（懒加载，没配模型时启动照常成功） */
  loadSdk: () => Promise<typeof import('@prismshadow/penguin-core')>
  /** 停：回收运行时与事件通道（宿主 stop 调） */
  dispose: () => void
}

export interface AssembleAgentOptions {
  /**
   * 宿主注入的能力（数据根 / KV / 提示词小节 / 中间件 / 日志）。
   *
   * 为什么整包注入而不是各拆一个参数：这些能力**同源**（都来自这一次装配的宿主），
   * 拆散后调用方容易只传一半，缺的那一项又只会在某条冷门路径上炸。
   */
  ports: AgentHostPorts
}

/** 构造一整套 Agent 服务；调用方负责在开关为真时才调用它。 */
export async function assembleAgentServices(opts: AssembleAgentOptions): Promise<AgentServices> {
  const ports = opts.ports
  const dataDir = ports.dataDir
  const log = ports.log ?? ((m: string, extra?: unknown) => console.log('[agent] ' + m, extra ?? ''))
  // goal hook 的仓库内来源：由宿主（或单文件产物启动器）在装配前告知。
  if (ports.vendorPluginsDir) setVendorPluginsDir(ports.vendorPluginsDir)
  const config = new AgentConfigService(dataDir, { kv: ports.kv, skillSources: ports.skillSources })
  const sessions = new AgentSessionStore(dataDir)
  let sdkPromise: Promise<typeof import('@prismshadow/penguin-core')> | undefined
  const loadSdk = (): Promise<typeof import('@prismshadow/penguin-core')> =>
    (sdkPromise ??= import('@prismshadow/penguin-core'))
  /** 同步引用：makeUserMessage 是同步签名，SDK 一旦加载就填进来 */
  let sdkRef: typeof import('@prismshadow/penguin-core') | undefined
  void loadSdk().then((sdk) => { sdkRef = sdk }).catch(() => undefined)

  // 「后台对话」的事件通道（设计 §3.2）：每会话一条常驻流，队列在空闲时自动起轮也靠它广播。
  const hub = new SessionHub({ log: (m, extra) => log('[hub] ' + m, extra) })
  /**
   * 先声明、后赋值：runtime 的 onRunFinished 要引用它，而它的 deps 又要 runtime 的派生面。
   * 用「延迟取值函数」而不是直接在回调里引用 `let`：实际执行时它早已赋值，
   * 但静态检查看不到这个时序，会报“使用在赋值前”。
   */
  let queueRef: QueueScheduler | undefined
  const queueLater = (): QueueScheduler => {
    if (!queueRef) throw new Error('[agent] 队列调度器尚未装配完成')
    return queueRef
  }
  let goalRef: GoalRuntime | undefined
  const goalLater = (): GoalRuntime => {
    if (!goalRef) throw new Error('[agent] 目标运行时尚未装配完成')
    return goalRef
  }
  const runtime = new AgentRuntime({
    root: dataDir,
    store: sessions,
    hub,
    agent: async () => {
      const sdk = await loadSdk()
      return sdk.createAgent({ root: agentRoot(dataDir), projectId: AGENT_PROJECT_ID, agentId: AGENT_ID })
    },
    /** 每次建会话现读：插件可热装热卸，运行期地址 / 端口也在变，快照会把旧值冻进提示词。 */
    promptSections: () => ports.promptSections().map((s) => ({ title: s.title, text: s.text })),
    makeUserMessage: (text, images) => {
      const sdk = sdkRef
      if (!sdk) throw new Error('SDK 尚未就绪：请先配置模型后重试')
      const messages: unknown[] = [sdk.userText(text)]
      for (const url of images ?? []) messages.push(sdk.imageUrlMessage(url))
      return messages
    },
    // 宿主注入的用户消息（目标协议文本）：必须走 sender:'harness' ——
    // SDK 的 goal stop hook 靠这个戳划轮次边界，缺了它记账会退化成「整份 trace = 一轮」。
    makeHarnessMessage: (text) => {
      const sdk = sdkRef
      if (!sdk) throw new Error('SDK 尚未就绪：请先配置模型后重试')
      return sdk.userText(text, 'harness')
    },
    filterMcp: (names) => config.subsetMcp(names),
    readSkill: (name) => config.readSkillFile(name),
    withSystemPrompt: (text) => config.withSystemPrompt(text),
    generateTitle: (plainFirstText) => config.generateSessionTitle(plainFirstText),
    onGoalRound: (canvasId, sessionId) => {
      void goalLater()
        .read(canvasId, sessionId)
        .then((g) => { if (g) hub.append(canvasId, sessionId, { type: 'goal_state', goal: g }) })
        .catch(() => undefined)
    },
    onRunFinished: (canvasId, sessionId) => {
      void goalLater()
        .enforcePauseIfNeeded(canvasId, sessionId)
        .catch((err) => console.warn('[agent-goal] 守住暂停失败', err instanceof Error ? err.message : String(err)))
        .finally(() => {
          hub.append(canvasId, sessionId, { type: 'round_done' })
          void goalLater()
            .read(canvasId, sessionId)
            .then((g) => { if (g) hub.append(canvasId, sessionId, { type: 'goal_state', goal: g }) })
            .catch(() => undefined)
          queueLater().onRunFinished(canvasId, sessionId)
        })
    },
    log,
  })
  const queue = new QueueScheduler({
    store: sessions,
    runtime,
    hub,
    startRun: (input) => runtime.startRun(input.canvasId, input),
    startGoal: (canvasId, sessionId, objective, budget) => goalLater().beginGoal(canvasId, sessionId, objective, budget),
    // 队列里的消息也要过 pre-turn 中间件：与 HTTP 的 /messages 同一套。
    preTurn: (turn) => ports.runMiddleware(turn),
    log: (message, extra) => log('[queue] ' + message, extra),
  })
  queueRef = queue
  const goal = new GoalRuntime({
    scratchpadOf: (_canvasId, sessionId) => sessionScratchpadPath(agentRoot(dataDir), sessionId),
    hooksDir: goalHooksDir(agentRoot(dataDir), AGENT_PROJECT_ID, AGENT_ID),
    latestTraceOf: (sessionId) => findSessionTrace(tracesDirOf(agentRoot(dataDir)), sessionId),
    startRun: async (canvasId, sessionId, text, harnessText) => {
      const r = await runtime.startRun(canvasId, {
        canvasId,
        sessionId,
        text,
        ...(harnessText ? { harnessText } : {}),
      })
      return { started: r.started }
    },
    isRunning: (canvasId, sessionId) => runtime.isRunning(canvasId, sessionId),
    runUserPromptHook: (canvasId, sessionId, name, prompt, extras) =>
      runtime.runUserPromptHook(canvasId, sessionId, name, prompt, extras),
    emit: (canvasId, sessionId, ev) => hub.append(canvasId, sessionId, ev),
    setPausedFlag: (canvasId, sessionId, paused) => sessions.setGoalPaused(canvasId, sessionId, paused),
    isPausedFlag: async (canvasId, sessionId) => (await sessions.get(canvasId, sessionId))?.goalPaused === true,
    log: (message, extra) => log('[goal] ' + message, extra),
  })
  goalRef = goal

  // 目标（goal）插件的 hook 包：恒幂等、永不抛错，必须在 start 前 await 完成写入。
  await ensureGoalInstalled(agentRoot(dataDir), AGENT_PROJECT_ID, AGENT_ID)

  return {
    config,
    sessions,
    hub,
    runtime,
    queue,
    goal,
    loadSdk,
    dispose: () => {
      runtime.disposeAll()
      hub.disposeAll()
    },
  }
}
