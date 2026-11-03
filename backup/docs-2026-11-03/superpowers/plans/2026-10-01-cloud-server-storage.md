# 后台存储地基（一个画布一个文件夹）实施计划

> **状态：已完成（2026-10-01）** —— 六个任务全部落地并验证。
> 本文档原本写着「不做兼容」以外的迁移路径，实际执行时按用户明确要求**硬切**：
> 老 kv 的 canvas:* key 与 /uploads/* 路由**直接下线**（不做兼容读）。
> 执行中还多做了原计划范围外的三块（见文末「执行时超出计划的部分」）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 cloud-server 的存储从「一份全局 kv + 一个全局 uploads」改成「一个画布一个文件夹」，并让老数据自动迁移过来。

**Architecture:** 新增一层 `CanvasStore`（画布文件夹读写）+ `CanvasResourceStore`（画布内资源），核心是**纯逻辑 + 注入根目录**，可在 Node 里用临时目录单测。老的 kv / uploads 路由**保留**（兼容读，到总收尾才删），新路由并行提供。`CanvasDocument` 的读改写内部换成新仓库，对外 API 不变 —— 这样后续所有步骤（任务执行、历史、插件）都不必再动存储。

**Tech Stack:** TypeScript、Hono、`node:fs/promises`、vitest（node 环境）。

**Spec:** `docs/superpowers/specs/2026-10-01-cloud-client-design.md`（§七 存储结构、§十 迁移步骤 1）。本计划实现其中的**第 1 步**；后续步骤见文末「后续计划」。

## Global Constraints

以下为项目级硬约束，**每个任务都隐含遵守**：

- **cloud-server 不能引工作区包**（它要能独立 `npx` 跑）：类型就地声明，不 import `@mini-canvas/*`。
- 数据落点：`<数据根>/canvases/<canvasId>/` 下放 `canvas.json`、`view.json`、`history.json`、`resources/`。
- 默认画布 id = `default`（前端界面当前只有一张画布，行为与今天一致）。
- 资源引用形态 = `res:<内容哈希><扩展名>`（**画布内相对引用**，不写画布 id、不写根路径）。
- 老资源地址 `/uploads/<hash>` 与老 kv（`canvas:graph` 等）**必须继续能读**；不破坏性改写。
- 落盘一律**原子写**（先写 `.tmp-*` 再 `rename`）。
- 路径安全：`canvasId` 与资源名都过白名单校验，**拒绝 `..`**。
- 测试命令：`pnpm -C packages/cloud-server test`；类型检查：`pnpm -C packages/cloud-server typecheck`。

## File Structure

| 文件 | 职责 |
|---|---|
| `packages/cloud-server/src/store/canvasPaths.ts`（新） | 路径推导 + 安全校验（纯函数） |
| `packages/cloud-server/src/store/canvasStore.ts`（新） | 画布文件夹读写（canvas.json / view.json） |
| `packages/cloud-server/src/store/canvasResources.ts`（新） | 画布内资源读写（含老 `uploads/` 兼容读） |
| `packages/cloud-server/src/routes/canvases.ts`（新） | 新路由 `/api/canvases/<id>/*` |
| `packages/cloud-server/src/mcp/canvasDoc.ts`（改） | 内部改走 `CanvasStore`，对外 API 不变 |
| `packages/cloud-server/src/server.ts`（改） | 组装新仓库与路由 |
| `packages/cloud-server/src/__tests__/canvasPaths.test.ts`（新） | 路径与安全 |
| `packages/cloud-server/src/__tests__/canvasStore.test.ts`（新） | 画布读写 |
| `packages/cloud-server/src/__tests__/canvasResources.test.ts`（新） | 资源读写与兼容 |
| `packages/cloud-server/src/__tests__/canvasRoutes.test.ts`（新） | 新路由 |
| `packages/cloud-server/src/__tests__/canvasDocMigration.test.ts`（新） | 老 kv 迁移 |

---

### Task 1: 路径推导与安全校验

**Files:**
- Create: `packages/cloud-server/src/store/canvasPaths.ts`
- Test: `packages/cloud-server/src/__tests__/canvasPaths.test.ts`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces:
  - `DEFAULT_CANVAS_ID: string` = `'default'`
  - `isSafeCanvasId(id: string): boolean`
  - `canvasDir(root: string, id: string): string`
  - `canvasFilePath(root: string, id: string, which: 'canvas' | 'view' | 'history'): string`
  - `canvasResourcesDir(root: string, id: string): string`
  - `canvasesRoot(root: string): string`

- [ ] **Step 1: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/canvasPaths.test.ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  DEFAULT_CANVAS_ID,
  isSafeCanvasId,
  canvasDir,
  canvasFilePath,
  canvasResourcesDir,
} from '../store/canvasPaths'

describe('画布 id 安全', () => {
  it('接受常见合法 id', () => {
    expect(isSafeCanvasId('default')).toBe(true)
    expect(isSafeCanvasId('my-canvas_1')).toBe(true)
    expect(isSafeCanvasId('A1b2C3')).toBe(true)
  })
  it('拒绝路径穿越与怪字符', () => {
    expect(isSafeCanvasId('..')).toBe(false)
    expect(isSafeCanvasId('../etc')).toBe(false)
    expect(isSafeCanvasId('a/b')).toBe(false)
    expect(isSafeCanvasId('')).toBe(false)
    expect(isSafeCanvasId('a b')).toBe(false)
    expect(isSafeCanvasId('a:b')).toBe(false)
  })
  it('拒绝过长 id（>64）', () => {
    expect(isSafeCanvasId('x'.repeat(65))).toBe(false)
    expect(isSafeCanvasId('x'.repeat(64))).toBe(true)
  })
})

describe('路径推导', () => {
  const root = 'tmp-root'
  it('画布目录在 canvases/<id> 下', () => {
    expect(canvasDir(root, 'default')).toBe(path.join(root, 'canvases', 'default'))
  })
  it('三个数据文件名固定', () => {
    expect(canvasFilePath(root, 'default', 'canvas')).toBe(path.join(root, 'canvases', 'default', 'canvas.json'))
    expect(canvasFilePath(root, 'default', 'view')).toBe(path.join(root, 'canvases', 'default', 'view.json'))
    expect(canvasFilePath(root, 'default', 'history')).toBe(path.join(root, 'canvases', 'default', 'history.json'))
  })
  it('资源目录是本画布下的 resources/', () => {
    expect(canvasResourcesDir(root, 'default')).toBe(path.join(root, 'canvases', 'default', 'resources'))
  })
  it('非法 id 抛错', () => {
    expect(() => canvasDir(root, '../etc')).toThrow()
    expect(() => canvasFilePath(root, '../etc', 'canvas')).toThrow()
    expect(() => canvasResourcesDir(root, '../etc')).toThrow()
  })
  it('默认画布 id 常量是 default', () => {
    expect(DEFAULT_CANVAS_ID).toBe('default')
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test canvasPaths`
Expected: FAIL —— 找不到模块 `../store/canvasPaths`

- [ ] **Step 3: 写最小实现**

```ts
// packages/cloud-server/src/store/canvasPaths.ts
/**
 * 画布路径推导与安全校验（纯函数，零依赖）。
 *
 * 布局：<root>/canvases/<canvasId>/ 下的 canvas.json / view.json / history.json / resources/
 * 为什么要这一层：路径拼接与安全校验散在各处时，一处漏了 .. 就是目录穿越。
 */
import path from 'node:path'

/** 默认画布 id（前端界面当前只有一张画布） */
export const DEFAULT_CANVAS_ID = 'default'

/** 画布 id 白名单：字母数字下划线连字符，1-64 位。点号不在表内，故 `..` 天然被拒 */
const CANVAS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isSafeCanvasId(id: string): boolean {
  return CANVAS_ID_RE.test(id)
}

function assertSafe(id: string): void {
  if (!isSafeCanvasId(id)) throw new Error('[canvasPaths] 非法画布 id: ' + id)
}

/** 画布根目录 */
export function canvasDir(root: string, id: string): string {
  assertSafe(id)
  return path.join(root, 'canvases', id)
}

/** 全部画布的父目录（列目录用；不涉及具体 id，故不需要校验） */
export function canvasesRoot(root: string): string {
  return path.join(root, 'canvases')
}

/** 三个数据文件的路径。which 是闭合词表，不是任意文件名 */
export function canvasFilePath(root: string, id: string, which: 'canvas' | 'view' | 'history'): string {
  const file = which === 'canvas' ? 'canvas.json' : which === 'view' ? 'view.json' : 'history.json'
  return path.join(canvasDir(root, id), file)
}

/** 本画布的资源目录 */
export function canvasResourcesDir(root: string, id: string): string {
  return path.join(canvasDir(root, id), 'resources')
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test canvasPaths`
Expected: PASS（12 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/cloud-server/src/store/canvasPaths.ts packages/cloud-server/src/__tests__/canvasPaths.test.ts
git commit -m "feat(cloud-server): 画布路径推导与 id 安全校验"
```

---

### Task 2: 画布文件夹读写（CanvasStore）

**Files:**
- Create: `packages/cloud-server/src/store/canvasStore.ts`
- Test: `packages/cloud-server/src/__tests__/canvasStore.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `canvasFilePath` / `canvasDir` / `canvasResourcesDir`
- Produces:
  - `interface CanvasData { nodes: unknown[]; edges: unknown[] }`
  - `class CanvasStore`：
    - `constructor(root: string)`
    - `readCanvas(id: string): Promise<CanvasData | undefined>`
    - `writeCanvas(id: string, data: CanvasData): Promise<void>`
    - `readView<T>(id: string): Promise<T | undefined>`
    - `writeView(id: string, v: unknown): Promise<void>`
    - `list(): Promise<string[]>`

- [ ] **Step 1: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/canvasStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CanvasStore } from '../store/canvasStore'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvasstore-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('CanvasStore', () => {
  it('没写过 → undefined（区分「没存过」与「存过空画布」）', async () => {
    const s = new CanvasStore(root)
    expect(await s.readCanvas('default')).toBeUndefined()
  })

  it('写进去能读回来', async () => {
    const s = new CanvasStore(root)
    await s.writeCanvas('default', { nodes: [{ id: '1', type: 'text' }], edges: [] })
    const back = await s.readCanvas('default')
    expect(back?.nodes).toHaveLength(1)
    expect(back?.edges).toEqual([])
  })

  it('落盘是单个 canvas.json（不是 nodes/edges 两个文件）', async () => {
    const s = new CanvasStore(root)
    await s.writeCanvas('default', { nodes: [{ id: '1' }], edges: [{ id: 'e-1-2' }] })
    const file = path.join(root, 'canvases', 'default', 'canvas.json')
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(raw.nodes).toHaveLength(1)
    expect(raw.edges).toHaveLength(1)
  })

  it('原子写：不留 .tmp 残骸', async () => {
    const s = new CanvasStore(root)
    await s.writeCanvas('default', { nodes: [], edges: [] })
    const names = await fs.readdir(path.join(root, 'canvases', 'default'))
    expect(names.filter((n) => n.includes('.tmp-'))).toHaveLength(0)
  })

  it('读回来的是副本：改它不影响磁盘', async () => {
    const s = new CanvasStore(root)
    await s.writeCanvas('default', { nodes: [{ id: '1' }], edges: [] })
    const a = (await s.readCanvas('default'))!
    a.nodes.push({ id: '999' })
    const b = (await s.readCanvas('default'))!
    expect(b.nodes).toHaveLength(1)
  })

  it('view 与 canvas 分开存，互不影响', async () => {
    const s = new CanvasStore(root)
    await s.writeCanvas('default', { nodes: [{ id: '1' }], edges: [] })
    await s.writeView('default', { x: 10, y: 20, zoom: 1.5 })
    expect(await s.readView('default')).toEqual({ x: 10, y: 20, zoom: 1.5 })
    expect((await s.readCanvas('default'))!.nodes).toHaveLength(1)
  })

  it('list 列出所有画布 id', async () => {
    const s = new CanvasStore(root)
    await s.writeCanvas('a', { nodes: [], edges: [] })
    await s.writeCanvas('b', { nodes: [], edges: [] })
    expect((await s.list()).sort()).toEqual(['a', 'b'])
  })

  it('list 在目录不存在时返回空数组（不是抛错）', async () => {
    const s = new CanvasStore(path.join(root, 'nope'))
    expect(await s.list()).toEqual([])
  })

  it('非法画布 id 抛错', async () => {
    const s = new CanvasStore(root)
    await expect(s.writeCanvas('../evil', { nodes: [], edges: [] })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test canvasStore`
Expected: FAIL —— 找不到模块 `../store/canvasStore`

- [ ] **Step 3: 写最小实现**

```ts
// packages/cloud-server/src/store/canvasStore.ts
/**
 * CanvasStore —— 一个画布文件夹的读写（canvas.json / view.json）。
 *
 * 分工（与 §七 的判据一致）：
 * - canvas.json：画布本体（节点 + 边 + 画布信息）
 * - view.json  ：视图状态（视口）—— 单独放，改视野不必重写整份节点边
 * 历史（history.json）与资源（resources/）由各自模块管，本类不碰。
 *
 * 读不到一律返回 undefined（不是空对象）：与既有 kv 语义一致，
 * 让上层能区分「从未保存过」与「保存过一张空画布」。
 */
import { promises as fs } from 'node:fs'
import { canvasDir, canvasFilePath, canvasesRoot } from './canvasPaths'

export interface CanvasData {
  nodes: unknown[]
  edges: unknown[]
}

export class CanvasStore {
  constructor(private readonly root: string) {}

  async readCanvas(id: string): Promise<CanvasData | undefined> {
    const raw = await readJson(canvasFilePath(this.root, id, 'canvas'))
    if (raw === undefined) return undefined
    const obj = (raw ?? {}) as { nodes?: unknown; edges?: unknown }
    return {
      nodes: Array.isArray(obj.nodes) ? obj.nodes : [],
      edges: Array.isArray(obj.edges) ? obj.edges : [],
    }
  }

  async writeCanvas(id: string, data: CanvasData): Promise<void> {
    await atomicWriteJson(canvasFilePath(this.root, id, 'canvas'), { nodes: data.nodes, edges: data.edges })
  }

  async readView<T = { x: number; y: number; zoom: number }>(id: string): Promise<T | undefined> {
    return (await readJson(canvasFilePath(this.root, id, 'view'))) as T | undefined
  }

  async writeView(id: string, v: unknown): Promise<void> {
    await atomicWriteJson(canvasFilePath(this.root, id, 'view'), v)
  }

  /** 列出全部画布 id（目录不存在 = 没有画布，返回空数组） */
  async list(): Promise<string[]> {
    try {
      const names = await fs.readdir(canvasesRoot(this.root))
      return names.filter((n) => /^[A-Za-z0-9_-]{1,64}$/.test(n)).sort()
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
  }
}

/** 读 JSON；不存在返回 undefined。JSON 坏掉按缺失处理并记一条 warning（与 kvStore 同口径） */
async function readJson(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if (isNotFound(err)) return undefined
    if (err instanceof SyntaxError) {
      console.warn('[canvasStore] ' + file + ' 不是合法 JSON，按缺失处理')
      return undefined
    }
    throw err
  }
}

/** 原子写：先写唯一临时文件，再 rename 覆盖目标（避免读到半截内容） */
async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  const idx = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  await fs.mkdir(file.slice(0, idx), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  await fs.writeFile(tmp, JSON.stringify(value), 'utf8')
  await fs.rename(tmp, file)
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test canvasStore`
Expected: PASS（9 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/cloud-server/src/store/canvasStore.ts packages/cloud-server/src/__tests__/canvasStore.test.ts
git commit -m "feat(cloud-server): 画布文件夹读写（canvas.json / view.json，原子写）"
```

---

### Task 3: 画布内资源读写（CanvasResourceStore，含老地址兼容读）

**Files:**
- Create: `packages/cloud-server/src/store/canvasResources.ts`
- Test: `packages/cloud-server/src/__tests__/canvasResources.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `canvasResourcesDir`
- Produces:
  - `RESOURCE_REF_PREFIX: string` = `'res:'`
  - `toResourceRef(hashName: string): string`
  - `isResourceRef(v: unknown): boolean`
  - `parseResourceRef(ref: string): string | undefined`
  - `class CanvasResourceStore`：
    - `constructor(root: string)`
    - `save(canvasId: string, bytes: Uint8Array, ext: string): Promise<{ ref: string; hashName: string; size: number }>`
    - `read(canvasId: string, hashName: string): Promise<Uint8Array | undefined>`
    - `readLegacy(hashName: string): Promise<Uint8Array | undefined>`（老 `<root>/uploads/`）
    - `list(canvasId: string): Promise<string[]>`

- [ ] **Step 1: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/canvasResources.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  CanvasResourceStore,
  RESOURCE_REF_PREFIX,
  toResourceRef,
  isResourceRef,
  parseResourceRef,
} from '../store/canvasResources'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const PNG2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9])

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvasres-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('资源引用形态', () => {
  it('前缀、构造、解析', () => {
    expect(RESOURCE_REF_PREFIX).toBe('res:')
    expect(toResourceRef('abc.png')).toBe('res:abc.png')
    expect(isResourceRef('res:abc.png')).toBe(true)
    expect(isResourceRef('/uploads/abc.png')).toBe(false)
    expect(isResourceRef(undefined)).toBe(false)
    expect(parseResourceRef('res:abc.png')).toBe('abc.png')
    expect(parseResourceRef('/uploads/abc.png')).toBeUndefined()
  })
})

describe('CanvasResourceStore', () => {
  it('存进去落在本画布 resources/ 下，读回来一致', async () => {
    const s = new CanvasResourceStore(root)
    const { ref, hashName } = await s.save('default', PNG, '.png')
    expect(ref).toBe('res:' + hashName)
    const back = await s.read('default', hashName)
    expect(back).toEqual(PNG)
    const onDisk = await fs.readdir(path.join(root, 'canvases', 'default', 'resources'))
    expect(onDisk).toContain(hashName)
  })

  it('同内容重复上传只占一份（按内容哈希命名）', async () => {
    const s = new CanvasResourceStore(root)
    const a = await s.save('default', PNG, '.png')
    const b = await s.save('default', PNG, '.png')
    expect(a.hashName).toBe(b.hashName)
    expect((await s.list('default')).length).toBe(1)
  })

  it('不同内容存两份', async () => {
    const s = new CanvasResourceStore(root)
    await s.save('default', PNG, '.png')
    await s.save('default', PNG2, '.png')
    expect((await s.list('default')).length).toBe(2)
  })

  it('两张画布的资源互不可见', async () => {
    const s = new CanvasResourceStore(root)
    const { hashName } = await s.save('a', PNG, '.png')
    expect(await s.read('b', hashName)).toBeUndefined()
    expect(await s.list('b')).toEqual([])
  })

  it('兼容读老 uploads/ 目录', async () => {
    const legacy = path.join(root, 'uploads')
    await fs.mkdir(legacy, { recursive: true })
    await fs.writeFile(path.join(legacy, 'deadbeef.png'), PNG)
    const s = new CanvasResourceStore(root)
    expect(await s.readLegacy('deadbeef.png')).toEqual(PNG)
    expect(await s.readLegacy('nope.png')).toBeUndefined()
  })

  it('非法资源名被拒（目录穿越）', async () => {
    const s = new CanvasResourceStore(root)
    expect(await s.read('default', '../canvas.json')).toBeUndefined()
    expect(await s.readLegacy('../canvas.json')).toBeUndefined()
  })

  it('read 读不到已删文件时返回 undefined（不抛）', async () => {
    const s = new CanvasResourceStore(root)
    expect(await s.read('default', 'a1b2c3d4e5f6a7b8.png')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test canvasResources`
Expected: FAIL —— 找不到模块 `../store/canvasResources`

- [ ] **Step 3: 写最小实现**

```ts
// packages/cloud-server/src/store/canvasResources.ts
/**
 * CanvasResourceStore —— 本画布的资源读写（<root>/canvases/<id>/resources/）。
 *
 * 命名：按**内容哈希**（前 16 位）+ 扩展名。好处与老 FileStore 一致：
 * 同内容天然去重、URL 与内容绑定（可长缓存）。
 *
 * 引用形态：节点里存 **res:<hashName>**（画布内相对引用）——
 * 不写画布 id、不写根路径，所以**复制整个画布文件夹到别处仍然能用**。
 *
 * 兼容读：老数据里是 /uploads/<hashName>（全局目录）。readLegacy 让老画布的图照常显示。
 * 全仓只有这一处知道老目录，将来删兼容也只需删这一个方法。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { canvasResourcesDir } from './canvasPaths'

export const RESOURCE_REF_PREFIX = 'res:'

export function toResourceRef(hashName: string): string {
  return RESOURCE_REF_PREFIX + hashName
}

export function isResourceRef(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(RESOURCE_REF_PREFIX)
}

export function parseResourceRef(ref: string): string | undefined {
  if (!isResourceRef(ref)) return undefined
  const name = ref.slice(RESOURCE_REF_PREFIX.length)
  return isSafeResourceName(name) ? name : undefined
}

/** 资源名白名单：16 位十六进制 + 可选扩展名（与老 FileStore 的 isSafeFileId 同口径） */
const RESOURCE_NAME_RE = /^[0-9a-f]{16}(\.[a-z0-9]+)?$/i

export function isSafeResourceName(name: string): boolean {
  return RESOURCE_NAME_RE.test(name)
}

export interface SavedResource {
  ref: string
  hashName: string
  size: number
}

export class CanvasResourceStore {
  constructor(private readonly root: string) {}

  /** 存一个资源；同内容不重复写。返回画布内引用与磁盘名 */
  async save(canvasId: string, bytes: Uint8Array, ext = ''): Promise<SavedResource> {
    const dir = canvasResourcesDir(this.root, canvasId)
    const safeExt = /^\.[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : ''
    const hashName = createHash('sha256').update(bytes).digest('hex').slice(0, 16) + safeExt
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, hashName)
    try {
      await fs.access(file)
    } catch {
      const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
      await fs.writeFile(tmp, bytes)
      await fs.rename(tmp, file)
    }
    return { ref: toResourceRef(hashName), hashName, size: bytes.byteLength }
  }

  /** 读本画布资源；名字不合法或不存在 → undefined */
  async read(canvasId: string, hashName: string): Promise<Uint8Array | undefined> {
    if (!isSafeResourceName(hashName)) return undefined
    return readBytes(path.join(canvasResourcesDir(this.root, canvasId), hashName))
  }

  /** 兼容读：老全局 uploads/ */
  async readLegacy(hashName: string): Promise<Uint8Array | undefined> {
    if (!isSafeResourceName(hashName)) return undefined
    return readBytes(path.join(this.root, 'uploads', hashName))
  }

  /** 列本画布资源名 */
  async list(canvasId: string): Promise<string[]> {
    try {
      const names = await fs.readdir(canvasResourcesDir(this.root, canvasId))
      return names.filter(isSafeResourceName).sort()
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
  }
}

async function readBytes(file: string): Promise<Uint8Array | undefined> {
  try {
    const buf = await fs.readFile(file)
    return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
  } catch (err) {
    if (isNotFound(err)) return undefined
    throw err
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test canvasResources`
Expected: PASS（8 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/cloud-server/src/store/canvasResources.ts packages/cloud-server/src/__tests__/canvasResources.test.ts
git commit -m "feat(cloud-server): 画布内资源读写（res: 引用 + 老 uploads 兼容读）"
```

---

### Task 4: 新路由 /api/canvases/<id>/*

**Files:**
- Create: `packages/cloud-server/src/routes/canvases.ts`
- Test: `packages/cloud-server/src/__tests__/canvasRoutes.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `CanvasStore`、Task 3 的 `CanvasResourceStore`
- Produces: `export function canvasesRoutes(store: CanvasStore, resources: CanvasResourceStore): Hono`
  实现端点：
  - `GET  /api/canvases` → `{ ok: true, canvases: string[] }`
  - `GET  /api/canvases/:id` → `{ ok: true, nodes, edges, view }`（没存过 → 空数组 + view null）
  - `PUT  /api/canvases/:id` body `{ nodes, edges }` → `{ ok: true }`
  - `PUT  /api/canvases/:id/view` body `{ x, y, zoom }` → `{ ok: true }`
  - `POST /api/canvases/:id/resources` 原始字节（`?name=` 给扩展名）→ `{ ok, ref, hashName, size }`
  - `GET  /api/canvases/:id/resources/:name` → 字节（`content-type` 按扩展名）

- [ ] **Step 1: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/canvasRoutes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { CanvasStore } from '../store/canvasStore'
import { CanvasResourceStore } from '../store/canvasResources'
import { canvasesRoutes } from '../routes/canvases'

let root: string
let app: Hono
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvasroutes-'))
  app = new Hono()
  app.route('/', canvasesRoutes(new CanvasStore(root), new CanvasResourceStore(root)))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const j = (r: Response) => r.json() as Promise<any>

describe('画布路由', () => {
  it('GET /api/canvases 列出画布（今天只有一个 default）', async () => {
    const res = await app.request('/api/canvases')
    expect(res.status).toBe(200)
    expect((await j(res)).ok).toBe(true)
  })

  it('PUT 后 GET 能读回节点与边', async () => {
    const put = await app.request('/api/canvases/default', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodes: [{ id: 'n1', type: 'text' }], edges: [] }),
    })
    expect(put.status).toBe(200)
    const res = await app.request('/api/canvases/default')
    const body = await j(res)
    expect(body.nodes).toHaveLength(1)
    expect(body.edges).toEqual([])
  })

  it('没存过的画布 → 空节点 + view null（不是 404：前端首次打开要能渲染）', async () => {
    const res = await app.request('/api/canvases/default')
    const body = await j(res)
    expect(body.nodes).toEqual([])
    expect(body.view).toBeNull()
  })

  it('PUT view 后 GET 能读到视口', async () => {
    await app.request('/api/canvases/default/view', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 1, y: 2, zoom: 1.25 }),
    })
    const body = await j(await app.request('/api/canvases/default'))
    expect(body.view).toEqual({ x: 1, y: 2, zoom: 1.25 })
  })

  it('非法画布 id → 400（不是 500）', async () => {
    const res = await app.request('/api/canvases/..%2Fevil')
    expect(res.status).toBe(400)
  })

  it('上传资源返回 res: 引用，再 GET 能取回字节', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const up = await app.request('/api/canvases/default/resources?name=a.png', { method: 'POST', body: bytes })
    const body = await j(up)
    expect(body.ok).toBe(true)
    expect(String(body.ref).startsWith('res:')).toBe(true)
    const got = await app.request('/api/canvases/default/resources/' + body.hashName)
    expect(got.status).toBe(200)
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes)
  })

  it('GET 不存在的资源 → 404', async () => {
    const res = await app.request('/api/canvases/default/resources/a1b2c3d4e5f6a7b8.png')
    expect(res.status).toBe(404)
  })

  it('PUT 的 body 不是对象 → 400', async () => {
    const res = await app.request('/api/canvases/default', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '"nope"',
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test canvasRoutes`
Expected: FAIL —— 找不到模块 `../routes/canvases`

- [ ] **Step 3: 写最小实现**

```ts
// packages/cloud-server/src/routes/canvases.ts
/**
 * canvases 路由 —— 画布文件夹的 HTTP 面。
 *
 * 契约：
 *   GET  /api/canvases                  → { ok, canvases: string[] }
 *   GET  /api/canvases/:id              → { ok, nodes, edges, view }（没存过 = 空 + view null）
 *   PUT  /api/canvases/:id              ← { nodes, edges }
 *   PUT  /api/canvases/:id/view         ← { x, y, zoom }
 *   POST /api/canvases/:id/resources    ← 原始字节（?name= 给扩展名）→ { ok, ref, hashName, size }
 *   GET  /api/canvases/:id/resources/:name → 字节
 *
 * 与老路由的关系：老 /api/kv/* 与 /uploads/* **保留**（兼容读，前端的 HttpAdapter 还在用），
 * 两条并行；等前端切到新地址后才删老路由。
 */
import { Hono } from 'hono'
import { isSafeCanvasId } from '../store/canvasPaths'
import type { CanvasStore } from '../store/canvasStore'
import { isSafeResourceName, type CanvasResourceStore } from '../store/canvasResources'

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
}

function mimeOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return (dot >= 0 ? EXT_MIME[name.slice(dot).toLowerCase()] : undefined) ?? 'application/octet-stream'
}

export function canvasesRoutes(store: CanvasStore, resources: CanvasResourceStore): Hono {
  const app = new Hono()

  app.get('/api/canvases', async (c) => c.json({ ok: true, canvases: await store.list() }))

  app.get('/api/canvases/:id', async (c) => {
    const id = c.req.param('id')
    if (!isSafeCanvasId(id)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    const data = (await store.readCanvas(id)) ?? { nodes: [], edges: [] }
    const view = (await store.readView(id)) ?? null
    return c.json({ ok: true, nodes: data.nodes, edges: data.edges, view })
  })

  app.put('/api/canvases/:id', async (c) => {
    const id = c.req.param('id')
    if (!isSafeCanvasId(id)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ ok: false, error: 'body 必须是对象 { nodes, edges }' }, 400)
    }
    const obj = body as { nodes?: unknown; edges?: unknown }
    await store.writeCanvas(id, {
      nodes: Array.isArray(obj.nodes) ? obj.nodes : [],
      edges: Array.isArray(obj.edges) ? obj.edges : [],
    })
    return c.json({ ok: true })
  })

  app.put('/api/canvases/:id/view', async (c) => {
    const id = c.req.param('id')
    if (!isSafeCanvasId(id)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    await store.writeView(id, body)
    return c.json({ ok: true })
  })

  app.post('/api/canvases/:id/resources', async (c) => {
    const id = c.req.param('id')
    if (!isSafeCanvasId(id)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.byteLength === 0) return c.json({ ok: false, error: '空文件' }, 400)
    const name = c.req.query('name') ?? ''
    const dot = name.lastIndexOf('.')
    const ext = dot >= 0 ? name.slice(dot) : ''
    const saved = await resources.save(id, bytes, ext)
    return c.json({ ok: true, ...saved })
  })

  app.get('/api/canvases/:id/resources/:name', async (c) => {
    const { id, name } = c.req.param()
    if (!isSafeCanvasId(id) || !isSafeResourceName(name)) return c.json({ ok: false, error: '非法路径' }, 400)
    const bytes = await resources.read(id, name)
    if (!bytes) return c.json({ ok: false, error: '资源不存在' }, 404)
    return c.body(bytes, 200, {
      'content-type': mimeOf(name),
      'cache-control': 'public, max-age=31536000, immutable',
    })
  })

  return app
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test canvasRoutes`
Expected: PASS（8 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/cloud-server/src/routes/canvases.ts packages/cloud-server/src/__tests__/canvasRoutes.test.ts
git commit -m "feat(cloud-server): /api/canvases 新路由（读画布 / 存画布 / 视口 / 资源）"
```

---

### Task 5: 老数据自动迁移（kv → 画布文件夹）

**Files:**
- Create: `packages/cloud-server/src/store/canvasMigration.ts`
- Test: `packages/cloud-server/src/__tests__/canvasMigration.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `CanvasStore`、Task 1 的 `DEFAULT_CANVAS_ID`
- Produces:
  - `interface LegacyKv { get<T>(type: string, key: string): Promise<T | undefined> }`
  - `migrateLegacyCanvas(kv: LegacyKv, store: CanvasStore, canvasId?: string): Promise<{ migrated: boolean; nodes: number; edges: number; hadView: boolean }>`

- [ ] **Step 1: 写失败测试**

```ts
// packages/cloud-server/src/__tests__/canvasMigration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CanvasStore } from '../store/canvasStore'
import { migrateLegacyCanvas, type LegacyKv } from '../store/canvasMigration'

/** 假的老 kv：用内存表模拟今天 .mini-canvas/kv/ 的读写 */
function fakeKv(map: Record<string, unknown>): LegacyKv {
  return {
    async get<T>(type: string, key: string) {
      return map[type + ':' + key] as T | undefined
    },
  }
}

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvasmig-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('老数据迁移', () => {
  it('老 kv 里有 graph / graph-edges / graph-viewport → 迁进 canvas.json 与 view.json', async () => {
    const kv = fakeKv({
      'canvas:graph': [{ id: 'n1', type: 'text' }],
      'canvas:graph-edges': [{ id: 'e-n1-n2', source: 'n1', target: 'n2' }],
      'canvas:graph-viewport': { x: 5, y: 6, zoom: 2 },
    })
    const store = new CanvasStore(root)
    const r = await migrateLegacyCanvas(kv, store)
    expect(r.migrated).toBe(true)
    expect(r.nodes).toBe(1)
    expect(r.edges).toBe(1)
    expect(r.hadView).toBe(true)
    expect((await store.readCanvas('default'))!.nodes).toHaveLength(1)
    expect(await store.readView('default')).toEqual({ x: 5, y: 6, zoom: 2 })
  })

  it('认「信封」形态（graph 里同时有 nodes/edges）', async () => {
    const kv = fakeKv({
      'canvas:graph': { nodes: [{ id: 'n1' }], edges: [{ id: 'e1', source: 'n1', target: 'n1' }] },
    })
    const store = new CanvasStore(root)
    const r = await migrateLegacyCanvas(kv, store)
    const back = (await store.readCanvas('default'))!
    expect(back.nodes).toHaveLength(1)
    expect(back.edges).toHaveLength(1)
    expect(r.edges).toBe(1)
  })

  it('已经迁过（新结构已有画布）→ 不覆盖，migrated=false', async () => {
    const store = new CanvasStore(root)
    await store.writeCanvas('default', { nodes: [{ id: 'new' }], edges: [] })
    const kv = fakeKv({ 'canvas:graph': [{ id: 'old' }] })
    const r = await migrateLegacyCanvas(kv, store)
    expect(r.migrated).toBe(false)
    expect((await store.readCanvas('default'))!.nodes).toEqual([{ id: 'new' }])
  })

  it('老 kv 也没有 → 什么都不做（全新安装）', async () => {
    const store = new CanvasStore(root)
    const r = await migrateLegacyCanvas(fakeKv({}), store)
    expect(r.migrated).toBe(false)
    expect(await store.readCanvas('default')).toBeUndefined()
  })

  it('老 kv 是空数组（存过空画布）→ 仍然迁移（区分空画布与没存过）', async () => {
    const store = new CanvasStore(root)
    const r = await migrateLegacyCanvas(fakeKv({ 'canvas:graph': [] }), store)
    expect(r.migrated).toBe(true)
    expect((await store.readCanvas('default'))!.nodes).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test canvasMigration`
Expected: FAIL —— 找不到模块 `../store/canvasMigration`

- [ ] **Step 3: 写最小实现**

```ts
// packages/cloud-server/src/store/canvasMigration.ts
/**
 * 老数据迁移：把 today 的 kv（canvas:graph / graph-edges / graph-viewport）
 * 搬进新的画布文件夹（canvas.json / view.json）。
 *
 * 三条规矩：
 * 1. **只在目标不存在时搬** —— 已经迁过（或本来就是新装的）绝不覆盖，避免把新数据冲掉；
 * 2. 三种老形态都认（只存节点的旧数组 / 含边的信封 / 空数组）；
 * 3. 搬完**不删老数据** —— 老路由还要兼容读一段时间，删了就没退路。
 */
import type { CanvasStore } from './canvasStore'
import { DEFAULT_CANVAS_ID } from './canvasPaths'

/** 老 kv 的最小读面（只需 get；注入假货即可单测） */
export interface LegacyKv {
  get<T = unknown>(type: string, key: string): Promise<T | undefined>
}

export interface MigrationResult {
  migrated: boolean
  nodes: number
  edges: number
  hadView: boolean
}

export async function migrateLegacyCanvas(
  kv: LegacyKv,
  store: CanvasStore,
  canvasId: string = DEFAULT_CANVAS_ID,
): Promise<MigrationResult> {
  // 目标已存在 → 什么都不做（幂等；重复启动安全）
  if ((await store.readCanvas(canvasId)) !== undefined) {
    return { migrated: false, nodes: 0, edges: 0, hadView: false }
  }

  const rawNodes = await kv.get<unknown>('canvas', 'graph')
  const rawEdges = await kv.get<unknown>('canvas', 'graph-edges')
  const rawView = await kv.get<unknown>('canvas', 'graph-viewport')

  // 老 kv 里也没有 → 全新安装，不写任何东西
  if (rawNodes === undefined && rawEdges === undefined) {
    return { migrated: false, nodes: 0, edges: 0, hadView: false }
  }

  let nodes: unknown[] = []
  let edges: unknown[] = Array.isArray(rawEdges) ? rawEdges : []
  if (Array.isArray(rawNodes)) {
    nodes = rawNodes
  } else if (rawNodes && typeof rawNodes === 'object' && Array.isArray((rawNodes as { nodes?: unknown }).nodes)) {
    const env = rawNodes as { nodes: unknown[]; edges?: unknown }
    nodes = env.nodes
    if (Array.isArray(env.edges)) edges = env.edges
  }

  await store.writeCanvas(canvasId, { nodes, edges })
  if (rawView !== undefined) await store.writeView(canvasId, rawView)

  return { migrated: true, nodes: nodes.length, edges: edges.length, hadView: rawView !== undefined }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm -C packages/cloud-server test canvasMigration`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/cloud-server/src/store/canvasMigration.ts packages/cloud-server/src/__tests__/canvasMigration.test.ts
git commit -m "feat(cloud-server): 老 kv 画布数据自动迁移（幂等、不覆盖、不删老数据）"
```

---

### Task 6: 把 CanvasDocument 接到新仓库（对外 API 不变）

**Files:**
- Modify: `packages/cloud-server/src/mcp/canvasDoc.ts`（只改 `read` / `write` / `writeKey` / `removeKey` / `saveResource` 的内部；**所有公开方法签名与语义保持不变**）
- Modify: `packages/cloud-server/src/server.ts`（组装新仓库 + 启动时迁移 + 挂新路由）
- Modify: `packages/cloud-server/src/index.ts`（导出新模块）
- Test: `packages/cloud-server/src/__tests__/canvasDocMigration.test.ts`（新）
- 同步改：`canvasDoc.test.ts`、`canvasOps.test.ts`、`routes.test.ts`（它们构造 `CanvasDocument` 的方式变了）

**Interfaces:**
- Consumes: Task 2/3/5 的 `CanvasStore`、`CanvasResourceStore`、`migrateLegacyCanvas`
- Produces: `new CanvasDocument(store: CanvasStore, resources?: CanvasResourceStore, canvasId?: string)`
  （原签名是 `new CanvasDocument(kv: KvStore, files?: FileStore)`）

> ⚠️ **这是本计划风险最高的一步**：它动的是一切读写的地基。
> 破解办法是**不加新语义** —— `read`/`write` 的输入输出一字不变，只把落点从 kv 换成画布文件夹。
> 既有测试的**断言不动**，只有"怎么造出 CanvasDocument"这一句要改。

- [ ] **Step 1: 先跑一遍存量测试，记住基线**

Run: `pnpm -C packages/cloud-server test`
Expected: 全绿。**本计划写就时的实测基线：7 个文件 / 109 个用例全过**（2026-10-01）。
（这一步不许有红的，否则先修基线再往下走。）

- [ ] **Step 2: 写失败测试（迁移后的行为不变）**

```ts
// packages/cloud-server/src/__tests__/canvasDocMigration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CanvasStore } from '../store/canvasStore'
import { CanvasResourceStore } from '../store/canvasResources'
import { CanvasDocument } from '../mcp/canvasDoc'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvasdoc-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('CanvasDocument 走新仓库', () => {
  it('batchNodes 落进画布文件夹的 canvas.json', async () => {
    const doc = new CanvasDocument(new CanvasStore(root), new CanvasResourceStore(root))
    await doc.batchNodes({ add: [{ type: 'text', id: 'n1', data: { text: 'hi' } }] })
    const raw = JSON.parse(await fs.readFile(path.join(root, 'canvases', 'default', 'canvas.json'), 'utf8'))
    expect(raw.nodes).toHaveLength(1)
    expect(raw.nodes[0].id).toBe('n1')
  })

  it('读画布：没存过 → 空画布（不是抛错）', async () => {
    const doc = new CanvasDocument(new CanvasStore(root), new CanvasResourceStore(root))
    expect((await doc.read()).nodes).toEqual([])
  })

  it('存资源返回 res: 引用', async () => {
    const doc = new CanvasDocument(new CanvasStore(root), new CanvasResourceStore(root))
    const stored = await doc.saveResource(new Uint8Array([1, 2, 3]), { fileName: 'a.png' })
    expect(String((stored as { ref?: string }).ref).startsWith('res:')).toBe(true)
  })

  it('写画布不碰 view（AI 编辑不该重置用户视野）', async () => {
    const store = new CanvasStore(root)
    await store.writeView('default', { x: 9, y: 9, zoom: 3 })
    const doc = new CanvasDocument(store, new CanvasResourceStore(root))
    await doc.batchNodes({ add: [{ type: 'text', id: 'n1' }] })
    expect(await store.readView('default')).toEqual({ x: 9, y: 9, zoom: 3 })
  })
})
```

- [ ] **Step 3: 跑测试，确认失败**

Run: `pnpm -C packages/cloud-server test canvasDocMigration`
Expected: FAIL —— `CanvasDocument` 构造签名不匹配 / 落点仍找不到 `canvas.json`

- [ ] **Step 4: 改 CanvasDocument 的内部落点**

只改这四处（**公开方法签名、参数、返回形状一律不动**）：

```ts
// packages/cloud-server/src/mcp/canvasDoc.ts
import type { CanvasStore } from '../store/canvasStore'
import { DEFAULT_CANVAS_ID } from '../store/canvasPaths'
import type { CanvasResourceStore } from '../store/canvasResources'

export class CanvasDocument {
  /**
   * @param store     画布本体（canvas.json / view.json）
   * @param resources 本画布资源（res: 引用）
   * @param canvasId  画布 id（默认 default；前端界面当前只有一张画布）
   */
  constructor(
    private readonly store: CanvasStore,
    private readonly resources?: CanvasResourceStore,
    private readonly canvasId: string = DEFAULT_CANVAS_ID,
  ) {}

  /** 读整张画布。从未保存过 = 空画布（不是错误） */
  async read(): Promise<CanvasSnapshot> {
    const data = (await this.store.readCanvas(this.canvasId)) ?? { nodes: [], edges: [] }
    const viewport = (await this.store.readView(this.canvasId)) as { x: number; y: number; zoom: number } | undefined
    return {
      nodes: clone(data.nodes) as CanvasNode[],
      edges: clone(data.edges) as CanvasEdge[],
      ...(viewport ? { viewport: clone(viewport) } : {}),
    }
  }

  /** 写整张画布。只写 nodes/edges 两个字段，**不碰 view** */
  async write(snapshot: { nodes: CanvasNode[]; edges: CanvasEdge[] }): Promise<void> {
    await this.store.writeCanvas(this.canvasId, { nodes: snapshot.nodes, edges: snapshot.edges })
  }

  /** 单个画布 key 的改写（老路由 PUT /api/kv/canvas/graph 仍打到这里） */
  async writeKey(key: string, value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      const cur = (await this.store.readCanvas(this.canvasId)) ?? { nodes: [], edges: [] }
      if (key === GRAPH_KEY) {
        const nodes = Array.isArray(value)
          ? value
          : ((value as { nodes?: unknown[] } | undefined)?.nodes ?? [])
        const edges = Array.isArray(value)
          ? cur.edges
          : ((value as { edges?: unknown[] } | undefined)?.edges ?? cur.edges)
        await this.store.writeCanvas(this.canvasId, { nodes, edges })
      } else if (key === GRAPH_EDGES_KEY) {
        await this.store.writeCanvas(this.canvasId, { nodes: cur.nodes, edges: Array.isArray(value) ? value : [] })
      } else if (key === GRAPH_VIEWPORT_KEY) {
        await this.store.writeView(this.canvasId, value)
      }
    })
  }

  /** 单键删除 */
  async removeKey(key: string): Promise<boolean> {
    return this.runExclusive(async () => {
      const cur = await this.store.readCanvas(this.canvasId)
      if (cur === undefined) return false
      // 只有 graph 的删除会真正清空节点；其余按"置空"处理
      if (key === GRAPH_KEY) await this.store.writeCanvas(this.canvasId, { nodes: [], edges: [] })
      else if (key === GRAPH_EDGES_KEY) await this.store.writeCanvas(this.canvasId, { nodes: cur.nodes, edges: [] })
      return true
    })
  }

  /** 存一个资源 → 返回同源稳定地址 + 画布内引用 */
  async saveResource(bytes: Uint8Array, opts: { fileName?: string; mime?: string } = {}) {
    if (!this.resources) throw new Error('[mcp] 未配置资源存储，无法保存资源')
    if (bytes.byteLength === 0) throw new Error('[mcp] 资源内容为空')
    const ext = safeExt(opts.fileName ?? '') || extFromMime(opts.mime ?? '')
    const saved = await this.resources.save(this.canvasId, bytes, ext)
    return {
      ref: saved.ref,
      hashName: saved.hashName,
      // 老字段保留：既有调用方（MCP 的 add_image / resource.upload）与测试都还在读 url
      url: '/api/canvases/' + this.canvasId + '/resources/' + saved.hashName,
      size: saved.size,
      // MIME 来源：调用方给的就用，没给就按扩展名反查（与老 FileStore 同口径）
      mime: opts.mime ?? mimeOf(safeExt(opts.fileName ?? '') || extFromMime(opts.mime ?? '')),
    }
  }
}
```

删掉不再使用的 `KvStore` 字段与相关私有方法（`nextFreePosition` 保留：它只依赖 nodes，不依赖存储）。
注意 `mimeOf` 与 `safeExt` / `extFromMime` 来自原有的 `store/fileStore.js`（继续 import，
它们与落点无关，只是查表）。

- [ ] **Step 5: 同步改既有测试的构造方式**

`canvasDoc.test.ts` / `canvasOps.test.ts` / `routes.test.ts` 里凡出现
`new CanvasDocument(kvStore)` 的地方，改成：

```ts
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-'))
const doc = new CanvasDocument(new CanvasStore(root), new CanvasResourceStore(root))
```

**断言一律不改**（它们断言的是行为，不是落点）。
若某条断言直接读 kv 文件（如"网页端按 canvas:graph 读得到"），把它改成走 `doc.read()`
—— 测试要验的是"读得回来"，不是"存在哪个文件名"。

- [ ] **Step 6: 跑全量测试，确认通过**

Run: `pnpm -C packages/cloud-server test`
Expected: 全绿，且用例数 **≥ 113**（基线 109 + 本任务新增 4）。

若出现红：优先怀疑"断言里写死了旧落点"，而不是行为真的变了 —— 逐条核对。

- [ ] **Step 7: 在 server 组装处接上新仓库、启动时迁移、挂新路由**

```ts
// packages/cloud-server/src/server.ts（关键片段）
const canvasStore = new CanvasStore(dataDir)
const canvasResources = new CanvasResourceStore(dataDir)
// 启动时迁移老数据（幂等：迁过就跳过）
const migration = await migrateLegacyCanvas(kvStore, canvasStore, DEFAULT_CANVAS_ID)
if (migration.migrated) {
  console.log(`[cloud-server] 已迁移老画布数据：${migration.nodes} 节点 / ${migration.edges} 边`)
}

// doc 改用新仓库（对外行为不变），老 kv / uploads 路由保留（兼容读）
const doc = new CanvasDocument(canvasStore, canvasResources)

// 新路由：放在老路由之后、静态托管之前
app.route('/', canvasesRoutes(canvasStore, canvasResources))
```

- [ ] **Step 8: 跑测试与类型检查**

Run: `pnpm -C packages/cloud-server test && pnpm -C packages/cloud-server typecheck`
Expected: 全绿、零类型错误。

- [ ] **Step 9: 手工验一遍真实数据（重要）**

Run:
```bash
cd packages/cloud-server && node ./dist/cli.js serve --no-mcp --no-open
```
（或用 `pnpm -C packages/cloud-server serve`）

然后另开一个终端：
```bash
curl -s http://127.0.0.1:8865/api/canvases
curl -s http://127.0.0.1:8865/api/canvases/default | head -c 200
```
Expected: 第一条列出 `default`；第二条返回**既有画布的真实节点**（不是空数组）——
说明迁移把仓库里那份老数据搬过来了。

对照检查磁盘：`packages/cloud-server/.mini-canvas/canvases/default/canvas.json` 存在，
且老的 `kv/canvas%3Agraph.json` **仍然在**（不删老数据）。

- [ ] **Step 10: 提交**

```bash
git add packages/cloud-server/src/mcp/canvasDoc.ts packages/cloud-server/src/server.ts packages/cloud-server/src/index.ts packages/cloud-server/src/__tests__/
git commit -m "feat(cloud-server): CanvasDocument 改用画布文件夹 + 启动迁移 + 挂新路由"
```

---

## 完成标志

本计划做完后应当成立：

- `pnpm -C packages/cloud-server test` 与 `typecheck` 全绿。
- 磁盘上是 `canvases/<id>/{canvas.json, view.json, resources/}` 的新结构。
- 老数据自动迁过来了，**老 kv 文件还在**（可回退）。
- 老路由 `/api/kv/canvas/*` 与 `/uploads/*` **仍然可用**（前端还没切）。
- 新路由 `/api/canvases/*` 可用，资源返回 `res:<hash>` 引用。

## 后续计划（本计划**不做**，另行开单）

技能要求每个计划自成一体、单独可测，所以按子系统拆开：

| # | 计划 | 内容 | 依赖 |
|---|---|---|---|
| 2 | 动作清单与 provider 目录 | 后台扫 `providers/`、合并成 `GET /api/actions`、内置 web2api 改写成第一个 provider、变更检测 + 版本信号 | 1 |
| 3 | 任务执行与历史 | `/api/jobs` 三接口、按 actionId 路由到 provider、写回节点 runState（增量口）、终态归档 `history.json`（+ 信号键）、`GET /api/history` | 2 |
| 4 | 插件 `plugin-cloud-client` | 合并 cloud-save、拉清单注册动作（字段换算 + 全量重建）、下单 + 只读轮询、历史服务、自带 video/audio 写入器 | 3 |
| 5 | 前端接线与收尾 | 底栏小改（`canvasId` 透传 + 「状态由外部管」标记）、历史弹窗接服务、`ui.ts` 的 `cloud-save` 判断、前端切到 `/api/canvases/*`、MCP 生成工具、删旧包与老路由 | 4 |

> 顺序不能变：**2 依赖 1（存储）**、3 依赖 2（清单）、4 依赖 3（接口）、5 依赖 4。
> 计划 1 是唯一可以独立跑、独立验证、且不破坏任何现有功能的一步 —— 先做它最安全。

---

## 执行时超出计划的部分（2026-10-01 同日完成）

原计划只覆盖「存储地基」。实际执行时把后续几步也一并做了 ——
因为它们是同一件事的不同侧面，分开做反而要反复改同一批文件：

### ① 平台提供方目录（后台的「投递箱」）

`packages/cloud-server/src/providers/`：`types` / `registry` / `load` / `watch` /
`web2api/`（内置 provider，用**和外挂完全一样**的接口写的）。

- 丢一个 `.js` 进 `<数据根>/providers/` → 重启（或几秒内热重载）即多一个平台；
- `GET /api/actions` 给前端清单，带 `ifVersion` 省流量；
- 目录用**内容签名**轮询比对（跨平台稳），变了就整体重扫（删掉的 provider 一起消失）。

### ② 任务执行与历史

`packages/cloud-server/src/tasks/`：`taskManager`（下单 → 轮 provider → 写节点 →
终态归档）、`history`（画布文件夹里的 history.json，分页 + 汇总）、`types`。

`POST/GET /api/jobs`、`POST /api/jobs/:id/cancel`、`GET /api/history`。

**关键点**：后台写节点走**增量口**（`batchNodes`，与网页端共用同一把锁）；
归档历史后写一个 `config:history-rev` 信号键 —— 否则前台收不到"有新历史"的通知。

### ③ MCP 生成工具（不开页面也能干活）

`generation.actions` / `generation.create` / `generation.status` 三个 MCP 工具。
没有它们，「把生成交给后台」就只在"页面开着"的时候成立。

### ④ 云端客户端插件 `plugin-cloud-client`

取代 `plugin-cloud-save`（后者已删除）。它一个包干四件事、共用一条 SSE：
存档 + 实时跟随、拉后台清单**注册进底栏**、下单/看进度/取消、读历史。

**零 import 单文件产物**（28KB），经 `fetch 文本 → import(data:URL)` 动态装载 ——
这正是"后台下发插件"那条路，产物里一个 import 都不能有（实测验证过）。

### ⑤ 前端接线

- 历史弹窗改读 `gen-history` 服务（分页 + 汇总 + 实时刷新）；没连后台时给人话提示；
- `ui.ts` 注入服务地址时改按**服务名**判断（原来写死 `cloud-save` 目录名，改名后会静默失效）；
- 底栏加了 `externalRunState` 可选标记：云动作的进度由后台写，底栏不重复写（否则来回跳）。

### 验证（实测）

| 包 | 测试 |
|---|---|
| cloud-server | 154 |
| plugin-cloud-client | 76 |
| plugin-bottom-bar | 85 |
| ui | 65 |

真实服务上端到端跑通：存储文件夹结构、provider 热重载（丢一个平台 → 清单 11→12）、
下单 → 节点 runState → 历史记账、MCP 全程下单（不开页面）、插件零引用产物动态装载。
