// 文件：packages/docs/public/examples/kernel/plugin-fiber-demo/src/demoPlugins.ts
// 格式：TypeScript 模块（四个插件模块，用于诊断演示）
// 位置：演示用，集中放一起
import type { Context, PluginModule } from '@mini-canvas/kernel'

/** ① 正常插件：提供一个服务 */
export const healthyPlugin: PluginModule = {
  name: 'healthy',
  apply(ctx: Context) {
    ctx.provide('healthy-svc', { ok: true })
  },
}

/** ② 缺依赖：等一个永远不来的服务 → 停在 pending */
export const waitingPlugin: PluginModule = {
  name: 'waiting',
  inject: ['never-provided-svc'],
  apply() {
    console.log('这行永远不会打印')
  },
}

/** ③ config 校验失败：装了也没跑起来，fiber 进 failed */
export const badConfigPlugin: PluginModule = {
  name: 'bad-config',
  Config: { width: { type: 'number', default: 2, min: 1, max: 6 } },
  apply() {},
}

/** ④ apply 里抛错：fiber 同样进 failed，但错误来自运行期 */
export const throwingPlugin: PluginModule = {
  name: 'throwing',
  apply() {
    throw new Error('boom-apply')
  },
}

