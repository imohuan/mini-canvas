// 文件：packages/docs/public/examples/kernel/plugin-capability-demo/src/miniLayer.ts
// 格式：TypeScript 模块（自定义能力层实现）
// 位置：演示「内核不认识段，段由能力层产出」
import type { CapabilityLayer, PluginScope } from '@mini-canvas/kernel'

/** 段 / 内置服务的运行时状态（每 Context 一份 —— 所以要用工厂产出） */
export function createMiniCapabilityLayer(): CapabilityLayer {
  /** ① 内核会通过 builtins() 看到它：ctx.get('clock') 恒可取到 */
  const clock = { now: () => Date.now() }

  /** ② 每个插件各自记一份「它的笔记」（演示段随视图产出、逐插件隔离） */
  const notes = new Map<string, string[]>()

  return {
    buildSegments(_ctx: PluginScope, scopeName: string): Record<string, unknown> {
      // ③ 产出一个 notes 段：会被 Object.assign 到该视图上 → ctx.notes 可用
      return {
        notes: {
          add(text: string): void {
            const list = notes.get(scopeName) ?? []
            list.push(text)
            notes.set(scopeName, list)
          },
          list(): string[] {
            return [...(notes.get(scopeName) ?? [])]
          },
        },
      }
    },

    builtins(): Record<string, unknown> {
      return { clock }                  // ④ 恒可取、依赖判定恒满足、不进服务表
    },

    reset(): void {
      notes.clear()                     // ⑤ ctx.stop() 时由内核调用
    },

    // ⑥ 本演示不做配置登记：返回一个空清理函数即可（真层在这里把标量字段登记进设置面板）
    declareConfig() {
      return () => {}
    },
  }
}

