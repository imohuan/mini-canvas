# 注册场：加功能不用加服务

这是整套设计里最核心的一招。看懂这一篇，你就明白为什么加新功能**不用再改核心、不用再加 API**。

## 先说病根

老写法是：想加一类新东西，就新写一个服务。

要给节点加按钮 → 新服务 `nodeButton`；要加进度条 → 新服务 `progress`；
要加工具栏 → 新服务 `toolbar`……每加一样，就要多一个服务名、多一套 API、多一份文档。
**功能越堆越多，API 就越堆越多**，这就是作者说的"混乱"。

## 新写法：一张表

注册场就是"**按种类放一串条目**"。它**不是服务**，不占服务名，
它是 `ctx` 自带的一个方法：

```ts
const field = ctx.registryOf<条目的类型>('种类名')
field.add('键', 值, { id: '我的条目', order: 10 })
```

要加一类新东西？**报一个新种类名就行**，不用改内核、不用加服务。

## 条目长什么样

放进场里的每一条，都是这个形状：

```ts
interface Entry<T> {
  id: string        // 条目的身份；同 id 再放 = 替换，不是新增
  value: T          // 值（组件、命令、配置……）
  order: number     // 排序：小 = 在外层 / 优先级高（谁"赢"看它）
  source: string    // 谁放的 ←── 专门用来回答"这条到底是谁加的"
}
```

`source` 这一项很关键。以前出问题最难查的就是"这东西谁放的"，现在每条都自带答案。

## 场的完整方法

```ts
interface Registry<T> {
  // 写
  add(key, value, opts?: { id?, order? }): { id, dispose() }
  remove(key, id): boolean
  clear(key): void

  // 读
  list(key): Entry<T>[]        // 整摞，order 升序（第一条 = 最外层/优先级最高）
  top(key): Entry<T> | undefined   // 单赢家（order 最小者）
  get(key, id): Entry<T> | undefined
  has(key): boolean
  ids(key): string[]
  keys(): string[]             // 这个种类下有哪些键

  // 组合与订阅
  wrap(key, fn, opts?): Disposable   // 包住下一层，做"链式叠加"
  resolve(key): T | undefined        // 从里到外逐层套完的结果
  subscribe(fn): Disposable          // 变了通知我（渲染侧重绘用）
}
```

## 键是"路径"，不是普通字符串

键可以写得很具体，也可以写通配：

```
node/shell/image     精确：只有 image 这种节点
node/shell/*         通配：所有节点
node/shell           默认：兜底
```

查找的时候**从最精确往最粗找**：先精确，再通配，最后默认。
所以"给所有节点加一层"和"只给图片节点加一层"能共存，互不打架。

## order 的方向（最容易搞错的一条）

**order 越小 = 越在外层 = 优先级越高。**

- 单赢家的槽（比如"节点外壳用哪个组件"）：order 最小者获胜。
- 可叠多层的槽（比如"卡片内部叠什么"）：`list` 按 order 升序，第一条在最外。

想替换别人的东西，不需要删掉别人，只要放一条 order 更小的。
**底层永远还在** —— 这正是"换皮"能安全生效的前提。

## 真实例子：节点上的东西就是这么放的

你在节点上看到的**上控制栏 / 下控制栏 / 状态栏**，全都是往注册场里放条目。真实种类名如下
（下面这些是从**跑起来的画布**里读出来的，不是编的）：

| 种类名 | 装什么 | 例子 |
| --- | --- | --- |
| `node/type` | 节点类型的声明摘要 | 文本节点、图片节点 |
| `node/region` | 往某节点的某**区域**挂组件 | 状态栏覆盖层 |
| `selection/region` | 往**多选框**挂组件 | "加入资产库"、"引用到 Agent" |
| `node/bar` | 节点**状态栏上的动作** | 下载、旋转、删除 |
| `node/bar-applier` | 某种动作的"执行体" | 图片类动作怎么跑 |
| `command` | 命令 | 删除、对齐、复制 |
| `theme` | 主题槽 | 节点外壳、连线、背景 |
| `slot` | 通用 UI 槽 | 小地图、设置页签 |
| `ui` | 设计系统组件目录 | 按钮、下拉、滑块 |
| `capability` | 组件能力包 | `node` / `zoom` / `selection` |

写插件时，这一行就够：

```ts
// 往"所有节点"的"卡片内部"挂一个组件
ctx.nodes.attach('*', { region: 'in', component: MyOverlay, id: 'mine' })

// 往"图片节点"的"上控制栏"挂一个按钮
ctx.nodes.attach('image', { region: 'out:top', component: MyButton, id: 'mine:top' })

// 往多选框的上控制栏挂一项
ctx.selectionRegion.attach({ region: 'out:top', component: AddToAssets, id: 'assets' })
```

注意上面用的 `ctx.nodes.attach` / `ctx.selectionRegion.attach` 是**语法糖**，
它们的落点就是注册场（`node/region` 与 `selection/region`）。

## 为什么要"糖"和"场"两条路都对

你可能会想：直接 `ctx.registryOf('node/region').add(...)` 不就行了，为什么要糖？

因为作者写代码时想的是"**给图片节点的上栏加个按钮**"，不是"往 `node/region` 场
的 `image/out:top` 键加一条"。糖负责把前者翻译成后者，落点仍然是同一个场。

好处是：**不管走哪条路，自省看到的都是同一份真相**。
这就是为什么文档能准确列出"注册了什么" —— 它直接读场，不用猜。

## 一句话总结

**"一张表"是场，"一个能手"是服务。**
加一批同类东西 → 注册场；加一个会换实现的能力 → 服务。
