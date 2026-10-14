# 服务 `text`

> 插件：文本节点 text · [返回总览](/plugins/parsed/node-text/)

**一句话**：本插件注册的服务名是 `text` —— 建文本节点、改文本、复制节点都走它。

## 怎么拿

```ts
const text = ctx.get('text')      // 组件里用这个
```

> 根 ctx **没有**属性代理，别直访 `ctx.text`。类型增强（`declare module`）只给类型，运行时要用 `ctx.get`。

## 类型

源码里的 `TextNodeService` 接口，与实现类 `TextService extends Service` 一一对应：

```ts
export interface TextNodeService {
  addTextNode(position: { x: number; y: number }): string
  editText(id: string, text: string): void
  duplicateTextNode(id: string): string
}
```

## 它依赖什么

`doc`（数据唯一写入口）。方法内 `this.ctx.get('doc')` 惰性取、不缓存；
`doc` 也写在模块级 `inject` 里（硬依赖，缺了插件停在 PENDING）。

## 函数逐条

### `addTextNode(position)`

| 项 | 内容 |
| --- | --- |
| 签名 | `addTextNode(position: { x: number; y: number }): string` |
| 参数 | `position`：新节点左上角在画布坐标系里的位置 |
| 返回 | 新节点的短 id（字符串） |
| 干什么 | 在一次事务（`'add-text-node'`）里建一个 `text` 节点，内容写 `'双击编辑'` |
| 何时用 | 要在画布上放一个文本节点（右键菜单、导入、脚本都走它） |

```ts
// 位置：在 (120, 80) 放一个文本节点
const id = ctx.get('text').addTextNode({ x: 120, y: 80 })
```

### `editText(id, text)`

| 项 | 内容 |
| --- | --- |
| 签名 | `editText(id: string, text: string): void` |
| 参数 | `id`：节点 id；`text`：新的文本内容 |
| 返回 | 无 |
| 干什么 | 经 `doc.updateNode@@ 改 `data.text`（进历史、自动落盘，可撤销） |
| 何时用 | 内容组件编辑完写回；或程序化改文本 |

> 内容组件 `TextContent.vue` 编辑完调的就是它。

### `duplicateTextNode(id)`

| 项 | 内容 |
| --- | --- |
| 签名 | `duplicateTextNode(id: string): string` |
| 参数 | `id`：被复制的节点 id |
| 返回 | 新节点 id；**源节点不存在时返回空串** |
| 干什么 | 抄来源节点的 `data.text`（只带这一个业务字段），落在源节点右下 24px，包一次事务 |
| 何时用 | 复制动作 / `text.duplicate` 命令 |

> 为什么只带 `text` 不整包拷 `data`：避免把 `_overlay` 这类会话态一起复制过去。

## 注意事项

1. **写数据永远经 `doc`**：这三个方法内部都走唯一写入口，自带历史与落盘。
2. **方法内的 `ctx.get` 是惰性取现时服务**（不缓存）：避免卸载残留 / 换实例时拿到旧引用。
3. **`duplicateTextNode` 源不存在返回空串**（不抛）：调用方要判空。

