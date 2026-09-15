/**
 * MCP 工具面单测。
 *
 * 这一组是补一个**真出过的坑**：新加的工具在源码里、也确实被 e2e 验过了，但用户
 * 装完却看不到 —— 因为他跑的是打包产物 `dist/`，而那是上一次编译的（`prepack` 当时
 * 只收 assets、没重新编译）。e2e 走的是 tsx 直读源码，永远发现不了这种"源码对、产物旧"。
 *
 * 所以这里除了断言"源码里有哪些工具"，还额外断言**清单与注册保持一致**，
 * 并把"产物是否过期"交给 package.json 那条 `prepack: build && bundle-assets` 兜住。
 */
import { describe, it, expect } from 'vitest'
import { TOOL_LIST, listTools, createCanvasMcpServer } from '../mcp/server'
import { CanvasDocument } from '../mcp/canvasDoc'
import { KvStore } from '../store/kvStore'
import { FileStore } from '../store/fileStore'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

describe('MCP 工具清单', () => {
  it('画布读写四件套都在', () => {
    const names = listTools().map((t) => t.name)
    for (const n of ['canvas.get', 'canvas.overview', 'canvas.batch_nodes', 'canvas.batch_edges']) {
      expect(names).toContain(n)
    }
  })

  it('资源上传三件套都在（AI 要能往画布放图，不能只建空节点）', () => {
    const names = listTools().map((t) => t.name)
    for (const n of ['resource.upload', 'resource.list', 'canvas.add_image']) {
      expect(names).toContain(n)
    }
  })

  it('每个工具都有非空描述（AI 靠描述决定用哪个）', () => {
    for (const t of TOOL_LIST) {
      expect(t.description.length).toBeGreaterThan(5)
    }
  })

  it('清单与真实注册一致：TOOL_LIST 里的名字，server 上都注册了', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-tools-'))
    try {
      const server = createCanvasMcpServer(new CanvasDocument(new KvStore(dir), new FileStore(dir)))
      // SDK 内部把已注册工具放在 _registeredTools；用它核对清单没有"列了却没注册"的落空项
      const registered = Object.keys(
        (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools ?? {},
      )
      expect(registered.length).toBeGreaterThan(0)
      for (const t of TOOL_LIST) {
        expect(registered).toContain(t.name)
      }
      // 反向也要求：注册了却不在清单里 = 用户看不到的工具（等于白写）
      const listed = new Set(TOOL_LIST.map((t) => t.name))
      for (const name of registered) {
        expect(listed).toContain(name)
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('★ 打包产物（dist）里的工具面必须与源码一致 —— 用户跑的正是 dist', async () => {
    // 这条是补一个**真出过的坑**：新工具加在源码里、e2e 也验过了，但用户装完看不到 ——
    // 他跑的是 `dist/`（npx 装在 node_modules 里那份），而那是上一次编译的产物。
    // e2e 走 tsx 直读 `../src/...`，永远发现不了"源码对、产物旧"。这条断言补上这个盲区：
    // 只要 dist 存在（本地构建过 / 打过包），它的工具面就必须与源码一致。
    // dist 不存在时跳过（干净 clone 里 dist 是构建产物，gitignore 掉了，不该因此报错）。
    const distEntry = path.resolve(__dirname, '../../dist/mcp/server.js')
    let distTools: string[]
    try {
      const mod = (await import(pathToFileURL(distEntry).href)) as { listTools?: () => { name: string }[] }
      distTools = (mod.listTools?.() ?? []).map((t) => t.name)
    } catch {
      return // 没有 dist：跳过（不是失败）
    }
    expect(distTools.sort()).toEqual(listTools().map((t) => t.name).sort())
  })
})
