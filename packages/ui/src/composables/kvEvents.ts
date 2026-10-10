/**
 * kvEvents —— 全应用共享**一条** `/api/kv/events`（SSE）连接。
 *
 * 解决的问题（用户报的"后台怎么这么卡"）：设置同步、主题同步、Agent 设置同步
 * 各自 `new EventSource('/api/kv/events')` —— 一个页面上就开出好几条**永不关闭**的长连接。
 * 浏览器对单个域名的并发连接上限是 6 条（Chrome 至今如此），长连接把额度占满之后，
 * 页面里**所有**普通请求（保存画布、拉会话、轮询动作清单）只能排队 ——
 * 用户看到的就是"请求永远停在待处理、页面访问很慢很慢"。
 *
 * 做法：进程内按路径维护一条连接 + 一份订阅者名单（引用计数）。第一个订阅者开连接，
 * 最后一个退订才关。各模块只拿到一个 dispose，不感知别人。
 *
 * 为什么走全局键暴露：`plugin-cloud-client` 是**独立打包**的插件（产物自包含、零 import），
 * 拿不到本模块的导出，而它自己也订阅着同一条 `/api/kv/events`。把共享订阅挂到全局后，
 * 插件在浏览器里先找它、找到就复用；找不到（别的宿主 / 单测）就退回自己开一条 ——
 * 与 sharedGlobals.ts 同一套理由。
 */

/** 服务端广播的变更事件形状（cloud-server 只报"哪个 key 变了"，不带值） */
export interface KvChangeEventLike {
  type: string
  key: string
}

type KvEventListener = (e: KvChangeEventLike) => void

/** SSE 端点：与 cloud-server 的 routes/events.ts 定死的那条一致 */
export const KV_EVENTS_PATH = '/api/kv/events'

/** 跨 bundle 共享用的全局键（外部插件靠它复用本应用的连接） */
export const KV_EVENTS_GLOBAL_KEY = '__miniCanvasKvEvents'

/** 挂在全局上的共享订阅形状（外部 bundle 按这个签名调用） */
export interface SharedKvEventsRegistry {
  subscribe(path: string, onEvent: KvEventListener): () => void
}

/** 每个路径一条连接：插件可能连到别的 cloud-server（设置里的"服务地址"），不能混用 */
const sharedByPath = new Map<string, { source: EventSource; listeners: Set<KvEventListener> }>()

/**
 * 按路径取（或开）共享连接并订阅。
 *
 * 同路径只有一条连接 —— 这是本模块存在的全部意义：无论几个模块订阅，
 * 浏览器那 6 条并发额度只被占掉一条。
 */
function subscribePath(path: string, onEvent: KvEventListener): () => void {
  if (typeof EventSource === 'undefined') return () => {}
  const entry = entryFor(path)
  if (!entry) return () => {} // 连不上（构造抛错）：安静降级，不把调用方带崩
  entry.listeners.add(onEvent)
  let closed = false
  return () => {
    if (closed) return
    closed = true
    const cur = sharedByPath.get(path)
    if (!cur) return
    cur.listeners.delete(onEvent)
    // 最后一个订阅者走了才关连接：别的模块可能还在听
    if (cur.listeners.size === 0) {
      cur.source.close()
      sharedByPath.delete(path)
    }
  }
}

/** 取（或建）某路径的共享连接；建不起来返回 undefined */
function entryFor(path: string): { source: EventSource; listeners: Set<KvEventListener> } | undefined {
  const existing = sharedByPath.get(path)
  if (existing) return existing
  try {
    const listeners = new Set<KvEventListener>()
    const entry = { source: openSource(path, () => sharedByPath.get(path)), listeners }
    sharedByPath.set(path, entry)
    return entry
  } catch {
    return undefined
  }
}

/**
 * 订阅云端 KV 变更；返回取消函数。
 *
 * 无 EventSource（node 测试 / 极端环境）→ 返回 no-op dispose，不抛错
 * （与既有各 watch 函数的容错口径一致：首屏不能因为订阅不上就白屏）。
 */
export function subscribeKvEvents(onEvent: KvEventListener): () => void {
  return subscribePath(KV_EVENTS_PATH, onEvent)
}

function openSource(path: string, lookup: () => { listeners: Set<KvEventListener> } | undefined): EventSource {
  const es = new EventSource(path)
  es.onmessage = (ev: MessageEvent<string>): void => {
    let event: KvChangeEventLike
    try {
      event = JSON.parse(ev.data) as KvChangeEventLike
    } catch {
      return // 坏帧忽略，不打断订阅
    }
    if (!event || typeof event.type !== 'string' || typeof event.key !== 'string') return
    const entry = lookup()
    if (!entry) return
    // 先快照再遍历：订阅者在回调里退订不会影响本轮分发
    for (const listener of [...entry.listeners]) {
      try {
        listener(event)
      } catch {
        /* 单个订阅者出错不该打断其它订阅者 */
      }
    }
  }
  return es
}

/**
 * 把共享订阅挂到全局，供**外部插件 bundle**（plugin-cloud-client）复用。
 * 幂等；宿主没挂也能正常工作（插件会退回自己开一条连接）。
 */
export function exposeSharedKvEvents(
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): void {
  if (target[KV_EVENTS_GLOBAL_KEY] !== undefined) return
  const registry: SharedKvEventsRegistry = { subscribe: (path, onEvent) => subscribePath(path, onEvent) }
  target[KV_EVENTS_GLOBAL_KEY] = registry
}

/**
 * 测试专用：丢掉所有共享连接与订阅者。
 *
 * 为什么必须给测试留这个口子：共享连接是**模块级状态**，跨用例存活 ——
 * 上一个用例留下的订阅会让下一个用例"复用到旧连接"而看不到自己新建的那条
 * （实测：FakeEventSource.instances[0] 取到 undefined）。生产代码不该调它。
 */
export function __resetKvEventsForTests(): void {
  for (const entry of sharedByPath.values()) {
    try {
      entry.source.close()
    } catch {
      /* 关不掉也要清掉映射，否则下一个用例会拿到死连接 */
    }
  }
  sharedByPath.clear()
}

