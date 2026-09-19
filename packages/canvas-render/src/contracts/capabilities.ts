/**
 * capabilities —— 「能力包」（设计文档 §4.5 / 案例 5 / 决策 9）。
 *
 * 要解决的问题（作者原话）："很多时候一个组件都是由多个 hooks 来操作的，这些 hooks 其实
 * 大多都是通用的，不需要重复实现" —— 于是每个节点插件各写一份"读节点 + 写回 + 看缩放 +
 * 看选中"的样板，改一处要改 N 处。
 *
 * 能力包的答案：**能力放进 registryOf('capability') 这张场，按名注册、按名取用**。
 * - 任何插件都能注册（与 cordis「任何插件都能提供服务」一致）；主题插件换掉整套能力就是叠一个更小 order 的条目。
 * - 组件在注册时声明 needs: ['node','zoom','tools']，只拿得到声明过的。
 * - **每节点一份实例**（同一节点上所有条目共享），由消费它的组件回收（见 createCapabilityCache）。
 * - needs 缺项：dev 当场抛错（响亮），prod 返回 undefined + warn（不白屏）。见决策 9。
 *
 * 为什么这里没有 ctx 参数：本模块是 canvas-render 的契约层，只做"取值 + 缺项裁决"，
 * 不 import 任何节点插件 —— 具体能力由宿主/主题插件注册（见 createMiniCanvasHost 的标准四件）。
 */
import { inject, provide, type InjectionKey, type Ref } from 'vue'
import type { Entry, Registry } from '@mini-canvas/kernel'
import type { Context } from '@mini-canvas/canvas-data'

/** 一个节点暴露给能力工厂的上下文（工厂按它造出该节点专属的能力实例） */
export interface CapabilityNodeContext {
  /** 内核 ctx（能力实现里可 ctx.get('doc') 等） */
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

/** 能力场（registryOf('capability')）：键 = 能力名，值 = 工厂 */
export type CapabilityField = Registry<CapabilityFactory>

/** 注入令牌：把"这一条区域条目的能力袋"沿渲染树往下传（useCapabilities() 从它取） */
export const CAPABILITY_BAG_KEY: InjectionKey<CapabilityBag> = Symbol('canvas-capability-bag')

/**
 * 作用域令牌：比能力袋多记两件事 —— "这条条目声明了哪些 needs" 与 "现在是 dev 还是 prod"。
 *
 * 为什么不能只用能力袋：光看袋子分不清两种"取不到"（都是 undefined）——
 *   ① 你**没在 needs 里声明**它（作者忘了写，最典型）；② 声明了但没人注册（已在别处响亮处理）。
 * 只有记下 declared 才谈得上对 ① 给提示。isDev 存一份是因为 useCapabilities 拿不到 ctx 时
 * 无法判断该不该提示（prod 不该刷 warn）。
 */
export const CAPABILITY_SCOPE_KEY: InjectionKey<{ declared: string[]; isDev: boolean }> =
  Symbol('canvas-capability-scope')

/**
 * 一条区域条目的能力袋：{ [能力名]: 实例 }，**只含 needs 里声明过的**。
 *
 * 为什么按能力名分组（而不是摊平成一个对象）：摊平会让两个能力撞同名键时静默互相盖掉
 * （"我明明注册了却拿不到"是最难查的一类失效）；按名分组之后"谁提供哪一格"永远可分。
 */
export type CapabilityBag = Record<string, unknown>

/**
 * 取本条区域条目的能力袋。必须在 BaseNode 的区域渲染子树内调用（那些位置包了 RegionEntryHost）。
 * 没有声明 needs 的条目拿到空对象 —— 不抛错（"我不用任何能力"是合法声明）。
 *
 * 在区域子树**之外**调用时（比如把浮层挂到 ctx.slots 的画布级槽里，或在 BaseNode 之外自绘组件）：
 * 这里拿不到注入，返回 `{}`。为了让这种误用**不静默**，dev 下会 warn 一次并说明原因
 * —— 与 `useCanvasRender()` 的抛错不同，这里不抛：本函数允许被"可选地"调用。
 */
export function useCapabilities(): CapabilityBag {
  const bag = inject(CAPABILITY_BAG_KEY, null)
  const scope = inject(CAPABILITY_SCOPE_KEY, null)
  if (bag) return bag
  // 没有袋：要么本组件不在区域子树里（最常见），要么这条条目真的没声明 needs。
  if (scope?.isDev && typeof console !== 'undefined') {
    console.warn(
      '[capability] useCapabilities() 取不到能力包：本组件不在 BaseNode 的区域渲染子树内' +
        '（只有 RegionEntryHost 会 provide 能力袋）。用 ctx.nodes.attach(...) 挂到十个区域词上即可；' +
        '若它是画布级浮层（ctx.slots.register("overlay", …)），它本来就拿不到节点能力，' +
        '请改用 ctx.get(...) 直接取服务。详见设计文档 §4.5。',
    )
  }
  return {}
}

/**
 * 取单个能力的便捷入口：const node = useCapability('node')。
 * 未声明（needs 里没有）→ undefined；未注册 → 由缺项裁决处理过了（dev 已抛 / prod 已 warn）。
 *
 * 作者最容易踩的坑是**忘了在 attach 里写 needs** —— 那会静默 undefined，与"能力没注册"长得一样。
 * 这里在 dev 下把它与"已声明但为空"区分开并给一条提示（决策 9 的"响亮"补齐最后一段：
 * 声明式白名单的"漏声明"不该无声无息）。
 */
export function useCapability<C = unknown>(name: string): C | undefined {
  const value = useCapabilities()[name] as C | undefined
  if (value === undefined) {
    const scope = inject(CAPABILITY_SCOPE_KEY, null)
    if (scope?.isDev && !scope.declared.includes(name) && typeof console !== 'undefined') {
      console.warn(
        `[capability] useCapability('${name}') 拿到 undefined：这条条目的 needs 里没有 "${name}"。` +
          `（已声明的是：[${scope.declared.join(', ')}]。）在 ctx.nodes.attach(...) 里加 needs: ['${name}'] 即可。`,
      )
    }
  }
  return value
}

/** 缺项裁决的结果：ok=false 表示"没注册这个能力"（dev 已抛错，或 prod 已 warn）。不导出：消费方一律走 bagFor/useCapabilities */
type CapabilityLookup = { ok: true; value: unknown } | { ok: false }

/**
 * **每节点一份**实例的缓存（决策 9 第②条："每节点一份实例"）。
 *
 * 为什么必须是 per-node 而不是 per-条目：一条条目的按钮要打开另一条条目的面板时，两者得共享
 * 同一份能力（比如同一个 tools 客户端）；per-条目就会各造一份、状态不共享 —— 那正是作者想避免的重复。
 * 缓存键 = 能力名，于是"同一节点上所有声明了 needs:['tools'] 的条目"拿到**同一个**实例。
 *
 * 生命周期：由造它的人（BaseNode 实例）持有，节点卸载时 dispose() 统一回收 ——
 * 这正是决策 9 的"实例由消费它的组件负责回收"。
 *
 * 热换能力（主题插件叠一个 order 更小的新条目）时自动重建：缓存记着产出该实例的工厂，
 * 工厂引用一变就重造（旧实例先回收），避免一直用旧实现。
 */
export interface CapabilityCache {
  /** 造一条条目的能力袋（只含 needs 里声明过的；未声明 = 空袋） */
  bagFor(needs: string[] | undefined, entryId: string): CapabilityBag
  /** 回收本节点全部实例（有 dispose()/stop() 的顺手调一次） */
  dispose(): void
}

/**
 * 建一份"每节点实例"缓存。在节点壳（BaseNode）的 setup 里建一次，随节点卸载 dispose。
 *
 * @param field  registryOf('capability')（缺省 = 场不存在 → 一切 needs 都算缺项）
 * @param node   该节点的能力上下文（工厂参数）
 * @param isDev  决定缺项是抛错（dev）还是 warn（prod）—— 见决策 9 第③条
 * @param warn   注入 console.warn（测试可换掉，避免脏输出）
 */
export function createCapabilityCache(
  field: { top(key: string): Entry<CapabilityFactory> | undefined } | undefined,
  node: CapabilityNodeContext,
  isDev: boolean,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): CapabilityCache {
  /** 能力名 → { 实例, 产出它的工厂 }（工厂换引用 = 能力被热换 → 重造） */
  const memo = new Map<string, { value: unknown; factory: CapabilityFactory }>()

  const lookup = (name: string, entryId: string): CapabilityLookup => {
    const factory = field?.top(name)?.value
    if (typeof factory !== 'function') {
      const msg =
        `[capability] 条目 "${entryId}" 的 needs 里声明了 "${name}"，但 registryOf('capability') 里没有它` +
        '（没人注册，或注册它的插件还没装载）。注册处见设计文档 §4.5 决策 9。'
      // 决策 9：dev 要"响亮"（这是"静默不生效"的解药），prod 不能让缺一个能力就白屏。
      if (isDev) throw new Error(msg)
      warn(msg)
      return { ok: false }
    }
    const hit = memo.get(name)
    if (hit && hit.factory === factory) return { ok: true, value: hit.value }
    let value: unknown
    try {
      value = factory(node)
    } catch (err) {
      // 工厂自己炸了：这是作者 bug，不降级（降级会把"能力实现有错"伪装成"能力缺失"）
      throw new Error(
        `[capability] 条目 "${entryId}" 的 "${name}" 能力工厂抛错：` +
          (err instanceof Error ? err.message : String(err)),
        { cause: err },
      )
    }
    if (hit) disposeOne(hit.value) // 热换：旧实例先回收再换新的
    memo.set(name, { value, factory })
    return { ok: true, value }
  }

 return {
    bagFor(needs, entryId) {
      const bag: CapabilityBag = {}
      if (!needs || needs.length === 0) return bag
      for (const name of needs) {
        const r = lookup(name, entryId)
        if (r.ok) bag[name] = r.value
      }
      return bag
    },
    dispose() {
      for (const { value } of memo.values()) disposeOne(value)
      memo.clear()
    },
  }
}

/** 尽力回收一个能力实例：有 dispose() 用 dispose()，否则有 stop() 用 stop()；普通对象零影响 */
function disposeOne(value: unknown): void {
  const d = value as { dispose?: unknown; stop?: unknown } | null | undefined
  if (!d) return
  try {
    if (typeof d.dispose === 'function') (d as { dispose(): void }).dispose()
    else if (typeof d.stop === 'function') (d as { stop(): void }).stop()
  } catch {
    /* 单个实例回收失败不阻断其余（与注册场 notify 同一条原则） */
  }
}

/**
 * 造一条区域条目的能力袋并把它 provide 给子树（RegionEntryHost 内部用）。
 *
 * 实例来自传入的 cache（每节点一份，由 BaseNode 持有并在卸载时统一回收）——
 * 本函数只负责"按 this 条目的 needs 取用 + provide"，不持有实例。
 */
export function provideCapabilityBag(
  cache: CapabilityCache,
  needs: string[] | undefined,
  entryId: string,
  /** 本条目声明的能力名（= needs；供 useCapability 区分"没声明"与"没注册"）+ 是否 dev */
  scope?: { isDev: boolean },
): CapabilityBag {
  const bag = cache.bagFor(needs, entryId)
  provide(CAPABILITY_BAG_KEY, bag)
  // 作用域信息单独 provide：袋子本身只装实例，分不清"没声明"与"没注册"（见 CAPABILITY_SCOPE_KEY）
  provide(CAPABILITY_SCOPE_KEY, { declared: needs ?? [], isDev: scope?.isDev === true })
  return bag
}

/**
 * 取本画布的能力场（registryOf('capability')）。
 *
 * 取不到（极简宿主/单测桩没装 registryOf）时返回 undefined —— 与既有"缺服务不抛"一致；
 * 这时 needs 非空会按缺项裁决（dev 抛错 / prod warn），正是我们要的"不开静默"。
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
 * 造一份"节点上下文"（BaseNode 一层用；data/selected/solo/zoom 都是活引用，
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
