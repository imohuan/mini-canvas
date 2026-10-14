/**
 * runtimeContext —— 把「这台后台自己是谁、目录都在哪」交给 Agent。
 *
 * ## 为什么需要它
 *
 * 模型干活时要拼地址、要找目录，而它原本只知道 Environment 里的 CWD / Session ID 那几行：
 *   - 后台监听地址：它不知道，只能猜端口（真机：模型自己拼 http://127.0.0.1:3000 去请求，
 *     而服务其实在别的端口，表现为「接口 404 / 连不上」）；
 *   - 目录：它只知道自己那个工作目录，不知道画布资源 / 资产库 / 技能 / 草稿在哪。
 *
 * ## 两条通路，各有各的用处
 *
 * 1. **常驻小节**（runtimeContextSection）：每条会话的系统提示词末尾都会追加它，
 *    用户什么都不用做 —— 走 SDK 留给宿主的正门 createAgent({ assembly: { promptSections } })；
 * 2. **占位符**（agentContextPlaceholders）：用户可以在自己的提示词正文里写
 *    {{BACKEND_BASE_URL}} / {{CANVASES_DIR}} 这类记号，由 AgentConfigService.expandContext
 *    在**建会话前**展开成当前值（端口变了下一句就对）。
 *
 * 第二条第 2 点为什么成立：SDK 组装时先把 AGENTS.md 灌进模板、再整体扫一遍占位符，
 * 所以 AGENTS.md 里的记号（含 SDK 自带的 {{CWD}} 等）本来就会被展开（2026-10-14 实测）。
 *
 * ## 为什么是纯函数
 *
 * 地址里的端口要**运行期**才知道（port: 0 由系统分配、CLI 换端口兜底），所以这里只接收
 * 已经定下来的值，不自己去读全局状态 —— 单测可以直接喂假路径。
 */
import os from 'node:os'
import path from 'node:path'
import type { PromptSection } from '@prismshadow/penguin-core'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot } from './agentPaths.js'

/**
 * 一个可插入自定义提示词的占位符。
 *
 * `value` 为空串表示「这行的值每轮不同」（按会话或按模型），此时界面只显示说明、不给当前值 ——
 * 写一个假值比不写更糟（用户会以为自己看到的就是模型看到的）。
 */
export interface AgentContextPlaceholder {
  /** 完整记号，如 `{{CANVASES_DIR}}` */
  token: string
  /** 这台服务上确定的当前值；空串 = 每轮不同，见 description */
  value: string
  /** 给用户看的一句话 */
  description: string
  /** 谁提供的：mini-canvas = 本服务加的；harness = SDK 自带（本服务不重复实现） */
  source: 'mini-canvas' | 'harness'
}

/** 界面 / 路由要的上下文情报（地址 + 目录 + 占位符清单） */
export interface AgentContextInfo {
  /** 后台地址（含真实端口）；空串 = 还没监听 */
  baseUrl: string
  /** 常驻小节里那几个目录（label 给界面直接显示） */
  dirs: Array<{ label: string; path: string }>
  placeholders: AgentContextPlaceholder[]
}

/** 渲染这一节要用到的全部坐标（都由宿主给） */
export interface AgentRuntimeContext {
  /** 后台服务自己的地址（**含真实端口**），如 http://127.0.0.1:8865 */
  baseUrl: string
  /** 数据根（画布 / 资产 / agent 三块都挂在它下面） */
  dataRoot: string
  /** 画布父目录：<数据根>/canvases（一张画布一个子目录） */
  canvasesRoot: string
  /** 资产库：<数据根>/assets */
  assetsRoot: string
  /** 后台功能脚本目录：<数据根>/task-scripts */
  taskScriptsDir: string
  /** Agent 状态目录：AGENTS.md / skills / memory 都在这 */
  agentStateDir: string
  /** 技能目录 */
  skillsDir: string
  /** 会话草稿父目录（每个会话一个子目录） */
  scratchpadRoot: string
}

/**
 * 按「数据根 + 后台地址」推全部目录。
 *
 * 每一段都与 SDK 自己算的路径**逐字同形**（见 agentPaths.ts 的说明）——
 * 这里写错一段，模型就会照着一个不存在的目录去找东西。
 */
export function buildRuntimeContext(deps: { baseUrl: string; dataRoot: string }): AgentRuntimeContext {
  const dataRoot = deps.dataRoot
  const root = agentRoot(dataRoot)
  const stateDir = path.join(root, AGENT_PROJECT_ID, 'agents', AGENT_ID, 'agent_state')
  return {
    baseUrl: (deps.baseUrl ?? '').replace(/\/+$/, ''),
    dataRoot,
    canvasesRoot: path.join(dataRoot, 'canvases'),
    assetsRoot: path.join(dataRoot, 'assets'),
    taskScriptsDir: path.join(dataRoot, 'task-scripts'),
    agentStateDir: stateDir,
    skillsDir: path.join(stateDir, 'skills'),
    scratchpadRoot: path.join(root, AGENT_PROJECT_ID, 'agents', AGENT_ID, 'scratchpad'),
  }
}

/**
 * 路径写成**正斜杠**：与 SDK 的 modelVisiblePath 同口径。
 *
 * 模型会把这些路径原样搬进 JSON 参数和 shell 命令；Windows 的反斜杠在 JSON 里要转义，
 * 一漏就报解析错（SDK 也是这么处理的，见官方文档「Windows 路径」一节）。
 */
function slash(p: string): string {
  return p.split('\\').join('/')
}

/** 系统版本（与 SDK 的 getOsVersion 同口径；取不到就 'unknown'） */
function osVersion(): string {
  try {
    return process.platform === 'win32' ? os.version() + ' ' + os.release() : os.type() + ' ' + os.release()
  } catch {
    return 'unknown'
  }
}

/** 今天（本地日期，YYYY-MM-DD；与 SDK 的 formatLocalDate 同口径） */
function today(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/**
 * 可插入的占位符清单。
 *
 * 分两组：
 *   - **mini-canvas**：本服务自己展开的（后台地址 + 目录）。SDK 不认识这些名字，
 *     所以由 AgentConfigService.expandContext 在建会话前替换掉；
 *   - **harness**：SDK 自带的（CWD / SESSION_ID / SKILLS …）。本服务不重复实现 ——
 *     同名两套会互相抢，反而说不清谁生效。
 */
export function agentContextPlaceholders(ctx: AgentRuntimeContext): AgentContextPlaceholder[] {
  return [
    {
      token: '{{BACKEND_BASE_URL}}',
      value: ctx.baseUrl,
      description: '这台后台的地址（含真实端口）',
      source: 'mini-canvas',
    },
    { token: '{{CANVASES_DIR}}', value: slash(ctx.canvasesRoot), description: '画布目录的父目录（一画布一个子目录）', source: 'mini-canvas' },
    { token: '{{ASSETS_DIR}}', value: slash(ctx.assetsRoot), description: '资产库目录（生成产物 + 上传的素材）', source: 'mini-canvas' },
    { token: '{{TASK_SCRIPTS_DIR}}', value: slash(ctx.taskScriptsDir), description: '后台功能脚本目录', source: 'mini-canvas' },
    { token: '{{SKILLS_DIR}}', value: slash(ctx.skillsDir), description: '技能目录（每个技能一个子目录）', source: 'mini-canvas' },
    { token: '{{SCRATCHPAD_DIR}}', value: slash(ctx.scratchpadRoot), description: '会话草稿目录（一会话一个子目录）', source: 'mini-canvas' },
    { token: '{{AGENT_STATE_DIR}}', value: slash(ctx.agentStateDir), description: 'Agent 状态目录（AGENTS.md / skills / memory）', source: 'mini-canvas' },
    { token: '{{CWD}}', value: '', description: '本会话的工作目录（每个画布一个）', source: 'harness' },
    { token: '{{SESSION_ID}}', value: '', description: '本会话的 id', source: 'harness' },
    { token: '{{PROJECT_DIR}}', value: '', description: 'App Data Dir（即数据根）', source: 'harness' },
    { token: '{{AGENT_ID}}', value: AGENT_ID, description: 'Agent id', source: 'harness' },
    { token: '{{DATE}}', value: today(), description: '今天（本地日期）', source: 'harness' },
    { token: '{{PLATFORM}}', value: process.platform, description: '运行平台', source: 'harness' },
    { token: '{{OS_VERSION}}', value: osVersion(), description: '操作系统版本', source: 'harness' },
    { token: '{{SHELL}}', value: '', description: '命令执行用的 Shell', source: 'harness' },
    { token: '{{PROVIDER}}', value: '', description: '本会话用的模型分组', source: 'harness' },
    { token: '{{MODEL_ID}}', value: '', description: '本会话用的上游模型 id', source: 'harness' },
    { token: '{{SKILLS}}', value: '', description: '技能小节（技能清单 + 怎么用）', source: 'harness' },
    { token: '{{MEMORY}}', value: '', description: '记忆小节（长期记忆索引）', source: 'harness' },
    { token: '{{SCHEDULES}}', value: '', description: '定时任务小节', source: 'harness' },
    { token: '{{VAULT}}', value: '', description: '密钥保险柜小节（只给键名，不给值）', source: 'harness' },
    { token: '{{AGENTS_MD}}', value: '', description: 'AGENTS.md 全文（写它就是把自己插一遍）', source: 'harness' },
  ]
}

/**
 * 把自定义占位符展开成当前值。
 *
 * 用 split/join 而不是 replace：值里出现 `$&` 之类的字符时 replace 会当成替换语法
 * （路径里出现 $ 的概率不为零，这种错起来极难查）。
 *
 * 只展开 source === 'mini-canvas' 的那些：SDK 自带的记号交给 SDK 自己展开
 * （它拿得到会话级的值，比如 {{CWD}}；我们这里展开会写出一个错的）。
 */
export function expandAgentContext(text: string, placeholders: AgentContextPlaceholder[]): string {
  let out = text
  for (const p of placeholders) {
    if (p.source !== 'mini-canvas' || !p.value) continue
    out = out.split(p.token).join(p.value)
  }
  return out
}

/** 界面要的上下文情报（设置页的「可用占位符」清单） */
export function agentContextInfo(ctx: AgentRuntimeContext): AgentContextInfo {
  return {
    baseUrl: ctx.baseUrl,
    dirs: [
      { label: '数据根', path: slash(ctx.dataRoot) },
      { label: '画布', path: slash(ctx.canvasesRoot) },
      { label: '资产库', path: slash(ctx.assetsRoot) },
      { label: '后台功能脚本', path: slash(ctx.taskScriptsDir) },
      { label: 'Agent 状态', path: slash(ctx.agentStateDir) },
      { label: '技能', path: slash(ctx.skillsDir) },
      { label: '会话草稿', path: slash(ctx.scratchpadRoot) },
    ],
    placeholders: agentContextPlaceholders(ctx),
  }
}

/**
 * 渲染成给模型看的一节（title + 正文）。
 *
 * 五条硬口径（每条都对着一个真机踩过的坑）：
 * 1. **地址只给这一个** —— 不给的话模型自己猜端口；
 * 2. **目录给「父目录 + 命名规则」而不是穷举** —— 一张画布一个目录，穷举会随用户建画布过期；
 * 3. **明确说「数据根不是任务输入」** —— 与 SDK 默认模板的 File system 一节同口径，
 *    否则模型可能把内部数据当素材用；
 * 4. **密钥文件一律不读** —— 与默认模板一致；
 * 5. **产物落回画布** —— 本项目最常犯的错：把图存到工作目录再手动挂节点。
 */
export function runtimeContextSection(ctx: AgentRuntimeContext): PromptSection {
  const base = ctx.baseUrl
  const lines = [
    '这台后台服务同时装着画布数据、资源与生成任务。需要取资源或调接口时，地址**只用下面这个**，不要猜端口。',
    '',
    '## 后台接口',
    '- 后台地址：' + (base || '（还不知道，服务还没监听）'),
    '- 画布本体：' + base + '/api/canvases/<画布id>',
    '- 画布资源（上传 / 回读）：' + base + '/api/canvases/<画布id>/resources/<文件名>',
    '- 资产库：' + base + '/api/assets',
    '- MCP 端点：' + base + '/mcp',
    '',
    '## 目录',
    '- 数据根：' + slash(ctx.dataRoot),
    '- 画布目录：' + slash(ctx.canvasesRoot) + '/<画布id>（资源在它的 resources/ 子目录里）',
    '- 资产库目录：' + slash(ctx.assetsRoot),
    '- 后台功能脚本：' + slash(ctx.taskScriptsDir),
    '- Agent 状态目录：' + slash(ctx.agentStateDir) + '（放 AGENTS.md、skills/、memory/）',
    '- 技能目录：' + slash(ctx.skillsDir),
    '- 会话草稿目录：' + slash(ctx.scratchpadRoot) + '/<会话id>',
    '- 工作目录：每个画布一个，就是 Environment 那行的 CWD；文件类工具出不去它。',
    '',
    '数据根里是这台服务自己的数据（画布 / 资产 / Agent 状态），**不是用户给的素材**，不要当任务输入去翻。',
    'agent_state/.vault.toml 与 .project_config.toml 一律不要读、不要抄、不要打印（里面是用户的密钥）。',
    '生成的产物一律落回**画布资源目录**（通过画布 MCP 或接口写回节点），不要留在工作目录里再手动挂上去。',
  ]
  return { title: '运行环境（本机后台）', text: lines.join('\n') }
}

/** 整节拼成一段纯文本（给断言与调试用；实际注入走 runtimeContextSection 的结构） */
export function renderRuntimeContext(ctx: AgentRuntimeContext): string {
  const s = runtimeContextSection(ctx)
  return '# ' + s.title + '\n' + s.text
}
