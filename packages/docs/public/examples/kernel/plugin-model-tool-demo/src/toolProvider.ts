// 文件：packages/docs/public/examples/kernel/plugin-model-tool-demo/src/toolProvider.ts
// 格式：TypeScript 模块（插件入口：导出 name / apply）
// 位置：注册模型可调用工具的插件
import { defineTool, type Context, type PluginModule, type ToolSpec } from '@mini-canvas/kernel'

export const name = 'model-tool-provider'

export function apply(ctx: Context): void {
  // ① 取这张场（同 kind 全内核只有一张表；本插件放的东西随本插件卸载自动摘除）
  const tools = ctx.registryOf<ToolSpec>('tool')

  // ② 注册「打招呼」：参数名就是键；required 会进 JSON Schema
  tools.add('greet', defineTool({
    description: '向某人打招呼',
    parameters: {
      name: { type: 'string', required: true, label: '对方名字', description: '要打招呼的人' },
      excited: { type: 'boolean' },
    },
    // ③ 产物是字符串：schema 声明它，render 摆盘成 text 块
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute(args) {
      const who = String(args.name)
      const bang = args.excited === true ? '!!' : '!'
      return 'Hello, ' + who + bang
    },
  }))

  // ④ 注册「翻倍」：产物是 json 块（默认 renderer 就能干，这里显式写出来做示范）
  tools.add('double', defineTool({
    description: '把一个数字翻倍',
    parameters: { n: { type: 'number', required: true, min: -1000, max: 1000, step: 1 } },
    output: {
      schema: {
        type: 'object',
        properties: { n: { type: 'number' }, doubled: { type: 'number' } },
        required: ['n', 'doubled'],
      },
      render: (_args, value) => [{ type: 'json', value }],
    },
    async execute(args, call) {
      // ⑤ callId 贯穿本次调用；signal 可取消（本工具很快，仅演示接口）
      if (call.signal.aborted) throw new Error('已取消')
      const n = Number(args.n)
      return { n, doubled: n * 2 }
    },
  }))
}

export const modelToolProviderPlugin: PluginModule = { name, apply }

