/**
 * 运行环境上下文（后台地址 + 目录）—— 用户 2026-10-14 的诉求：
 * 「Agent 需要知道当前运行的后台 base URL，还有一些目录信息」。
 *
 * 两条通路各自的语义锁在这里：
 *   1. 常驻小节（runtimeContextSection）—— 每条会话都会追加，用户零配置；
 *   2. 占位符（agentContextPlaceholders / expandAgentContext）—— 用户在提示词里自己插。
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  agentContextInfo,
  agentContextPlaceholders,
  buildRuntimeContext,
  expandAgentContext,
  renderRuntimeContext,
  runtimeContextSection,
} from '../agent/runtimeContext'

const DATA = path.join('D:', 'data', '.mini-canvas')
const ctx = buildRuntimeContext({ baseUrl: 'http://127.0.0.1:8865/', dataRoot: DATA })

describe('运行环境上下文', () => {
  it('地址去掉尾斜杠（拼出来的 URL 不出现 //）', () => {
    expect(ctx.baseUrl).toBe('http://127.0.0.1:8865')
  })

  it('目录与 SDK 的路径口径逐字同形（agent 数据在 agent/<project>/agents/<id> 下）', () => {
    expect(ctx.canvasesRoot).toBe(path.join(DATA, 'canvases'))
    expect(ctx.assetsRoot).toBe(path.join(DATA, 'assets'))
    expect(ctx.taskScriptsDir).toBe(path.join(DATA, 'task-scripts'))
    expect(ctx.agentStateDir).toBe(
      path.join(DATA, 'agent', 'mini-canvas', 'agents', 'canvas-agent', 'agent_state'),
    )
    expect(ctx.skillsDir).toBe(path.join(ctx.agentStateDir, 'skills'))
    expect(ctx.scratchpadRoot).toBe(
      path.join(DATA, 'agent', 'mini-canvas', 'agents', 'canvas-agent', 'scratchpad'),
    )
  })

  it('给模型看的那一节：地址只给这一个、目录带命名规则、明说数据根不是任务输入', () => {
    const section = runtimeContextSection(ctx)
    expect(section.title).toBe('运行环境（本机后台）')
    const text = section.text
    expect(text).toContain('http://127.0.0.1:8865/api/canvases/<画布id>')
    expect(text).toContain('http://127.0.0.1:8865/api/assets')
    expect(text).toContain('不要猜端口')
    // 目录给父目录 + 命名规则，不穷举具体画布（穷举会随用户建画布过期）
    expect(text).toContain('canvases/<画布id>')
    expect(text).toContain('<会话id>')
    // 与默认模板同口径的两条红线
    expect(text).toContain('不是用户给的素材')
    expect(text).toContain('.vault.toml')
    // 本项目最常犯的错：产物留在工作目录再手动挂节点
    expect(text).toContain('落回**画布资源目录**')
  })

  it('Windows 路径写正斜杠（模型会把它搬进 JSON 和 shell 命令）', () => {
    if (process.platform !== 'win32') return
    const text = renderRuntimeContext(ctx)
    // 正斜杠：JSON 里不用转义，shell 里也认（SDK 的 modelVisiblePath 同口径）
    expect(text).toContain('D:/data/.mini-canvas/canvases')
    // 一个反斜杠都不许留（留了就要在 JSON 里转义，漏一次就是解析错）
    expect(text).not.toContain('\\')
  })

  it('占位符：地址与目录都给了当前值，且值就是它们', () => {
    const list = agentContextPlaceholders(ctx)
    const get = (t: string): string => list.find((p) => p.token === t)?.value ?? ''
    expect(get('{{BACKEND_BASE_URL}}')).toBe('http://127.0.0.1:8865')
    expect(get('{{CANVASES_DIR}}')).toBe(ctx.canvasesRoot.split(path.sep).join('/'))
    expect(get('{{ASSETS_DIR}}')).toBe(ctx.assetsRoot.split(path.sep).join('/'))
    expect(get('{{TASK_SCRIPTS_DIR}}')).toBe(ctx.taskScriptsDir.split(path.sep).join('/'))
    expect(get('{{SKILLS_DIR}}')).toBe(ctx.skillsDir.split(path.sep).join('/'))
    expect(get('{{SCRATCHPAD_DIR}}')).toBe(ctx.scratchpadRoot.split(path.sep).join('/'))
    expect(get('{{AGENT_STATE_DIR}}')).toBe(ctx.agentStateDir.split(path.sep).join('/'))
  })

  it('不重复实现 SDK 自带的记号（同名两套会互相抢）', () => {
    const list = agentContextPlaceholders(ctx)
    const harness = list.filter((p) => p.source === 'harness').map((p) => p.token)
    for (const t of ['{{CWD}}', '{{SESSION_ID}}', '{{SKILLS}}', '{{MEMORY}}', '{{AGENTS_MD}}']) {
      expect(harness).toContain(t)
      // 本服务那一组里不许出现同名
      expect(list.filter((p) => p.source === 'mini-canvas' && p.token === t)).toHaveLength(0)
    }
    // 按会话 / 按模型才定的值不给假值（用户会以为自己看到的就是模型看到的）
    expect(list.find((p) => p.token === '{{CWD}}')?.value).toBe('')
  })

  it('展开只动本服务那套记号（SDK 的留给 SDK）', () => {
    const out = expandAgentContext(
      '后台 {{BACKEND_BASE_URL}}，画布在 {{CANVASES_DIR}}；CWD={{CWD}} 会话={{SESSION_ID}}',
      agentContextPlaceholders(ctx),
    )
    expect(out).toBe(
      '后台 http://127.0.0.1:8865，画布在 ' +
        ctx.canvasesRoot.split(path.sep).join('/') +
        '；CWD={{CWD}} 会话={{SESSION_ID}}',
    )
  })

  it('展开用 split/join：值里带 $& 也不会被当成替换语法', () => {
    const weird = buildRuntimeContext({ baseUrl: 'http://x', dataRoot: 'C:\\a$&b' })
    const out = expandAgentContext('{{CANVASES_DIR}}', agentContextPlaceholders(weird))
    expect(out).toBe(weird.canvasesRoot.split(path.sep).join('/'))
    expect(out).toContain('$&')
  })

  it('界面情报：地址 + 目录清单 + 占位符清单都给全', () => {
    const info = agentContextInfo(ctx)
    expect(info.baseUrl).toBe('http://127.0.0.1:8865')
    expect(info.dirs.map((d) => d.label)).toEqual([
      '数据根',
      '画布',
      '资产库',
      '后台功能脚本',
      'Agent 状态',
      '技能',
      '会话草稿',
    ])
    expect(info.placeholders.length).toBeGreaterThan(10)
  })

  it('端口还没定（地址空）时也给得出目录，只是地址那行说明还没监听', () => {
    const early = buildRuntimeContext({ baseUrl: '', dataRoot: DATA })
    const text = runtimeContextSection(early).text
    expect(text).toContain('还没监听')
    expect(text).toContain(early.canvasesRoot.split(path.sep).join('/'))
  })
})
