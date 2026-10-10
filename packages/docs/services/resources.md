# `resources` · 资源

**一句话定位**：`ctx.get('resources')` 管画布上的**大文件**（图片、视频、音频）——
把字节存好、拿到一个稳定的"引用"，要用的时候再把引用换成一个能显示的地址。

**它属于哪一档**：**画布基础**。由 `canvas-base` 基础插件建好并上架
（见 `packages/canvas-data/src/canvas/canvasBasePlugin.ts` 里的 `ctx.inject('resources', resources)`）；
接口与实现在 `packages/canvas-data/src/resourceService.ts`。

## 用法

### 方法清单

| 方法 | 一句话 | 什么时候用 |
| --- | --- | --- |
| `put(blob: Blob, opts?: ResourcePutOptions): Promise<string>` | 存一份字节，返回**持久引用** | 上传、生成出图，一切"要长期留着的字节"，这是统一入口 |
| `resolve(ref: string): Promise<string \| undefined>` | 持久引用 → 当前可显示的地址 | 渲染前把 `resourceId` 换成能用的 url |
| `get(id: string): ResourceEntry \| undefined` | 按 id 取条目（`{ id, kind, url, resource? }`） | 想看这条资源的元信息 |
| `url(id: string): string \| undefined` | 按 id 取 URL（同步） | 已经登记过、只要地址 |
| `alive(id: string): boolean` | 这条资源还活着吗 | 诊断 / 回收前检查 |
| `ids(): string[]` | 当前全部资源 id | 遍历 / 诊断 |
| `revoke(id: string): boolean` | 注销一条并回收它的 URL；返回是否真回收 | 某条资源确定不再需要 |
| `revokeByResource(resource: unknown): number` | 注销"句柄等于给定值"的全部条目 | 节点 data 里握着同一个 Blob 引用时 |
| `revokeByKind(kind: string): number` | 按 kind 批量回收（如删 image 节点时 `kind='image'`） | 按种类整批清 |
| `disposeUnreferenced(referenced: ReadonlySet<string>): number` | 回收"没被给定 id 集合引用"的全部条目 | **删节点后回收**的标准做法 |
| `dispose(): void` | 全量回收 | 宿主停止 / 画布销毁 |
| `flush(id: string): Promise<void>` | 等某条资源的字节真正写进持久化存储 | 上传后要确保"确实存进去了" |
| `restore(id: string, kind?): Promise<string \| undefined>` | 刷新后按引用重建显示地址（与 `resolve` 同一件事，名字强调"载入时重算"） | 打开画布时恢复媒体 |
| `register(input: RegisterResourceInput): string` | **旧接口**：登记一个已经拿到的地址（不落字节） | 只在"地址已有、只想统一回收"时用 |

`ResourcePutOptions` 只有两个字段：`kind?`（`'image'` / `'video'` / `'audio'` / `'text'` / 自定义）
与 `name?`（原始文件名，供后端推断扩展名）。

### 两条最重要的规矩

**规矩一：节点里只存引用，不存地址。**

~~~ts
// 对：引用是稳定的，地址要现取
const resourceId = await resources.put(blob, { kind: 'image', name: file.name })
const url = await resources.resolve(resourceId)
doc.updateNode(id, { data: { resourceId, imageUrl: url } })
~~~

`imageUrl` 是给这一次渲染用的**临时**地址（本地是 object URL），`resourceId` 才是能跨刷新活下来的那个。

**规矩二：`register` 是旧接口，新代码用 `put`。**

`register` 返回的 id **只在本会话的表里有效，刷新就失效** —— 它不写后端。
它存在的唯一理由是"调用方手里已经有地址了，只想登记进表以便统一回收"。
想"刷新不丢"，必须走 `put`。

### 后端不归它管

`resources` 自己**不持有**资源后端，而是每次现取 `save.adapterOf('resource')`。
这样的好处是：云插件一句 `save.useAdapter('resource', 云端适配器)` 换过去，
资源立刻跟着走，不用重建资源库。没装资源后端时 `put` 会直接抛错 —— **不静默造一个用不了的引用**。

**硬依赖写在模块顶层**：

~~~ts
export const inject = ['resources'] as string[]
~~~

## 注意事项

1. **`register` 返回的 id 刷新就失效。**
   它**不写后端**，只在本会话的表里有效。历史上旧实现在这里偷偷 `put` 过一次，
   结果"返回的 id 与实际落库的引用不是同一个" —— 调用方拿着 id 什么都查不到，
   还留下一份永远回收不掉的孤儿字节。现在不那样做了。要跨刷新，用 `put`。

2. **`put` 在没装资源后端时会抛错。**
   消息是"当前 resource 类型的 adapter 不支持存资源"。这不是 bug，是刻意的：
   宁可在存的时候响亮地失败，也不要返回一个用不了的引用，等用户刷新后才发现图没了。
   极简宿主（纯 Node、单测）要自己注入一个假后端。
   而"**取服务**"这一步不会抛：`ctx.get('resources')` 缺服务只返回 `undefined` ——
   所以硬依赖仍然要写模块顶层 `export const inject = ['resources']`。
   想做"没资源库也能跑"的降级就用 `ctx.tryGet('resources')` 探测，
   **不要**退回去把 base64 塞进节点（`packages/plugins/plugin-node-image/src/imageOps.ts` 里写了"宁可失败，也不退回 base64"）。

3. **`resolve` 给的地址是"当下有效"，别存起来当长期数据。**
   本地后端每次 `resolve` 可能得到**新的** object URL（刷新后内存里的地址没了，会重新建一个）。
   判断"某字段是不是临时地址"的现成工具在同一个文件里：
   `sanitizeTransientResourceUrls`（保存前清掉 `blob:` 与"有 resourceId 的 data:"）与
   `pendingMediaRestoreFields`（判断哪些字段需要重建）。

4. **删了节点不会立刻回收资源 —— 这是刻意的。**
   `resources` 不认识节点，它只知道自己的表。回收动作由宿主在**落盘前**做：
   扫一遍所有存活节点的 `data.resourceId`，再调 `disposeUnreferenced(存活集合)`
   （见 `packages/canvas-render/src/host/CanvasHost.vue` 的 `flushSave`）。
   为什么不在删除的那一刻就回收？因为**撤销要把节点恢复回来**，
   那一刻就 revoke 的话，撤销后图片就是破图（源码里写了这条理由）。
   注意**你自己建的临时资源**（比如预览用的、还没写进节点的）不在这个扫描里，得自己 `revoke`。

5. **`flush(id)` 现在几乎总是立刻返回。**
   `ResourceStore` 里有一张"待写"表，但当前实现里 `put` 走的是 `await adapter.putResource(...)`，
   写完才返回，所以并没有往那张表里塞东西。别指望它替你等一个后台任务 ——
   要确保真的落库了，请 `await put`，而不是 `put` 之后马上 `flush`。

