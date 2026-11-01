# Agent 插件（画布内对话助手）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 UI 里那套假的 Agent 面板做成真插件 + 真后台：对话由 `packages/cloud-server` 用 `@prismshadow/penguin-core` 提供（真模型、真流式、按画布隔离会话），Agent 相关的界面全部收进新包 `packages/plugins/plugin-agent`。

**Architecture:** 后台在 cloud-server 里新增 `src/agent/` 子系统（自包含、不引工作区包，这条是 cloud-server 的既有硬约束），会话转录落在 `canvases/<canvasId>/agent/`，模型/技能/MCP 是全局配置落在 `agent/<projectId>/`。前端新建 `plugin-agent`：**内容组件**（消息流 + 输入区）经 `agent-conversation` 槽渲染，状态挂在 `agent` 服务上，配置页挂在设置内容的 `settingsNav`/`settingsTab` 插槽上。**外壳（浮动 / 停靠 / 拖宽 / 头部按钮）归 `packages/ui`，不在插件里。**

**Tech Stack:** TypeScript、Hono、`@prismshadow/penguin-core@0.2.13`（Node ≥ 24）、Vue 3、vitest。

**Spec:** `docs/superpowers/specs/2026-10-01-agent-plugin-design.md`

## Global Constraints

- **cloud-server 不能 import 工作区包 `@mini-canvas/*`**（它要能独立 `npx` 跑）。`src/agent/` 里所有类型就地声明。
- 数据落点：`<数据根>/agent/`（全局配置，penguin 的数据根）+ `<数据根>/canvases/<canvasId>/agent/`（会话）。
- 画布 id 校验一律走 `src/store/canvasPaths.ts` 的 `isSafeCanvasId`（已存在，别另写一份正则）。
- `canvasId` 今天恒为 `default`（与 `plugin-cloud-client` 的 `CANVAS_ID` 一致）。
- 系统提醒的**文案**与**是否询问**是两件独立的事：文案（系统通知）已定要真做；询问需要往返通道，排在 Phase 3。
- 测试命令：`pnpm -C packages/cloud-server test`、`pnpm -C packages/plugins/plugin-agent test`、`pnpm -C packages/ui test`；类型检查：`pnpm -C <包> typecheck`。
- 全绿才前进。改动涉及 UI 时，另外跑 `pnpm -C packages/ui typecheck`。

## File Structure

### cloud-server（后台）

| 文件 | 职责 |
|---|---|
| `packages/cloud-server/src/agent/agentPaths.ts`（新） | agent 全局目录 + 画布会话目录的路径推导与安全校验（纯函数） |
| `packages/cloud-server/src/agent/sessionStore.ts`（新） | 会话索引与转录的读写（纯逻辑，注入数据根，可单测） |
| `packages/cloud-server/src/agent/translate.ts`（新） | SDK 消息 → 前端事件（纯函数，可单测） |
| `packages/cloud-server/src/agent/approval.ts`（新） | 审批档位与「哪类工具要问」（纯函数，可单测） |
| `packages/cloud-server/src/agent/config.ts`（新） | SDK 配置面：模型 / 技能 / MCP / 工具清单 |
| `packages/cloud-server/src/agent/runtime.ts`（新） | 会话生命周期：建 / 续 / 跑 / 打断 |
| `packages/cloud-server/src/routes/agent.ts`（新） | 全局配置路由 `/api/agent/*` |
| `packages/cloud-server/src/routes/agentSessions.ts`（新） | 画布会话路由 + SSE 对话流 |
| `packages/cloud-server/src/server.ts`（改） | 组装 agent 子系统并挂路由 |

### 前端插件（新包）

| 文件 | 职责 |
|---|---|
| `packages/plugins/plugin-agent/package.json`（新） | 包定义与依赖 |
| `packages/plugins/plugin-agent/tsconfig.json`（新） | 与 `plugin-bottom-bar` 同形 |
| `packages/plugins/plugin-agent/vitest.config.ts`（新） | 测试配置 |
| `packages/plugins/plugin-agent/src/index.ts`（新） | 出口 |
| `packages/plugins/plugin-agent/src/agentPlugin.ts`（新） | 插件主体：槽位 + 服务 + 命令 + 设置页 + Config |
| `packages/plugins/plugin-agent/src/agentApi.ts`（新） | 后端接口封装（fetch + SSE 解析），零 Vue 可单测 |
| `packages/plugins/plugin-agent/src/sessionModel.ts`（新） | 事件 → 消息列表的纯合并逻辑（含去重） |
| `packages/plugins/plugin-agent/src/approvalMode.ts`（新） | 前端侧「要不要问」的规则匹配（纯函数） |
| `packages/plugins/plugin-agent/src/notify.ts`（新） | 系统通知封装（浏览器 Notification，带降级） |
| `packages/plugins/plugin-agent/src/components/*.vue`（新） | 面板与子组件（从 `packages/ui` 迁移 + 改造） |
| `packages/plugins/plugin-agent/src/components/settings/*.vue`（新） | 三个配置页与导航/页签 |

### 宿主（改造）

| 文件 | 改动 |
|---|---|
| `packages/ui/src/App.vue` | `#ui` 内加 `<SlotHost slot="agent-conversation" />`；把 `ChatPanel.vue` 改造成外壳（浮动/停靠/拖宽 + 头部按钮，内嵌内容组件）；`right-width` 读 agent 服务 |
| `packages/ui/src/composables/ui.ts` | 删 chat/models/skills/director 那一整段；加 agent 服务的两处读 |
| `packages/ui/src/components/areas/ChatPanel.vue` | **删除**（内容搬进插件） |
| `packages/ui/src/components/areas/ModalsArea.vue` | 删 TV Director 设置弹窗 |
| `packages/ui/src/components/areas/DockArea.vue` | 删 TV Director 圆按钮 |
| `packages/ui/src/assembly.ts` | 清单加 `agentPlugin`（24 → 25），更新注释里的数字 |
| `packages/ui/src/__tests__/entrypoint.test.ts` | 断言 24 → 25 |
| `packages/ui/package.json`、`packages/ui/vite.config.ts` | 加依赖与 `optimizeDeps.exclude` 条目 |

---

## Phase 0 · 后台地基

### Task 1: agent 路径推导与安全校验

**Files:**
- Create: `packages/cloud-server/src/agent/agentPaths.ts`
- Test: `packages/cloud-server/src/__tests__/agentPaths.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `AGENT_PROJECT_ID: string` = `'mini-canvas'`
  - `AGENT_ID: string` = `'canvas-agent'`
  - `agentRoot(root: string): string` → `<root>/agent`
  - `agentStateDir(root: string): string` → `<root>/agent/<projectId>/agents/<agentId>/agent_state`
  - `agentSkillSources(): string[]` → 可导入技能来源目录（默认 `~/.agents/skills`）
  - `canvasAgentDir(root: string, canvasId: string): string` → `<root>/canvases/<canvasId>/agent`
  - `canvasSessionsFile(root: string, canvasId: string): string`
  - `canvasSessionsDir(root: string, canvasId: string): string`
  - `canvasSessionFile(root: string, canvasId: string, sessionId: string): string`
  - `canvasWorkspaceDir(root: string, canvasId: string): string`
  - `isSafeSessionId(id: string): boolean`

> 注意：`agentStateDir` 必须与 SDK 的 `agentStateDir(root, projectId, agentId)` **算出来一致**。测试里两条路径要逐字相等（这是本任务最容易写错的一点）。

- [ ] **Step 1: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/agentPaths.test.ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { agentStateDir as sdkAgentStateDir } from '@prismshadow/penguin-core'
import {
  AGENT_ID,
  AGENT_PROJECT_ID,
  agentRoot,
  agentStateDir,
  canvasAgentDir,
  canvasSessionFile,
  canvasSessionsDir,
  canvasSessionsFile,
  canvasWorkspaceDir,
  isSafeSessionId,
} from '../agent/agentPaths'

const root = 'tmp-root'

describe('agent 全局路径', () => {
  it('agent 根在 <root>/agent', () => {
    expect(agentRoot(root)).toBe(path.join(root, 'agent'))
  })

  it('agent_state 与 SDK 算出来的一致（这条防的是"两套路径漂移"）', () => {
    expect(agentStateDir(root)).toBe(sdkAgentStateDir(agentRoot(root), AGENT_PROJECT_ID, AGENT_ID))
  })
})

describe('画布会话路径', () => {
  it('落在 canvases/<id>/agent 下', () => {
    expect(canvasAgentDir(root, 'default')).toBe(path.join(root, 'canvases', 'default', 'agent'))
    expect(canvasSessionsFile(root, 'default')).toBe(
      path.join(root, 'canvases', 'default', 'agent', 'sessions.json'),
    )
    expect(canvasSessionsDir(root, 'default')).toBe(
      path.join(root, 'canvases', 'default', 'agent', 'sessions'),
    )
    expect(canvasWorkspaceDir(root, 'default')).toBe(
      path.join(root, 'canvases', 'default', 'agent', 'workspace'),
    )
  })

  it('非法画布 id 抛错（复用 canvasPaths 的校验）', () => {
    expect(() => canvasAgentDir(root, '../etc')).toThrow()
    expect(() => canvasSessionsFile(root, 'a/b')).toThrow()
  })

  it('会话 id 安全校验：拒绝路径穿越', () => {
    expect(isSafeSessionId('session-2026-10-01-12-00-00-ab12cd34')).toBe(true)
    expect(isSafeSessionId('..')).toBe(false)
    expect(isSafeSessionId('a/b')).toBe(false)
    expect(isSafeSessionId('')).toBe(false)
    expect(() => canvasSessionFile(root, 'default', '../x')).toThrow()
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test agentPaths`
Expected: FAIL —— 找不到模块 `../agent/agentPaths`

- [ ] **Step 3: 写最小实现**

```ts
// packages/cloud-server/src/agent/agentPaths.ts
/**
 * agent 子系统的路径推导（纯函数，零依赖）。
 *
 * 两类数据落点不同，本文件把这件事钉在一处：
 * - **全局配置**（模型 / 技能 / MCP）→ `<root>/agent/<projectId>/agents/<agentId>/agent_state`，
 *   与 penguin SDK 自己算的路径**必须逐字一致**（否则我们写一份、SDK 读另一份）。
 * - **会话**（转录 + 索引 + 工作目录）→ `<root>/canvases/<canvasId>/agent/`，
 *   跟着画布走：删画布 = 删这个目录（用户口径）。
 */
import path from 'node:path'
import os from 'node:os'
import { canvasDir, isSafeCanvasId } from '../store/canvasPaths.js'

/** penguin 项目 id（全局一个；模型/技能/MCP 都挂它下面） */
export const AGENT_PROJECT_ID = 'mini-canvas'
/** Agent id（全局一个；会话不按 agent 分，按画布分） */
export const AGENT_ID = 'canvas-agent'

/** 全部 agent 数据的根：SDK 的 "root" 参数就是它 */
export function agentRoot(root: string): string {
  return path.join(root, 'agent')
}

/** <agentRoot>/<projectId>/agents/<agentId> */
export function agentDirPath(root: string): string {
  return path.join(agentRoot(root), AGENT_PROJECT_ID, 'agents', AGENT_ID)
}

/** <agentDir>/agent_state（与 SDK 的 agentStateDir 同形） */
export function agentStateDir(root: string): string {
  return path.join(agentDirPath(root), 'agent_state')
}

/**
 * 一键导入技能的候选来源目录。
 *
 * 默认扫用户自己的技能收藏夹（与参考项目同一处）；测试里经 createCloudServer 的
 * `agentSkillSources` 覆盖，不去读真实家目录。
 */
export function agentSkillSources(): string[] {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir()
  return [path.join(home, '.agents', 'skills')]
}

/** 会话 id 白名单：字母数字下划线连字符点（SDK 的 session-2026-... 形态），1-128 位，拒 .. */
export function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

/** <root>/canvases/<canvasId>/agent */
export function canvasAgentDir(root: string, canvasId: string): string {
  if (!isSafeCanvasId(canvasId)) throw new Error('[agentPaths] 非法画布 id: ' + canvasId)
  return path.join(canvasDir(root, canvasId), 'agent')
}

export function canvasSessionsFile(root: string, canvasId: string): string {
  return path.join(canvasAgentDir(root, canvasId), 'sessions.json')
}

export function canvasSessionsDir(root: string, canvasId: string): string {
  return path.join(canvasAgentDir(root, canvasId), 'sessions')
}

export function canvasSessionFile(root: string, canvasId: string, sessionId: string): string {
  if (!isSafeSessionId(sessionId)) throw new Error('[agentPaths] 非法会话 id: ' + sessionId)
  return path.join(canvasSessionsDir(root, canvasId), sessionId + '.json')
}

/** 会话的工作目录（D6：Agent 的文件类工具被限制在本画布目录内） */
export function canvasWorkspaceDir(root: string, canvasId: string): string {
  return path.join(canvasAgentDir(root, canvasId), 'workspace')
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test agentPaths`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/cloud-server/src/agent/agentPaths.ts packages/cloud-server/src/__tests__/agentPaths.test.ts
git commit -m "feat(cloud-server): agent 路径推导（全局配置 + 按画布的会话）"
```

---

### Task 2: 会话索引与转录的落盘

**Files:**
- Create: `packages/cloud-server/src/agent/sessionStore.ts`
- Test: `packages/cloud-server/src/__tests__/agentSessionStore.test.ts`

**Interfaces:**
- Consumes: Task 1 的路径函数
- Produces:
  ```ts
  export interface AgentTurn { role: 'user' | 'assistant' | 'thinking' | 'tool'; text: string; ts: number }
  export interface AgentSessionMeta {
    id: string              // 我们自己的 id（= SDK 的 sessionId）
    title: string
    createdAt: number
    updatedAt: number
    provider: string
    modelId: string
    /** 转录里最后一条可读文本（列表页展示用） */
    preview?: string
  }
  export interface AgentSessionRecord extends AgentSessionMeta { turns: AgentTurn[] }
  export class AgentSessionStore {
    constructor(private readonly root: string) {}
    list(canvasId: string): Promise<AgentSessionMeta[]>
    get(canvasId: string, sessionId: string): Promise<AgentSessionRecord | undefined>
    ensure(canvasId: string, meta: Omit<AgentSessionMeta, 'updatedAt'>): Promise<AgentSessionRecord>
    appendTurn(canvasId: string, sessionId: string, turn: AgentTurn): Promise<void>
    rename(canvasId: string, sessionId: string, title: string): Promise<boolean>
    remove(canvasId: string, sessionId: string): Promise<boolean>
    /** 删掉整张画布的 agent 目录（删画布时调用） */
    removeCanvas(canvasId: string): Promise<void>
  }
  ```

- [ ] **Step 1: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/agentSessionStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentSessionStore } from '../agent/sessionStore'

let root: string
let store: AgentSessionStore

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sessions-'))
  store = new AgentSessionStore(root)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const meta = {
  id: 'session-2026-10-01-12-00-00-ab12cd34',
  title: '新会话',
  createdAt: 1000,
  provider: 'deepseek',
  modelId: 'deepseek-chat',
}

describe('会话索引与转录', () => {
  it('空画布列出空数组（不是报错）', async () => {
    expect(await store.list('default')).toEqual([])
  })

  it('ensure 后能列出并读到（含落到磁盘的那份索引）', async () => {
    await store.ensure('default', meta)
    const list = await store.list('default')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(meta.id)
    expect(list[0].updatedAt).toBeGreaterThan(0)
    const rec = await store.get('default', meta.id)
    expect(rec?.turns).toEqual([])
    const raw = JSON.parse(
      await fs.readFile(path.join(root, 'canvases', 'default', 'agent', 'sessions.json'), 'utf8'),
    )
    expect(raw.sessions).toHaveLength(1)
  })

  it('appendTurn 追加并刷新 updatedAt 与 preview', async () => {
    await store.ensure('default', meta)
    await store.appendTurn('default', meta.id, { role: 'user', text: '你好', ts: 2000 })
    await store.appendTurn('default', meta.id, { role: 'assistant', text: '在的', ts: 2001 })
    const rec = await store.get('default', meta.id)
    expect(rec?.turns.map((t) => t.text)).toEqual(['你好', '在的'])
    expect(rec?.preview).toBe('在的')
    expect(rec?.updatedAt).toBeGreaterThanOrEqual(2001)
  })

  it('首次 appendTurn 会自动建会话（进程重启后继续追加的场景）', async () => {
    await store.appendTurn('default', meta.id, { role: 'user', text: 'hi', ts: 1 })
    expect(await store.list('default')).toHaveLength(1)
  })

  it('两个画布互不串（会话按画布隔离）', async () => {
    await store.ensure('default', meta)
    expect(await store.list('other')).toEqual([])
  })

  it('rename 改标题；remove 删掉会话与其转录文件', async () => {
    await store.ensure('default', meta)
    expect(await store.rename('default', meta.id, '换个名字')).toBe(true)
    expect((await store.get('default', meta.id))?.title).toBe('换个名字')
    expect(await store.remove('default', meta.id)).toBe(true)
    expect(await store.list('default')).toEqual([])
    expect(await store.get('default', meta.id)).toBeUndefined()
    await expect(
      fs.access(path.join(root, 'canvases', 'default', 'agent', 'sessions', meta.id + '.json')),
    ).rejects.toThrow()
  })

  it('removeCanvas 把整张画布的 agent 目录清掉', async () => {
    await store.ensure('default', meta)
    await store.removeCanvas('default')
    await expect(fs.access(path.join(root, 'canvases', 'default'))).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test agentSessionStore`
Expected: FAIL —— 找不到模块 `../agent/sessionStore`

- [ ] **Step 3: 写最小实现**

```ts
// packages/cloud-server/src/agent/sessionStore.ts
/**
 * AgentSessionStore —— 一个画布下的会话索引与转录（纯逻辑，注入数据根，可单测）。
 *
 * 为什么自己存一份：SDK 的 `resumeSession` 恢复的是**模型上下文**（它自己的 trace），
 * 而界面要渲染的是"我们这轮聊了什么"。两者用途不同：
 * - trace 给 SDK 续上下文；本文件给界面回放（刷新 / 重启后都读它）。
 *
 * 落点（`canvases/<canvasId>/agent/`）跟着画布走 → 删画布即删会话（与画布文件夹同一棵树）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { canvasAgentDir, canvasSessionFile, canvasSessionsDir, canvasSessionsFile } from './agentPaths.js'

export interface AgentTurn {
  role: 'user' | 'assistant' | 'thinking' | 'tool'
  text: string
  ts: number
}

export interface AgentSessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  provider: string
  modelId: string
  preview?: string
}

export interface AgentSessionRecord extends AgentSessionMeta {
  turns: AgentTurn[]
}

interface IndexFile {
  sessions: AgentSessionMeta[]
}

export class AgentSessionStore {
  constructor(private readonly root: string) {}

  /** 会话列表（新的在前）。索引文件不存在 = 还没有会话，返回空数组 */
  async list(canvasId: string): Promise<AgentSessionMeta[]> {
    const idx = await this.readIndex(canvasId)
    return [...idx.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(canvasId: string, sessionId: string): Promise<AgentSessionRecord | undefined> {
    const raw = await readJson<AgentSessionRecord>(canvasSessionFile(this.root, canvasId, sessionId))
    return raw
  }

  /** 建目录 + 落一份带元信息的转录文件；已存在则原样返回（不覆盖转录） */
  async ensure(canvasId: string, meta: Omit<AgentSessionMeta, 'updatedAt'>): Promise<AgentSessionRecord> {
    const existing = await this.get(canvasId, meta.id)
    if (existing) return existing
    const record: AgentSessionRecord = { ...meta, updatedAt: Date.now(), turns: [] }
    await this.writeRecord(canvasId, record)
    await this.upsertIndex(canvasId, record)
    return record
  }

  /** 追加一条并同步索引里的 updatedAt / preview（会话不存在时自动建） */
  async appendTurn(canvasId: string, sessionId: string, turn: AgentTurn): Promise<void> {
    let record = await this.get(canvasId, sessionId)
    if (!record) {
      record = await this.ensure(canvasId, {
        id: sessionId,
        title: '新会话',
        createdAt: turn.ts,
        provider: 'default',
        modelId: 'default',
      })
    }
    record.turns.push(turn)
    record.updatedAt = Date.now()
    // 预览只取"给人看的那两类"，thinking / tool 不参与（它们只是过程）
    if (turn.role === 'user' || turn.role === 'assistant') record.preview = turn.text.slice(0, 120)
    await this.writeRecord(canvasId, record)
    await this.upsertIndex(canvasId, record)
  }

  async rename(canvasId: string, sessionId: string, title: string): Promise<boolean> {
    const record = await this.get(canvasId, sessionId)
    if (!record) return false
    record.title = title
    await this.writeRecord(canvasId, record)
    await this.upsertIndex(canvasId, record)
    return true
  }

  async remove(canvasId: string, sessionId: string): Promise<boolean> {
    const idx = await this.readIndex(canvasId)
    const next = idx.sessions.filter((s) => s.id !== sessionId)
    if (next.length === idx.sessions.length) return false
    await writeJson(canvasSessionsFile(this.root, canvasId), { sessions: next })
    await fs.rm(canvasSessionFile(this.root, canvasId, sessionId), { force: true })
    return true
  }

  /** 删整张画布的 agent 目录（删画布时调用；目录不存在也当成功） */
  async removeCanvas(canvasId: string): Promise<void> {
    await fs.rm(canvasAgentDir(this.root, canvasId), { recursive: true, force: true })
  }

  private async readIndex(canvasId: string): Promise<IndexFile> {
    const raw = await readJson<IndexFile>(canvasSessionsFile(this.root, canvasId))
    return { sessions: Array.isArray(raw?.sessions) ? raw.sessions : [] }
  }

  private async writeRecord(canvasId: string, record: AgentSessionRecord): Promise<void> {
    await fs.mkdir(canvasSessionsDir(this.root, canvasId), { recursive: true })
    await writeJson(canvasSessionFile(this.root, canvasId, record.id), record)
  }

  /** 索引里同 id 覆盖、否则追加（顺序按 updatedAt 排，list 时再排一次） */
  private async upsertIndex(canvasId: string, record: AgentSessionRecord): Promise<void> {
    const idx = await this.readIndex(canvasId)
    const meta: AgentSessionMeta = {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      provider: record.provider,
      modelId: record.modelId,
      ...(record.preview !== undefined ? { preview: record.preview } : {}),
    }
    const next = idx.sessions.filter((s) => s.id !== record.id)
    next.push(meta)
    await writeJson(canvasSessionsFile(this.root, canvasId), { sessions: next })
  }
}

/** 读 JSON；不存在 / 内容坏掉都返回 undefined 并出声（与 canvasStore 同口径） */
async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.warn('[agentSessionStore] ' + file + ' 不是合法 JSON，按缺失处理')
      return undefined
    }
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT') {
      return undefined
    }
    throw err
  }
}

/** 原子写（先临时文件再 rename），与 canvasStore 同一套做法 */
async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(tmp, file)
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test agentSessionStore`
Expected: PASS（7 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/cloud-server/src/agent/sessionStore.ts packages/cloud-server/src/__tests__/agentSessionStore.test.ts
git commit -m "feat(cloud-server): 画布会话索引与转录落盘（按画布隔离）"
```
---

### Task 3: SDK 消息 → 前端事件（纯函数）

**Files:**
- Create: `packages/cloud-server/src/agent/translate.ts`
- Test: `packages/cloud-server/src/__tests__/agentTranslate.test.ts`

**Interfaces:**
- Consumes: 无（只吃 SDK 的 `OmniMessage` 形状）
- Produces:
  ```ts
  export type AgentChatEvent =
    | { type: 'session'; sessionId: string; title: string }
    | { type: 'text'; delta?: string; text?: string; partial?: boolean; final?: boolean }
    | { type: 'thinking'; delta?: string; text?: string; partial?: boolean; final?: boolean }
    | { type: 'tool_call'; id: string; name: string; arguments: string }
    | { type: 'tool_output'; id: string; output: string }
    | { type: 'notice'; message: string }
    | { type: 'error'; message: string }
    | { type: 'done' }
  export function translateMessage(msg: unknown, log?: (m: string, extra?: unknown) => void): AgentChatEvent[]
  ```

> 要点：`request_end.status === 'completed'` 是**成功**，不产出事件；只有 `retryable` / `fatal` / `aborted` 才说话（参考项目踩过"成功后误报错误"）。

- [ ] **Step 1: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/agentTranslate.test.ts
import { describe, it, expect } from 'vitest'
import { translateMessage } from '../agent/translate'

/** 造一条"模型消息"：SDK 的 isModelMessage 判定形状 */
const model = (payload: Record<string, unknown>) => ({ type: 'model_msg', payload })
/** 造一条"事件消息" */
const event = (payload: Record<string, unknown>) => ({ type: 'event_msg', payload })

describe('模型消息翻译', () => {
  it('partial_text delta → text.partial', () => {
    expect(translateMessage(model({ type: 'partial_text', event_type: 'delta', text: '你' }))).toEqual([
      { type: 'text', delta: '你', partial: true },
    ])
  })

  it('text 完整块 → text.final', () => {
    expect(translateMessage(model({ type: 'text', text: '你好' }))).toEqual([
      { type: 'text', text: '你好', final: true },
    ])
  })

  it('thinking 的 delta 与完整块分别出 partial / final', () => {
    expect(translateMessage(model({ type: 'partial_thinking', event_type: 'delta', thinking: '想' }))).toEqual([
      { type: 'thinking', delta: '想', partial: true },
    ])
    expect(translateMessage(model({ type: 'thinking', thinking: '想好了' }))).toEqual([
      { type: 'thinking', text: '想好了', final: true },
    ])
  })

  it('tool_call / tool_call_output → 对应事件', () => {
    expect(
      translateMessage(model({ type: 'tool_call', tool_call_id: 't1', name: 'canvas.get', arguments: '{}' })),
    ).toEqual([{ type: 'tool_call', id: 't1', name: 'canvas.get', arguments: '{}' }])
    expect(
      translateMessage(model({ type: 'tool_call_output', tool_call_id: 't1', output: 'ok' })),
    ).toEqual([{ type: 'tool_output', id: 't1', output: 'ok' }])
  })

  it('没见过的模型消息类型：出声但不产出事件（不静默丢）', () => {
    const warned: string[] = []
    const out = translateMessage(model({ type: 'brand_new' }), (m) => warned.push(m))
    expect(out).toEqual([])
    expect(warned).toHaveLength(1)
  })
})

describe('事件消息翻译', () => {
  it('request_end 成功（completed）不说话 —— 成功不该被当成失败', () => {
    expect(translateMessage(event({ type: 'request_end', status: 'completed' }))).toEqual([])
  })

  it('request_end 失败给 error（fatal）/ notice（可重试）', () => {
    const fatal = translateMessage(event({ type: 'request_end', status: 'fatal', error_message: '密钥无效' }))
    expect(fatal[0].type).toBe('error')
    expect(String((fatal[0] as { message: string }).message)).toContain('密钥无效')
    const retry = translateMessage(event({ type: 'request_end', status: 'retryable', error_message: '超时' }))
    expect(retry[0].type).toBe('notice')
  })

  it('mcp_connect_end 失败时把原因说出来（否则用户只看到"模型没工具"）', () => {
    const out = translateMessage(
      event({
        type: 'mcp_connect_end',
        results: [{ server: 'canvas', status: 'error', error: 'connect ECONNREFUSED' }],
      }),
    )
    expect(out[0].type).toBe('error')
    expect(String((out[0] as { message: string }).message)).toContain('canvas')
  })

  it('mcp_connect_end 成功时给一条可见的 notice', () => {
    const out = translateMessage(
      event({ type: 'mcp_connect_end', results: [{ server: 'canvas', status: 'completed', tools: 7 }] }),
    )
    expect(out[0]).toEqual({ type: 'notice', message: '已连接 MCP：canvas(7 个工具)' })
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test agentTranslate`
Expected: FAIL —— 找不到模块 `../agent/translate`

- [ ] **Step 3: 写最小实现**

```ts
// packages/cloud-server/src/agent/translate.ts
/**
 * translate —— 把 SDK 的 OmniMessage 翻成前端能懂的事件（纯函数，可单测）。
 *
 * 三条从参考项目学来的口径（都是踩过的坑）：
 * 1. `request_end.status === 'completed'` 是**成功**，不该产出事件 —— 曾把 completed 当失败，
 *    于是每次正常回答后面都跟一条红字。
 * 2. `partial_*` 的 delta 是增量，完整块（`text` / `thinking`）是**整块**；两者都发，
 *    由前端按块去重（前端见 sessionModel.ts）。后端不做去重，因为它不知道前端收到了什么。
 * 3. 没见过的类型要**出声**（log），不能静默丢 —— 一条什么都不产出的流最难查。
 */
export type AgentChatEvent =
  | { type: 'session'; sessionId: string; title: string }
  | { type: 'text'; delta?: string; text?: string; partial?: boolean; final?: boolean }
  | { type: 'thinking'; delta?: string; text?: string; partial?: boolean; final?: boolean }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_output'; id: string; output: string }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

type Log = (message: string, extra?: unknown) => void

/** 判断是不是"模型消息"（SDK 的 isModelMessage 等效实现；不 import 是为了可独立单测） */
function isModel(msg: unknown): boolean {
  const t = (msg as { type?: string } | undefined)?.type
  return t === 'model_msg'
}

/** 翻译一条 SDK 消息 */
export function translateMessage(msg: unknown, log?: Log): AgentChatEvent[] {
  const m = msg as { type?: string; payload?: Record<string, unknown> }
  const payload = (m?.payload ?? {}) as Record<string, unknown>

  if (m?.type === 'session_meta') {
    const sessionId = String(payload.session_id ?? '')
    return sessionId ? [{ type: 'session', sessionId, title: '' }] : []
  }

  if (!isModel(msg)) return eventNotice(payload, log)

  const p = payload
  switch (p.type) {
    case 'partial_text':
      return p.event_type === 'delta' ? [{ type: 'text', delta: String(p.text ?? ''), partial: true }] : []
    case 'partial_thinking':
      return p.event_type === 'delta'
        ? [{ type: 'thinking', delta: String(p.thinking ?? ''), partial: true }]
        : []
    case 'text':
      return [{ type: 'text', text: String(p.text ?? ''), final: true }]
    case 'thinking':
      return [{ type: 'thinking', text: String(p.thinking ?? ''), final: true }]
    case 'tool_call':
      return [
        {
          type: 'tool_call',
          id: String(p.tool_call_id ?? ''),
          name: String(p.name ?? ''),
          arguments: typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.arguments ?? null),
        },
      ]
    case 'tool_call_output':
      return [{ type: 'tool_output', id: String(p.tool_call_id ?? ''), output: String(p.output ?? '') }]
    case 'partial_tool_call':
    case 'partial_tool_call_output':
      return []
    default:
      // 不静默：没见过的模型消息类型要留下痕迹
      log?.('unhandled model payload type', { type: p.type })
      return []
  }
}

/**
 * 把 SDK 的"事件消息"翻成给用户看的提示。
 *
 * `request_end.status` 用共享的 StopReason 词表（completed | aborted | retryable | fatal）；
 * completed 是成功、aborted 是用户按了停止 —— 两者都不必说话。
 */
function eventNotice(p: Record<string, unknown>, log?: Log): AgentChatEvent[] {
  switch (p.type) {
    case 'mcp_connect_end': {
      const results = Array.isArray(p.results) ? (p.results as Array<Record<string, unknown>>) : []
      const failed = results.filter((r) => String(r.status) !== 'completed')
      if (failed.length) {
        return [
          {
            type: 'error',
            message:
              'MCP 连接失败：' +
              failed.map((r) => String(r.server ?? '') + ' — ' + String(r.error ?? r.status ?? '')).join('；'),
          },
        ]
      }
      const ok = results.map((r) => String(r.server ?? '') + '(' + String(r.tools ?? 0) + ' 个工具)').join('、')
      return ok ? [{ type: 'notice', message: '已连接 MCP：' + ok }] : []
    }
    case 'request_end': {
      const status = String(p.status ?? '')
      if (status === 'completed' || status === 'aborted') return []
      const code = String(p.error_code ?? '')
      const detail = String(p.error_message ?? '')
      if (code === 'network' && /Invalid URL/i.test(detail)) {
        return [
          {
            type: 'error',
            message:
              '模型请求的地址无效（Invalid URL）。多半是模型设置里的 Base URL 填错了 —— ' +
              '它必须是完整地址（例如 https://api.deepseek.com），而不是模型名。',
          },
        ]
      }
      return [
        {
          type: status === 'fatal' ? 'error' : 'notice',
          message:
            status === 'fatal'
              ? '模型请求失败：' + (detail || code || status) + '（不会重试，需要先改配置）'
              : '模型请求失败：' + (detail || code || status),
        },
      ]
    }
    case 'abort':
      return []
    default:
      // 事件类消息数量最多（每个请求好几种），只记不报，避免把日志刷满
      log?.('non-model message', { type: p.type })
      return []
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test agentTranslate`
Expected: PASS（9 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/cloud-server/src/agent/translate.ts packages/cloud-server/src/__tests__/agentTranslate.test.ts
git commit -m "feat(cloud-server): SDK 消息 → 前端事件（含成功不误报、未知类型出声）"
```

---

### Task 4: 审批档位（纯函数）

**Files:**
- Create: `packages/cloud-server/src/agent/approval.ts`
- Test: `packages/cloud-server/src/__tests__/agentApproval.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  ```ts
  export type ApprovalMode = 'auto' | 'ask' | 'deny-list'
  export interface ApprovalPolicy { mode: ApprovalMode; askTools: string[]; denyTools: string[] }
  export const DEFAULT_POLICY: ApprovalPolicy
  export type ApprovalDecision = 'allow' | 'deny' | 'ask'
  export function decideTool(policy: ApprovalPolicy, toolName: string): ApprovalDecision
  /** 通配匹配：'web2api:*' / '*.generate*' / 精确名 */
  export function matchesPattern(pattern: string, toolName: string): boolean
  ```

- [ ] **Step 1: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/agentApproval.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_POLICY, decideTool, matchesPattern, type ApprovalPolicy } from '../agent/approval'

const policy = (over: Partial<ApprovalPolicy> = {}): ApprovalPolicy => ({
  ...DEFAULT_POLICY,
  ...over,
})

describe('通配匹配', () => {
  it('精确名', () => {
    expect(matchesPattern('exec_command', 'exec_command')).toBe(true)
    expect(matchesPattern('exec_command', 'read_file')).toBe(false)
  })
  it('前缀星', () => {
    expect(matchesPattern('web2api:*', 'web2api:doubao-tts')).toBe(true)
    expect(matchesPattern('mcp__canvas__*', 'mcp__canvas__canvas.get')).toBe(true)
    expect(matchesPattern('mcp__canvas__*', 'mcp__other__x')).toBe(false)
  })
  it('两侧星', () => {
    expect(matchesPattern('*generate*', 'doubao-generate-image')).toBe(true)
    expect(matchesPattern('*generate*', 'canvas.get')).toBe(false)
  })
})

describe('审批档位', () => {
  it('默认档是全放行（用户口径：自动放行就行）', () => {
    expect(DEFAULT_POLICY.mode).toBe('auto')
    expect(decideTool(DEFAULT_POLICY, 'exec_command')).toBe('allow')
    expect(decideTool(DEFAULT_POLICY, 'canvas.batch_nodes')).toBe('allow')
  })

  it('默认询问清单含本地命令与写文件（用户口径：只让我执行他提供的工具）', () => {
    expect(DEFAULT_POLICY.askTools).toContain('exec_command')
    expect(DEFAULT_POLICY.askTools.some((p) => p.includes('write'))).toBe(true)
  })

  it('auto 档忽略询问清单（全放行）', () => {
    expect(decideTool(policy({ mode: 'auto', askTools: ['exec_command'] }), 'exec_command')).toBe('allow')
  })

  it('ask 档：命中询问清单 → ask，其余放行', () => {
    const p = policy({ mode: 'ask', askTools: ['web2api:*'] })
    expect(decideTool(p, 'web2api:doubao-tts')).toBe('ask')
    expect(decideTool(p, 'canvas.get')).toBe('allow')
  })

  it('deny-list 档：命中拒绝清单 → deny，其余放行', () => {
    const p = policy({ mode: 'deny-list', denyTools: ['exec_command'] })
    expect(decideTool(p, 'exec_command')).toBe('deny')
    expect(decideTool(p, 'canvas.get')).toBe('allow')
  })

  it('deny 清单优先于 ask 清单（同一条命中两边时拒绝）', () => {
    const p = policy({ mode: 'ask', askTools: ['x:*'], denyTools: ['x:bad'] })
    expect(decideTool(p, 'x:bad')).toBe('deny')
    expect(decideTool(p, 'x:good')).toBe('ask')
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test agentApproval`
Expected: FAIL —— 找不到模块 `../agent/approval`

- [ ] **Step 3: 写最小实现**

```ts
// packages/cloud-server/src/agent/approval.ts
/**
 * approval —— 工具的审批策略（纯函数，可单测）。
 *
 * 用户口径（2026-10-01）：
 * - 默认**全放行**（等于参考项目的"协作模式"开启）："自动放行就行"。
 * - 可以配置成"手动控制"：比如执行生图这类动作前必须先问。
 * - 他只会让 Agent 执行他提供的工具（操作画布、创建任务、写文档），
 *   **不会让它跑本地命令脚本** —— 所以默认询问清单里放着 `exec_command` 与写文件类工具：
 *   档位虽是全放行，真调到"询问"档时这几个也是要被拦下来问的。
 *
 * 特意不按"工具名看起来像不像危险"猜：参考项目试过，结果是模型调个只读工具也被拒，
 * 然后它跟用户说自己的工具坏了。所以规则只有一份显式清单，由用户配置。
 */
export type ApprovalMode = 'auto' | 'ask' | 'deny-list'

export interface ApprovalPolicy {
  mode: ApprovalMode
  /** ask 档下需要询问的工具（支持 * 通配） */
  askTools: string[]
  /** deny-list 档下直接拒绝的工具（支持 * 通配） */
  denyTools: string[]
}

export type ApprovalDecision = 'allow' | 'deny' | 'ask'

/**
 * 默认策略。
 *
 * askTools 里放"本地命令 + 写文件"这一类：默认档是 auto 用不到它，
 * 但用户一调成"询问"，这几个就是最该先问的（他说过不会让我跑命令脚本）。
 */
export const DEFAULT_POLICY: ApprovalPolicy = {
  mode: 'auto',
  askTools: ['exec_command', 'input_command', 'write_file', 'edit_file', '*write*', '*delete*'],
  denyTools: ['exec_command', 'input_command'],
}

/** 通配匹配：只支持 `*`（匹配任意长度），大小写敏感（工具名本来就是大小写敏感的） */
export function matchesPattern(pattern: string, toolName: string): boolean {
  if (!pattern.includes('*')) return pattern === toolName
  const parts = pattern.split('*').filter((s) => s.length > 0)
  if (parts.length === 0) return true // 纯 "*" → 全部命中
  let cursor = 0
  for (let i = 0; i < parts.length; i++) {
    const idx = toolName.indexOf(parts[i], cursor)
    if (idx < 0) return false
    // 第一段必须贴头、最后一段必须贴尾（否则 "a*b" 会匹配 "xaXbY"）
    if (i === 0 && !pattern.startsWith('*') && idx !== 0) return false
    cursor = idx + parts[i].length
  }
  if (!pattern.endsWith('*') && cursor !== toolName.length) return false
  return true
}

/** 判定一次工具调用该怎么处理 */
export function decideTool(policy: ApprovalPolicy, toolName: string): ApprovalDecision {
  // 拒绝清单先判：同一条同时命中两边时以"拒绝"为准（更安全的一侧赢）
  if (policy.denyTools.some((p) => matchesPattern(p, toolName))) return 'deny'
  if (policy.mode === 'auto') return 'allow'
  if (policy.mode === 'deny-list') return 'allow'
  // ask 档
  return policy.askTools.some((p) => matchesPattern(p, toolName)) ? 'ask' : 'allow'
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test agentApproval`
Expected: PASS（9 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/cloud-server/src/agent/approval.ts packages/cloud-server/src/__tests__/agentApproval.test.ts
git commit -m "feat(cloud-server): 工具审批档位（默认全放行，可配询问/拒绝清单）"
```

---

### Task 5: 依赖与 SDK 配置面（模型 / 技能 / MCP）

**Files:**
- Modify: `packages/cloud-server/package.json`（加 `@prismshadow/penguin-core`）
- Create: `packages/cloud-server/src/agent/config.ts`
- Test: `packages/cloud-server/src/__tests__/agentConfig.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `agentRoot` / `AGENT_PROJECT_ID` / `AGENT_ID` / `agentSkillSources`
- Produces:
  ```ts
  export interface AgentModelView {
    provider: string; modelId: string; displayName?: string; hasKey: boolean
    baseUrl?: string; vision: boolean; isDefault: boolean; isVision: boolean; envKeys: string[]
  }
  export interface AgentProviderView { provider: string; label: string; known: boolean; apiKeyUrl?: string }
  export interface AgentMcpView { name: string; config: Record<string, unknown>; permission?: string; invalid?: string }
  export interface AgentSkillView { name: string; description: string; size: number; fileCount: number }
  export interface AgentSkillCandidate { name: string; description: string; dir: string; installed: boolean }
  export class AgentConfigService {
    constructor(private readonly root: string, private readonly skillSources?: string[]) {}
    models(): Promise<{ models: AgentModelView[]; providers: AgentProviderView[]; defaultRef?: { provider: string; modelId: string } }>
    upsertModel(input: { provider: string; modelId: string; apiKey?: string; baseUrl?: string; clientType?: string; vision?: boolean; setDefault?: boolean }): Promise<void>
    deleteModel(provider: string, modelId: string): Promise<void>
    setDefaultModel(provider: string, modelId: string): Promise<void>
    setVisionModel(provider: string, modelId: string): Promise<void>
    mcpServers(): Promise<AgentMcpView[]>
    addMcpServer(input: { name: string; kind: 'stdio' | 'http' | 'sse'; command?: string; args?: string[]; url?: string; permission?: 'auto' | 'r' | 'rw' }): Promise<AgentMcpView[]>
    removeMcpServer(name: string): Promise<AgentMcpView[]>
    skills(): Promise<AgentSkillView[]>
    skillCandidates(): Promise<AgentSkillCandidate[]>
    importSkill(dir: string): Promise<string>
    removeSkill(name: string): Promise<void>
    /** 一次装配会拿到的工具清单 + 警告（设置页与诊断用） */
    resolvedTools(): Promise<{ builtin: string[]; mcp: string[]; warnings: string[] }>
  }
  ```

- [ ] **Step 1: 装依赖**

Run: `pnpm -C packages/cloud-server add @prismshadow/penguin-core@0.2.13`
Expected: `packages/cloud-server/package.json` 的 dependencies 里出现它（pnpm 会同时改 lockfile）

- [ ] **Step 2: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/agentConfig.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentConfigService } from '../agent/config'

let root: string
let svc: AgentConfigService

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'))
  // 技能来源指向一个不存在的目录：候选列表应为空，而不是去读真实家目录
  svc = new AgentConfigService(root, [path.join(root, 'no-such-skills')])
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('模型与 Provider', () => {
  it('全新环境：模型为空、Provider 仍有内置清单（界面据此渲染可选平台）', async () => {
    const r = await svc.models()
    expect(r.models).toEqual([])
    expect(r.providers.length).toBeGreaterThan(0)
    expect(r.providers[0]).toHaveProperty('provider')
  })

  it('增改模型：能读回、密钥只报 hasKey 不回传明文', async () => {
    await svc.upsertModel({
      provider: 'deepseek',
      modelId: 'deepseek-chat',
      apiKey: 'sk-secret-value',
      setDefault: true,
    })
    const r = await svc.models()
    expect(r.models).toHaveLength(1)
    expect(r.models[0].hasKey).toBe(true)
    expect(r.models[0].isDefault).toBe(true)
    expect(JSON.stringify(r)).not.toContain('sk-secret-value')
  })

  it('base_url 不是完整地址时抛错（存进去只会在第一次对话时才炸）', async () => {
    await expect(
      svc.upsertModel({ provider: 'deepseek', modelId: 'deepseek-chat', baseUrl: 'deepseek-chat' }),
    ).rejects.toThrow()
  })

  it('删模型与设看图模型', async () => {
    await svc.upsertModel({ provider: 'deepseek', modelId: 'deepseek-chat' })
    await svc.setVisionModel('deepseek', 'deepseek-chat')
    expect((await svc.models()).models[0].isVision).toBe(true)
    await svc.deleteModel('deepseek', 'deepseek-chat')
    expect((await svc.models()).models).toEqual([])
  })
})

describe('MCP 服务', () => {
  it('新增 stdio 服务后能读回，非法名被拒', async () => {
    const list = await svc.addMcpServer({ name: 'canvas', kind: 'http', url: 'http://127.0.0.1:8865/mcp' })
    expect(list.map((m) => m.name)).toContain('canvas')
    await expect(svc.addMcpServer({ name: 'bad name', kind: 'http', url: 'http://x/mcp' })).rejects.toThrow()
  })

  it('http 类型缺 url / url 不是完整地址都被拒', async () => {
    await expect(svc.addMcpServer({ name: 'x', kind: 'http' })).rejects.toThrow()
    await expect(svc.addMcpServer({ name: 'x', kind: 'http', url: 'nope' })).rejects.toThrow()
  })

  it('删除服务；删不存在的报错', async () => {
    await svc.addMcpServer({ name: 'a', kind: 'http', url: 'http://x/mcp' })
    expect((await svc.removeMcpServer('a')).map((m) => m.name)).not.toContain('a')
    await expect(svc.removeMcpServer('a')).rejects.toThrow()
  })
})

describe('技能', () => {
  it('没有来源目录时候选为空、已装技能为空（不是报错）', async () => {
    expect(await svc.skills()).toEqual([])
    expect(await svc.skillCandidates()).toEqual([])
  })

  it('从来源目录导入一个技能，再卸载', async () => {
    const src = path.join(root, 'skills-src', 'demo')
    await fs.mkdir(src, { recursive: true })
    await fs.writeFile(
      path.join(src, 'SKILL.md'),
      '---\nname: demo\ndescription: 演示技能\n---\n\n正文\n',
      'utf8',
    )
    const s = new AgentConfigService(root, [path.join(root, 'skills-src')])
    const cands = await s.skillCandidates()
    expect(cands.map((c) => c.name)).toContain('demo')
    expect(cands.find((c) => c.name === 'demo')?.installed).toBe(false)
    await s.importSkill(src)
    expect((await s.skills()).map((k) => k.name)).toContain('demo')
    await s.removeSkill('demo')
    expect((await s.skills()).map((k) => k.name)).not.toContain('demo')
  })

  it('拒绝导入不在来源目录里的技能（UI 不该能让我们读任意路径）', async () => {
    const outside = path.join(root, 'elsewhere', 'x')
    await fs.mkdir(outside, { recursive: true })
    await fs.writeFile(path.join(outside, 'SKILL.md'), '---\nname: x\n---\n', 'utf8')
    const s = new AgentConfigService(root, [path.join(root, 'skills-src')])
    await expect(s.importSkill(outside)).rejects.toThrow()
  })
})
```

- [ ] **Step 3: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test agentConfig`
Expected: FAIL —— 找不到模块 `../agent/config`

- [ ] **Step 4: 写最小实现**

```ts
// packages/cloud-server/src/agent/config.ts
/**
 * AgentConfigService —— Agent 的**全局配置**面（模型 / 技能 / MCP）。
 *
 * 为什么把 SDK 包在这一层：cloud-server 不能 import 工作区包，但**可以**依赖 SDK；
 * 而直接散着调 SDK 会让"密钥不回传""base_url 要校验"这类口径散到各路由里。
 * 收在一个类里，路由只做 HTTP。
 *
 * 两条硬口径：
 * 1. **密钥只写不回读**：返回给界面的是 `hasKey: boolean`，明文永不出服务端。
 * 2. **base_url 存之前就校验**：存错的后果是第一次对话时模型端报 Invalid URL，
 *    而 SDK 会用指数退避重试、界面只显示"等待首个 token"，极难定位。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  addModel,
  loadProjectConfig,
  removeModel,
  setDefaultModel,
  setVisionModel,
  MODEL_PROVIDERS,
  providerClientType,
  providerInfo,
  resolveModelEnv,
  buildToolConfig,
  loadAgentState,
  resolveMCPServer,
  systemConfigPath,
  installSkill,
  listInstalledSkills,
  parseSkillFrontmatter,
  removeSkill,
  agentStateDir as sdkAgentStateDir,
  skillsDir as sdkSkillsDir,
} from '@prismshadow/penguin-core'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot, agentSkillSources } from './agentPaths.js'

export interface AgentProviderView {
  provider: string
  label: string
  known: boolean
  apiKeyUrl?: string
  gatewayBaseUrl?: string
}

export interface AgentModelView {
  provider: string
  modelId: string
  displayName?: string
  hasKey: boolean
  baseUrl?: string
  vision: boolean
  isDefault: boolean
  isVision: boolean
  envKeys: string[]
}

export interface AgentMcpView {
  name: string
  config: Record<string, unknown>
  permission?: string
  invalid?: string
}

export interface AgentSkillView {
  name: string
  description: string
  size: number
  fileCount: number
}

export interface AgentSkillCandidate {
  name: string
  description: string
  dir: string
  installed: boolean
}

export interface UpsertModelInput {
  provider: string
  modelId: string
  apiKey?: string
  baseUrl?: string
  clientType?: string
  vision?: boolean
  setDefault?: boolean
}

export interface AddMcpInput {
  name: string
  kind: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  permission?: 'auto' | 'r' | 'rw'
}

export class AgentConfigService {
  private readonly skillSources: string[]

  constructor(private readonly dataRoot: string, skillSources?: string[]) {
    this.skillSources = skillSources ?? agentSkillSources()
  }

  /** SDK 的数据根（全局配置住它下面） */
  private get sdkRoot(): string {
    return agentRoot(this.dataRoot)
  }

  // ------------------------------------------------------------------ 模型

  async models(): Promise<{
    models: AgentModelView[]
    providers: AgentProviderView[]
    defaultRef?: { provider: string; modelId: string }
  }> {
    const cfg = await loadProjectConfig(this.sdkRoot, AGENT_PROJECT_ID)
    const same = (a?: { provider: string; model_id: string }, b?: { provider: string; model_id: string }) =>
      !!a && !!b && a.provider === b.provider && a.model_id === b.model_id
    const models: AgentModelView[] = cfg.models.map((m) => {
      const env = resolveModelEnv(m.model_id, m.client_type)
      const envKeys = [env?.envKey, env?.envBaseUrlKey].filter((k): k is string => !!k)
      return {
        provider: m.provider,
        modelId: m.model_id,
        ...(m.display_name ? { displayName: m.display_name } : {}),
        hasKey: !!m.api_key,
        ...(m.base_url ? { baseUrl: m.base_url } : {}),
        vision: m.vision !== false,
        isDefault: same(cfg.default_model, m),
        isVision: same(cfg.vision_model, m),
        envKeys,
      }
    })
    return {
      models,
      providers: MODEL_PROVIDERS.map((info) => ({
        provider: info.id,
        label: info.label,
        known: true,
        ...(info.apiKeyUrl ? { apiKeyUrl: info.apiKeyUrl } : {}),
        ...(info.gatewayBaseUrl ? { gatewayBaseUrl: info.gatewayBaseUrl } : {}),
      })),
      ...(cfg.default_model
        ? { defaultRef: { provider: cfg.default_model.provider, modelId: cfg.default_model.model_id } }
        : {}),
    }
  }

  async upsertModel(input: UpsertModelInput): Promise<void> {
    const provider = input.provider.trim()
    const modelId = input.modelId.trim()
    if (!provider) throw new Error('provider 不能为空')
    if (!modelId) throw new Error('modelId 不能为空')

    const rawBase = (input.baseUrl ?? '').trim()
    const baseUrl = rawBase ? assertHttpUrl(rawBase) : undefined
    const cfg = await loadProjectConfig(this.sdkRoot, AGENT_PROJECT_ID)
    const existing = cfg.models.find((m) => m.provider === provider && m.model_id === modelId)
    const carried = {
      apiKey: input.apiKey?.trim() || existing?.api_key,
      clientType: input.clientType?.trim() || existing?.client_type || providerClientType(provider),
      vision: input.vision ?? existing?.vision,
    }
    // SDK 用 
    // SDK 用 `??` 合并 base_url，空串清不掉已存的 —— 要清必须 remove 再 add
    if (existing?.base_url && !rawBase) {
      await removeModel(this.sdkRoot, AGENT_PROJECT_ID, { provider, model_id: modelId })
    }
    await addModel(
      this.sdkRoot,
      AGENT_PROJECT_ID,
      {
        provider,
        model_id: modelId,
        api_key: carried.apiKey,
        base_url: baseUrl,
        client_type: carried.clientType,
        vision: carried.vision,
      },
      { setDefault: !!input.setDefault },
    )
  }

  async deleteModel(provider: string, modelId: string): Promise<void> {
    await removeModel(this.sdkRoot, AGENT_PROJECT_ID, { provider, model_id: modelId })
  }

  async setDefaultModel(provider: string, modelId: string): Promise<void> {
    await setDefaultModel(this.sdkRoot, AGENT_PROJECT_ID, { provider, model_id: modelId })
  }

  async setVisionModel(provider: string, modelId: string): Promise<void> {
    await setVisionModel(this.sdkRoot, AGENT_PROJECT_ID, { provider, model_id: modelId })
  }

  // -------------------------------------------------------------------- MCP

  async mcpServers(): Promise<AgentMcpView[]> {
    const cfg = await loadSystemConfig(this.sdkRoot)
    const entries = (cfg.tools?.mcpServers ?? []) as Array<{ name: string; config: Record<string, unknown> }>
    return entries.map((e) => {
      try {
        const resolved = resolveMCPServer(e as never)
        return { name: e.name, config: e.config, permission: resolved.permission ?? 'auto' }
      } catch (err) {
        return { name: e.name, config: e.config, invalid: describe(err) }
      }
    })
  }

  async addMcpServer(input: AddMcpInput): Promise<AgentMcpView[]> {
    const name = input.name.trim()
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('MCP 服务名只能包含字母、数字、下划线和短横线')
    const perm = input.permission ? { permission: input.permission } : {}
    let config: Record<string, unknown>
    if (input.kind === 'stdio') {
      const command = (input.command ?? '').trim()
      if (!command) throw new Error('stdio 类型必须填写 command')
      config = { command, args: input.args ?? [], ...perm }
    } else {
      const url = (input.url ?? '').trim()
      if (!url) throw new Error(input.kind + ' 类型必须填写 url')
      assertHttpUrl(url)
      config = { type: input.kind, url, ...perm }
    }
    const entry = { name, config }
    // 写之前先自证能解析：坏条目在它被读到时只会静默跳过，用户当下看不到任何问题
    resolveMCPServer(entry as never)
    const cfg = await loadSystemConfig(this.sdkRoot)
    const existing = (cfg.tools?.mcpServers ?? []) as Array<{ name: string }>
    const next = [...existing.filter((e) => e.name !== name), entry]
    await writeSystemConfig(this.sdkRoot, { ...cfg, tools: { ...(cfg.tools ?? {}), mcpServers: next } })
    return this.mcpServers()
  }

  async removeMcpServer(name: string): Promise<AgentMcpView[]> {
    const cfg = await loadSystemConfig(this.sdkRoot)
    const existing = (cfg.tools?.mcpServers ?? []) as Array<{ name: string }>
    const next = existing.filter((e) => e.name !== name)
    if (next.length === existing.length) throw new Error('没有名为「' + name + '」的 MCP 服务')
    await writeSystemConfig(this.sdkRoot, { ...cfg, tools: { ...(cfg.tools ?? {}), mcpServers: next } })
    return this.mcpServers()
  }

  /** 一次装配会真正拿到哪些工具（界面显示 + 诊断） */
  async resolvedTools(): Promise<{ builtin: string[]; mcp: string[]; warnings: string[] }> {
    const state = await loadAgentState({ agentId: AGENT_ID, projectId: AGENT_PROJECT_ID, root: this.sdkRoot })
    const toolConfig = buildToolConfig(state)
    const warnings: string[] = []
    const mcp: string[] = []
    for (const entry of toolConfig.mcpServers) {
      try {
        resolveMCPServer(entry)
        mcp.push(entry.name)
      } catch (err) {
        warnings.push(entry.name + ': ' + describe(err))
      }
    }
    return { builtin: toolConfig.customTools.map((t) => t.name), mcp, warnings }
  }

  // ------------------------------------------------------------------- 技能

  async skills(): Promise<AgentSkillView[]> {
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
      out.push({ name: s.name, description: s.description ?? '', size, fileCount })
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
        found.push({ name, description: meta?.description ?? '', dir, installed: installedNames.has(name) })
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

  /** 设置页要显示这层数据到底落在哪（诊断用） */
  systemConfigPath(): string {
    return systemConfigPath(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
  }

  stateDir(): string {
    return sdkAgentStateDir(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
  }
}

/** base_url 必须是完整 http(s) 地址 */
function assertHttpUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('地址必须是完整地址（例如 https://api.deepseek.com），当前填的是「' + raw + '」')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('地址只支持 http/https，当前是「' + parsed.protocol + '」')
  }
  return raw
}

/** 递归列目录（相对路径 + 绝对路径） */
async function walk(dir: string, prefix = ''): Promise<Array<{ abs: string; rel: string }>> {
  const out: Array<{ abs: string; rel: string }> = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    const rel = prefix ? prefix + '/' + e.name : e.name
    if (e.isDirectory()) out.push(...(await walk(abs, rel)))
    else if (e.isFile()) out.push({ abs, rel })
  }
  return out
}

/** 读 Agent 的 system_config.yaml（未初始化时带 init 建一份，避免首次进设置页就报错） */
async function loadSystemConfig(root: string): Promise<{ tools?: { mcpServers?: unknown[] }; [k: string]: unknown }> {
  const state = await loadAgentState({ agentId: AGENT_ID, projectId: AGENT_PROJECT_ID, root, init: {} })
  return state.systemConfig as { tools?: { mcpServers?: unknown[] } }
}

/** 写回 system_config.yaml（SDK 无公开写入口，直接写 YAML；形状永远是 SDK 自己加载出来的那份） */
async function writeSystemConfig(root: string, cfg: unknown): Promise<void> {
  const yaml = await import('yaml')
  const target = systemConfigPath(root, AGENT_PROJECT_ID, AGENT_ID)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, yaml.stringify(cfg, { lineWidth: 0 }), 'utf8')
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test agentConfig`
Expected: PASS（9 个用例）

若 `loadProjectConfig` / `loadAgentState` 的首建行为与断言不符（例如需要先建目录），
按报错调整 `loadSystemConfig` 的 `init` 传参，**不要**改测试的断言口径
（「全新环境返回空列表」是契约）。

- [ ] **Step 6: 提交**

```bash
git add packages/cloud-server/package.json pnpm-lock.yaml packages/cloud-server/src/agent/config.ts packages/cloud-server/src/__tests__/agentConfig.test.ts
git commit -m "feat(cloud-server): Agent 全局配置面（模型/技能/MCP，密钥不回传）"
```
---

### Task 6: 会话生命周期（runtime）

**Files:**
- Create: `packages/cloud-server/src/agent/runtime.ts`
- Test: `packages/cloud-server/src/__tests__/agentRuntime.test.ts`

**Interfaces:**
- Consumes: Task 1 路径、Task 2 的 `AgentSessionStore`、Task 3 的 `translateMessage`、Task 4 的 `ApprovalPolicy`
- Produces:
```ts
export interface AgentLike {
  createSession(opts?: Record<string, unknown>): Promise<AgentSessionLike>
  resumeSession(opts: { sessionId: string }): Promise<AgentSessionLike>
}
export interface AgentSessionLike {
  readonly sessionId: string
  readonly provider?: string
  readonly modelId?: string
  run(messages: unknown[], opts?: Record<string, unknown>): AsyncIterable<unknown>
  steer?(messages: unknown[]): boolean
  dispose?(): void
}
/** 可注入的依赖（单测塞假 agent；生产塞 createAgent 的产物） */
export interface AgentRuntimeDeps {
  root: string
  store: AgentSessionStore
  agent(): Promise<AgentLike>
  makeUserMessage(text: string, images?: string[]): unknown
  policy: ApprovalPolicy
  log?: (message: string, extra?: unknown) => void
}
/** 一个活着的会话（内存态；进程重启后靠 store + resumeSession 复活） */
export interface LiveAgentSession { id: string; session: AgentSessionLike; running: boolean }
export interface StartRunInput { canvasId: string; sessionId?: string; text: string; images?: string[] }
export class AgentRuntime {
  constructor(deps: AgentRuntimeDeps)
  ensureSession(canvasId: string, opts?: { sessionId?: string; title?: string }): Promise<{ id: string; resumed: boolean }>
  run(canvasId: string, input: StartRunInput, signal: AbortSignal): AsyncGenerator<AgentChatEvent>
  abort(canvasId: string, sessionId: string): void
  forget(canvasId: string, sessionId: string): void
  disposeAll(): void
}
```

- [ ] **Step 1: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/agentRuntime.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentSessionStore } from '../agent/sessionStore'
import { AgentRuntime, type AgentLike, type AgentSessionLike } from '../agent/runtime'
import { DEFAULT_POLICY } from '../agent/approval'

let root: string
let store: AgentSessionStore

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-runtime-'))
  store = new AgentSessionStore(root)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 假 SDK 会话：按脚本吐消息 */
function fakeSession(id: string, script: unknown[][]): AgentSessionLike {
  return {
    sessionId: id,
    provider: 'test',
    modelId: 'test-model',
    async *run() {
      for (const batch of script) for (const m of batch) yield m
    },
  }
}

function makeAgent(
  script: unknown[][],
  seen: { workspace?: Array<Record<string, unknown>>; resumed?: string[] } = {},
): AgentLike {
  let counter = 0
  return {
    async createSession(o) {
      seen.workspace?.push(o ?? {})
      counter += 1
      return fakeSession('session-fixed-' + counter, script)
    },
    async resumeSession(o) {
      seen.resumed?.push(o.sessionId)
      return fakeSession(o.sessionId, script)
    },
  }
}

function makeRuntime(script: unknown[][], seen: { workspace?: Array<Record<string, unknown>>; resumed?: string[] } = {}) {
  return new AgentRuntime({
    root,
    store,
    agent: async () => makeAgent(script, seen),
    makeUserMessage: (text) => ({ type: 'model_msg', payload: { type: 'text', role: 'user', text } }),
    policy: DEFAULT_POLICY,
  })
}

describe('会话建立与续接', () => {
  it('首次 ensureSession 建会话并落一份索引', async () => {
    const rt = makeRuntime([])
    const r = await rt.ensureSession('default')
    expect(r.resumed).toBe(false)
    expect((await store.list('default')).map((s) => s.id)).toContain(r.id)
  })

  it('带上本画布的工作目录（D6：Agent 的文件工具出不去这张画布）', async () => {
    const seen: { workspace?: Array<Record<string, unknown>> } = { workspace: [] }
    const rt = makeRuntime([], seen)
    await rt.ensureSession('default')
    expect(String(seen.workspace?.[0]?.workspaceDir)).toContain(
      path.join('canvases', 'default', 'agent', 'workspace'),
    )
  })

  it('带已有 sessionId 且磁盘上有转录 → 走 resumeSession（不新建）', async () => {
    const seen: { resumed?: string[] } = { resumed: [] }
    const rt = makeRuntime([], seen)
    await store.ensure('default', {
      id: 'session-old',
      title: '旧会话',
      createdAt: 1,
      provider: 'test',
      modelId: 'test-model',
    })
    const r = await rt.ensureSession('default', { sessionId: 'session-old' })
    expect(r.resumed).toBe(true)
    expect(seen.resumed).toEqual(['session-old'])
  })

  it('带一个磁盘上没有的 sessionId → 退回新建（不假装续上了）', async () => {
    const seen: { resumed?: string[] } = { resumed: [] }
    const rt = makeRuntime([], seen)
    const r = await rt.ensureSession('default', { sessionId: 'session-ghost' })
    expect(r.resumed).toBe(false)
    expect(seen.resumed).toEqual([])
  })
})

describe('跑一轮', () => {
  it('把 SDK 消息翻成事件，可读的那几类写进转录', async () => {
    const rt = makeRuntime([
      [
        { type: 'session_meta', payload: { session_id: 'session-fixed-1' } },
        { type: 'model_msg', payload: { type: 'partial_text', event_type: 'delta', text: '你' } },
        { type: 'model_msg', payload: { type: 'text', text: '你好' } },
      ],
    ])
    const events: string[] = []
    for await (const ev of rt.run('default', { text: '在吗' }, new AbortController().signal)) {
      events.push(ev.type)
    }
    expect(events).toContain('text')
    expect(events[events.length - 1]).toBe('done')
    const list = await store.list('default')
    const rec = await store.get('default', list[0].id)
    // 用户那句 + 助手那句都落盘（partial 只在界面上滚动，不落）
    expect(rec?.turns.map((t) => t.text)).toEqual(['在吗', '你好'])
  })

  it('第一轮后会话标题取用户首句（列表里看得懂）', async () => {
    const rt = makeRuntime([[{ type: 'model_msg', payload: { type: 'text', text: '好' } }]])
    for await (const _ of rt.run('default', { text: '帮我画一张图' }, new AbortController().signal)) void _
    const list = await store.list('default')
    expect(list[0].title).toBe('帮我画一张图')
  })

  it('SDK 抛错时产出 error 事件并收尾（不让流挂着）', async () => {
    const agent: AgentLike = {
      async createSession() {
        return {
          sessionId: 's1',
          async *run() {
            yield { type: 'model_msg', payload: { type: 'text', text: '半句' } }
            throw new Error('网络断了')
          },
        }
      },
      async resumeSession() {
        throw new Error('不该走这里')
      },
    }
    const rt = new AgentRuntime({
      root,
      store,
      agent: async () => agent,
      makeUserMessage: (t) => ({ type: 'model_msg', payload: { type: 'text', role: 'user', text: t } }),
      policy: DEFAULT_POLICY,
    })
    const events: Array<{ type: string; message?: string }> = []
    for await (const ev of rt.run('default', { text: 'hi' }, new AbortController().signal)) events.push(ev)
    expect(events.find((e) => e.type === 'error')?.message).toContain('网络断了')
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('一轮进行中再来一句 → 走 steering，不并发开第二个 run', async () => {
    let steered = 0
    const session: AgentSessionLike = {
      sessionId: 'session-steer',
      async *run() {
        await new Promise((r) => setTimeout(r, 30))
        yield { type: 'model_msg', payload: { type: 'text', text: '完成' } }
      },
      steer() {
        steered += 1
        return true
      },
    }
    const agent: AgentLike = {
      async createSession() {
        return session
      },
      async resumeSession() {
        return session
      },
    }
    const rt = new AgentRuntime({
      root,
      store,
      agent: async () => agent,
      makeUserMessage: (t) => ({ type: 'model_msg', payload: { type: 'text', role: 'user', text: t } }),
      policy: DEFAULT_POLICY,
    })
    const first = (async () => {
      for await (const _ of rt.run('default', { text: '第一句' }, new AbortController().signal)) void _
    })()
    // 等第一轮真正进入 running
    await new Promise((r) => setTimeout(r, 10))
    const second: string[] = []
    for await (const ev of rt.run('default', { text: '补充一句' }, new AbortController().signal)) {
      second.push(ev.type)
    }
    await first
    expect(steered).toBe(1)
    expect(second).toContain('notice')
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test agentRuntime`
Expected: FAIL —— 找不到模块 `../agent/runtime`

- [ ] **Step 3: 写最小实现**

```ts
// packages/cloud-server/src/agent/runtime.ts
/**
 * AgentRuntime —— 会话的生命周期（建 / 续 / 跑 / 打断）。
 *
 * 它只做四件事，且都围绕「一个画布下多个会话」这条口径：
 * 1. ensureSession：磁盘上有转录就 resumeSession 续上下文，没有就 createSession
 *    （带**本画布**的 workspaceDir）；
 * 2. run：跑完一轮，产出前端事件，同时把**可读的那几类**追加进转录（partial 不落）；
 * 3. abort：用户按停止 —— 中止这一轮，会话与转录都留着；
 * 4. forget / disposeAll：删会话与进程退出时放掉内存态。
 *
 * 会话对象只在内存里（SDK 的 Session），转录与索引在磁盘上（AgentSessionStore）。
 * 依赖全部经构造参数注入（agent / makeUserMessage / policy），单测不需要真模型、真网络。
 */
import type { AgentChatEvent } from './translate.js'
import { translateMessage } from './translate.js'
import { decideTool, type ApprovalPolicy } from './approval.js'
import { canvasWorkspaceDir } from './agentPaths.js'
import type { AgentSessionStore } from './sessionStore.js'

export interface AgentSessionLike {
  readonly sessionId: string
  readonly provider?: string
  readonly modelId?: string
  run(messages: unknown[], opts?: Record<string, unknown>): AsyncIterable<unknown>
  steer?(messages: unknown[]): boolean
  dispose?(): void
}

export interface AgentLike {
  createSession(opts?: Record<string, unknown>): Promise<AgentSessionLike>
  resumeSession(opts: { sessionId: string }): Promise<AgentSessionLike>
}

export interface AgentRuntimeDeps {
  root: string
  store: AgentSessionStore
  agent(): Promise<AgentLike>
  makeUserMessage(text: string, images?: string[]): unknown
  policy: ApprovalPolicy
  log?: (message: string, extra?: unknown) => void
}

export interface StartRunInput {
  canvasId: string
  sessionId?: string
  text: string
  images?: string[]
}

export interface LiveAgentSession {
  id: string
  session: AgentSessionLike
  running: boolean
  abort?: AbortController
}

export class AgentRuntime {
  private readonly live = new Map<string, LiveAgentSession>()

  constructor(private readonly deps: AgentRuntimeDeps) {}

  /** 内存键带画布前缀：不同画布下同名会话不该被当成同一个 */
  private key(canvasId: string, sessionId: string): string {
    return canvasId + '/' + sessionId
  }

  async ensureSession(
    canvasId: string,
    opts: { sessionId?: string; title?: string } = {},
  ): Promise<{ id: string; resumed: boolean }> {
    if (opts.sessionId) {
      const cached = this.live.get(this.key(canvasId, opts.sessionId))
      if (cached) return { id: cached.id, resumed: true }
      // 磁盘上有转录 = 这个会话以前建过 → 用 resumeSession 把模型上下文接回来
      const record = await this.deps.store.get(canvasId, opts.sessionId)
      if (record) {
        const agent = await this.deps.agent()
        const session = await agent.resumeSession({ sessionId: opts.sessionId })
        this.live.set(this.key(canvasId, opts.sessionId), { id: opts.sessionId, session, running: false })
        return { id: opts.sessionId, resumed: true }
      }
      // 磁盘上也没有 → 不当成错误，退回新建（界面传来的旧 id 可能已被删）
    }
    const agent = await this.deps.agent()
    const session = await agent.createSession({
      // D6：工作目录钉在本画布目录下，Agent 的文件类工具便出不去
      workspaceDir: canvasWorkspaceDir(this.deps.root, canvasId),
    })
    const id = session.sessionId
    await this.deps.store.ensure(canvasId, {
      id,
      title: opts.title?.trim() || '新会话',
      createdAt: Date.now(),
      provider: session.provider ?? 'default',
      modelId: session.modelId ?? 'default',
    })
    this.live.set(this.key(canvasId, id), { id, session, running: false })
    return { id, resumed: false }
  }

  /** 跑一轮。产出事件；转录只落「能读」的那几类 */
  async *run(canvasId: string, input: StartRunInput, signal: AbortSignal): AsyncGenerator<AgentChatEvent> {
    const log = this.deps.log ?? ((): void => undefined)
    const { id } = await this.ensureSession(canvasId, {
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      title: input.text,
    })
    const entry = this.live.get(this.key(canvasId, id))!
    const messages: unknown[] = [this.deps.makeUserMessage(input.text, input.images)]

    // 已经有会话在跑：这一句当 steering 送进去，不并发开第二个 run
    if (entry.running) {
      const steered = entry.session.steer?.(messages) ?? false
      log('steered into running task', { session: id, steered })
      yield { type: 'notice', message: steered ? '已作为补充指令发送给进行中的任务' : '任务正在执行中' }
      yield { type: 'done' }
      return
    }

    entry.running = true
    entry.abort = new AbortController()
    const own = entry.abort
    signal.addEventListener('abort', () => own.abort(), { once: true })
    const started = Date.now()
    let assistantText = ''
    try {
      yield { type: 'session', sessionId: id, title: '' }
      await this.deps.store.appendTurn(canvasId, id, { role: 'user', text: input.text, ts: Date.now() })

      const approve = async (toolCall: unknown): Promise<'allow' | 'deny'> => {
        const name = String((toolCall as { payload?: { name?: string } })?.payload?.name ?? '')
        const decision = decideTool(this.deps.policy, name)
        log('tool decision', { tool: name, decision })
        // Phase 3 会把 'ask' 变成「挂起等用户在界面上点」；此刻先放行并留痕，
        // 免得用户面对一个永远不返回的对话。
        return decision === 'deny' ? 'deny' : 'allow'
      }

      for await (const msg of entry.session.run(messages, { signal: own.signal, approve })) {
        for (const ev of translateMessage(msg, (m, extra) => log(m, extra))) {
          if (ev.type === 'text' && ev.final && typeof ev.text === 'string') {
            assistantText += ev.text
            await this.deps.store.appendTurn(canvasId, id, { role: 'assistant', text: ev.text, ts: Date.now() })
          } else if (ev.type === 'thinking' && ev.final && typeof ev.text === 'string') {
            await this.deps.store.appendTurn(canvasId, id, { role: 'thinking', text: ev.text, ts: Date.now() })
          } else if (ev.type === 'tool_call') {
            await this.deps.store.appendTurn(canvasId, id, {
              role: 'tool',
              text: ev.name + '(' + ev.arguments + ')',
              ts: Date.now(),
            })
          }
          yield ev
        }
      }
      log('run done', { session: id, ms: Date.now() - started, chars: assistantText.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log('run failed', { session: id, message, ms: Date.now() - started })
      yield { type: 'error', message }
    } finally {
      entry.running = false
      entry.abort = undefined
      yield { type: 'done' }
    }
  }

  /** 中止当前轮：会话本身留着（用户只是停下，不是删掉） */
  abort(canvasId: string, sessionId: string): void {
    this.live.get(this.key(canvasId, sessionId))?.abort?.abort()
  }

  /** 删会话时放掉内存态（转录由 AgentSessionStore 删） */
  forget(canvasId: string, sessionId: string): void {
    const entry = this.live.get(this.key(canvasId, sessionId))
    if (!entry) return
    entry.abort?.abort()
    entry.session.dispose?.()
    this.live.delete(this.key(canvasId, sessionId))
  }

  disposeAll(): void {
    for (const entry of this.live.values()) {
      entry.abort?.abort()
      entry.session.dispose?.()
    }
    this.live.clear()
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test agentRuntime`
Expected: PASS（8 个用例）

注：「一轮进行中再来一句」那条靠 `setTimeout` 让第一轮真的进入 running，
若在 CI 上偶发，把两处延时各加大到 50/20ms —— 它测的是**分支选择**，不是时序精度。

- [ ] **Step 5: 提交**

```bash
git add packages/cloud-server/src/agent/runtime.ts packages/cloud-server/src/__tests__/agentRuntime.test.ts
git commit -m "feat(cloud-server): AgentRuntime 建续跑打断（按画布工作目录，转录落盘）"
```
---

### Task 7: 全局配置路由（`/api/agent/*`）

**Files:**
- Create: `packages/cloud-server/src/routes/agent.ts`
- Test: `packages/cloud-server/src/__tests__/agentRoutes.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `AgentConfigService`
- Produces: `export function agentRoutes(config: AgentConfigService): Hono`

契约（对外，定死）：

```
GET    /api/agent/config          → { ok, models, providers, defaultRef, skills, mcpServers, tools, paths }
POST   /api/agent/models          ← { provider, modelId, apiKey?, baseUrl?, clientType?, vision?, setDefault? }
DELETE /api/agent/models          ← { provider, modelId }
POST   /api/agent/models/default  ← { provider, modelId }
POST   /api/agent/models/vision   ← { provider, modelId }
GET    /api/agent/skills          → { ok, skills }
GET    /api/agent/skills/sources  → { ok, candidates }
POST   /api/agent/skills/import   ← { dir }
DELETE /api/agent/skills/:name    → { ok, removed }
POST   /api/agent/mcp             ← { name, kind, command?, args?, url?, permission? }
DELETE /api/agent/mcp             ← { name }
GET    /api/agent/tools           → { ok, builtin, mcp, warnings }
```

> `GET /api/agent/config` 一次给全：设置页一打开三个页签的数据都要用。
> `paths` 告诉界面配置落在哪个文件，出问题时用户能自己去看。

- [ ] **Step 1: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/agentRoutes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server'

let dir: string
let srv: CloudServer

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-routes-'))
  srv = await createCloudServer({
    dir,
    watchProviders: false,
    // 技能来源指到临时目录：单测不去读真实家目录
    agentSkillSources: [path.join(dir, 'skills-src')],
  })
})
afterEach(async () => {
  srv.stop()
  await fs.rm(dir, { recursive: true, force: true })
})

async function call(method: string, url: string, body?: unknown) {
  const res = await srv.app.fetch(
    new Request('http://localhost' + url, {
      method,
      ...(body !== undefined
        ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
        : {}),
    }),
  )
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

describe('GET /api/agent/config', () => {
  it('全新环境：模型/技能/MCP 都空，但结构与 Provider 清单齐备', async () => {
    const r = await call('GET', '/api/agent/config')
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
    expect(r.json.models).toEqual([])
    expect(r.json.skills).toEqual([])
    expect(r.json.mcpServers).toEqual([])
    expect(Array.isArray(r.json.providers)).toBe(true)
    expect(String((r.json.paths as Record<string, string>).state)).toContain('agent_state')
  })
})

describe('模型接口', () => {
  it('加模型 → 出现在 config 里，且明文密钥不外泄', async () => {
    const add = await call('POST', '/api/agent/models', {
      provider: 'deepseek',
      modelId: 'deepseek-chat',
      apiKey: 'sk-top-secret',
      setDefault: true,
    })
    expect(add.status).toBe(200)
    const cfg = await call('GET', '/api/agent/config')
    const models = cfg.json.models as Array<Record<string, unknown>>
    expect(models).toHaveLength(1)
    expect(models[0].hasKey).toBe(true)
    expect(JSON.stringify(cfg.json)).not.toContain('sk-top-secret')
  })

  it('base_url 不合法 → 400 且带上人话', async () => {
    const r = await call('POST', '/api/agent/models', {
      provider: 'deepseek',
      modelId: 'x',
      baseUrl: 'not-a-url',
    })
    expect(r.status).toBe(400)
    expect(String(r.json.error)).toContain('完整地址')
  })

  it('缺 provider / modelId → 400', async () => {
    expect((await call('POST', '/api/agent/models', { provider: '', modelId: 'x' })).status).toBe(400)
    expect((await call('POST', '/api/agent/models', { provider: 'x' })).status).toBe(400)
  })

  it('设默认 / 设看图 / 删除', async () => {
    await call('POST', '/api/agent/models', { provider: 'deepseek', modelId: 'a' })
    expect((await call('POST', '/api/agent/models/default', { provider: 'deepseek', modelId: 'a' })).status).toBe(200)
    expect((await call('POST', '/api/agent/models/vision', { provider: 'deepseek', modelId: 'a' })).status).toBe(200)
    expect((await call('DELETE', '/api/agent/models', { provider: 'deepseek', modelId: 'a' })).status).toBe(200)
    const cfg = await call('GET', '/api/agent/config')
    expect(cfg.json.models).toEqual([])
  })
})

describe('MCP 接口', () => {
  it('加一个 http 服务 → config 里能看到；非法名 400', async () => {
    const add = await call('POST', '/api/agent/mcp', {
      name: 'canvas',
      kind: 'http',
      url: 'http://127.0.0.1:8865/mcp',
    })
    expect(add.status).toBe(200)
    const cfg = await call('GET', '/api/agent/config')
    expect((cfg.json.mcpServers as Array<Record<string, unknown>>).map((m) => m.name)).toEqual(['canvas'])
    const bad = await call('POST', '/api/agent/mcp', { name: 'bad name', kind: 'http', url: 'http://x/mcp' })
    expect(bad.status).toBe(400)
  })

  it('删不存在的服务 → 404', async () => {
    expect((await call('DELETE', '/api/agent/mcp', { name: 'nope' })).status).toBe(404)
  })
})

describe('技能接口', () => {
  it('导入一个技能再删掉', async () => {
    const src = path.join(dir, 'skills-src', 'demo')
    await fs.mkdir(src, { recursive: true })
    await fs.writeFile(path.join(src, 'SKILL.md'), '---\nname: demo\ndescription: 演示\n---\n\n正文\n', 'utf8')
    expect((await call('POST', '/api/agent/skills/import', { dir: src })).status).toBe(200)
    const list = await call('GET', '/api/agent/skills')
    expect((list.json.skills as Array<Record<string, unknown>>).map((s) => s.name)).toContain('demo')
    expect((await call('DELETE', '/api/agent/skills/demo')).status).toBe(200)
    const after = await call('GET', '/api/agent/skills')
    expect((after.json.skills as Array<Record<string, unknown>>).map((s) => s.name)).not.toContain('demo')
  })

  it('导入来源之外的目录 → 400', async () => {
    const outside = path.join(dir, 'elsewhere')
    await fs.mkdir(outside, { recursive: true })
    expect((await call('POST', '/api/agent/skills/import', { dir: outside })).status).toBe(400)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test agentRoutes`
Expected: FAIL —— `/api/agent/config` 返回 404（路由还没挂）

- [ ] **Step 3: 写最小实现**

```ts
// packages/cloud-server/src/routes/agent.ts
/**
 * agent 路由 —— Agent 的**全局配置**面（模型 / 技能 / MCP）。
 *
 * 与会话路由分开（agentSessions.ts）：这两类数据的归属不同 ——
 * 配置是全局一份，会话按画布分（用户口径）。放两个文件，路由表一眼看出这个区别。
 *
 * 错误处理：服务抛的都是「用户能改的输入问题」（名字不合法 / 地址不是 URL / 目录不在来源里），
 * 一律 400 并把原话回给界面；没料到的问题照抛（500），别把服务端故障说成用户的错。
 */
import { Hono } from 'hono'
import type { AgentConfigService } from '../agent/config.js'

export function agentRoutes(config: AgentConfigService): Hono {
  const app = new Hono()

  /** 把服务抛的错翻成 400（消息原样给用户看） */
  async function guard<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
    try {
      return { ok: true, value: await fn() }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  app.get('/api/agent/config', async (c) => {
    const r = await guard(async () => {
      const m = await config.models()
      const [skills, mcpServers, tools] = await Promise.all([
        config.skills(),
        config.mcpServers(),
        config.resolvedTools(),
      ])
      return {
        models: m.models,
        providers: m.providers,
        ...(m.defaultRef ? { defaultRef: m.defaultRef } : {}),
        skills,
        mcpServers,
        tools,
        paths: { state: config.stateDir(), systemConfig: config.systemConfigPath() },
      }
    })
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, ...r.value })
  })

  app.post('/api/agent/models', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const r = await guard(() =>
      config.upsertModel({
        provider: String(body.provider ?? ''),
        modelId: String(body.modelId ?? body.model_id ?? ''),
        ...(typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {}),
        ...(typeof body.baseUrl === 'string' ? { baseUrl: body.baseUrl } : {}),
        ...(typeof body.clientType === 'string' ? { clientType: body.clientType } : {}),
        ...(typeof body.vision === 'boolean' ? { vision: body.vision } : {}),
        setDefault: body.setDefault === true,
      }),
    )
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    const m = await config.models()
    return c.json({ ok: true, models: m.models, providers: m.providers })
  })

  app.delete('/api/agent/models', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const provider = String(body.provider ?? '')
    const modelId = String(body.modelId ?? body.model_id ?? '')
    if (!provider || !modelId) return c.json({ ok: false, error: '需要 provider 与 modelId' }, 400)
    const r = await guard(() => config.deleteModel(provider, modelId))
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, models: (await config.models()).models })
  })

  /** 设默认 / 设看图共用一段（只是调不同方法） */
  function modelRefRoute(kind: 'default' | 'vision', run: (p: string, m: string) => Promise<void>) {
    app.post('/api/agent/models/' + kind, async (c) => {
      const body = await safeJson(c)
      if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
      const provider = String(body.provider ?? '')
      const modelId = String(body.modelId ?? body.model_id ?? '')
      if (!provider || !modelId) return c.json({ ok: false, error: '需要 provider 与 modelId' }, 400)
      const r = await guard(() => run(provider, modelId))
      if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
      return c.json({ ok: true, models: (await config.models()).models })
    })
  }
  modelRefRoute('default', (p, m) => config.setDefaultModel(p, m))
  modelRefRoute('vision', (p, m) => config.setVisionModel(p, m))

  app.get('/api/agent/skills', async (c) => c.json({ ok: true, skills: await config.skills() }))
  app.get('/api/agent/skills/sources', async (c) =>
    c.json({ ok: true, candidates: await config.skillCandidates() }),
  )

  app.post('/api/agent/skills/import', async (c) => {
    const body = await safeJson(c)
    if (!body || typeof body.dir !== 'string' || !body.dir.trim()) {
      return c.json({ ok: false, error: '需要提供 dir（技能目录的绝对路径）' }, 400)
    }
    const r = await guard(() => config.importSkill(body.dir as string))
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, imported: r.value, skills: await config.skills() })
  })

  app.delete('/api/agent/skills/:name', async (c) => {
    const name = decodeURIComponent(c.req.param('name'))
    const r = await guard(() => config.removeSkill(name))
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, removed: name, skills: await config.skills() })
  })

  app.post('/api/agent/mcp', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const kind = String(body.kind ?? 'stdio')
    if (kind !== 'stdio' && kind !== 'http' && kind !== 'sse') {
      return c.json({ ok: false, error: 'kind 只能是 stdio / http / sse' }, 400)
    }
    const permission = body.permission
    const r = await guard(() =>
      config.addMcpServer({
        name: String(body.name ?? ''),
        kind: kind as 'stdio' | 'http' | 'sse',
        ...(typeof body.command === 'string' ? { command: body.command } : {}),
        ...(Array.isArray(body.args) ? { args: body.args.map(String) } : {}),
        ...(typeof body.url === 'string' ? { url: body.url } : {}),
        ...(permission === 'auto' || permission === 'r' || permission === 'rw'
          ? { permission: permission as 'auto' | 'r' | 'rw' }
          : {}),
      }),
    )
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, mcpServers: r.value })
  })

  app.delete('/api/agent/mcp', async (c) => {
    const body = await safeJson(c)
    if (!body || typeof body.name !== 'string') return c.json({ ok: false, error: '需要 name' }, 400)
    const r = await guard(() => config.removeMcpServer(body.name as string))
    if (!r.ok) return c.json({ ok: false, error: r.message }, 404)
    return c.json({ ok: true, mcpServers: r.value })
  })

  app.get('/api/agent/tools', async (c) => c.json({ ok: true, ...(await config.resolvedTools()) }))

  return app
}

/** 读 JSON body；坏 JSON 返回 undefined（由调用方回 400） */
async function safeJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | undefined> {
  try {
    const v = await c.req.json()
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test agentRoutes`
Expected: PASS（9 个用例）—— 需要 Task 9 先把路由挂上；若先写本任务，可先在 `createCloudServer` 里挂一行再回测。

- [ ] **Step 5: 提交**

```bash
git add packages/cloud-server/src/routes/agent.ts packages/cloud-server/src/__tests__/agentRoutes.test.ts
git commit -m "feat(cloud-server): /api/agent/* 全局配置路由（模型/技能/MCP）"
```
---

### Task 8: 画布会话路由 + SSE 对话流

**Files:**
- Create: `packages/cloud-server/src/routes/agentSessions.ts`
- Test: `packages/cloud-server/src/__tests__/agentSessionsRoutes.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `AgentSessionStore`、Task 6 的 `AgentRuntime`、Task 1 的 `isSafeSessionId`
- Produces: `export function agentSessionRoutes(store: AgentSessionStore, runtime: AgentRuntime): Hono`

契约（对外，定死）：

```
GET    /api/agent/canvases/:canvasId/sessions              → { ok, sessions }
POST   /api/agent/canvases/:canvasId/sessions              ← { sessionId?, title? } → { ok, id, resumed }
GET    /api/agent/canvases/:canvasId/sessions/:id          → { ok, session }
PATCH  /api/agent/canvases/:canvasId/sessions/:id          ← { title } → { ok }
DELETE /api/agent/canvases/:canvasId/sessions/:id          → { ok, removed }
POST   /api/agent/canvases/:canvasId/sessions/:id/messages ← { text, images? } → text/event-stream
POST   /api/agent/canvases/:canvasId/sessions/:id/abort    → { ok }
```

> **没有 `/new` 这个口**：不带 sessionId 的 POST 就是新建。少一个容易写错的路径。
> 删会话时同时调 `runtime.forget`（内存态）与 `store.remove`（磁盘）。

- [ ] **Step 1: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/agentSessionsRoutes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentSessionStore } from '../agent/sessionStore'
import { AgentRuntime, type AgentLike, type AgentSessionLike } from '../agent/runtime'
import { DEFAULT_POLICY } from '../agent/approval'
import { agentSessionRoutes } from '../routes/agentSessions'

let root: string
let store: AgentSessionStore

/** 假会话：吐一句文本就结束 */
function scriptedAgent(): AgentLike {
  const session: AgentSessionLike = {
    sessionId: 'session-2026-10-01-00-00-00-abcdef01',
    provider: 'test',
    modelId: 'test-model',
    async *run() {
      yield { type: 'model_msg', payload: { type: 'text', text: '收到' } }
    },
  }
  return {
    async createSession() {
      return session
    },
    async resumeSession() {
      return session
    },
  }
}

function makeApp() {
  const runtime = new AgentRuntime({
    root,
    store,
    agent: async () => scriptedAgent(),
    makeUserMessage: (text) => [{ type: 'model_msg', payload: { type: 'text', role: 'user', text } }],
    policy: DEFAULT_POLICY,
  })
  return agentSessionRoutes(store, runtime)
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sess-routes-'))
  store = new AgentSessionStore(root)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const BASE = '/api/agent/canvases/default/sessions'

async function call(app: ReturnType<typeof makeApp>, method: string, url: string, body?: unknown) {
  return app.fetch(
    new Request('http://localhost' + url, {
      method,
      ...(body !== undefined
        ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
        : {}),
    }),
  )
}

describe('会话 CRUD', () => {
  it('列表空 → 空数组；建一个后列表里有它', async () => {
    const app = makeApp()
    const before = await (await call(app, 'GET', BASE)).json()
    expect((before as { sessions: unknown[] }).sessions).toEqual([])
    const created = await (await call(app, 'POST', BASE, {})).json()
    expect((created as { ok: boolean; resumed: boolean }).resumed).toBe(false)
    const after = await (await call(app, 'GET', BASE)).json()
    expect((after as { sessions: unknown[] }).sessions).toHaveLength(1)
  })

  it('非法画布 id → 400', async () => {
    const res = await call(makeApp(), 'GET', '/api/agent/canvases/..%2Fetc/sessions')
    expect(res.status).toBe(400)
  })

  it('读会话：不存在 404；改标题后能读回', async () => {
    const app = makeApp()
    const created = (await (await call(app, 'POST', BASE, {})).json()) as { id: string }
    expect((await call(app, 'GET', BASE + '/nope')).status).toBe(404)
    expect((await call(app, 'PATCH', BASE + '/' + created.id, { title: '新名字' })).status).toBe(200)
    const one = await (await call(app, 'GET', BASE + '/' + created.id)).json()
    expect((one as { session: { title: string } }).session.title).toBe('新名字')
  })

  it('删会话 → 列表里没了', async () => {
    const app = makeApp()
    const created = (await (await call(app, 'POST', BASE, {})).json()) as { id: string }
    expect((await call(app, 'DELETE', BASE + '/' + created.id)).status).toBe(200)
    const list = await (await call(app, 'GET', BASE)).json()
    expect((list as { sessions: unknown[] }).sessions).toEqual([])
  })
})

describe('对话流（SSE）', () => {
  it('POST messages 回 text/event-stream，帧里带 text 与 done', async () => {
    const app = makeApp()
    const created = (await (await call(app, 'POST', BASE, {})).json()) as { id: string }
    const res = await call(app, 'POST', BASE + '/' + created.id + '/messages', { text: '你好' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const body = await res.text()
    expect(body).toContain('text')
    expect(body).toContain('done')
    const one = (await (await call(app, 'GET', BASE + '/' + created.id)).json()) as {
      session: { turns: Array<{ text: string }> }
    }
    expect(one.session.turns.map((t) => t.text)).toContain('你好')
  })

  it('消息为空 → 400（不该白白开一条流）', async () => {
    const app = makeApp()
    const created = (await (await call(app, 'POST', BASE, {})).json()) as { id: string }
    expect((await call(app, 'POST', BASE + '/' + created.id + '/messages', { text: '   ' })).status).toBe(400)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test agentSessionsRoutes`
Expected: FAIL —— 找不到模块 `../routes/agentSessions`

- [ ] **Step 3: 写最小实现**

```ts
// packages/cloud-server/src/routes/agentSessions.ts
/**
 * agentSessions 路由 —— 某个画布下的会话与对话流。
 *
 * 与 agent.ts（全局配置）分开住的原因就是「归属不同」：这份 URL 里带着 canvasId。
 *
 * 流式为什么用 SSE：与 /api/kv/events 同一条理由 —— 数据天生单向（服务器推、浏览器收），
 * 而用户的下一条消息本来就有现成的 POST。用 WebSocket 只会多背一套重连与粘包。
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { isSafeCanvasId } from '../store/canvasPaths.js'
import { isSafeSessionId } from '../agent/agentPaths.js'
import type { AgentSessionStore } from '../agent/sessionStore.js'
import type { AgentRuntime } from '../agent/runtime.js'

export function agentSessionRoutes(store: AgentSessionStore, runtime: AgentRuntime): Hono {
  const app = new Hono()

  /** 校验路径两段；不合法时回一个 400 响应 */
  function guardParams(c: { req: { param: (k: string) => string | undefined } }):
    | { ok: true; canvasId: string; sessionId?: string }
    | { ok: false; res: Response } {
    const canvasId = c.req.param('canvasId') ?? ''
    if (!isSafeCanvasId(canvasId)) {
      return { ok: false, res: Response.json({ ok: false, error: '非法画布 id' }, { status: 400 }) }
    }
    const sessionId = c.req.param('sessionId')
    if (sessionId !== undefined && !isSafeSessionId(sessionId)) {
      return { ok: false, res: Response.json({ ok: false, error: '非法会话 id' }, { status: 400 }) }
    }
    return sessionId === undefined ? { ok: true, canvasId } : { ok: true, canvasId, sessionId }
  }

  app.get('/api/agent/canvases/:canvasId/sessions', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    return c.json({ ok: true, sessions: await store.list(p.canvasId) })
  })

  app.post('/api/agent/canvases/:canvasId/sessions', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    let body: Record<string, unknown> = {}
    try {
      body = ((await c.req.json()) ?? {}) as Record<string, unknown>
    } catch {
      /* 空 body 是允许的：新建一个默认会话 */
    }
    const title = typeof body.title === 'string' ? body.title : undefined
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
    try {
      const r = await runtime.ensureSession(p.canvasId, {
        ...(sessionId ? { sessionId } : {}),
        ...(title ? { title } : {}),
      })
      return c.json({ ok: true, id: r.id, resumed: r.resumed })
    } catch (err) {
      // 最常见的失败是「还没配模型」：用户能自己处理，回 503 并说清怎么修
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 503)
    }
  })

  app.get('/api/agent/canvases/:canvasId/sessions/:sessionId', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    const session = await store.get(p.canvasId, p.sessionId!)
    if (!session) return c.json({ ok: false, error: '会话不存在' }, 404)
    return c.json({ ok: true, session })
  })

  app.patch('/api/agent/canvases/:canvasId/sessions/:sessionId', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    let body: Record<string, unknown>
    try {
      body = ((await c.req.json()) ?? {}) as Record<string, unknown>
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return c.json({ ok: false, error: '需要 title' }, 400)
    }
    const done = await store.rename(p.canvasId, p.sessionId!, body.title.trim())
    if (!done) return c.json({ ok: false, error: '会话不存在' }, 404)
    return c.json({ ok: true })
  })

  app.delete('/api/agent/canvases/:canvasId/sessions/:sessionId', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    // 先放掉内存态（否则那条会话对象会一直挂着、甚至继续跑）
    runtime.forget(p.canvasId, p.sessionId!)
    const removed = await store.remove(p.canvasId, p.sessionId!)
    return c.json({ ok: true, removed })
  })

  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/abort', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    runtime.abort(p.canvasId, p.sessionId!)
    return c.json({ ok: true })
  })

  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/messages', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    let body: Record<string, unknown>
    try {
      body = ((await c.req.json()) ?? {}) as Record<string, unknown>
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    const text = String(body.text ?? '').trim()
    if (!text) return c.json({ ok: false, error: '消息不能为空' }, 400)
    const images = Array.isArray(body.images) ? body.images.map(String) : undefined

    const ac = new AbortController()
    return streamSSE(c, async (stream) => {
      // 浏览器关页面 / 断网：立刻中止这一轮，别让模型白跑
      stream.onAbort(() => ac.abort())
      try {
        for await (const ev of runtime.run(
          p.canvasId,
          { canvasId: p.canvasId, sessionId: p.sessionId!, text, ...(images ? { images } : {}) },
          ac.signal,
        )) {
          await stream.writeSSE({ data: JSON.stringify(ev) })
        }
      } catch (err) {
        // runtime.run 自己会吞掉 SDK 的异常并产出 error 事件；走到这里说明是更外层的问题
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
        })
      }
    })
  })

  return app
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test agentSessionsRoutes`
Expected: PASS（6 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/cloud-server/src/routes/agentSessions.ts packages/cloud-server/src/__tests__/agentSessionsRoutes.test.ts
git commit -m "feat(cloud-server): 画布会话路由 + SSE 对话流（含中止与删除）"
```
---

### Task 9: 把 agent 子系统接进 cloud-server

**Files:**
- Modify: `packages/cloud-server/src/server.ts`
- Modify: `packages/cloud-server/src/index.ts`
- Modify: `packages/cloud-server/src/cli.ts`（打印 Agent 配置落点）
- Modify: `packages/cloud-server/src/__tests__/routes.test.ts`（加两条断言，验证路由挂上了）

**Interfaces:**
- Produces: `CloudServerOptions` 新增两个可选字段：
  - `agentSkillSources?: string[]` —— 技能来源目录（测试注入；缺省 `~/.agents/skills`）
  - `agentRuntime?: boolean` —— 是否装配会话运行时（缺省 true；测试可关）

> **一处必须先改的前置**：Task 6 的 `makeUserMessage` 要返回**消息数组**
> （SDK 的一条输入可能拆成「文本 + 若干图片」）。
> 改 `AgentRuntime.run` 里那一行：
> `const one = this.deps.makeUserMessage(input.text, input.images)` +
> `const messages: unknown[] = Array.isArray(one) ? one : [one]`；
> 并把 Task 6 测试里的假实现改成返回数组。

- [ ] **Step 1: 加两条失败断言**

在 `packages/cloud-server/src/__tests__/routes.test.ts` 末尾追加：

```ts
describe('agent 路由已挂上', () => {
  it('GET /api/agent/config 可用（不再是 404）', async () => {
    const r = await call('GET', '/api/agent/config')
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
  })

  it('会话路由也在：画布 id 非法时 400（说明路由存在且做了校验）', async () => {
    const r = await call('GET', '/api/agent/canvases/bad!id/sessions')
    expect(r.status).toBe(400)
  })
})
```

Run: `pnpm -C packages/cloud-server test routes`
Expected: FAIL（两条都是 404）

- [ ] **Step 2: 在 server.ts 里装配**

在 `createCloudServer` 里，`const doc = new CanvasDocument(...)` 之后插入：

```ts
  // ==================== Agent（画布内的对话助手）====================
  // 两条归属不同的线（设计 §三）：全局配置（模型/技能/MCP）+ 按画布的会话。
  // sdk 在这里一次性取好：createAgent / userText 都是同步要用的函数。
  const sdk = await import('@prismshadow/penguin-core')
  const agentConfig = new AgentConfigService(dataDir, opts.agentSkillSources)
  const agentSessions = new AgentSessionStore(dataDir)
  const agentRuntime = new AgentRuntime({
    root: dataDir,
    store: agentSessions,
    // 懒建 agent：没配模型时第一次对话才报错，而不是启动就失败
    agent: () =>
      sdk.createAgent({ root: agentRoot(dataDir), projectId: AGENT_PROJECT_ID, agentId: AGENT_ID }),
    makeUserMessage: (text, images) => {
      const messages: unknown[] = [sdk.userText(text)]
      for (const url of images ?? []) messages.push(sdk.imageUrlMessage(url))
      return messages
    },
    policy: DEFAULT_POLICY,
    log: (message, extra) => console.log('[agent] ' + message, extra ?? ''),
  })
```

补 import（文件顶部的 import 区）：

```ts
import { AgentConfigService } from './agent/config.js'
import { AgentSessionStore } from './agent/sessionStore.js'
import { AgentRuntime } from './agent/runtime.js'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot } from './agent/agentPaths.js'
import { DEFAULT_POLICY } from './agent/approval.js'
import { agentRoutes } from './routes/agent.js'
import { agentSessionRoutes } from './routes/agentSessions.js'
```

挂路由（放在 `app.route('/', canvasOpsRoutes(doc))` 之后、MCP 之前）：

```ts
  // Agent：全局配置 + 按画布的会话。对话流是 SSE，必须留在静态托管之前。
  app.route('/', agentRoutes(agentConfig))
  if (opts.agentRuntime !== false) app.route('/', agentSessionRoutes(agentSessions, agentRuntime))
```

在 `CloudServerOptions` 里补两个字段：

```ts
  /** 技能一键导入的来源目录（缺省 ~/.agents/skills；测试注入临时目录，避免读到真实家目录） */
  agentSkillSources?: string[]
  /** 是否装配 Agent 会话运行时（缺省 true；测试里可关掉，避免加载 SDK） */
  agentRuntime?: boolean
```

并把 `stop()` 改成：

```ts
    stop() {
      watcher?.stop()
      agentRuntime.disposeAll()
      void tasks.dispose()
      server?.close()
      server = undefined
    },
```

- [ ] **Step 3: 导出新模块**

在 `packages/cloud-server/src/index.ts` 补：

```ts
export { AgentConfigService } from './agent/config.js'
export { AgentSessionStore } from './agent/sessionStore.js'
export { AgentRuntime } from './agent/runtime.js'
export { translateMessage } from './agent/translate.js'
export { DEFAULT_POLICY, decideTool, matchesPattern } from './agent/approval.js'
export { agentRoutes } from './routes/agent.js'
export { agentSessionRoutes } from './routes/agentSessions.js'
export type { AgentChatEvent } from './agent/translate.js'
export type { ApprovalMode, ApprovalPolicy } from './agent/approval.js'
export type { AgentSessionMeta, AgentSessionRecord, AgentTurn } from './agent/sessionStore.js'
export type { AgentLike, AgentSessionLike, StartRunInput } from './agent/runtime.js'
```

- [ ] **Step 4: CLI 打印落点**

在 `packages/cloud-server/src/cli.ts` 打印数据目录那几行后面补：

```ts
  console.log(`  Agent  ${srv.paths.data}/agent      模型 / 技能 / MCP 的全局配置`)
  console.log(`         会话在 ${srv.paths.canvases}/<画布>/agent/`)
```

- [ ] **Step 5: 跑全量测试与类型检查**

Run: `pnpm -C packages/cloud-server test && pnpm -C packages/cloud-server typecheck`
Expected: 全绿、零类型错误。**动手前先记下当前用例数**，做完只增不减。

若 `routes.test.ts` 里已有用例因为多了一条真实路由而变化（例如通配兜底断言），
逐条核对，只改与本次相关的部分。

- [ ] **Step 6: 手工验真后台（Phase 0 的收尾闸门）**

Run: `pnpm -C packages/cloud-server build`，然后 `node ./dist/cli.js serve --no-mcp --no-open --port 8866`
另开一个终端（把密钥换成你自己的，**别写进任何文件**）：

```bash
curl -s http://127.0.0.1:8866/api/agent/config
curl -s -X POST http://127.0.0.1:8866/api/agent/models \
  -H 'content-type: application/json' \
  -d '{"provider":"deepseek","modelId":"deepseek-chat","apiKey":"<你的密钥>","baseUrl":"https://api.deepseek.com","setDefault":true}'
curl -s -N -X POST http://127.0.0.1:8866/api/agent/canvases/default/sessions/session-probe/messages \
  -H 'content-type: application/json' -d '{"text":"你是什么模型"}'
```

Expected：
1. 第一条：模型为空（还没配）；
2. 第二条之后再看 `config`，`models` 有一项、`hasKey: true`，**响应里搜不到明文密钥**；
3. 第三条：一串 `data: {...}` 帧，含 `text` 与结尾 `done`。

**关键验证（D5 的核心假设，必须做）**：Ctrl+C 停掉服务，重新启动，然后：

```bash
curl -s http://127.0.0.1:8866/api/agent/canvases/default/sessions
```
Expected：会话还在列表里；再发一句「我上一条问了什么」，回答能对上 ——
说明 SDK 的 `resumeSession` 确实把上下文接回来了。
**这条不成立就停下来回报**（设计 §九 风险 1 已写明退路：改用 SDK 的 trace 路径，或把转录当前缀注入）。

- [ ] **Step 7: 提交**

```bash
git add packages/cloud-server/src/server.ts packages/cloud-server/src/index.ts packages/cloud-server/src/cli.ts packages/cloud-server/src/__tests__/routes.test.ts
git commit -m "feat(cloud-server): 装配 agent 子系统（全局配置 + 按画布会话 + SSE 对话）"
```
---

## Phase 1 · 前端插件

### Task 10: 插件包骨架（能装上、能开合面板）

**Files:**
- Create: `packages/plugins/plugin-agent/package.json`
- Create: `packages/plugins/plugin-agent/tsconfig.json`
- Create: `packages/plugins/plugin-agent/vitest.config.ts`
- Create: `packages/plugins/plugin-agent/src/env.d.ts`
- Create: `packages/plugins/plugin-agent/src/agentPlugin.ts`
- Create: `packages/plugins/plugin-agent/src/index.ts`
 - Create: `packages/plugins/plugin-agent/src/components/AgentConversation.vue`
- Test: `packages/plugins/plugin-agent/src/__tests__/agentPlugin.test.ts`

**Interfaces:**
- Consumes: `@mini-canvas/canvas-base` 的 `Context` / `PluginModule`
- Produces:
```ts
export const name = 'agent'
export const inject = [] as string[]
export interface AgentServiceState {
  open: boolean
  docked: boolean
  width: number
  sessionId: string | null
  running: boolean
}
export function apply(ctx: Context): void
export const agentPlugin: PluginModule
```

- [ ] **Step 1: 建包（照 plugin-bottom-bar 的形状）**

```json
// packages/plugins/plugin-agent/package.json
{
  "name": "@mini-canvas/plugin-agent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./*": "./src/*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@mini-canvas/canvas-base": "workspace:*",
    "@mini-canvas/canvas-render": "workspace:*",
    "@mini-canvas/kernel": "workspace:*"
  },
  "peerDependencies": { "vue": "^3.5.34" },
  "devDependencies": {
    "@vitejs/plugin-vue": "^6.0.6",
    "typescript": "~6.0.2",
    "vitest": "^3.0.0",
    "vue": "^3.5.34"
  }
}
```

```json
// packages/plugins/plugin-agent/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "types": []
  },
  "include": ["src"]
}
```

```ts
// packages/plugins/plugin-agent/vitest.config.ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: { include: ['src/**/*.test.ts'], environment: 'node', passWithNoTests: true },
})
```

```ts
// packages/plugins/plugin-agent/src/env.d.ts
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
```

- [ ] **Step 2: 写失败测试（插件挂上后服务与槽位都在）**

```ts
// packages/plugins/plugin-agent/src/__tests__/agentPlugin.test.ts
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { agentPlugin } from '../agentPlugin'
import type { AgentServiceState } from '../agentPlugin'

async function boot() {
  const ctx = new Context()
  ctx.inject('command', new CommandRegistry())
  ctx.plugin(agentPlugin)
  await ctx.start()
  return ctx
}

describe('agent 插件装配', () => {
  it('挂上后 agent 服务在，默认收起', async () => {
    const ctx = await boot()
    const svc = ctx.get<AgentServiceState>('agent')
    expect(svc).toBeTruthy()
    expect(svc.open).toBe(false)
    expect(svc.sessionId).toBeNull()
    ctx.stop()
  })

  it('内容组件注册进了 agent-conversation 槽', async () => {
    const ctx = await boot()
    const occ = ctx.slots.occupants('agent-conversation')
    expect(occ.map((o) => o.id)).toContain('agent-conversation')
    ctx.stop()
  })

  it('命令 agent:toggle 能开合面板', async () => {
    const ctx = await boot()
    const svc = ctx.get<AgentServiceState>('agent')
    const command = ctx.get<{ run(id: string): boolean }>('command')
    command.run('agent:toggle')
    expect(svc.open).toBe(true)
    command.run('agent:toggle')
    expect(svc.open).toBe(false)
    ctx.stop()
  })

  it('卸载后服务与槽位一起回收', async () => {
    const ctx = await boot()
    ctx.stop()
    expect(ctx.get('agent')).toBeUndefined()
  })
})
```

Run: `pnpm -C packages/plugins/plugin-agent test`
Expected: FAIL —— 找不到模块 `../agentPlugin`

- [ ] **Step 3: 写插件主体与最小面板**

```ts
// packages/plugins/plugin-agent/src/agentPlugin.ts
/**
 * plugin-agent —— 画布内的对话助手（内容组件 + 服务 + 命令 + 设置页）。
 *
 * 与 plugin-mini-map 同一条路（本仓库插件的标准做法）：
 * - **槽位**装 UI：内容组件注册进 agent-conversation 槽，任何布局用 <SlotHost slot="agent-conversation" /> 自选位置；
 * - **服务**持状态：ctx.inject('agent', state)，宿主读它做布局（面板要挤画布），与 ui.ts 读 mini-map 同形；
 * - **命令**给键盘：agent:toggle，键位由渲染层统一分发（插件不自己绑 window）。
 *
 * **外壳不在本插件里**（浮动框 / 停靠 / 拖宽 / 缩放 / 头部按钮归 packages/ui）：
 * 插件只提供「消息流 + 输入区」这一块内容，与设置面板「插件给内容、外壳归渲染层」同构。
 * 理由之一是技术上的：停靠要把画布挤窄，用的是 CanvasShell 的 right-width，插件够不到那个绑定。
 *
 * 打开时**不自动建会话**：没配模型时该给引导，而不是一进来就报错。
 */
 import { reactive } from 'vue'
 import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import AgentConversation from './components/AgentConversation.vue'

export const name = 'agent'
export const inject = [] as string[]

export interface AgentServiceState {
  open: boolean
  docked: boolean
  width: number
  sessionId: string | null
  running: boolean
}

export function apply(ctx: Context): void {
  const state: AgentServiceState = reactive({
    open: false,
    docked: false,
    width: 400,
    sessionId: null,
    running: false,
  })
  ctx.inject('agent', state)

  ctx.slots.register('agent-conversation', {
    id: 'agent-conversation',
    order: 60,
    component: AgentConversation,
    meta: { title: 'Agent 对话内容' },
  })

  ctx.commands.register({
    id: 'agent:toggle',
    title: '切换 Agent 面板',
    keys: ['mod+j'],
    order: 60,
    run: () => {
      state.open = !state.open
    },
  })
}

export const agentPlugin: PluginModule = { name, inject, apply }
```

```vue
<!-- packages/plugins/plugin-agent/src/components/AgentConversation.vue -->
<script setup lang="ts">
// AgentConversation 骨架：本组件是**内容** —— 没有外框、没有头部按钮、不拖拽、不停靠。
// 那些是外壳的事（归 packages/ui），与设置内容「插件给内容、渲染层给外壳」同一条规矩。
// 本步只让它立起来；消息流与输入区在 Task 11 / 12 填。
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { AgentServiceState } from '../agentService'

const { ctx } = useCanvasRender()
const s = ctx.get<AgentServiceState>('agent')
</script>

<template>
  <div class="ac-root" :data-empty="!s.turns.length" aria-label="Agent 对话">
    <div class="ac-body">对话内容见下一步</div>
  </div>
</template>

<style scoped>
/* 视觉数值取自 docs/design/ui-style-guide.md，不自造颜色 / 圆角 / 字号。 */
/* 只写内容自己的样式：外框 / 圆角 / 阴影由外壳给，这里不碰。 */
.ac-root { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--ui-ink); }
.ac-body { flex: 1; min-height: 0; padding: 0 16px; }
</style>
```

```ts
// packages/plugins/plugin-agent/src/index.ts
export { agentPlugin, name, inject, apply } from './agentPlugin.js'
export type { AgentServiceState } from './agentPlugin.js'
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/plugins/plugin-agent test && pnpm -C packages/plugins/plugin-agent typecheck`
Expected: PASS（4 个用例）、零类型错误

注意 `package.json` 里没有 `lucide-vue-next`：它是 vue 生态的图标包，
本插件的组件用到它时要把它加进 `dependencies`（与 `packages/ui` 的版本一致：
`^1.0.0`）。**这一步别忘**，否则 typecheck 会报找不到模块。

- [ ] **Step 5: 提交**

```bash
git add packages/plugins/plugin-agent pnpm-lock.yaml
git commit -m "feat(plugin-agent): 插件骨架（agent-conversation 槽 + agent 服务 + agent:toggle 命令）"
```
---

### Task 11: 后端接口封装与事件合并（纯逻辑，可单测）

**Files:**
- Create: `packages/plugins/plugin-agent/src/agentApi.ts`
- Create: `packages/plugins/plugin-agent/src/sessionModel.ts`
- Test: `packages/plugins/plugin-agent/src/__tests__/sessionModel.test.ts`
- Test: `packages/plugins/plugin-agent/src/__tests__/agentApi.test.ts`

**Interfaces:**
- Produces:
```ts
export type ChatEvent =
  | { type: 'session'; sessionId: string; title: string }
  | { type: 'text'; delta?: string; text?: string; partial?: boolean; final?: boolean }
  | { type: 'thinking'; delta?: string; text?: string; partial?: boolean; final?: boolean }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_output'; id: string; output: string }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  thinking: string
  tools: Array<{ id: string; name: string; arguments: string; output?: string }>
  notice?: string
  error?: string
  streaming: boolean
}

export class AgentApi {
  constructor(opts?: { baseUrl?: string; fetchImpl?: typeof fetch })
  config(): Promise<Record<string, unknown>>
  listSessions(canvasId: string): Promise<Record<string, unknown>[]>
  getSession(canvasId: string, sessionId: string): Promise<Record<string, unknown>>
  createSession(canvasId: string, body?: { title?: string }): Promise<{ id: string; resumed: boolean }>
  renameSession(canvasId: string, sessionId: string, title: string): Promise<unknown>
  deleteSession(canvasId: string, sessionId: string): Promise<unknown>
  abort(canvasId: string, sessionId: string): Promise<unknown>
  sendMessage(canvasId: string, sessionId: string, text: string, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void>
  saveModel(body: Record<string, unknown>): Promise<unknown>
  deleteModel(provider: string, modelId: string): Promise<unknown>
  setDefaultModel(provider: string, modelId: string): Promise<unknown>
  setVisionModel(provider: string, modelId: string): Promise<unknown>
  importSkill(dir: string): Promise<unknown>
  removeSkill(name: string): Promise<unknown>
  addMcp(body: Record<string, unknown>): Promise<unknown>
  removeMcp(name: string): Promise<unknown>
}

export class ChatModel {
  readonly turns: ChatTurn[]
  send(text: string): string
  apply(ev: ChatEvent): void
  reset(): void
}
```

- [ ] **Step 1: 写失败测试（事件合并，重点是去重）**

```ts
// packages/plugins/plugin-agent/src/__tests__/sessionModel.test.ts
import { describe, it, expect } from 'vitest'
import { ChatModel } from '../sessionModel'

describe('ChatModel 事件合并', () => {
  it('用户发送后立刻有用户消息与一条空的助手消息', () => {
    const m = new ChatModel()
    const id = m.send('你好')
    expect(m.turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(m.turns[1].streaming).toBe(true)
    expect(m.turns[1].id).toBe(id)
  })

  it('delta 累积成正文', () => {
    const m = new ChatModel()
    const id = m.send('在吗')
    m.apply({ type: 'text', delta: '你', partial: true })
    m.apply({ type: 'text', delta: '好', partial: true })
    expect(m.turns.find((t) => t.id === id)?.text).toBe('你好')
  })

  it('同一块既有 delta 又有 final 时不重复追加（参考项目踩过的显示两遍）', () => {
    const m = new ChatModel()
    const id = m.send('问')
    m.apply({ type: 'text', delta: '答', partial: true })
    m.apply({ type: 'text', text: '答', final: true })
    expect(m.turns.find((t) => t.id === id)?.text).toBe('答')
  })

  it('只有 final（没有 delta）时整块落上', () => {
    const m = new ChatModel()
    const id = m.send('问')
    m.apply({ type: 'text', text: '完整回答', final: true })
    expect(m.turns.find((t) => t.id === id)?.text).toBe('完整回答')
  })

  it('thinking 走独立字段，不混进正文', () => {
    const m = new ChatModel()
    const id = m.send('问')
    m.apply({ type: 'thinking', delta: '想', partial: true })
    m.apply({ type: 'text', delta: '答', partial: true })
    const t = m.turns.find((x) => x.id === id)!
    expect(t.thinking).toBe('想')
    expect(t.text).toBe('答')
  })

  it('tool_call 与 tool_output 按 id 配对', () => {
    const m = new ChatModel()
    const id = m.send('问')
    m.apply({ type: 'tool_call', id: 't1', name: 'canvas.get', arguments: '{}' })
    m.apply({ type: 'tool_output', id: 't1', output: 'ok' })
    const tools = m.turns.find((x) => x.id === id)!.tools
    expect(tools).toHaveLength(1)
    expect(tools[0].output).toBe('ok')
  })

  it('done 结束流式；notice / error 各归其位', () => {
    const m = new ChatModel()
    const id = m.send('问')
    m.apply({ type: 'notice', message: '已连接 MCP：canvas(7 个工具)' })
    m.apply({ type: 'done' })
    const t = m.turns.find((x) => x.id === id)!
    expect(String(t.notice)).toContain('已连接 MCP')
    expect(t.streaming).toBe(false)
    m.apply({ type: 'error', message: '网络断了' })
    expect(t.error).toBe('网络断了')
  })

  it('reset 清空（新建对话）', () => {
    const m = new ChatModel()
    m.send('x')
    m.reset()
    expect(m.turns).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/plugins/plugin-agent test sessionModel`
Expected: FAIL —— 找不到模块 `../sessionModel`

- [ ] **Step 3: 实现 sessionModel（把去重写死在这里）**

```ts
// packages/plugins/plugin-agent/src/sessionModel.ts
/**
 * sessionModel —— 把 SSE 事件合并成界面上那一串消息（纯逻辑，零 Vue，可单测）。
 *
 * 一条**从参考项目学来的硬要求**：同一块内容既会以 delta 流式来、也会以 final 整块来，
 * 两者都追加就会让回答显示两遍（那个项目踩过，见其 PLAN.md 的「修复的问题」表）。
 * 这里的做法：每个 turn 记一份 committed 位，首次收到 delta 就置位；
 * final 到来时若已置位则**整块替换**（不是追加），未置位才整块落上。
 */
import type { ChatEvent, ChatTurn } from './agentApi.js'

let seq = 0
const nextId = (): string => 't' + ++seq

export class ChatModel {
  readonly turns: ChatTurn[] = []
  /** turnId → 该块是否已被 delta 写过（决定 final 是替换还是落上） */
  private readonly committed = new Map<string, { text: boolean; thinking: boolean }>()

  private markDue(id: string, key: 'text' | 'thinking'): void {
    const cur = this.committed.get(id) ?? { text: false, thinking: false }
    cur[key] = true
    this.committed.set(id, cur)
  }

  /** 记下用户这句并开一条空的助手消息；返回助手那条的 id */
  send(text: string): string {
    const replyId = nextId()
    this.turns.push({ id: nextId(), role: 'user', text, thinking: '', tools: [], streaming: false })
    this.turns.push({ id: replyId, role: 'assistant', text: '', thinking: '', tools: [], streaming: true })
    return replyId
  }

  private lastAssistant(): ChatTurn | undefined {
    for (let i = this.turns.length - 1; i >= 0; i--) {
      if (this.turns[i].role === 'assistant') return this.turns[i]
    }
    return undefined
  }

  apply(ev: ChatEvent): void {
    const turn = this.lastAssistant()
    if (!turn) return
    const marks = this.committed.get(turn.id) ?? { text: false, thinking: false }
    switch (ev.type) {
      case 'text':
        if (ev.partial && typeof ev.delta === 'string') {
          this.markDue(turn.id, 'text')
          turn.text += ev.delta
        } else if (ev.final && typeof ev.text === 'string') {
          turn.text = marks.text ? ev.text : turn.text + ev.text
        }
        break
      case 'thinking':
        if (ev.partial && typeof ev.delta === 'string') {
          this.markDue(turn.id, 'thinking')
          turn.thinking += ev.delta
        } else if (ev.final && typeof ev.text === 'string') {
          turn.thinking = marks.thinking ? ev.text : turn.thinking + ev.text
        }
        break
      case 'tool_call':
        turn.tools.push({ id: ev.id, name: ev.name, arguments: ev.arguments })
        break
      case 'tool_output': {
        const t = turn.tools.find((x) => x.id === ev.id)
        if (t) t.output = ev.output
        break
      }
      case 'notice':
        turn.notice = ev.message
        break
      case 'error':
        turn.error = ev.message
        turn.streaming = false
        break
      case 'done':
        turn.streaming = false
        break
      default:
        break
    }
  }

  reset(): void {
    this.turns.length = 0
    this.committed.clear()
  }
}
```

- [ ] **Step 4: 实现 agentApi（含 SSE 解析）**

```ts
// packages/plugins/plugin-agent/src/agentApi.ts
/**
 * agentApi —— 后端的 HTTP 面（fetch + SSE 解析）。零 Vue，可单测。
 *
 * baseUrl 缺省空串 = 与画布同源（cloud-server 托管界面时就是这样，也正是 D1 选一个端口的原因）。
 */
export type ChatEvent =
  | { type: 'session'; sessionId: string; title: string }
  | { type: 'text'; delta?: string; text?: string; partial?: boolean; final?: boolean }
  | { type: 'thinking'; delta?: string; text?: string; partial?: boolean; final?: boolean }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_output'; id: string; output: string }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  thinking: string
  tools: Array<{ id: string; name: string; arguments: string; output?: string }>
  notice?: string
  error?: string
  streaming: boolean
}

export class AgentApi {
  private readonly base: string
  private readonly f: typeof fetch

  constructor(opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.base = (opts.baseUrl ?? '').replace(/\/+$/, '')
    this.f = opts.fetchImpl ?? ((...args) => fetch(...args))
  }

  private url(p: string): string {
    return this.base + p
  }

  private async json<T>(p: string, init?: RequestInit): Promise<T> {
    const res = await this.f(this.url(p), {
      ...init,
      headers: init?.body
        ? { 'content-type': 'application/json', ...(init.headers ?? {}) }
        : init?.headers,
    })
    if (!res.ok) {
      let message = '请求失败（' + res.status + '）'
      try {
        const data = (await res.json()) as { error?: string }
        if (data.error) message = data.error
      } catch {
        /* 非 JSON 错误体：保留状态码文案 */
      }
      throw new Error(message)
    }
    return (await res.json()) as T
  }

  private sessionPath(canvasId: string, sessionId: string): string {
    return (
      '/api/agent/canvases/' +
      encodeURIComponent(canvasId) +
      '/sessions/' +
      encodeURIComponent(sessionId)
    )
  }

  config(): Promise<Record<string, unknown>> {
    return this.json('/api/agent/config')
  }

  async listSessions(canvasId: string): Promise<Record<string, unknown>[]> {
    const r = await this.json<{ sessions: Record<string, unknown>[] }>(
      '/api/agent/canvases/' + encodeURIComponent(canvasId) + '/sessions',
    )
    return r.sessions ?? []
  }

  async getSession(canvasId: string, sessionId: string): Promise<Record<string, unknown>> {
    const r = await this.json<{ session: Record<string, unknown> }>(this.sessionPath(canvasId, sessionId))
    return r.session
  }

  createSession(canvasId: string, body: { title?: string } = {}): Promise<{ id: string; resumed: boolean }> {
    return this.json('/api/agent/canvases/' + encodeURIComponent(canvasId) + '/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  renameSession(canvasId: string, sessionId: string, title: string): Promise<unknown> {
    return this.json(this.sessionPath(canvasId, sessionId), {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
  }

  deleteSession(canvasId: string, sessionId: string): Promise<unknown> {
    return this.json(this.sessionPath(canvasId, sessionId), { method: 'DELETE' })
  }

  abort(canvasId: string, sessionId: string): Promise<unknown> {
    return this.json(this.sessionPath(canvasId, sessionId) + '/abort', { method: 'POST', body: '{}' })
  }

  /**
   * 发一句并消费 SSE 流。
   *
   * 事件体是逐帧的 data: {...}，以空行分隔；只认 data: 前缀，保活注释帧（: ping）忽略。
   * 半个帧（分片切在中间）留在 buffer 里等下一片 —— 这是 SSE 客户端最容易写错的一处。
   */
  async sendMessage(
    canvasId: string,
    sessionId: string,
    text: string,
    onEvent: (e: ChatEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await this.f(this.url(this.sessionPath(canvasId, sessionId) + '/messages'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) {
      let message = '发送失败（' + res.status + '）'
      try {
        const data = (await res.json()) as { error?: string }
        if (data.error) message = data.error
      } catch {
        /* 保留状态码文案 */
      }
      throw new Error(message)
    }
    if (!res.body) throw new Error('响应没有内容')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        try {
          onEvent(JSON.parse(line.slice(6)) as ChatEvent)
        } catch {
          /* 坏帧跳过，不因一帧解析失败杀掉整条流 */
        }
      }
    }
  }

  saveModel(body: Record<string, unknown>): Promise<unknown> {
    return this.json('/api/agent/models', { method: 'POST', body: JSON.stringify(body) })
  }

  deleteModel(provider: string, modelId: string): Promise<unknown> {
    return this.json('/api/agent/models', { method: 'DELETE', body: JSON.stringify({ provider, modelId }) })
  }

  setDefaultModel(provider: string, modelId: string): Promise<unknown> {
    return this.json('/api/agent/models/default', {
      method: 'POST',
      body: JSON.stringify({ provider, modelId }),
    })
  }

  setVisionModel(provider: string, modelId: string): Promise<unknown> {
    return this.json('/api/agent/models/vision', {
      method: 'POST',
      body: JSON.stringify({ provider, modelId }),
    })
  }

  importSkill(dir: string): Promise<unknown> {
    return this.json('/api/agent/skills/import', { method: 'POST', body: JSON.stringify({ dir }) })
  }

  removeSkill(name: string): Promise<unknown> {
    return this.json('/api/agent/skills/' + encodeURIComponent(name), { method: 'DELETE' })
  }

  addMcp(body: Record<string, unknown>): Promise<unknown> {
    return this.json('/api/agent/mcp', { method: 'POST', body: JSON.stringify(body) })
  }

  removeMcp(name: string): Promise<unknown> {
    return this.json('/api/agent/mcp', { method: 'DELETE', body: JSON.stringify({ name }) })
  }
}
```

- [ ] **Step 5: 写 agentApi 的解析测试**

```ts
// packages/plugins/plugin-agent/src/__tests__/agentApi.test.ts
import { describe, it, expect } from 'vitest'
import { AgentApi, type ChatEvent } from '../agentApi'

/** 把若干片拼成一个假 Response（可用来验「一帧被切成两片」） */
function sseResponse(parts: string[]): Response {
  const enc = new TextEncoder()
  const chunks = parts.map((p) => enc.encode(p))
  let i = 0
  return new Response(
    new ReadableStream({
      pull(ctrl) {
        if (i >= chunks.length) {
          ctrl.close()
          return
        }
        ctrl.enqueue(chunks[i++])
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('SSE 解析', () => {
  it('逐帧切分并忽略保活注释帧', async () => {
    const api = new AgentApi({
      fetchImpl: async () =>
        sseResponse([
          ': ping\n\n',
          'data: {"type":"text","delta":"你","partial":true}\n\n',
          'data: {"type":"done"}\n\n',
        ]),
    })
    const seen: ChatEvent[] = []
    await api.sendMessage('default', 's1', 'hi', (e) => seen.push(e))
    expect(seen.map((e) => e.type)).toEqual(['text', 'done'])
  })

  it('一帧被切成两片也能拼回来（buffer 逻辑）', async () => {
    const api = new AgentApi({
      fetchImpl: async () =>
        sseResponse(['data: {"type":"text","de', 'lta":"好","partial":true}\n\n']),
    })
    const seen: ChatEvent[] = []
    await api.sendMessage('default', 's1', 'hi', (e) => seen.push(e))
    expect(seen).toHaveLength(1)
    expect((seen[0] as { delta?: string }).delta).toBe('好')
  })

  it('HTTP 报错时把服务端的 error 文案抛出来', async () => {
    const api = new AgentApi({
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: false, error: '尚未配置可用模型' }), { status: 503 }),
    })
    await expect(api.sendMessage('default', 's1', 'hi', () => undefined)).rejects.toThrow('尚未配置可用模型')
  })
})
```

- [ ] **Step 6: 跑测试，确认通过**

Run: `pnpm -C packages/plugins/plugin-agent test && pnpm -C packages/plugins/plugin-agent typecheck`
Expected: PASS（11 个用例）、零类型错误

- [ ] **Step 7: 提交**

```bash
git add packages/plugins/plugin-agent/src/agentApi.ts packages/plugins/plugin-agent/src/sessionModel.ts packages/plugins/plugin-agent/src/__tests__
git commit -m "feat(plugin-agent): 后端接口封装 + SSE 解析 + 事件合并（含去重）"
```
---

### Task 12: 面板接上真后台 + 宿主改动

**Files:**
- Modify: `packages/plugins/plugin-agent/src/agentPlugin.ts`（Config + 接 agentApi + 会话列表）
- Create: `packages/plugins/plugin-agent/src/components/AgentMessageList.vue`
- Create: `packages/plugins/plugin-agent/src/components/AgentComposer.vue`
 - Modify: `packages/plugins/plugin-agent/src/components/AgentConversation.vue`
- Modify: `packages/ui/src/App.vue`（SlotHost + dock-append + right-width + 去掉 ChatPanel）
- Modify: `packages/ui/src/composables/ui.ts`（加 agent 服务的两处读）
- Modify: `packages/ui/package.json` / `packages/ui/vite.config.ts`（加依赖与 exclude）

**Interfaces:**
- Consumes: Task 11 的 `AgentApi` / `ChatModel`；Task 10 的 `agent` 服务
- Produces: `AgentServiceState` 扩展为：

```ts
export interface AgentServiceState {
  open: boolean
  docked: boolean
  width: number
  sessionId: string | null
  running: boolean
  /** 后端返回的会话列表（面板里的历史下拉读它） */
  sessions: Array<{ id: string; title: string; updatedAt: number; preview?: string }>
  /** 还没配模型（界面给引导而不是报错） */
  needsModel: boolean
}
```

- [ ] **Step 1: 插件里加 Config、读配置、拉会话列表**

给插件加 `Config`（少量开关走 schema，列表与表单页走内容插槽，见设计 §6.3）：

```ts
import { F } from '@mini-canvas/kernel'

export const Config = {
  agentBaseUrl: {
    type: 'string',
    default: '',
    label: '后端地址',
    group: 'Agent/常规',
    description: 'cloud-server 的根地址。留空 = 与画布同源（由 cloud-server 托管界面时就是这样）。',
  },
  agentApprovalMode: {
    type: 'select',
    default: 'auto',
    label: '工具审批档位',
    group: 'Agent/常规',
    options: [
      { value: 'auto', label: '自动（全部放行）' },
      { value: 'ask', label: '询问（按清单先问）' },
    ],
    description: '自动 = Agent 可直接动手；询问 = 命中询问清单的动作先经过你确认。',
  },
  agentAskTools: {
    type: 'array',
    default: ['exec_command', '*write*'],
    item: F.string(),
    label: '需要询问的动作',
    group: 'Agent/常规',
    description: '仅在询问档位生效。支持通配，例如 web2api:* 或 *.generate*。',
  },
} as const

export type AgentPluginConfig = {
  agentBaseUrl?: string
  agentApprovalMode?: string
  agentAskTools?: string[]
}
```

在 `apply(ctx, config)` 里（apply 现在收第二个参数）：

```ts
export function apply(ctx: Context, config?: AgentPluginConfig): void {
  const state: AgentServiceState = reactive({
    open: false,
    docked: false,
    width: 400,
    sessionId: null,
    running: false,
    sessions: [],
    needsModel: false,
  })
  ctx.inject('agent', state)

  const api = new AgentApi({ baseUrl: config?.agentBaseUrl ?? '' })
  ctx.inject('agent-api', api)

  /** 拉一次会话列表；失败不抛（面板照常可用，只是列表空） */
  async function refreshSessions(): Promise<void> {
    try {
      const list = await api.listSessions(CANVAS_ID)
      state.sessions = list.map((s) => ({
        id: String(s.id),
        title: String(s.title ?? '新会话'),
        updatedAt: Number(s.updatedAt ?? 0),
        ...(typeof s.preview === 'string' ? { preview: s.preview } : {}),
      }))
    } catch {
      state.sessions = []
    }
  }

  /** 问一次后端：还没配模型就置 needsModel（界面据此给引导） */
  async function refreshReadiness(): Promise<void> {
    try {
      const cfg = await api.config()
      const models = Array.isArray(cfg.models) ? cfg.models : []
      state.needsModel = models.length === 0
    } catch {
      state.needsModel = true
    }
  }

  ctx.inject('agent-refresh', { sessions: refreshSessions, readiness: refreshReadiness })
  // …原有的 slots / commands 注册保持不变；agent:toggle 打开时顺手刷一次 readiness
}
```

`CANVAS_ID` 在本插件里就地声明为 `'default'`（与 plugin-cloud-client 的 keys.ts 一致），
并由 Step 6 的测试逐字比对，避免将来只改了一边。

- [ ] **Step 2: 写消息列表与输入区组件**

```vue
<!-- packages/plugins/plugin-agent/src/components/AgentMessageList.vue -->
<script setup lang="ts">
// 消息流：正文 + 可折叠的思考 + 工具调用行。纯展示，状态由 agent 服务提供。
import type { ChatTurn } from '../agentApi'

defineProps<{ turns: ChatTurn[]; emptyText: string }>()
</script>

<template>
  <div class="agent-list">
    <p v-if="!turns.length" class="agent-empty">{{ emptyText }}</p>
    <template v-for="t in turns" :key="t.id">
      <div class="agent-row" :class="t.role">
        <span class="agent-avatar">{{ t.role === 'user' ? 'ME' : 'AI' }}</span>
        <p class="agent-text">{{ t.text }}</p>
      </div>
      <details v-if="t.thinking" class="agent-thinking">
        <summary>思考过程</summary>
        <pre>{{ t.thinking }}</pre>
      </details>
      <div v-for="tool in t.tools" :key="tool.id" class="agent-tool">
        <code>{{ tool.name }}</code>
        <span v-if="tool.output" class="agent-tool-out">{{ tool.output }}</span>
      </div>
      <p v-if="t.notice" class="agent-notice">{{ t.notice }}</p>
      <p v-if="t.error" class="agent-error">{{ t.error }}</p>
    </template>
  </div>
</template>

<style scoped>
.agent-list { display: flex; flex-direction: column; gap: 12px; padding: 4px 0 16px; }
.agent-empty { padding: 40px 0; text-align: center; font-size: 12px; color: var(--ui-ink-dim); }
.agent-row { display: flex; align-items: flex-start; gap: 8px; }
.agent-avatar { display: grid; place-items: center; width: 24px; height: 24px; flex: none; border-radius: 999px; font-size: 9px; font-weight: 700; }
.agent-row.assistant .agent-avatar { background: var(--ui-accent); color: var(--ui-primary-ink); }
.agent-row.user .agent-avatar { background: var(--ui-hover-strong); color: var(--ui-ink); }
.agent-text { margin: 0; font-size: 12px; line-height: 1.6; color: var(--ui-ink); white-space: pre-wrap; }
.agent-thinking { font-size: 11px; color: var(--ui-ink-dim); }
.agent-thinking pre { margin: 6px 0 0; white-space: pre-wrap; font-family: inherit; }
.agent-tool { padding: 6px 8px; border-radius: 8px; background: var(--ui-veil); font-size: 11px; }
.agent-tool-out { display: block; margin-top: 4px; color: var(--ui-ink-dim); }
.agent-notice { margin: 0; font-size: 11px; color: var(--ui-ink-dim); }
.agent-error { margin: 0; font-size: 11px; color: var(--ui-danger); }
</style>
```

```vue
<!-- packages/plugins/plugin-agent/src/components/AgentComposer.vue -->
<script setup lang="ts">
// 输入区：回车发送；跑着的时候按钮变「停止」。
import { ref } from 'vue'
import { ArrowUp, Square } from 'lucide-vue-next'

const props = defineProps<{ running: boolean; disabled: boolean }>()
const emit = defineEmits<{ send: [string]; stop: [] }>()
const text = ref('')

function submit(): void {
  const v = text.value.trim()
  if (!v || props.disabled || props.running) return
  text.value = ''
  emit('send', v)
}
</script>

<template>
  <div class="agent-composer">
    <textarea
      v-model="text"
      rows="1"
      class="agent-input"
      :disabled="disabled"
      :placeholder="disabled ? '请先在设置里配置模型' : '说点什么…（Enter 发送）'"
      aria-label="对话输入"
      @keydown.enter.prevent="submit"
    ></textarea>
    <button
      class="agent-send"
      :aria-label="running ? '停止' : '发送'"
      :disabled="!running && (!text.trim() || disabled)"
      @click="running ? emit('stop') : submit()"
    >
      <Square v-if="running" :size="14" />
      <ArrowUp v-else :size="16" />
    </button>
  </div>
</template>

<style scoped>
.agent-composer { display: flex; align-items: flex-end; gap: 8px; padding: 8px 0 4px; }
.agent-input { flex: 1; min-height: 36px; max-height: 96px; resize: none; padding: 8px 12px; border: 1px solid var(--ui-line); border-radius: 16px; background: var(--ui-veil); color: var(--ui-ink); font-size: 12px; outline: none; }
.agent-send { display: grid; place-items: center; width: 36px; height: 36px; flex: none; border: 0; border-radius: 999px; background: var(--ui-primary-bg); color: var(--ui-primary-ink); cursor: pointer; }
.agent-send:disabled { opacity: 0.4; cursor: default; }
</style>
```

- [ ] **Step 3: 把面板接起来（真发送 + 真流 + 历史 + 引导）**

把 `AgentConversation.vue` 的 `script` 段整体替换为：

```vue
<script setup lang="ts">
// AgentConversation —— 画布内的对话内容（消息流 + 输入区）。外壳（浮动/停靠/头部按钮）归 packages/ui。
//
// 三种状态：还没配模型 → 引导；没有会话 → 空态；有会话 → 消息流 + 输入区。
// 状态放在 agent 服务上（宿主读它做布局），组件只负责调 API 与渲染。
import { computed, onMounted, ref } from 'vue'
import { X, PanelRight, History, Plus } from 'lucide-vue-next'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { AgentServiceState } from '../agentPlugin'
import { AgentApi, type ChatEvent } from '../agentApi'
import { ChatModel } from '../sessionModel'
import AgentMessageList from './AgentMessageList.vue'
import AgentComposer from './AgentComposer.vue'

const CANVAS_ID = 'default'
const { ctx } = useCanvasRender()
const s = ctx.get<AgentServiceState>('agent')
const api = ctx.get<AgentApi>('agent-api')
const refresh = ctx.get<{ sessions: () => Promise<void>; readiness: () => Promise<void> }>('agent-refresh')

const model = ref(new ChatModel())
const abort = ref<AbortController | null>(null)
const errorText = ref('')
const historyOpen = ref(false)
const turns = computed(() => model.value.turns)

onMounted(() => {
  void refresh.readiness()
  void refresh.sessions()
})

async function send(text: string): Promise<void> {
  errorText.value = ''
  // 第一次发送才建会话：这样「还没配模型」时不会留下一个空会话
  if (!s.sessionId) {
    try {
      const created = await api.createSession(CANVAS_ID)
      s.sessionId = created.id
      await refresh.sessions()
    } catch (err) {
      errorText.value = err instanceof Error ? err.message : String(err)
      return
    }
  }
  model.value.send(text)
  s.running = true
  const ac = new AbortController()
  abort.value = ac
  try {
    await api.sendMessage(CANVAS_ID, s.sessionId, text, (ev: ChatEvent) => model.value.apply(ev), ac.signal)
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : String(err)
  } finally {
    s.running = false
    abort.value = null
    void refresh.sessions()
  }
}

function stop(): void {
  abort.value?.abort()
  if (s.sessionId) void api.abort(CANVAS_ID, s.sessionId)
  s.running = false
}

function newChat(): void {
  model.value.reset()
  s.sessionId = null
  errorText.value = ''
}

async function openSession(id: string): Promise<void> {
  historyOpen.value = false
  try {
    const raw = await api.getSession(CANVAS_ID, id)
    model.value.reset()
    const rows = Array.isArray(raw.turns) ? (raw.turns as Array<{ role: string; text: string }>) : []
    for (const t of rows) {
      if (t.role === 'user') {
        model.value.send(t.text)
        continue
      }
      // 助手 / 思考 / 工具那几类补到最后一条助手消息上（只用于回放显示）
      const last = model.value.turns[model.value.turns.length - 1]
      if (!last) continue
      if (t.role === 'assistant') last.text = last.text ? last.text + String.fromCharCode(10) + t.text : t.text
      else if (t.role === 'thinking') last.thinking += t.text
      else last.tools.push({ id: 'r' + last.tools.length, name: t.text, arguments: '' })
      last.streaming = false
    }
    s.sessionId = id
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : String(err)
  }
}

/** 打开画布自己的设置面板（Agent 页就在里面，见设计 §六） */
function goSettings(): void {
  ctx.emit('settings:open')
}

function resize(e: PointerEvent): void {
  e.preventDefault()
  const startX = e.clientX
  const startW = s.width
  const min = 320
  const max = (): number => Math.round(window.innerWidth * 0.55)
  const move = (ev: PointerEvent): void => {
    s.width = Math.min(max(), Math.max(min, startW + (startX - ev.clientX)))
  }
  const stopResize = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stopResize)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stopResize)
}
</script>
```

> `ctx.emit('settings:open')` 需要内核已登记该事件名（dev 下未登记会 warn）。
> 在插件的 `apply` 里加一句 `registerEventName('settings:open')`（从 canvas-base 导入），
> 并在宿主 `ui.ts` 里订阅它：`ctx.on('settings:open', () => { state.settingsOpen = true })`。
> 与既有的 `settings:ui-close` 是同一套广播机制（那个走相反方向）。

模板部分在 Task 10 骨架上补三块：引导块（`s.needsModel`）、消息区（`AgentMessageList`）、
输入区（`AgentComposer`），并在头部加「新建对话」（`newChat`）与「历史」（`historyOpen` 切换）两个按钮。

- [ ] **Step 4: 宿主改三处**

```vue
<!-- packages/ui/src/App.vue 的 <template #ui> 内，与 mini-map 并列 -->
<SlotHost slot="agent-conversation" />
```

```vue
<!-- packages/ui/src/App.vue 的 <CanvasShell> 里启用 dock-append（外壳早就留了这个具名插槽） -->
<template #dock-append>
  <div class="agent-dock-slot">
    <SlotHost slot="agent-dock" />
  </div>
</template>
```

并把 `right-width` 改读 agent 服务：

```vue
<CanvasShell
  class="app-root"
  :theme="s.theme"
  :left-width="s.drawer === 'left' ? s.drawerWidth : 0"
  :right-width="agentDocked ? agentWidth : 0"
  :push-status="true"
  :push-dock="true"
>
```

```ts
// packages/ui/src/composables/ui.ts（与 minimapOn 同形，放在它附近）
const agentState = computed(() =>
  readyHost?.ctx?.get<{ open: boolean; docked: boolean; width: number }>('agent'),
)
const agentDocked = computed(() => !!agentState.value?.open && !!agentState.value.docked)
const agentWidth = computed(() => agentState.value?.width ?? 400)
```

把 `agentDocked` / `agentWidth` 加进 `useUi()` 的返回对象，供 App.vue 用；
并在 `onReady` 里订阅 `settings:open`（见 Step 3 的说明）。

同时去掉 App.vue 里的 `<ChatPanel />` 那行（文件留到 Task 14 再删）。

- [ ] **Step 5: 让 ui 包认识新插件**

```bash
pnpm -C packages/ui add @mini-canvas/plugin-agent@workspace:*
```

在 `packages/ui/vite.config.ts` 的 `optimizeDeps.exclude` 里加 `'@mini-canvas/plugin-agent'`。

- [ ] **Step 6: 加两条防漂移测试**

```ts
// packages/ui/src/__tests__/agentAssembly.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentPlugin } from '@mini-canvas/plugin-agent'

const here = dirname(fileURLToPath(import.meta.url))
const packagesDir = resolve(here, '../../..')

describe('agent 插件与云端插件的画布 id 必须一致', () => {
  it('两边的 CANVAS_ID 字面量相同', () => {
    const cloudKeys = readFileSync(join(packagesDir, 'plugins/plugin-cloud-client/src/keys.ts'), 'utf8')
    const panel = readFileSync(
      join(packagesDir, 'plugins/plugin-agent/src/components/AgentConversation.vue'),
      'utf8',
    )
    const cloud = /CANVAS_ID = '([^']+)'/.exec(cloudKeys)?.[1]
    const agent = /const CANVAS_ID = '([^']+)'/.exec(panel)?.[1]
    expect(cloud).toBeTruthy()
    expect(agent).toBe(cloud)
  })
})

describe('agent 插件可装配', () => {
  it('导出的插件有 name 与 apply', () => {
    expect(agentPlugin.name).toBe('agent')
    expect(typeof agentPlugin.apply).toBe('function')
  })
})
```

- [ ] **Step 7: 跑测试与类型检查**

先 `pnpm -C packages/plugins/plugin-agent test && pnpm -C packages/plugins/plugin-agent typecheck`（都要干净），
再 `pnpm -C packages/ui test`（entrypoint 的 24 之数先别管，Task 14 会改），
最后 `pnpm -C packages/ui typecheck`。

- [ ] **Step 8: 浏览器实测（Phase 1 的闸门）**

Run: 先 `pnpm -C packages/ui build`，再 `pnpm -C packages/cloud-server build`，
然后 `node ./dist/cli.js serve --open`（它会托管 ui 的构建产物）。

Expected（逐条看过）：
1. 底栏出现 Agent 入口按钮，点它能开面板；
2. **停靠时画布被挤窄**（不是被盖住）—— 这是 `right-width` 改对了的标志；
3. 没配模型时面板给「去配置模型」引导，而不是报错；
4. 配好模型后发一句话：能看到流式出字；
5. 刷新页面后**重新打开面板仍能看到刚才的对话**（读的是磁盘上的转录）；
6. 控制台零 error。

- [ ] **Step 9: 提交**

```bash
git add packages/plugins/plugin-agent packages/ui
git commit -m "feat(plugin-agent): 面板接真后台（流式对话 + 历史 + 引导）+ 宿主接槽与布局"
```
---

## Phase 2 · 设置页（模型 / 技能 / MCP）

### Task 13: 三个配置页挂进设置面板的内容插槽

**Files:**
- Create: `packages/plugins/plugin-agent/src/components/settings/AgentSettingsNav.vue`
- Create: `packages/plugins/plugin-agent/src/components/settings/AgentSettingsTabs.vue`
- Create: `packages/plugins/plugin-agent/src/components/settings/ModelsPage.vue`
- Create: `packages/plugins/plugin-agent/src/components/settings/SkillsPage.vue`
- Create: `packages/plugins/plugin-agent/src/components/settings/McpPage.vue`
- Modify: `packages/plugins/plugin-agent/src/agentPlugin.ts`（注册 settingsNav / settingsTab）
- Test: `packages/plugins/plugin-agent/src/__tests__/settingsSlots.test.ts`

**Interfaces:**
- Consumes: Task 11 的 `AgentApi`；设置面板的三层内容插槽（`settingsNav` / `settingsTab` / `settingsGroup/<key>`）
- Produces: 三个槽位 occupant：
  - `settingsNav` → id = `Agent`
  - `settingsTab` → id = `Agent/模型`、`Agent/技能`、`Agent/MCP`

 > **为什么这样挂**（读 `PluginSettingsContent.vue` 得出，别猜）：
> 面板左侧一级导航 = `ctx.settings.groups()` 里每个 group 的第一个 `/` 分段；
> 自定义项来自 `settingsNav`，id 命中已有分组则**顶替**、否则追加；
> 右侧内容里，`settingsTab` 中 id 首段 = 当前一级名的项会被当成自定义段渲染。
> 所以只要 id 按上面的写法，Agent 就会成为设置面板里的一级，三个页签各是一段，内容全由我们画。

- [ ] **Step 1: 写失败测试（槽位确实填上了）**

```ts
// packages/plugins/plugin-agent/src/__tests__/settingsSlots.test.ts
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { agentPlugin } from '../agentPlugin'

async function boot() {
  const ctx = new Context()
  ctx.inject('command', new CommandRegistry())
  ctx.plugin(agentPlugin)
  await ctx.start()
  return ctx
}

describe('Agent 设置页挂进了设置面板的内容插槽', () => {
  it('settingsNav 上有 id 为 Agent 的导航项', async () => {
    const ctx = await boot()
    expect(ctx.slots.occupants('settingsNav').map((o) => o.id)).toContain('Agent')
    ctx.stop()
  })

  it('settingsTab 上有三个页签，id 都以 Agent/ 开头', async () => {
    const ctx = await boot()
    const ids = ctx.slots.occupants('settingsTab').map((o) => o.id)
    expect(ids).toContain('Agent/模型')
    expect(ids).toContain('Agent/技能')
    expect(ids).toContain('Agent/MCP')
    ctx.stop()
  })

  it('卸载后这些槽位一起回收（不留孤儿页面）', async () => {
    const ctx = await boot()
    ctx.stop()
    expect(ctx.get('agent')).toBeUndefined()
  })
})
```

Run: `pnpm -C packages/plugins/plugin-agent test settingsSlots`
Expected: FAIL（槽位里还没有这些 id）

- [ ] **Step 2: 注册三个 occupant**

在 `agentPlugin.ts` 的 `apply` 里补：

```ts
import AgentSettingsNav from './components/settings/AgentSettingsNav.vue'
import AgentModelsTab from './components/settings/AgentSettingsTabs.vue'

  // 设置面板的内容插槽（见设计 §六）：一级导航 + 三个自定义页签。
  // 页面数据全部来自后端（/api/agent/*），与内核的 schema 控件无关。
  ctx.slots.register('settingsNav', {
    id: 'Agent',
    order: 90,
    component: AgentSettingsNav,
    meta: { title: 'Agent' },
  })
  ctx.slots.register('settingsTab', {
    id: 'Agent/模型',
    order: 0,
    component: AgentModelsTab,
    meta: { page: 'models' },
  })
  ctx.slots.register('settingsTab', {
    id: 'Agent/技能',
    order: 1,
    component: AgentModelsTab,
    meta: { page: 'skills' },
  })
  ctx.slots.register('settingsTab', {
    id: 'Agent/MCP',
    order: 2,
    component: AgentModelsTab,
    meta: { page: 'mcp' },
  })
```

> 三个页签共用一个组件 `AgentSettingsTabs.vue`，按 `meta.page` 决定渲染哪一页 ——
> 少两个只差一行 import 的文件。

- [ ] **Step 3: 写导航项与页签组件**

```vue
<!-- packages/plugins/plugin-agent/src/components/settings/AgentSettingsNav.vue -->
<script setup lang="ts">
// 设置面板左侧的一级导航项（settingsNav occupant）。
// 面板会把 { group, active, onSelect } 注入进来；id 命中的是自定义项，所以只画名字与图标。
import { Bot } from 'lucide-vue-next'

defineProps<{ group: string; active?: boolean; onSelect?: (key: string) => void }>()
</script>

<template>
  <button
    class="agent-nav"
    :class="{ active }"
    @click="onSelect && onSelect(group)"
  >
    <Bot :size="15" />
    <span>Agent</span>
  </button>
</template>

<style scoped>
.agent-nav { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 6px 10px; border: 0; border-radius: 10px; background: transparent; color: var(--ui-ink); font-size: 13px; font-weight: 600; text-align: left; cursor: pointer; }
.agent-nav:hover { background: var(--ui-hover); }
.agent-nav.active { background: var(--ui-accent-soft); color: var(--ui-accent-hover); }
</style>
```

```vue
<!-- packages/plugins/plugin-agent/src/components/settings/AgentSettingsTabs.vue -->
<script setup lang="ts">
// 设置面板右侧的一个「段」（settingsTab occupant）。三页共用：按 meta.page 决定画哪一页。
// 面板把 { group, settings } 注入进来；本组件不用 settings —— 数据全部来自 /api/agent/*。
import { computed } from 'vue'
import ModelsPage from './ModelsPage.vue'
import SkillsPage from './SkillsPage.vue'
import McpPage from './McpPage.vue'

const props = defineProps<{ group: string; meta?: { page?: string } }>()
const page = computed(() => props.meta?.page ?? 'models')
</script>

<template>
  <ModelsPage v-if="page === 'models'" />
  <SkillsPage v-else-if="page === 'skills'" />
  <McpPage v-else />
</template>
```

三个页面组件结构一致（列表 + 表单 + 错误行）。以模型页为例：

```vue
<!-- packages/plugins/plugin-agent/src/components/settings/ModelsPage.vue -->
<script setup lang="ts">
// 模型页：列表（哪些模型、有没有密钥、谁是默认/看图）+ 新增表单 + 设为默认/删除。
// 密钥只写不回读：服务端只给 hasKey，界面显示「已配置」。
import { onMounted, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { AgentApi } from '../../agentApi'

const { ctx } = useCanvasRender()
const api = ctx.get<AgentApi>('agent-api')

interface ModelRow { provider: string; modelId: string; hasKey: boolean; isDefault: boolean; isVision: boolean; baseUrl?: string }
interface ProviderRow { provider: string; label: string }

const models = ref<ModelRow[]>([])
const providers = ref<ProviderRow[]>([])
const error = ref('')
const busy = ref(false)
const form = ref({ provider: '', modelId: '', apiKey: '', baseUrl: '', vision: true })

async function load(): Promise<void> {
  error.value = ''
  try {
    const cfg = await api.config()
    models.value = (Array.isArray(cfg.models) ? cfg.models : []) as ModelRow[]
    providers.value = (Array.isArray(cfg.providers) ? cfg.providers : []) as ProviderRow[]
    if (!form.value.provider && providers.value.length) form.value.provider = providers.value[0].provider
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function save(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await api.saveModel({
      provider: form.value.provider,
      modelId: form.value.modelId,
      ...(form.value.apiKey ? { apiKey: form.value.apiKey } : {}),
      ...(form.value.baseUrl ? { baseUrl: form.value.baseUrl } : {}),
      vision: form.value.vision,
      setDefault: models.value.length === 0,
    })
    form.value.apiKey = ''
    await load()
    // 配好模型后让面板的「去配置」引导立刻消失
    void ctx.get<{ readiness: () => Promise<void> }>('agent-refresh')?.readiness()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

async function setDefault(m: ModelRow): Promise<void> {
  error.value = ''
  try {
    await api.setDefaultModel(m.provider, m.modelId)
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function remove(m: ModelRow): Promise<void> {
  error.value = ''
  try {
    await api.deleteModel(m.provider, m.modelId)
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="agent-page">
    <p v-if="error" class="agent-page-error">{{ error }}</p>

    <ul class="agent-rows">
      <li v-for="m in models" :key="m.provider + '/' + m.modelId" class="agent-row">
        <span class="agent-row-main">
          <strong>{{ m.modelId }}</strong>
          <small>{{ m.provider }} · {{ m.hasKey ? '已配置密钥' : '未配置密钥' }}{{ m.isDefault ? ' · 默认' : '' }}{{ m.isVision ? ' · 看图' : '' }}</small>
        </span>
        <button class="agent-mini" @click="setDefault(m)">设为默认</button>
        <button class="agent-mini danger" @click="remove(m)">删除</button>
      </li>
      <li v-if="!models.length" class="agent-empty">还没有配置模型</li>
    </ul>

    <form class="agent-form" @submit.prevent="save()">
      <label>平台<select v-model="form.provider"><option v-for="p in providers" :key="p.provider" :value="p.provider">{{ p.label }}</option></select></label>
      <label>模型 ID<input v-model="form.modelId" placeholder="deepseek-chat" /></label>
      <label>API Key<input v-model="form.apiKey" type="password" placeholder="留空 = 不改动已存的" /></label>
      <label>Base URL<input v-model="form.baseUrl" placeholder="https://api.deepseek.com（可留空）" /></label>
      <button type="submit" :disabled="busy || !form.modelId">保存</button>
    </form>
  </div>
</template>

<style scoped>
.agent-page { display: flex; flex-direction: column; gap: 12px; }
.agent-rows { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.agent-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--ui-line); border-radius: 10px; }
.agent-row-main { flex: 1; min-width: 0; }
.agent-row-main strong { display: block; font-size: 12px; }
.agent-row-main small { display: block; font-size: 11px; color: var(--ui-ink-dim); }
.agent-mini { height: 28px; padding: 0 10px; border: 1px solid var(--ui-line); border-radius: 8px; background: transparent; color: var(--ui-ink); font-size: 11px; cursor: pointer; }
.agent-mini.danger { color: var(--ui-danger); }
.agent-empty { padding: 16px 0; text-align: center; font-size: 12px; color: var(--ui-ink-dim); }
.agent-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding-top: 8px; border-top: 1px solid var(--ui-line-soft); }
.agent-form label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--ui-ink-dim); }
.agent-form input, .agent-form select { height: 32px; padding: 0 8px; border: 1px solid var(--ui-line); border-radius: 8px; background: var(--ui-panel); color: var(--ui-ink); font-size: 12px; outline: none; }
.agent-form button { grid-column: 1 / -1; height: 32px; border: 0; border-radius: 8px; background: var(--ui-primary-bg); color: var(--ui-primary-ink); font-size: 12px; cursor: pointer; }
.agent-page-error { margin: 0; font-size: 12px; color: var(--ui-danger); }
</style>
```

`SkillsPage.vue` 与 `McpPage.vue` 照同一个骨架写（同样的 `load` / `save` / `error` / 列表 + 表单 结构）：

| 页 | 列表读 | 表单写 |
|---|---|---|
| 技能 | `GET /api/agent/skills`（+ `/skills/sources` 给候选） | `POST /api/agent/skills/import`（填候选目录）/ `DELETE /api/agent/skills/:name` |
| MCP | `GET /api/agent/config` 的 `mcpServers` 与 `tools` | `POST /api/agent/mcp`（kind 三选一：stdio 要 command+args，http/sse 要 url）/ `DELETE /api/agent/mcp` |

MCP 表单要把 `kind` 做成三选一，选中后**只显示该类型需要的字段** ——
这正是「不用 schema 自动渲染」的原因：那种自动控件表达不了随选择变化的表单。

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/plugins/plugin-agent test && pnpm -C packages/plugins/plugin-agent typecheck`
Expected: PASS（14 个用例）、零类型错误

- [ ] **Step 5: 浏览器实测三页**

Expected：
1. 打开设置面板，左侧一级里出现 **Agent**（与 节点/布局/边/常规 并列）；
2. 点它，右侧出现 模型 / 技能 / MCP 三个页签；
3. 模型页：能加一个模型、设为默认、删掉；**密钥填过之后界面上只显示「已配置」**；
4. 技能页：能看到候选并导入一个；
5. MCP 页：能加一个 http 服务（地址填 "http://127.0.0.1:8865/mcp"）、再删掉；
6. 全程控制台零 error。

- [ ] **Step 6: 提交**

```bash
git add packages/plugins/plugin-agent
git commit -m "feat(plugin-agent): 模型/技能/MCP 三个配置页挂进设置面板内容插槽"
```

---

## Phase 3 · 清理与收尾

### Task 14: 清掉宿主里的假 Agent + 装进装配清单

**Files:**
- Delete: `packages/ui/src/components/areas/ChatPanel.vue`
- Modify: `packages/ui/src/composables/ui.ts`（删 chat/models/skills/director 那一整段）
- Modify: `packages/ui/src/components/areas/ModalsArea.vue`（删 TV Director 设置弹窗）
- Modify: `packages/ui/src/components/areas/DockArea.vue`（删 TV Director 圆按钮）
- Modify: `packages/ui/src/assembly.ts`（清单加 agentPlugin，24 → 25）
- Modify: `packages/ui/src/__tests__/entrypoint.test.ts`（24 → 25）
- Modify: `packages/ui/src/__tests__/settingsCoverage.test.ts`（若它断言了一级分类集合，见下）

- [ ] **Step 1: 先把新插件装进清单（此时两者并存，先确认不打架）**

```ts
// packages/ui/src/assembly.ts
import { agentPlugin } from '@mini-canvas/plugin-agent'

export const APP_PLUGINS = [
  // …原有项不动…
  fileDropPlugin,
  agentPlugin, // Agent 对话助手：面板 + 设置三页（宿主不再自带对话 UI）
]
```

并把 `entrypoint.test.ts` 的 `toHaveLength(24)` 改成 `toHaveLength(25)`。

Run: `pnpm -C packages/ui test`
Expected: 全绿（此时旧的 ChatPanel 与 ui.ts 状态还在，只是没人用）

- [ ] **Step 2: 删宿主里的 Agent 业务代码**

按顺序删（每删一处跑一次 `pnpm -C packages/ui typecheck`，出事立刻能定位到是哪一处）：

1. 删文件 `packages/ui/src/components/areas/ChatPanel.vue`；
2. `App.vue` 里删掉对它的 import；
3. `ui.ts` 里删掉这一段（整块）：`chatOpen` / `chatDocked` / `chatWidth` / `chatHeight` / `chatMinW` / `chatMinH` / `chatPos` / `chatInput` / `chatTitle` / `chatMessages` / `chatHistories` / `chatModes` / `chatMode` / `chatModeOpen` / `chatSuggestions` / `contextLeft` / `genMode` / `modelTab` / `models` / `currentModel` / `skillTab` / `skills` / `currentSkill` / `directorOpen` / `director` / `storyboard`；
4. 同文件里删掉只服务于它们的函数：`sendChat` / `renameChat` / `startChatDrag` / `stopChatDrag` / `onChatDrag` / `startChatResize` / `startChatCornerResize` / `chatEl` / `chatDragStart`，以及 `startWidthDrag` 里 `target: 'chat'` 那一支；
5. 删 `ModalsArea.vue` 里那段 TV Director 弹窗（`s.directorOpen` 的整个 `<AxDialog>`）与相关 import；
6. 删 `DockArea.vue` 里那个 `aria-label="TV Director"` 的圆按钮。

然后跑 `pnpm -C packages/ui typecheck` 与 `pnpm -C packages/ui test`。
Expected: 干净、全绿。**若 settingsCoverage.test.ts 报「一级分类必须是 布局/常规/节点/边」**：
那条断言在它自己的 `bootWithSettings()` 里只装了 5 个插件（不含 plugin-agent），
所以不该受影响；若被影响，说明装配顺序有变，先查清原因再改断言（**别直接放宽断言**）。

- [ ] **Step 3: 浏览器全量回归**

Expected（逐条）：
1. 面板：开合 / 停靠挤压 / 拖动改宽 / 新建会话 / 历史里切回旧会话 / 发消息流式出字 / 停止；
2. 刷新页面：**上一次的对话还在**（读磁盘转录）；
3. 服务重启后再进：对话仍在，且下一句能引用上文（D5 的端到端验证）；
4. 设置面板的 Agent 三页都能读写；
5. 画布原有功能不受影响：建/连/删节点、撤销重做、小地图、底栏；
6. 控制台零 error（这条是 AGENTS.md 对 UI 改动的硬要求）。

- [ ] **Step 4: 提交**

```bash
git add -A packages/ui
git commit -m "refactor(ui): 删宿主里的假 Agent（面板/状态/弹窗/按钮），改由 plugin-agent 承担"
```

---

## 后续（本计划不做，另行开单）

| # | 内容 | 为什么单开 |
|---|---|---|
| A | **审批气泡**（把 `ask` 档位做成真的：服务端挂起 → SSE 推请求 → 前端点允许/拒绝 → POST 解开） | 这是唯一需要**新造**一条实时通道的地方，且与对话流是两条独立的流；做在对话功能稳定之后更安全 |
| B | **系统通知真的接上**（浏览器 Notification：一轮跑完或出错时提醒） | 需要权限申请与用户开关，属于独立的一块界面行为 |
| C | **真会话的图片输入**（把画布节点里的图作为输入发给模型） | 需要先把画布资源引用（`res:<hash>`）换成服务端可取的真实地址，链路比纯文本长 |
| D | **多画布**（`canvasId` 不再恒为 default） | 存储与接口已按多画布写好，只差前端界面 |

## 验证命令汇总

```bash
# 后台
pnpm -C packages/cloud-server test
pnpm -C packages/cloud-server typecheck

# 插件
pnpm -C packages/plugins/plugin-agent test
pnpm -C packages/plugins/plugin-agent typecheck

# 宿主（装配 + 设置覆盖 + 样式编译）
pnpm -C packages/ui test
pnpm -C packages/ui typecheck

# 找不到插件包时先装一次（在 packages/ui 里）
pnpm -C packages/ui add @mini-canvas/plugin-agent@workspace:*
```

**全绿才前进。** 每期结束时都要跑一遍这三个包的 test 与 typecheck。

## Self-Review（写计划的人自己过一遍）

**1. 规格覆盖**

| 设计 §   | 落在哪个任务 |
|---|---|
| §三 存储形状（全局配置 + 按画布会话） | Task 1 / 2 / 9 |
| §四 后台子系统与路由契约 | Task 5–9 |
| §4.2 SSE 事件形状 | Task 3（后端）/ Task 11（前端解析）/ Task 12（渲染） |
| §4.3 会话生命周期（D5 跨重启） | Task 6（resumeSession）/ Task 9 Step 6（端到端验）/ Task 14 Step 3 |
| §4.4 与画布数据的关系（复用 /mcp + 已有 SSE） | 不需要新任务：MCP 路由与 events 路由都已存在，只需在设置页把 /mcp 地址配进 MCP 页 |
| §五 插件结构 | Task 10–13 |
| §5.3 宿主改动清单 | Task 12 Step 4 / Task 14 |
| §六 设置页走内容插槽 | Task 13 |
| §七 审批档位（默认全放行 + 可询问） | Task 4（后端判定）；**询问的交互留给后续 A** |
| §九 风险 2（依赖重量）/ 3（不引工作区包） | Task 5 Step 1 / 各任务注释 |
| §九 风险 6（删画布连 agent 目录一起删） | Task 2 的 `removeCanvas`；**接线**见下面「缺口」 |
| §十 待确认 5 条 | 已在设计文档里定稿为：默认 auto / 询问清单含 exec_command+write / 系统通知真做（后续 B）/ 删画布即删目录 / 没模型给引导（Task 12 Step 3、Task 13） |

**缺口（两处，已补成任务内步骤）**：

1. **删画布的接线**：Task 2 有 `removeCanvas`，但**没有**「删画布时调用它」的入口 ——
   本仓库当前也没有删画布的路由（`canvases.ts` 只有读/存/资源）。
   处理：本计划**不做**删画布功能；在 `store/canvasPaths.ts` 的注释里记一句「删画布时应调 `AgentSessionStore.removeCanvas`」，
   等你真要删画布时一起做。
2. **询问档位的挂起实现**：Task 4 只做判定，`runtime.ts` 里把 `ask` 暂按 allow 处理并留日志。
   这是**有意**的取舍（写着注释），询问交互在后续 A。**但**这意味着「询问」档位现在**不会真的问** ——
   设计 §七 第 5 条写明了它是 Phase 3 之后的事，这里再确认一次。

**2. 占位符扫描**：本计划里没有 TBD / TODO /「稍后实现」/「类似 Task N」。
每个代码步骤都给了完整代码；测试都给的是**可跑**的断言代码。

**3. 类型一致性**：

| 名字 | 定义处 | 使用处 |
|---|---|---|
| `AgentChatEvent` | Task 3 | Task 6（runtime 产出）、Task 8（SSE 写帧） |
| `ChatEvent`（前端） | Task 11 agentApi.ts | Task 11 sessionModel、Task 12 面板 |
| `AgentServiceState` | Task 10（初版）/ Task 12（扩展） | Task 12 面板、Task 13 模型页、宿主 ui.ts |
| `makeUserMessage` | Task 6（返回单条）/ Task 9（**改成返回数组**） | Task 6 测试假实现需同步改成数组 |
| `AgentLike` / `AgentSessionLike` | Task 6 | Task 8 测试、Task 9（真 SDK 适配） |
| `agent-api` / `agent-refresh` 服务名 | Task 12 | Task 12 面板、Task 13 模型页 |

## Execution Handoff

计划已写到 `docs/superpowers/plans/2026-10-01-agent-plugin.md`。两种执行方式：

**1. 子代理逐任务执行（推荐）** —— 每个任务派一个新的子代理，任务之间我来审查，迭代快；
**2. 会话内批量执行** —— 在本会话里按 executing-plans 分批做，中途设检查点。

**选哪种？**

> 不管选哪种，Task 9 Step 6 与 Task 14 Step 3 这两处**必须由我亲自跑**（真模型、真重启、真浏览器），
> 不能只看子代理的报告 —— 它们是 D5 与整体可用性的最后一道闸门。
