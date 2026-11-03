/**
 * AgentConfigBase —— 配置面里与模型、MCP 无关的共享实现。
 *
 * 提示词 / 模板体检 / 运行上下文 / 技能这些方法原样搬到这里；
 * AgentConfigService 继承它，外部 import 路径与调用方式不变。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  loadAgentState,
  systemConfigPath,
  agentStateDir as sdkAgentStateDir,
  skillsDir as sdkSkillsDir,
  agentsMdPath as sdkAgentsMdPath,
  installSkill,
  listInstalledSkills,
  parseSkillFrontmatter,
  removeSkill,
  defaultSystemConfig,
} from '@prismshadow/penguin-core'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot, agentSkillSources } from './agentPaths.js'
import type { AgentKvPort, AgentPromptSectionView } from '../ports.js'
import {
  agentContextPlaceholders,
  agentContextInfo,
  buildRuntimeContext,
  expandAgentContext,
  type AgentContextInfo,
  type AgentRuntimeContext,
} from './runtimeContext.js'
import type { AgentSkillCandidate, AgentSkillView, PromptPreset } from './configTypes.js'
import { AGENT_PROMPTS_KEY, AGENT_PROMPTS_KV_TYPE, DEFAULT_PROMPTS, normalizePrompts } from './configTypes.js'
import {
  acquireQueue,
  loadSystemConfig,
  templateMissing,
  walk,
  writeSystemConfig,
} from './configTools.js'

export class AgentConfigBase {
  /** Agent 的系统提示词（agent_state/AGENTS.md） */
  async systemPrompt(): Promise<string> {
    await this.ensureInit()
    try {
      const raw = await fs.readFile(sdkAgentsMdPath(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID), 'utf8')
      // **返回原文**（不展开自定义占位符）：这个值会被界面拿去做「读 → 改 → 写回」的
      // 往返编辑，展开一次就把记号冻成了当时的值 —— 端口一换、画布一挪，用户写的模板
      // 就永远停在旧地址上，而他根本没改过。
      // 展开后的样子走 contextInfo().placeholders 给界面显示，两件事分开。
      return raw
    } catch {
      return ''
    }
  }

  /** 写入系统提示词（空串也允许 —— 那就是「没有额外指令」） */
  async setSystemPrompt(text: string): Promise<void> {
    await this.ensureInit()
    // 与「建会话时临时替换 AGENTS.md」排同一条队：否则一次保存可能落在
    // withSystemPrompt 的「读旧值 → 还原」中间，用户刚写的提示词会被旧值盖回去。
    const release = await this.acquirePromptLock()
    try {
      const target = sdkAgentsMdPath(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, text, 'utf8')
    } finally {
      release()
    }
  }

  /**
   * 临场把 AGENTS.md 换成「**用户自己的 AGENTS.md + 这段文本**」，返回还原函数。
   *
   * 为什么用这个手法（与 subsetMcp 同款）：SDK 只在**建会话时**读一次 AGENTS.md
   * 来组装系统提示词。所以「建会话前换成模式提示词、建完立刻还原」正好卡在那个点上 ——
   * 既让这一条会话用上模式提示词，又不永久改动 AGENTS.md（用户自己的系统提示词还在）。
   *
   * ⚠️ **不能直接替换**（2026-10-14 用户实测的真 bug）：那样一来选着模式时，「Agent 提示词」
   * 里写的东西**一个字都进不去模型** —— 真机上表现为「设置里改了 Agent 提示词，AI 毫无反应」。
   * 模式提示词是**附加在用户自己的指令之上**（`<AGENTS.md 原文>\n\n<模式提示词>`），
   * 不是替换掉它。两者都进 `{{AGENTS_MD}}` 那个位置。
   *
   * 还原失败不抛（宁可留下模式提示词，也不能让建会话这一步崩掉）。
   */
  async withSystemPrompt(text: string): Promise<() => Promise<void>> {
    await this.ensureInit()
    // 取互斥锁：一次只容一个「换 → 建会话 → 还原」走完（见 acquirePromptLock 的说明）。
    // 锁一直握到还原（返回的 restore 里释放），所以并发建会话不会互相覆盖 AGENTS.md。
    const release = await this.acquirePromptLock()
    let previous = ''
    const target = sdkAgentsMdPath(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
    try {
      previous = await fs.readFile(target, 'utf8').catch(() => '')
      await fs.mkdir(path.dirname(target), { recursive: true })
      // 展开自定义占位符（{{BACKEND_BASE_URL}} 等）——**卡在建会话这一刻**：
      // 端口/目录是运行期才定下来的，写盘时就展开会把值冻死（换了端口还发旧地址）。
      // 注意只展开本服务这套记号：SDK 自带的 {{CWD}} 等留给 SDK 自己展开。
      // **用户自己的 AGENTS.md 排在最前**：模式提示词 / 插件小节都加在它后面，谁都不顶掉谁。
      const combined = [previous.trim(), text].filter(Boolean).join('\n\n')
      await fs.writeFile(target, this.expandContext(combined), 'utf8')
    } catch (err) {
      // 写不进去就把锁还回去：否则这一条失败会把它后面的建会话全卡死。
      release()
      throw err
    }
    return async () => {
      try {
        await fs.writeFile(target, previous, 'utf8')
      } catch {
        /* 还原失败：保住眼下这条会话，别把错抛出去 */
      } finally {
        // 无论还原成败都要放锁，否则后面排队的建会话全卡死
        release()
      }
    }
  }

  private readonly skillSources: string[]
  /**
   * 首次初始化只做一次。
   *
   * 为什么必须串起来：设置页一次要读模型 / 技能 / MCP 三份，它们是并行的；
   * 而每份都会 loadAgentState({init:{}})，尚未初始化时三条并发初始化会抢着写同一批文件 ——
   * Windows 上表现为 rename EPERM（实测 `AGENTS.md` 撞车）。
   * 所以先 await 这一条，后续读一律不带 init（只读，不写）。
   */
  private initPromise?: Promise<void>

  /**
   * AGENTS.md 临时替换的**互斥锁**（一次只容一个「换 → 建会话 → 还原」走完）。
   *
   * 为什么必须有：`withSystemPrompt` 是「读旧值 → 写新值 → 建会话 → 还原旧值」，
   * 且**建会话在中间**（SDK 那时才读 AGENTS.md）。两个并发 createSession
   * （用户连点两次 / 两个画布同时开）会交错：A 读旧、B 读旧、A 写、B 写、A 还原、B 还原 ——
   * 最后谁写谁赢，可能把用户的系统提示词覆盖掉。
   * 锁要**一直握到还原**，所以不是简单的任务链，而是一个带排队的信号量。
   */
  private promptLock: Promise<void> = Promise.resolve()

  /**
   * 配置落盘（模型表 / MCP 表）的**互斥队列**。
   *
   * 为什么必须有：这两份配置的每次写都是「读整份 → 改 → 写回」。并发时各自读到同一份
   * 旧内容，后写的把先写的整条盖掉；Windows 上两次 rename 打同一个目标还会 EPERM。
   * 真出事的场景有两个：服务启动时 `ensureBuiltinCanvasMcp` 与 `ensureTestModel` 是并发
   * 发出的（server.ts 监听回调里两条 void），以及用户在设置页连点保存。
   *
   * 与 promptLock 分开：它们写的是不同文件（AGENTS.md / system_config.yaml / project_config.toml），
   * 互不相干；合成一把会让「建会话」把设置页的保存也堵住。
   */
  private configLock: Promise<void> = Promise.resolve()

  /** 排队取锁；返回释放函数 */
  private async acquirePromptLock(): Promise<() => void> {
    return acquireQueue(
      () => this.promptLock,
      (p) => (this.promptLock = p),
    )
  }

  /** 排队取配置写锁；返回释放函数 */
  private async acquireConfigLock(): Promise<() => void> {
    return acquireQueue(
      () => this.configLock,
      (p) => (this.configLock = p),
    )
  }

  /** 把一段「读 → 改 → 写」整体排进配置写队列 */
  protected async withConfigLock<T>(run: () => Promise<T>): Promise<T> {
    const release = await this.acquireConfigLock()
    try {
      return await run()
    } finally {
      release()
    }
  }

  /**
   * @param deps.kv 宿主注入的小数据 KV（与 /api/kv 同一份 settings.json）。
   *   必须注入，不给默认实现：默认一份内存 KV 会让「提示词改完重启就没了」这种坑
   *   在开发环境看不出来、上线才炸。
   */
  constructor(
    private readonly dataRoot: string,
    private readonly deps: { kv: AgentKvPort; skillSources?: string[] },
  ) {
    this.skillSources = deps.skillSources ?? agentSkillSources()
  }

  /**
   * 提示词清单的落点：与设置 / 快捷键同一条 KV（`{dataRoot}/settings.json` 的 `config` 桶）。
   *
   * 用户口径：提示词存在后台，用已有的 storeAdapter（KV）保存 —— 于是换台机器也在，
   * 且与「设置」这条已验证的链路同源，不必再开新存储。
   */
  protected get promptKv(): AgentKvPort {
    return this.deps.kv
  }

  /**
   * 读提示词清单。**首次为空时落上两条内置**，之后永远以 KV 里的为准。
   *
   * 为什么首次要落盘（而不是「读不到就现返回默认」）：用户改了内置项的正文之后，
   * 「读不到就返回默认」会把他的修改一直盖掉 —— 只有真的存过一次，修改才留得住。
   */
  async prompts(): Promise<PromptPreset[]> {
    const stored = await this.promptKv.get<PromptPreset[]>(AGENT_PROMPTS_KV_TYPE, AGENT_PROMPTS_KEY)
    if (Array.isArray(stored) && stored.length) return normalizePrompts(stored)
    const seed = DEFAULT_PROMPTS.map((p) => ({ ...p }))
    await this.promptKv.set(AGENT_PROMPTS_KV_TYPE, AGENT_PROMPTS_KEY, seed)
    return seed
  }

  /**
   * 整包写回提示词清单。
   *
   * 校验两件事：
   * 1. **内置项不允许被删**：传来的清单里必须仍含两个内置 id，缺了就补回（以默认内容为底）；
   * 2. id 唯一、name 非空 —— 否则下拉里会出现两个同名项。
   */
  async savePrompts(list: unknown): Promise<PromptPreset[]> {
    const incoming = Array.isArray(list) ? (list as PromptPreset[]) : []
    const byId = new Map<string, PromptPreset>()
    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object') continue
      const id = String((raw as PromptPreset).id ?? '').trim()
      const name = String((raw as PromptPreset).name ?? '').trim()
      const text = String((raw as PromptPreset).text ?? '')
      if (!id || !name) continue
      byId.set(id, { id, name, text, ...(raw.builtin ? { builtin: true } : {}) })
    }
    // 内置项必须在：被删掉的补回来（正文用默认；用户改过的会以传入的为准）
    for (const d of DEFAULT_PROMPTS) {
      const cur = byId.get(d.id)
      if (!cur) byId.set(d.id, { ...d })
      else byId.set(d.id, { ...cur, builtin: true })
    }
    const next = normalizePrompts([...byId.values()])
    await this.promptKv.set(AGENT_PROMPTS_KV_TYPE, AGENT_PROMPTS_KEY, next)
    return next
  }

  /** SDK 的数据根（全局配置住它下面） */
  protected get sdkRoot(): string {
    return agentRoot(this.dataRoot)
  }

  // ------------------------------------------------- 提示词模板体检与恢复

  /**
   * 提示词模板的体检结果。
   *
   * `missing` 里每一条都是「模板缺了什么」；空了就是健康。
   */
  async templateHealth(): Promise<{ ok: boolean; missing: string[]; template: string }> {
    await this.ensureInit()
    const cfg = await loadSystemConfig(this.sdkRoot)
    const template = String((cfg as { system_prompt?: unknown }).system_prompt ?? '')
    const missing = templateMissing(template)
    return { ok: missing.length === 0, missing, template }
  }

  /**
   * 把提示词模板恢复成 SDK 的出厂模板（**唯一会动到 system_prompt 的地方**）。
   *
   * ## 为什么必须留这个口子（根因）
   *
   * `system_prompt` 是 SDK **唯一**支持占位符替换的模板，而 {{AGENTS_MD}} 是它里面
   * 唯一把用户提示词送进模型的那根线。2026-10-06 的事故（AGENTS.md 被并发写截断）
   * 之后重建配置时，这份模板被写成了**纯文本**（只剩「你是 mini-canvas 画布助手。」），
   * 于是：
   *   - 设置页写的系统提示词（AGENTS.md）进不去模型；
   *   - 模式提示词（全能创作 / 剧本创编）进不去模型；
   *   - 引用标记说明、技能 / 记忆 / 密钥小节、Environment 那几行全都进不去。
   * 而模型端**不报任何错** —— 表现只是「它好像不太懂画布」，极难定位。
   * 真机证据：265 条会话里 259 条的系统提示词长度恒为 34 个字符。
   *
   * ## 为什么不自动修
   *
   * 出厂模板里有一大段 PenguinHarness 自己的角色设定（Role / Success criteria /
   * Tool use …），换回来会**明显改变这个 Agent 的性格**。这种改动必须让用户看见并
   * 自己点，不能在他没察觉时做（他就是被一次「不知不觉的自动重建」坑过的）。
   * 所以这里只提供动作，体检结果走 templateHealth() 给界面提示。
   */
  async restoreTemplate(): Promise<{ ok: boolean; missing: string[] }> {
    await this.ensureInit()
    await this.withConfigLock(async () => {
      const cfg = await loadSystemConfig(this.sdkRoot)
      const next = { ...cfg, system_prompt: defaultSystemConfig().system_prompt }
      await writeSystemConfig(this.sdkRoot, next)
    })
    return { ok: true, missing: [] }
  }

  /** 数据根（fork 写 Trace 种子要按它推 Trace 目录；只给服务内部用） */
  get dataDir(): string {
    return this.dataRoot
  }

  /**
   * 运行环境上下文（后台地址 + 目录）。宿主在**监听端口确定后**注入。
   *
   * 为什么由宿主注入而不是这里自己算：端口是运行期才知道的（port:0 由系统分配、
   * CLI 换端口兜底），算早了就会把一个错端口写进提示词 —— 那正是本次要修的毛病。
   */
  private context?: AgentRuntimeContext

  setRuntimeContext(ctx: AgentRuntimeContext): void {
    this.context = ctx
  }

  /** 当前上下文（没注入时用「地址还不知道 + 数据根」的兜底，保证目录照样能显示） */
  private contextOrDefault(): AgentRuntimeContext {
    return this.context ?? buildRuntimeContext({ baseUrl: '', dataRoot: this.dataRoot })
  }

  /** 界面要的上下文情报（地址 / 目录 / 可用占位符清单）。设置页的「插入占位符」用它 */
  contextInfo(): AgentContextInfo {
    return agentContextInfo(this.contextOrDefault())
  }

  /**
   * 后台还会自动往提示词里附加哪些内容（给设置页列出来）。
   *
   * 为什么由宿主注入而不是这里直接读注册场：config 是「Agent 的配置面」，不认识插件系统
   * （那是 serverFramework 的地盘）。跟 withSystemPrompt / promptSections 同一套注入风格。
   * 没注入 = 老宿主 / 单测 → 返回空数组（界面就不显示那一块）。
   */
  private sectionViews?: () => AgentPromptSectionView[]

  setPromptSectionViews(fn: () => AgentPromptSectionView[]): void {
    this.sectionViews = fn
  }

  promptSectionViews(): AgentPromptSectionView[] {
    try {
      return this.sectionViews?.() ?? []
    } catch {
      // 取小节视图失败不该让整条配置接口挂掉（界面少一块而已）
      return []
    }
  }

  /**
   * 把提示词正文里的自定义占位符（{{BACKEND_BASE_URL}} 等）展开成当前值。
   *
   * 只有一个调用点：`withSystemPrompt`（建会话前的临时替换）——**那一刻的值最新**，
   * 也正是 SDK 唯一会读 AGENTS.md 的时刻。落在磁盘上的正式 AGENTS.md 永不展开，
   * 所以记号一直保留着，端口变了下一句就对（见 systemPrompt 的说明）。
   */
  expandContext(text: string): string {
    return expandAgentContext(text, agentContextPlaceholders(this.contextOrDefault()))
  }

  /** 保证 Agent 已经初始化（幂等、串行），之后所有读都可以安全并行 */
  protected ensureInit(): Promise<void> {
    this.initPromise ??= loadAgentState({
      agentId: AGENT_ID,
      projectId: AGENT_PROJECT_ID,
      root: this.sdkRoot,
      init: {},
    })
      .then(() => undefined)
      .catch((err) => {
        // 初始化失败不要把它钉死在这里：下次调用应当重试（用户可能刚修好权限）
        this.initPromise = undefined
        throw err
      })
    return this.initPromise
  }

  // ------------------------------------------------------------------- 技能

  async skills(): Promise<AgentSkillView[]> {
    await this.ensureInit()
    const installed = await listInstalledSkills(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
    const dir = sdkSkillsDir(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
    const out: AgentSkillView[] = []
    for (const s of installed) {
      let size = 0
      let fileCount = 0
      try {
        const files = await walk(path.join(dir, s.name))
        fileCount = files.length
        const md = files.find((f) => f.rel.toLowerCase() === 'skill.md')
        size = md ? (await fs.stat(md.abs)).size : 0
      } catch {
        /* 目录在列举与 stat 之间消失：按空处理 */
      }
      out.push({ name: s.name, description: s.description ?? '', size, fileCount, dir: path.join(dir, s.name) })
    }
    return out
  }

  async skillCandidates(): Promise<AgentSkillCandidate[]> {
    const installedNames = new Set((await this.skills()).map((s) => s.name))
    const found: AgentSkillCandidate[] = []
    for (const root of this.skillSources) {
      let entries
      try {
        entries = await fs.readdir(root, { withFileTypes: true })
      } catch {
        continue // 来源目录不存在不是错误
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue
        const dir = path.join(root, e.name)
        let md: string
        try {
          md = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')
        } catch {
          continue
        }
        const meta = parseSkillFrontmatter(md)
        const name = (meta?.name ?? e.name).trim()
        found.push({
          name,
          description: meta?.description ?? '',
          dir,
          source: root,
          installed: installedNames.has(name),
        })
      }
    }
    return found.sort((a, b) => a.name.localeCompare(b.name))
  }

  async importSkill(dir: string): Promise<string> {
    const resolved = path.resolve(dir)
    // 只允许来源目录下的目录：UI 不该能让我们读任意路径
    const allowed = this.skillSources.some((root) => {
      const rel = path.relative(path.resolve(root), resolved)
      return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
    })
    if (!allowed) throw new Error('该目录不在已配置的技能来源中：' + dir)
    const files = await walk(resolved)
    const mdEntry = files.find((f) => f.rel.toLowerCase() === 'skill.md')
    if (!mdEntry) throw new Error('目录中没有 SKILL.md：' + dir)
    const content = await fs.readFile(mdEntry.abs, 'utf8')
    const meta = parseSkillFrontmatter(content)
    const name = (meta?.name ?? path.basename(resolved)).trim()
    const aux: Record<string, string> = {}
    for (const f of files) {
      if (f.rel.toLowerCase() === 'skill.md') continue
      aux[f.rel] = (await fs.readFile(f.abs)).toString('utf8')
    }
    await installSkill(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID, { name, content, files: aux })
    return name
  }

  async removeSkill(name: string): Promise<void> {
    await removeSkill(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID, name)
  }

  /** 读某个技能的 SKILL.md 全文（界面选了技能时要塞进 [use_skills] 块） */
  async readSkillFile(name: string): Promise<string | undefined> {
    try {
      const dir = sdkSkillsDir(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
      return await fs.readFile(path.join(dir, name, 'SKILL.md'), 'utf8')
    } catch {
      return undefined
    }
  }

  /**
   * 临时把 MCP 清单收窄成指定的几个，返回还原函数。
   *
   * SDK 在**会话第一次 run 时**才读 system_config.yaml 去连 MCP，所以
   * 「建会话之前换成子集、建完立刻还原」正好卡在这个点中间 —— 界面按对话选 MCP 就靠它。
   */
  async subsetMcp(names: string[]): Promise<() => Promise<void>> {
    await this.ensureInit()
    // 记住**收窄前的整份配置**：还原时写回的就是它。这段在锁里取，避免取到别的写中间态。
    const cfg = await this.withConfigLock(async () => {
      const current = await loadSystemConfig(this.sdkRoot)
      const all = current.tools?.mcpServers ?? []
      const kept = all.filter((e) => names.includes(e.name))
      await writeSystemConfig(this.sdkRoot, { ...current, tools: { ...(current.tools ?? {}), mcpServers: kept } })
      return current
    })
    return async () => {
      // 还原也走同一条队列：可能与另一次写同时落盘（否则 Windows 上又是一次 rename 撞车）
      await this.withConfigLock(() => writeSystemConfig(this.sdkRoot, cfg))
    }
  }

  /** 设置页要显示这层数据落在哪（诊断用） */
  systemConfigPath(): string {
    return systemConfigPath(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
  }

  stateDir(): string {
    return sdkAgentStateDir(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
  }
}

