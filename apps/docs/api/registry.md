# 注册场（Registry）

`ctx.registryOf<T>('种类')` 拿到一张**注册场**：按"种类"放一串条目。
它是 `ctx` 自带的方法，**不占服务名**；画布那套 `ctx.nodes` / `ctx.theme` 只是它的语法糖。

```ts
const field = ctx.registryOf<Entry>('node/region')
field.add('image/out:top', value, { id: 'my-entry', order: 10 })
```

## 写

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `add` | `add(key, value, opts?: { id?, order? }): { id, dispose() }` | 放一条；同 key 同 id 再放 = 替换；返回撤销句柄 |
| `remove` | `remove(key, id): boolean` | 摘掉该 id 最外一层；不存在返回 `false` |
| `clear` | `clear(key): void` | 清空某个键 |
| `clearByPrefix` | `clearByPrefix(prefix): void` | 清空某前缀下全部键 |

## 读

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `list` | `list(key): Entry<T>[]` | 整摞，按 order 升序（**第一条 = 最外层 / 优先级最高**） |
| `top` | `top(key): Entry<T> \| undefined` | 单赢家 = order 最小者 |
| `get` | `get(key, id): Entry<T> \| undefined` | 按 id 精确取 |
| `has` | `has(key): boolean` | 某键有没有条目 |
| `ids` | `ids(key): string[]` | 某键下全部条目 id |
| `keys` | `keys(): string[]` | 已有条目的键列表 |

## 组合与订阅

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `wrap` | `wrap(key, fn: (inner, entry) => T, opts?): Disposable` | 包住下一层（缺省放最外）；返回撤销句柄 |
| `resolve` | `resolve(key, base?): T \| undefined` | 从里到外逐层套完的结果；场里没条目时返回 `base` 本身 |
| `subscribe` | `subscribe(fn): Disposable` | 场变了通知我（渲染侧重绘用） |

## 条目的形状（`Entry<T>`）

```ts
interface Entry<T> {
  id: string        // 条目身份；同 key 同 id 再放 = 替换
  value: T          // 值（组件 / 命令 / 描述，opaque）
  order: number     // 排序：小 = 在最外 / 覆盖者
  source: string    // 谁放的（插件名 / '<host>' / '<anonymous>'）
}
```

## 两条语义

1. **order 越小 = 越在外层 = 优先级越高。** `list` 按 order 升序，第一条就是覆盖者；`top` 取 order 最小者。同 order 稳定保放入序。
2. **同 id 不覆盖，往栈上叠。** 不同插件用同一个 id 时各成一层（后放的在外），撤销最外层就露出下面那层。同一插件同 id 再 `add` 才是替换自己那层（热更语义）。

## 画布用到的种类（真实键）

| 种类 | 装什么 |
| --- | --- |
| `node/region` | 往某节点某区域挂组件（键 = `type/region`） |
| `selection/region` | 往多选框挂组件 |
| `node/bar` | 节点底栏的动作（`actions/<id>`）与写入器（`appliers/<kind>`） |
| `command` | 命令 |
| `ui` | 设计系统组件目录 |
| `capability` | 组件能力包 |
| `tool` | 模型可调用工具 |
| `node/shell` | 节点外壳覆盖 |
| `clipboard/copy` | 复制内容提供者 |
| `clipboard/paste` | 粘贴内容处理器 |
| `media/creator` | 媒体创建入口 |

真实种类名可从 [活快照](/plugins/live) 或 `ctx.surface()` 读到。

