/**
 * CanvasHost 纯画布化契约。
 *
 * 启动责任搬到 CanvasProvider 之后，这里锁三件事：
 * 1. Host 不再创建内核、不再自建 NodeRegistry、不再 stop 宿主；
 * 2. Host 改为消费基础上下文、用 Provider 建好的 nodeRegistry；
 * 3. Host 不再接受启动参数（props 类型和文件里都不该出现）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('CanvasHost 纯画布化', () => {
  it('不再创建内核、不再创建 NodeRegistry、不再 stop host', () => {
    const src = read('../CanvasHost.vue')
    // 允许 `import type { CanvasHostHandle } from './createMiniCanvasHost'` 这种纯类型导入；
    // 不允许运行时调用 createMiniCanvasHost（启动归 CanvasProvider）。
    expect(src).not.toMatch(/\bcreateMiniCanvasHost\s*\(/)
    expect(src).not.toContain('new NodeRegistry')
    expect(src).not.toContain('new MemoryStorageAdapter')
    expect(src).not.toContain('host.stop()')
    expect(src).not.toContain('exposeToWindow')
  })

  it('改为消费基础上下文，并用 host.nodeRegistry', () => {
    const src = read('../CanvasHost.vue')
    expect(src).toContain('useCanvasContext')
    expect(src).toContain('host.nodeRegistry')
    expect(src).toContain('CanvasHostRenderProps')
  })
})
