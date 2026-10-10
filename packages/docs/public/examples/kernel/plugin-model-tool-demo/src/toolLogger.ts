// 文件：packages/docs/public/examples/kernel/plugin-model-tool-demo/src/toolLogger.ts
// 格式：TypeScript 模块（插件入口，观察者）
// 位置：打印每一次模型工具调用 —— 它不需要 inject 任何服务
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'model-tool-logger'

export function apply(ctx: Context): void {
  // ① 谁进表 / 谁离表
  ctx.on('tools/registered', (toolName: string, _tool, source: string) => {
    console.log('[logger] 工具进表：', toolName, '（谁放的：' + source + '）')
  })
  ctx.on('tools/unregistered', (toolName: string, source: string) => {
    console.log('[logger] 工具离表：', toolName, '（原本谁放的：' + source + '）')
  })

  // ② 每一次调用 —— 成功和失败都会到（runToolCall 在结果物化时发）
  ctx.on('tools/result', (exec, result) => {
    console.log(
      '[logger] 调用', exec.name, 'callId=' + exec.callId,
      '入参=' + JSON.stringify(exec.arguments),
      '结果=', result.ok ? JSON.stringify(result.content) : '失败：' + result.error,
    )
  })
}

export const modelToolLoggerPlugin: PluginModule = { name, apply }

