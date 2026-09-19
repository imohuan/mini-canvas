/**
 * capabilities —— 「能力包」（设计文档 §4.5 / 案例 5 / 决策 9）。
 *
 * 要解决的问题（作者原话）："很多时候一个组件都是由多个 hooks 来操作的，这些 hooks 其实
 * 大多都是通用的，不需要重复实现" —— 于是每个节点插件各写一份"读节点 + 写回 + 看缩放 +
 * 看选中"的样板，改一处要改 N 处。
 *
 * 能力包的答案：**能力放进 \`registryOf('capability')\` 这张场，按名注册、按名取用**。
 * - 任何插件都能注册（与 cordis「任何插件都能提供服务」一致）；主题插件换掉整套能力就是叠一个更小 order 的条目。
 * - 组件在注册时声明 \`needs: ['node','zoom','tools']\`，只拿得到声明过的。
 * - **每节点一份实例**，由消费它的组件所在作用域回收（挂该组件的 onScopeDispose）。
 * - \`needs\` 缺项：dev 当场抛错（响亮），prod 返回 undefined + warn（不白屏）。见决策 9。
 *
 * 为什么这里没有 \`ctx\` 参数：本模块是 canvas-render 的契约层，只做"取值 + 缺项裁决"，
 * 不 import 任何节点插件 —— 具体能力由宿主/主题插件注册（见 createMiniCanvasHost 的标准四件）。
 */
import { inject, onScopeDispose, provide, ref, type InjectionKey, type Ref } from 'vue'
import type { Entry, Registry } from '@mini-canvas/kernel'
import type { Context, NodeSegmentEntry } from '@mini-canvas/canvas-data'
import { useCanvasRender } from './renderContext'

/** 一个节点暴露给能力工厂的上下文（工厂按它造出该节点专属的能力实例） */
export interface CapabilityNodeContext {
  /** 内核 ctx（能力实现里可 \`ctx.get('doc')\` 等） */
  ctx: Context
  /** 本节点 id / 业务 type */
  id: string
  type: string
  /** 节点数据（响应式只读：props.data 变则 .value 变） */
  data: Readonly<Ref<Record<string, unknown>>>
  /** 本节点是否在选中集里 */
  selected: Readonly<Ref<boolean>>
  /** 本节点是否被**单独**选中（恰好选一个且就是我；操作栏显隐的既有语义） */
  solo: Readonly<Ref<boolean>>
  /** 当前缩放（反缩放/LOD 判定用；已防零） */
  zoom: Readonly<Ref<number>>
  /** 写回本节点 data（走宿主 nodeWrite → 唯一图写入口，自动进历史 + 落盘） */
  update(patch: Record<string, unknown>): void
}

/** 能力工厂：收节点上下文，返回这个节点专属的能力实例（opaque，由注册者定义形状） */
export type CapabilityFactory<C = unknown> = (node: CapabilityNodeContext) => C

/** 能力场（\`registryOf('capability')\`）：键 = 能力名，值 = 工厂 */
export type CapabilityField = Registry<CapabilityFactory>

/** 关键词：把"这一条区域条目的能力袋"沿渲染树往下传（\`useCapabilities()\` 从它取） */
export const CAPABILITY_BAG_KEY: InjectionKey<CapabilityBag> = Symbol('canvas-capability-bag')

/**
 * 一条区域条目的能力袋：\`{ [能力名]: 实例 }\`，**只含 needs 里声明过的**。
 *
 * 为什么按能力名分组（而不是摊平成一个对象）：摊平会让两个能力撞同名键时静默互相盖掉
 * （"我明明注册了却拿不到"是最难查的一类失效）；按名分组之后"谁提供哪一格"永远可分。
 */
export type CapabilityBag = Record<string, unknown>

/**
 * 取本条区域条目的能力袋。必须在 \`<CapabilityScope>\` 之内调用（BaseNode 为每条区域条目包一层）。
 * 没有声明 \`needs\` 的条目拿到空对象 —— 不抛错（"我不用任何能力"是合法声明）。
 */
export function useCapabilities(): CapabilityBag {
  return inject(CAPABILITY_BAG_KEY, null) ?? {}
}

/**
 * 取单个能力的便捷入口：\`const node = useCapability('node')\`。
 * 未声明（\`needs\` 里没有）→ undefined；未注册 → 由 resolveCapabilityBag 按 dev/prod 裁决过了。
 */
export function useCapability<C = unknown>(name: string): C | undefined {
  return useCapabilities()[name] as C | undefined
}

/**
 * 按 \`needs\` 造出一条条目的能力袋（决策 9 的缺项裁决就在这儿）。
 *
 * @param field  \`registryOf('capability')\`（缺省 = 场不存在 → 全部按缺项处理）
 * @param needs  该条目声明的能力名（空/未声明 = 空袋，零开销）
 * @param node   该节点的能力上下文（工厂参数）
 * @param isDev  \`ctx.isDev\`：决定缺项是抛错还是 warn
 * @param entryId 条目 id（报错文案里指出"谁的 needs"）
 * @param warn   注入 console.warn（测试可换掉，避免脏输出）
 */
export function resolveCapabilityBag(
  field: { top(key: string): Entry<CapabilityFactory> | undefined } | undefined,
  needs: string[] | undefined,
  node: CapabilityNodeContext,
  isDev: boolean,
  entryId: string,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): CapabilityBag {
  const bag: CapabilityBag = {}
  if (!needs || needs.length === 0) return bag
  for (const name of needs) {
    const factory = field?.top(name)?.value
    if (typeof factory !== 'function') {
      const msg =
        `[capability] 条目 "${entryId}" 的 needs 里声明了 "${name}"，但 \`registryOf('capability')\` 里没有它` +
        `（没人注册，或注册它的插件还没装载）。注册处见设计文档 §4.5 决策 9。`
      // 决策 9：dev 要"响亮"（这是"静默不生效"的解药），prod 不能让缺一个能力就白屏。
      if (isDev) throw new Error(msg)
      warn(msg)
      continue
    }
    try {
      bag[name] = factory(node)
    } catch (err) {
      // 工厂自己炸了：这是作者 bug，不降级（降级会把"能力实现有错"伪装成"能力缺失"）
      throw new Error(
        `[capability] 条目 "${entryId}" 的 "${name}" 能力工厂抛错：` +
          (err instanceof Error ? err.message : String(err)),
        { cause: err },
      )
    }
  }
  return bag
}

/**
 * 造一条区域条目的能力袋并把它 provide 给子树（\`<CapabilityScope>\` 内部用）。
 *
 * **回收**：袋子里的实例随本组件作用域销毁（onScopeDispose）——决策 9 的"每节点一份实例由
 * 消费方回收"。工厂返回的东西若有 \`dispose()\` / \`stop()\`，这里顺手调一次（尽力而为，
 * 无该方法的实例（普通对象）零影响）。
 */
export function provideCapabilityBag(entry: NodeSegmentEntry, node: CapabilityNodeContext): CapabilityBag {
  const ctx = node.ctx
  const field = capabilityField(ctx)
  const bag = resolveCapabilityBag(
    field,
    entry.needs,
    node,
    ctx.isDev === true,
    entry.id,
  )
  provide(CAPABILITY_BAG_KEY, bag)
  onScopeDispose(() => {
    for (const value of Object.values(bag)) {
      const d = (value as { dispose?: unknown; stop?: unknown } | null | undefined)
      if (!d) continue
      try {
        if (typeof d.dispose === 'function') (d as { dispose(): void }).dispose()
        else if (typeof d.stop === 'function') (d as { stop(): void }).stop()
      } catch {
        /* 单个实例回收失败不阻断其余（与注册场 notify 同一条原则） */
      }
    }
  })
  return bag
}

/**
 * 取本画布的能力场（\`registryOf('capability')\`）。
 *
 * 取不到（极简宿主/单测桩没装 \`registryOf\`）时返回 undefined —— 与既有"缺服务不抛"一致；
 * 这时 \`needs\` 非空会按缺项裁决（dev 抛错 / prod warn），正是我们要的"不开静默"。
 */
export function capabilityField(ctx: Context | undefined): CapabilityField | undefined {
  if (!ctx) return undefined
  const fn = (ctx as { registryOf?: (kind: string) => CapabilityField }).registryOf
  if (typeof fn !== 'function') return undefined
  try {
    return fn.call(ctx, 'capability')
  } catch {
    return undefined
  }
}

/**
 * 造一份"节点上下文"（BaseNode 一层用；\`data/selected/solo/zoom\` 都是活引用，
 * 能力实例读到的永远是最新值，不是创建时的快照）。
 */
export function createCapabilityNodeContext(input: {
  ctx: Context
  id: string
  type: string
  data: Ref<Record<string, unknown>> | Readonly<Ref<Record<string, unknown>>>
  selected: Ref<boolean> | Readonly<Ref<boolean>>
  solo: Ref<boolean> | Readonly<Ref<boolean>>
  zoom: Ref<number> | Readonly<Ref<number>>
  update(patch: Record<string, unknown>): void
}): CapabilityNodeContext {
  return {
    ctx: input.ctx,
    id: input.id,
    type: input.type,
    data: input.data as Readonly<Ref<Record<string, unknown>>>,
    selected: input.selected as Readonly<Ref<boolean>>,
    solo: input.solo as Readonly<Ref<boolean>>,
    zoom: input.zoom as Readonly<Ref<number>>,
    update: input.update,
  }
}

/** 便捷：造一个可写 Ref（供 \`update\` 之外需要本地态的组件用；保持与能力包同样的回收语义） */
export function capabilityState<T>(initial: T): Ref<T> {
  return ref(initial) as Ref<T>
}
