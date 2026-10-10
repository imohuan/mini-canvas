# 能力详解 · routes：后台加接口 = 装插件

**一句话定位**：`ctx.routes` 是后台插件最常用的能力段 —— 在 `apply(ctx)` 里写一行 `ctx.routes.get(...)`，cloud-server 就多出一个 HTTP 接口；卸载插件，接口自动消失。

## 这篇能让你做什么

- 给后台加一条自己的路由（get / post / put / delete 全会写）；
- 明白「为什么路由必须写在 apply 里同步注册」；
- 分清 `mount` 与 `adopt` 两个高级用法。

## 完整代码

```js
// 文件：<数据根>/server-plugins/demo-routes.js
// 格式：自包含单文件后台插件（被 data: URL import 加载）
// 作用：演示 ctx.routes 全部常用方法

export const name = 'demo-routes'

export function apply(ctx) {
  // ① 最简单的查询路由
  ctx.routes.get('/api/demo/todos', (c) => c.json({ ok: true, todos: [] }));

  // ② 带校验的创建路由（照抄 showcase 的写法）
  ctx.routes.post('/api/demo/todos', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    if (typeof body?.title !== 'string' || !body.title.trim()) {
      return c.json({ ok: false, error: '需要非空 title' }, 400);
    }
    return c.json({ ok: true, title: body.title.trim() }, 201);
  });

  // ③ 路径参数：:id 写在 path 里，c.req.param() 取出来
  ctx.routes.put('/api/demo/todos/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => undefined);
    return c.json({ ok: true, id, body });
  });

  ctx.routes.delete('/api/demo/todos/:id', (c) => c.json({ ok: true, deleted: true }));
}
```

装上后立即可用：`curl http://127.0.0.1:8865/api/demo/todos`。

## 每一步在干什么

- **① 方法一共有八个**：`get` / `post` / `put` / `patch` / `delete` / `all`（所有方法都收）/ `use`（挂中间件）/ `mount` + `adopt`（挂整段子应用）。
- **② 路由条目登记进内核注册场**（场名 `server/route`，条目 id = 插件名）——所以卸载插件时这条路由自动从表里移除，不需要任何清理代码。
- **③ 为什么必须在 apply 里同步注册**：Hono 首次收到请求后路由表就冻结（实测报错「Can not add a route since the matcher is already built」），启动时装的路由靠「start 时把注册场一次性翻成 Hono 代理」命中；运行期热装的路由靠 catch-all 兜底代理（`app.all('*'`)）现查注册场命中。两条路都只认**注册场里已有的条目** —— 如果你 `setTimeout` 之后再注册，那条路由查不到，请求会 404。
- **④ 同 method + 同 path 谁生效**：先注册者优先（注册场按插入序取第一条）。不同插件各成一条互不覆盖；同一插件重复注册同 path 是「替换自己那条」的热更语义。

### mount 与 adopt 的区别

| | `mount(prefix, subApp)` | `adopt(subApp)` |
| --- | --- | --- |
| 注册形态 | 整段转发（剥前缀给子应用） | 逐条摊平进注册场 |
| path | 子应用内写相对路径，前缀统一给 | 子应用里就写全路径 |
| 顺序 | 子应用路由在 mount 前建齐 | 严格保持子应用原序 |

内置的 16 个插件全部用 adopt（见 builtin-services 篇）。

## 源码出处

| 这篇里的说法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| 八个方法 | `packages/cloud-server/src/serverFramework/routes.ts` 的 `RouteRegistrar` | get / post / put / patch / delete / all / use / mount / adopt |
| 注册场与归属 | 同上 `createRouteRegistrar` | `field.add(method + ' ' + path, entry, { id: scopeName })` |
| Hono 冻结三条实测 | 同上文件头 | 冻结报错 / 无反注册 API / catch-all 可行，三条注释原文 |
| 代理与 catch-all | 同上 `flushRoutes` | 启动时翻代理；`hotFallback` 时挂 `app.all('*')` 兜底 |
| 同 path 先注册者优先 | 同上文件头「匹配语义」段 | 取该 key 下第一条；同插件重复注册 = 替换 |

## 常见坑

1. **setTimeout 里注册路由**：注册场里晚出现，请求打不到（404）。路由注册必须同步完成。
2. **路径忘写前导斜杠**：`normalizePath` 会自动补（`api/x` 等价 `/api/x`），但写全更清晰。
3. **在 apply 外面注册**：ctx 还不存在，直接报错。所有注册都进 `apply(ctx)`。
4. **以为卸载后路由还在**：卸载即摘（注册场条目随插件作用域回收），是特性不是 bug —— 想保留就别卸。
