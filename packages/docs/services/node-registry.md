# `nodeRegistry` · 节点展示表

**一句话定位**：`ctx.get('nodeRegistry')` 回答一个问题 —— **"这种节点的这个位置，用哪个组件画？"**

**它属于哪一档**：**画布基础**。由 `canvas-base` 基础插件建好并上架
（见 `packages/canvas-data/src/canvas/canvasBasePlugin.ts` 里的 `ctx.inject('nodeRegistry', nodeRegistry)`），
但宿主也可以**自建一个传进去**（渲染宿主 `CanvasHost.vue` 就是这么做的）。
实现在 `packages/canvas-data/src/canvas/registry/nodeRegistry.ts`。

## 用法

### 两种写法，先分清

| 你想干的事 | 用哪个 | 落点 |
| --- | --- | --- |
| 注册一种节点（数据 + 展示一次搞定） | `ctx.nodes.register({...})` | 数据落 `doc`，展示落 `nodeRegistry` |
| 往某类型的某位置**叠**一个组件 | `ctx.nodes.attach(type, { region, component })` | `node/region` 注册场 |
| 直接读写这本说明书 | `ctx.get('nodeRegistry')` | 就是本页这个服务 |

**给作者的话**：日常几乎只用前两个语法糖。直接摸服务基本只有一种场景 —— **读**（比如底栏要拿节点类型的图标）。

### 方法清单

先看"位置名"。位置只能用**十个区域词**（`packages/canvas-data/src/canvas/region.ts` 是唯一来源）：

| 区域词 | 位置 |
| --- | --- |
| `in` | 卡片**内部**（最常用） |
| `title` | 卡片**标题**那一行 |
| `out:top` / `out:bottom` / `out:left` / `out:right` | 卡片**外面**的上/下/左/右（上控制栏、下控制栏在这） |
| `on:top` / `on:bottom` | 贴在卡片**边上**的上/下 |
| `over:inset` / `over:outset` | 卡片内/外的**覆盖层** |

老位置名（`content` / `top-toolbar` / `bottom-toolbar` / `overlay`）**已下线**：
类型上是字段不认识，运行时传进去会**当场抛错**并列出全部合法词。不留映射、不做归一 ——
静默忽略会表现成"注册成功了却什么都不显示"，比报错难查得多。

然后是方法：

| 方法 | 一句话 | 什么时候用 |
| --- | --- | --- |
| `register(type: string, segments: Partial<Record<NodeSegment, unknown>>): void` | 注册某类型的展示定义；**该类型已注册过就抛错** | 节点插件声明"我长什么样" |
| `get(type: string): NodePresentation \| undefined` | 取某类型的展示定义 | 想知道某类型有没有登记 / 拿了哪些位置 |
| `unregister(type: string): void` | 注销某类型（不存在也不报错），连带清掉它所有叠加 occupant | 热卸插件时回收 |
| `has(type: string): boolean` | 这个类型登记过没有 | 判断依据 |
| `types(): string[]` | 已登记的 type 列表 | 诊断 / 遍历 |
| `set(type, segments): void` | **覆盖式**重设某类型（没有就新建） | 宿主升级 / 热更；与 `register` 的区别是**已存在也照写** |
| `subscribe(listener: () => void): () => void` | 订阅本表任意变化（基座或叠加 occupant 任一变化都触发），返回取消函数 | 渲染宿主在运行期重装配 |

### 段级叠加（一个位置叠多个）

| 方法 | 一句话 | 什么时候用 |
| --- | --- | --- |
| `registerContribution(type, segment, req: NodeSegmentContribution): string` | 往某类型某位置叠一个 occupant（同 id 已存在 = **替换那一格**，否则追加）；返回 occupant id | 多插件往同一个位置叠东西 |
| `unregisterContribution(type, segment, id): boolean` | 移除一个叠加 occupant；不存在也不报错 | 热卸插件时回收 |
| `contributionIds(type, segment): string[]` | 某位置已叠的 occupant id 列表 | 诊断 / 热卸 |
| `contributionOccupants(type, segment): Array<{ id, order, component }>` | 某位置当前全部 occupant（按 `order` **升序**） | 渲染某一摞 |

`NodeSegmentContribution` 是 `{ id?, order?, component }`。

读回时**每个 id 只出现一条**（同一个 id 叠了多层时，看得见的是最外层那条）：
写成同一个 id 就是"在这个格子里再盖一层"，而不是"多一条并列的条目"。
想同时出现两个，请给两个不同的 id。

> **`order` 的方向**：**越小 = 越在外 / 优先级越高**。可以叠多层的槽里，
`contributionOccupants` 返回的数组就是按 `order` **升序**（第一条在最外）。
基座（`register` 时给的那个组件）**永远是第一层**，叠加层排在它之后。
新增 occupant 不给 `order` 时的缺省值 = 已有最大 `order` + 1（第一条排在基座之后）。

### 渲染侧怎么读这本说明书

这不是服务的方法，但是配套的读法（都在 `@mini-canvas/canvas-data` 里导出）：

| 函数 | 一句话 |
| --- | --- |
| `resolveSegment(registry, type, segment)` | 只取**基座**那一个组件（单值语义） |
| `nodeSegmentStackEntries(registry, type, segment)` | 取"基座 + 全部叠加"的完整栈，每项带稳定 `id`（渲染时当 key 用） |
| `nodeRegionStackEntries(registry, regionField, type, region)` | 把 `nodeRegistry` 与 `node/region` 注册场**合成同一摞**（真实外壳走的是这条） |
| `activeSegments(registry, type)` | 某类型有哪些位置要渲染 |

**硬依赖写在模块顶层**：

~~~ts
export const inject = ['nodeRegistry'] as string[]
~~~

## 注意事项

1. **`register` 对同一个 type 会抛错，`set` 不会。**
   `register` 是"声明"，重复声明说明两个插件抢同一种节点，必须响亮地失败
   （错误消息是 `presentation for node type "xxx" already registered`）。
   `set` 是"覆盖"，给宿主升级 / 热更用。作者侧不要用 `set` 去抢别人的类型 ——
   那会静默顶掉别人，出问题时什么都查不到。

2. **老位置名会当场抛错，不会静默。**
   `content` / `top-toolbar` / `bottom-toolbar` / `overlay` 四个老段名已下线。
   写它们时 `assertRegion` 会抛错并列出全部十个合法区域词。
   这不是"没兼容"，而是刻意的：静默丢弃会表现成"注册成功了却什么都不显示"。

3. **`order` 越小越在外，单赢家槽取最小者。**
   这是全项目统一的一条方向（注册场那一篇也讲过）。想顶掉别人的东西，
   **不需要删掉别人**，只要放一条 `order` 更小的 —— 底层永远还在，
   卸掉你的插件它立刻就回来了。这是"换皮能安全生效"的前提。

   叠加 occupant 的缺省 `order` = 已有最大值 + 1，也就是"排在现有叠加层最后"；
   基座永远在它们之前。

4. **`ctx.get('nodeRegistry')` 缺服务返回 `undefined`，不抛。**
   它在**纯数据宿主**里真的会缺席（基础插件允许不装它，跑单测只落数据时就是这样）。
   想写"有就叠、没有就算"的插件用 `ctx.tryGet('nodeRegistry')`（底栏插件就是这么拿图标的）；
   硬依赖请写 `export const inject = ['nodeRegistry']`。

5. **`unregister(type)` 会连带清掉该类型的所有叠加层。**
   这是刻意的：类型都没了，还留着它的 occupant 就是垃圾。
   反过来要注意 —— `unregisterContribution` 只摘你那一格，别人的基座与叠加都原位保留。
   插件热卸时走的是各自的回收路径（`ctx.effect`），作者不用手写。

