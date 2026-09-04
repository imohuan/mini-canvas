/**
 * contentBridge —— content 内容组件 ↔ 宿主/内核 的接入令牌（Vue provide/inject）。
 *
 * 归内核组件层（src/components，同 nodeRegistryKey.ts），不归 demo-web：
 * 插件包里的 content .vue 组件 import 本文件的 HOST_KEY，就能在不反向依赖 demo-web 的前提下
 * 拿到宿主句柄(CanvasHost)，再经 host.ctx.get('xxx') 调插件服务。宿主 provide、插件消费，令牌两边共享。
 *
 * 只 type 级 import vue，不把 vue 运行时拉进 Node 单测路径。
 */
import type { InjectionKey, Ref } from 'vue'

/**
 * 宿主句柄（CanvasHost 形状见 src/demo/host.ts）的响应式引用。
 * 内核异步 boot，provide 的是"宿主引用"（开始时空、boot 完成后填充），
 * content 组件在交互时（此时 boot 必已结束）读取 .value。
 */
// 用 any 兜底避免 src/demo 层反向 import 造成循环；具体类型由宿主在 provide 端标注。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const HOST_KEY: InjectionKey<Ref<any | undefined>> = Symbol('canvas-v2-host')
