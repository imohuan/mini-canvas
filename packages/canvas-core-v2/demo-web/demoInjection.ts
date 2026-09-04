import type { InjectionKey, Ref } from 'vue'
import type { CanvasHost } from '../src/demo/host'

/**
 * HOST_KEY —— demo 内容组件经 provide/inject 拿到宿主句柄的令牌。
 *
 * 因内核异步 boot，provide 的是"宿主引用"（开始时为空、boot 完成后填充），
 * 内容组件在交互时（此时 boot 必已结束）读取 `.value`。
 * 内容组件只经它 `host.ctx.get('text'|'image')` 等能力，不直接碰底层服务。
 */
export const HOST_KEY: InjectionKey<Ref<CanvasHost | undefined>> = Symbol('canvas-v2-demo-host')
