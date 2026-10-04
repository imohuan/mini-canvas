/**
 * server-capabilities —— 后台能力段的类型声明（插件作者侧）。
 *
 * cloud-server 的 serverFramework/capabilityTypes.ts 对宿主进程做了同样的声明合并；
 * 插件包在**自己的仓库里**写代码时拿不到那个合并（它住在宿主包里），所以作者要自备一份。
 * 类型与宿主完全一致（RouteRegistrar 等的真实形状以 kernel 运行时为准 —— 本文件只影响编辑器提示）。
 */
import type { PluginCapabilities } from '@mini-canvas/kernel'

declare module '@mini-canvas/kernel' {
  interface PluginCapabilities {
    // Handler 的 c 参数是 Hono 的最小结构类型（真实运行时由宿主的 hono 提供 —— external）
    routes: {
      get(path: string, handler: H): void
      post(path: string, handler: H): void
      put(path: string, handler: H): void
      delete(path: string, handler: H): void
    }
    agent: {
      use(mw: (turn: unknown, next: () => Promise<unknown>) => Promise<unknown>, opts?: { order?: number }): void
      systemPrompt(text: string): void
    }
    store: {
      namespace(name: string): {
        get<T = unknown>(key: string): Promise<T | undefined>
        set(key: string, value: unknown): Promise<void>
        delete(key: string): Promise<boolean>
        keys(): Promise<string[]>
        clear(): Promise<void>
      }
    }
    jobs: {
      every(intervalMs: number, fn: () => void | Promise<void>): { cancel(): void }
      once(delayMs: number, fn: () => void | Promise<void>): { cancel(): void }
      soon(fn: () => void | Promise<void>): { cancel(): void }
    }
    mcp: {
      tool(def: {
        name: string
        description: string
        input?: Record<string, 'string' | 'number' | 'boolean'>
        required?: string[]
        handler(args: Record<string, unknown>): unknown | Promise<unknown>
      }): void
    }
  }
}

export {}

/** Hono Context 的最小结构类型（req.param / req.json / json）—— 只为本插件的编辑器提示 */
interface HCtx {
  req: { param(name: string): string; json(): Promise<unknown> }
  json(body: unknown, status?: number): Response
}
type H = (c: HCtx) => unknown | Promise<unknown>
