# 能力详解 · store：插件私有持久化

**一句话定位**：`ctx.store` 给每个插件一块**自己的**持久化命名空间 —— 落盘跨重启保留，卸载时整块清干净，不会留垃圾给别人。

## 这篇能让你做什么

- 让插件记住「上次运行时间」「配额计数」这类小数据；
- 明白为什么卸载后数据一起消失（这是刻意设计）；
- 知道文件落在磁盘哪里、怎么排查。

## 完整代码

```js
// 文件：<数据根>/server-plugins/demo-store.js
// 格式：自包含单文件后台插件
// 作用：演示 ctx.store.namespace 的 get / set / delete / keys / clear

export const name = 'demo-store'

export function apply(ctx) {
  const db = ctx.store.namespace('demo');        // ① 取命名空间（同名多次取 = 同一份）

  // ② 启动时把「插件被装载过几次」记下来（跨重启保留）
  ctx.jobs.soon(async () => {
    const count = ((await db.get('bootCount')) ?? 0) + 1;
    await db.set('bootCount', count);
    console.log('[demo-store] 第 ' + count + ' 次被装载');
  });

  ctx.routes.get('/api/demo-store/count', async (c) => {
    return c.json({ ok: true, count: (await db.get('bootCount')) ?? 0 });
  });

  ctx.routes.delete('/api/demo-store/count', async (c) => {
    const removed = await db.delete('bootCount');   // ③ 删单键
    return c.json({ ok: true, removed });
  });
}
```

验证「跨重启保留」：GET 记下数字 → 重启服务 → 再 GET，数字 +1 而不是归零。

## 每一步在干什么

- **① 命名空间名有白名单**：字母数字下划线连字符点，1–64 位（防路径穿越）。文件落在 `<数据根>/plugin-data/<命名空间名>.json`。
- **② 五个方法**：`get(key)` / `set(key, value)` / `delete(key)` / `keys()` / `clear()`。值是任意可 JSON 化的数据；写盘是原子写（先写临时文件再 rename），读不到半截。
- **③ 卸载即清**：命名空间一被取过，框架就在插件作用域挂一个「卸载时清空该命名空间」的副作用。**插件卸载 = 数据文件一起走** —— 谁也不会捡到别人的残留，你也不用写清理代码。想留底就在卸载前导出。
- **④ 为什么不用 KV 公共域**：`/api/kv` 是宿主的公共存储（设置、快捷键），插件往里塞私货会键名打架、卸载留垃圾。私有数据走 `ctx.store`，公共数据走 `/api/kv`，边界清楚。

## 源码出处

| 这篇里的说法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| 五方法 | `packages/cloud-server/src/serverFramework/store.ts` 的 `PluginStoreNamespace` | get / set / delete / keys / clear |
| 命名空间白名单 | 同上 `NS_RE` | `/^[A-Za-z0-9_.-]{1,64}$/`，非法名抛错 |
| 文件位置 | 同上 `fileOf` | `<root>/plugin-data/<ns>.json` |
| 卸载即清 | 同上 `namespace()` 里 `ctx.effect(() => () => { void ns.clear() })` | 副作用随插件作用域回收 |
| 原子写 | 同上 `writeAll` | 写 `.tmp-` 临时文件再 rename |
| 坏文件容错 | 同上 `readAll` | JSON 坏了 / 不存在 → 空对象，不抛 |

## 常见坑

1. **指望卸载后数据还在**：不会。卸载即清是刻意的「别留垃圾」设计。要持久化又想卸载恢复，自己导出到 `/api/kv` 或别的存储。
2. **命名空间名带中文或斜杠**：白名单直接抛错。用英文 + 连字符。
3. **大文件塞进 store**：它是 JSON 全量读写，适合 KB 级小数据。大文件（图片、模型）走画布资源或资产接口。
4. **并发写同一键**：两次 set 之间没有锁，后写的赢。插件内部要串行化自己的写。
