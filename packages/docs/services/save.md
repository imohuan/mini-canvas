# `save` · 键值持久化

**一句话定位**：`ctx.get('save')` 是"把东西存下来、下次打开还在"的唯一入口 ——
你只管 `set`，什么时候真正落盘由它统一安排。

**它属于哪一档**：**画布基础**。由 `canvas-base` 这一件基础插件建好并上架
（见 `packages/canvas-data/src/canvas/canvasBasePlugin.ts` 里的 `ctx.inject('save', save)`）；
接口定义在 `packages/canvas-data/src/storage/types.ts`，实现在 `packages/canvas-data/src/storage/SaveService.ts`。

## 用法

### 类型：`SaveType`（四个抽屉名）

~~~ts
type SaveType = 'config' | 'canvas' | 'resource' | 'shortcut'
~~~

| 抽屉 | 装什么 | 举例 |
| --- | --- | --- |
| `config` | 这台设备/这个用户的偏好 | 主题、面板宽度 |
| `canvas` | 这张画布的内容 | 节点图、边、视口位置 |
| `resource` | 二进制大文件（图片/视频/音频） | 上传的原始字节 |
| `shortcut` | 改过的快捷键 | 命令 id → 键位表 |

`set` / `get` / `remove` 的 `type` 参数**缺省是 `'config'`**。存画布内容一定要显式写 `'canvas'`。

### 方法清单

| 方法 | 一句话 | 什么时候用 |
| --- | --- | --- |
| `set(key: string, value: unknown, type?: SaveType): void` | 入队一次写，**同步返回**（真正落盘在稍后的 flush） | 任何"要留下来"的改动 |
| `get<T>(key: string, type?: SaveType): Promise<T \| undefined>` | 读；没存过返回 `undefined` | 启动时读回上次的值 |
| `remove(key: string, type?: SaveType): Promise<void>` | 删；同时把它从脏队列里也清掉 | 重置某项 |
| `flush(): Promise<void>` | 立刻把脏队列落盘 | 想确保"现在就写完"（比如切画布前） |
| `isDirty(): boolean` | 还有没有没落盘的 key | 定时兜底保存的判据 |
| `useAdapter(type: SaveType, adapter: StorageAdapter \| ResourceAdapter): void` | 换某个抽屉的后端（换完会通知订阅者） | 装云插件时把抽屉切到云端 |
| `onAdapterChange(cb: (type: SaveType) => void): { dispose(): void }` | 订阅"某抽屉换后端了" | 换完后端要重读一次 |
| `adapterOf(type: SaveType): StorageAdapter \| ResourceAdapter` | 取某抽屉现在用的是哪个后端 | 资源库现取资源后端 |

`StorageAdapter` 是文本抽屉的形状：`{ id, capability, get(key), set(key, value), remove(key) }`；
`ResourceAdapter` 是大文件抽屉的形状：`{ id, capability, putResource(blob, opts), resolveResource(ref), removeResource(ref) }`。
两者形状不同是刻意的 —— 文本是"读写 JSON"，资源是"存字节、按引用换地址"，硬塞进一个接口会让双方都写废码。

### 内置的两个适配器

| 适配器 | 在哪 | 特点 |
| --- | --- | --- |
| `MemoryStorageAdapter` | `packages/canvas-data/src/storage/memoryAdapter.ts` | 纯内存，进程关了就没；`save` 的默认后端 |
| `LocalStorageAdapter` | `packages/canvas-data/src/storage/localStorageAdapter.ts` | 浏览器 local storage；成品应用默认用它 |

成品应用换后端的写法只有一行，在 `packages/ui/src/assembly.ts`：

~~~ts
/** 建一份成品应用默认的存储后端（本地 localStorage）。要换存储就换这里的实现。 */
export function createDefaultStorageAdapter(): StorageAdapter {
  return new LocalStorageAdapter()
}
~~~

画布内容存在哪几个 key 上也是公开的常量（`packages/canvas-data/src/storage/keys.ts`）：
`GRAPH_KEY = 'graph'`（节点）、`GRAPH_EDGES_KEY = 'graph-edges'`（边）、
`GRAPH_VIEWPORT_KEY = 'graph-viewport'`（视口），三个都在 `canvas` 抽屉里。

**硬依赖写在模块顶层**：

~~~ts
export const inject = ['save'] as string[]
~~~

## 注意事项

1. **`set` 之后不 `flush`，刷新页面就可能丢。**
   `set` 只把值放进脏队列，真正落盘要等一次 `flush`（由它内部的防抖计时器触发；
   同一轮里多次 `set` 会被合并成一次写）。
   浏览器里这套已经接好了（`CanvasHost.vue` 在 `visibilitychange` / `pagehide` 时 flush），
   但在 Node 脚本、测试、或"用户点了就跳走"的流程里，必须自己 `await save.flush()`。
   项目为此专门修过一个 bug：`flush` 以前没有串行化，两次并发调用里后一次会立刻返回，
   于是"await flush 完再跳转"根本没等到真正的写 —— 现在 `flush` 会先等上一次写完
   （见 `SaveServiceImpl.flush` 的注释）。

2. **四个抽屉各自一个后端，换一个不影响别个。**
   `useAdapter('config', 云端)` 只换 `config`。资源适配器（只有 `putResource` 那种）
   **只能**放进 `resource` 那一格 —— 它没有 `get/set/remove`，铺到别处会让文本读写全炸，
   `SaveServiceImpl.useAdapterForAll` 里专门写了这个判断。

3. **`useAdapterForAll` 不在插件的类型面上。**
   `ctx.get('save')` 的类型是 `SaveService`，里面**没有** `useAdapterForAll` 和 `dispose` ——
   那两个是 `SaveServiceImpl` 类上的方法，只有宿主（`host.save`）拿得到。
   插件侧换后端请用 `useAdapter(type, adapter)`。

4. **key 会被改成小写并加类型前缀。**
   `save.set('MyKey', 1, 'canvas')` 实际存的物理 key 是 `canvas:mykey` ——
   大小写不同、或者少了前缀，读的时候就找不到。少写 `type` 更隐蔽：
   默认是 `'config'`，于是"存的 key 和读的 key 一字不差"却读不回来，
   因为一个在 `config:` 一个在 `canvas:`。

5. **读不到时返回 `undefined`，不抛 —— 但"没存过"和"存了一个 `undefined`"分不开。**
   这是 `ctx.get` 家族的一贯语义（缺服务也是返回 `undefined`）。要区分"从没保存过"和"保存过空值"，
   得存一个显式的空值（比如空数组）当标记 —— 宿主的画布恢复就是这么做的：
   `packages/canvas-render/src/host/createMiniCanvasHost.ts` 里专门判断 `saved === undefined` 才算"从未保存过"。

