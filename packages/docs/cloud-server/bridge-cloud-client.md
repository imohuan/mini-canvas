# 对接详解 · Cloud Client 插件

**一句话定位**：`plugin-cloud-client` 是画布与后台之间的**数据桥** ——
存档同步（AI 改画布你这边跟着变）、动作清单（后台加平台前端菜单自动多一项）、
生成任务（下单/进度/取消）、生成历史。它**一行界面都不画**：底栏的皮来自 plugin-bottom-bar，
历史弹窗来自 packages/ui，它只提供数据和服务。

## 这篇能让你做什么

读完并照抄，你会有一个**能连上 cloud-server 的数据桥插件**：云端恢复存档、实时跟随后台的画布变更、
把存储后端切到云端。真实版在此之上叠了动作清单、任务下单、历史服务 —— 接口清单在下面第四节，
接入方式与骨架相同。

## 装上后你会看到

- 打开画布，节点和边从**云端**恢复（不是浏览器本地库）；AI 在后台改画布，你这边实时跟着变。
- 节点底栏的动作按钮变多了 —— 后台注册了哪些平台（文生图/文生视频…），这里就多哪些按钮，前端零改动。
- 点按钮下单生成 → 底栏出现进度 → 完成后结果写进节点（图/视频/文本），全程可取消。
- 生成历史弹窗有数据了（读后台账本），分页、按类型/状态/评分筛选。

## 完整代码（最小骨架）

真实插件把四件事并在一起共用一条 SSE。下面抽出「存档同步」这条主线的最小骨架：

```ts
// 文件：my-cloud-client/src/cloudApi.ts
// 格式：TypeScript 模块（与后台说话的唯一一处）
// 位置：所有 HTTP/SSE 收口在这个类 —— 真实版 = plugin-cloud-client/src/api.ts
export class MyCloudApi {
  private baseUrl: string
  constructor(baseUrl = '') { this.baseUrl = baseUrl }
  setBaseUrl(u: string) { this.baseUrl = u }        // 设置面板改地址立刻生效，不用重装
  absolute(p: string) { return /^https?:/i.test(p) ? p : this.baseUrl + p }

  /** 读画布（节点 + 边 + 视口） */
  async readCanvas(id: string) {
    const res = await fetch(this.absolute('/api/canvases/' + id))
    if (!res.ok) throw new Error('读画布失败 ' + res.status)
    const b = await res.json()
    return { nodes: b.nodes ?? [], edges: b.edges ?? [], view: b.view ?? null }
  }

  /** 增量拉动作清单：带上次版本号，没变只回版本号 —— 可以放心轮询 */
  async fetchActions(ifVersion?: number) {
    const res = await fetch(this.absolute('/api/actions' + (ifVersion ? '?ifVersion=' + ifVersion : '')))
    const b = await res.json()
    return { version: b.version ?? 0, changed: b.changed !== false, actions: b.actions ?? [] }
  }

  /** 下单生成任务 → jobId（后台 TaskManager 调 providers 真正执行） */
  async createJob(input: { canvasId: string; nodeId: string; actionId: string; prompt?: string }) {
    const res = await fetch(this.absolute('/api/jobs'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    const b = await res.json()
    if (!res.ok || !b.jobId) throw new Error(b.error ?? '下单失败')
    return b.jobId as string
  }
}
```

```ts
// 文件：my-cloud-client/src/index.ts
// 格式：TypeScript 模块（前端插件入口）
// 位置：数据桥插件骨架；真实版 = packages/plugins/plugin-cloud-client/src/plugin.ts
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import { MyCloudApi } from './cloudApi'

export const name = 'my-cloud-client'
export const inject = ['doc'] as string[]     // ① 数据桥只硬依赖 doc（读写画布的唯一门）

export function apply(ctx: Context): void {
  const api = new MyCloudApi()
  const doc = ctx.get('doc')!

  // ② 装载时：云端有存档就覆盖本地（AI 改过的），没有就保持现状（首次上云/空）。
  //    这一步在 apply 里同步做，保证宿主继续渲染前数据已经就位。
  void api.readCanvas('default').then(({ nodes, edges }) => {
    if (nodes.length) doc.replaceAll(nodes, edges)
  })

  // ③ 实时跟随：订后台的 SSE 事件流。AI 在后台改了画布 → 推变更过来 →
  //    把变更合并进本地 doc（走正常写口，进历史，可撤销）。真实版在 remoteSync.ts，
  //    合并策略在 applyMerge.ts（按节点 diff，不整包覆盖用户未保存的本地改动）。
  const es = new EventSource(api.absolute('/api/kv/events'))
  ctx.effect(() => () => es.close())          // ④ 卸载自动断开
  es.onmessage = (ev) => { /* 收到变更 → doc 增量合并 */ }

  // ⑤ 换存储后端：存档与资源都指到云端（插件自带 cloudKvAdapter / cloudResourceAdapter）。
  //    save 是可插拔的 —— 换 adapter 这一个动作，刷新/落盘就全走云了。
  const save = ctx.tryGet('save')
  if (save) {
    save.useAdapter('canvas', createMyCloudCanvasAdapter(api))
    save.useAdapter('resource', createMyCloudResourceAdapter(api))
  }

  // ⑥ 对外服务：状态查询 + 手动刷新动作清单（ui 的界面读它）。
  ctx.inject('my-cloud-client', {
    status: () => ({ active: true, baseUrl: '' , actions: 0 }),
    refreshActions: async () => { /* 重拉 /api/actions 并重新注册底栏按钮 */ },
  })
}
```

## 每一步在干什么

1. **只硬依赖 `doc`**：读写画布必须经它。底栏/资源等宿主服务全部 `tryGet` 软探测 ——
   底栏没装就不注册按钮，插件照常工作（存档同步部分不受影响）。
2. **装载时恢复**：云端有存档就 `replaceAll` 覆盖本地。真实版还有「迁移」细节：本地节点存的是
   `res-…` 引用配 `blob:` 地址，首次上云会把字节搬到云端资源目录、把节点字段换成服务器 URL ——
   不然用户的图上不了云（`migrateLocalResources`）。
3. **SSE 跟随**：后台一有变更（AI 改画布 / 任务进度推进）就推事件。合并走 `doc` 正常写口，
   所以这些变更**进历史、可撤销** —— 不是绕过数据层硬改。
4. **`ctx.effect` 包 EventSource**：插件卸载自动断流。不包的话热卸一次就漏一条连接。
5. **换 save 的 adapter**：这是「上云」的本质 —— 存档/资源两种数据的后端从本地（localStorage/IndexedDB）
   换成云端 HTTP。真实版在换之前会抓住本地资源后端（`adapterOf`），首次上云迁移要用它取回字节。
6. **对外只给状态与刷新**：界面弹窗读 `cloud-client:history` 服务（分页查账本），底栏按钮由动作清单 diff 出来。

## 它调的后台接口（真实枚举）

| 接口 | 干什么 |
| --- | --- |
| `/api/canvases/:id`（GET/PUT） | 画布本体（节点+边+视口）读写 |
| `/api/canvases/:id/resources`（POST/GET） | 画布资源上传与回读（字节落云端目录） |
| `/api/jobs`（POST）· `/api/jobs/:id`（GET）· `/jobs/:id/cancel`（POST） | 任务下单/查单/取消 |
| `/api/jobs/active?canvasId&nodeId` | 某节点有没有在跑的任务（挡住重复下单） |
| `/api/actions?ifVersion=N` | 动作清单（带版本增量拉） |
| `/api/history` | 生成历史（分页 + 汇总） |
| `/api/kv/events` | SSE 实时事件（画布变更 / 任务进度 / 队列 / 目标） |
| `/api/kv/:type/:key` | 小数据（设置/快捷键映射；画布数据不在这里） |

## 它注入的三个服务（别的插件这样消费它）

| 服务名 | 形状 | 谁在用 |
| --- | --- | --- |
| `cloud-client` | `status()` / `refreshActions()` | ui 的设置页与诊断 |
| `cloud-client:history` | `query(分页筛选)` / `subscribe(fn)` | ui 的生成历史弹窗 |
| `cloud-save` | `status()` / `sync()` | 自动保存/云端保存的显示 |

## 与后台插件系统的握手点

底栏动作是**后台动作清单驱动**的：后台 providers 注册了什么平台，`/api/actions` 就返回什么，
前端 diff 后往 `node/bar` 场放按钮（经 bottom-bar 的注册糖）—— 后台加平台，前端一行不改。
你自己写后台插件时经 `ctx.routes` 加的接口，前端想调就照这个模式把 fetch 收口在一个 Api 类里。

## 源码出处

| 这篇里的做法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| 全部请求收口一个类 | `packages/plugins/plugin-cloud-client/src/api.ts` | CloudApi：动作/任务/历史/画布/资源/SSE |
| 增量拉动作清单 | 同上 `fetchActions(ifVersion)` | 没变只回版本号 |
| 存档恢复 + 首次上云迁移 | `src/plugin.ts`、`src/restore.ts`、`migrateLocalResources` | 云端覆盖本地；本地资源搬上云换 URL |
| SSE 跟随与合并 | `src/remoteSync.ts`、`src/applyMerge.ts` | 事件 → doc 增量合并（进历史） |
| 换存储后端 | `src/cloudResourceAdapter.ts`、`cloudKvAdapter.ts` | `save.useAdapter(...)` 指向云端 |
| 动作 → 底栏按钮 | `src/actions.ts`（toBarAction/diffActions） | diff 出新增/失效动作，注册进 node/bar |
| 三个服务注入 | `src/plugin.ts:346-354` | `cloud-client:history` / `cloud-client` / `cloud-save` |
| 插件管理页（同包另一入口） | `src/manager/pluginManagerPlugin.ts` | 设置面板「插件」页，读 `/plugin-catalog.json` |

## 常见坑

1. **硬依赖底栏**：底栏是可选插件。要用它的注册糖就 `tryGet` + 等 `ctx:plugin-installed`，
   别写进 `inject` —— 不然两个好插件绑死，单独装任何一个都起不来。
2. **绕过 doc 直接改画布**：SSE 收到的变更必须走 doc 的写口（进历史、可撤销）；直接改 store 会导致
   撤销栈错乱、落盘缺失。
3. **首次上云不迁移资源**：本地 `blob:` 地址后台拿不到，直接整包推 = 图全丢。先按引用取回字节传云端，
   再换 URL（真实版连「已经传过的图」都做了去重标记）。
4. **EventSource 不包 effect**：热卸一次漏一条连接；面板多开几次后台就挂着一堆死流。
5. **请求散在各处**：后台地址要能改（设置面板那项），fetch 必须收口一个类，换地址改一个变量。
