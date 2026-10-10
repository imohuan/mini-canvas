# ctx.store · 后端私有存储

**一句话定位**：`ctx.store` 给插件一块**自己的持久化命名空间** —— 一个插件一个命名空间，
数据落在 `<数据根>/plugin-data/<插件名>.json`，卸载即清。

**属于哪一档**：后台框架能力段（`packages/cloud-server/src/serverFramework/store.ts`）。

## 用法

```js
// 文件：<数据根>/server-plugins/demo-store.js
export const name = 'demo-store'

export function apply(ctx) {
  const ns = ctx.store.namespace('demo-store')       // 同插件同名多次取 = 同一份
  ctx.routes.post('/api/demo/count', async (c) => {
    const n = (await ns.get('count')) ?? 0
    await ns.set('count', n + 1)
    return c.json({ count: n + 1 })
  })
}
```

## 方法（`ctx.store`）

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `namespace` | `namespace(name: string): PluginStoreNamespace` | 取一个命名空间（同名多次取 = 同一份） |

## 方法（`PluginStoreNamespace`）

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `get` | `get<T = unknown>(key: string): Promise<T \| undefined>` | 读一个键 |
| `set` | `set(key: string, value: unknown): Promise<void>` | 写一个键（值要可 JSON 化） |
| `delete` | `delete(key: string): Promise<boolean>` | 删一个键；不存在返回 `false` |
| `keys` | `keys(): Promise<string[]>` | 全部键 |
| `clear` | `clear(): Promise<void>` | 清空本命名空间（卸载时框架自动调） |

## 注意事项

1. **命名空间名有白名单**：`/^[A-Za-z0-9_.-]{1,64}$/`（防路径穿越）；不合法直接抛。
2. **卸载即清**：命名空间在插件作用域上登记，卸载时框架自动调 `clear()`（"别留垃圾"）。
3. **存储形态是 JSON 文件**，不是内存 —— 插件"下次启动还记得"。写盘是原子的（先写临时文件再 rename）。
4. **值必须可 JSON 化**；写不进去的值（函数、循环引用）会在序列化时丢。

