/**
 * CanvasDocumentPool —— **一个画布一个实例**，全进程共用。
 *
 * ## 为什么必须有（2026-10-14 真机复现）
 *
 * CanvasDocument 的写锁（runExclusive）是**实例字段**，它存在的理由是：
 * 每次写都是「读全量 → 改 → 写全量」，两个写方并发时各自读到同一份旧数据、
 * 各自写回只有自己那点改动的结果 —— 后写的把先写的整个盖掉。
 *
 * 可路由那几处原本是**每次请求现建一个** `new CanvasDocument(store, resources, canvasId)`
 * （server.ts 的 docForCanvas / onArtifact / MCP 取文档，builtins/routes.ts 的下面两处）。
 * 实例不同 = 锁不同 —— 于是「两者都收进同一把写锁」这句注释在**非默认画布上不成立**。
 *
 * 后果与用户报的现象一致：任务正在写进度（后台）的同时，网页端保存一次画布，
 * 前者的终态帧就被后者的旧快照盖回去 —— 任务在后台明明 done 了，节点上却永远停在
 * 「生成中 60%」。默认画布不会这样（全进程就那一个实例），所以这个坑只咬用户自建的画布。
 *
 * ## 做法与边界
 *
 * 按 canvasId 缓存实例。锁因此跨请求有效 —— 这才是文件头承诺的语义。
 * 缓存的是**无状态的门面**（只持有 store / resources 引用与画布 id），所以不担心陈旧：
 * 真正的数据每次写都现读磁盘（CanvasDocument 不缓存画布内容）。
 * 代价是 map 会随画布数增长 —— 每项只是一个字符串 + 两个对象引用，可忽略。
 */
import { CanvasDocument } from './canvasDoc.js'
import type { CanvasStore } from '../store/canvasStore.js'
import type { CanvasResourceStore } from '../store/canvasResources.js'

export class CanvasDocumentPool {
  private readonly docs = new Map<string, CanvasDocument>()

  constructor(
    private readonly store: CanvasStore,
    private readonly resources: CanvasResourceStore,
    /**
     * 预登记的实例（默认画布那份由 server.ts 先建好、多处共用）。
     * 不登记的话 pool 会给 default 另建一个 —— 而 MCP / 任务 / 路由还拿着原来那个，
     * 两条路各自的锁，等于这个池白加。
     */
    seed?: Array<{ canvasId: string; doc: CanvasDocument }>,
  ) {
    for (const s of seed ?? []) this.docs.set(s.canvasId, s.doc)
  }

  /** 取某张画布的文档（同一个 id 永远同一个实例 → 同一把写锁） */
  for(canvasId: string): CanvasDocument {
    let d = this.docs.get(canvasId)
    if (!d) {
      d = new CanvasDocument(this.store, this.resources, canvasId)
      this.docs.set(canvasId, d)
    }
    return d
  }
}
