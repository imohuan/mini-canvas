# ctx.routes · 后端接口

**一句话定位**：`ctx.routes` 在后端加 HTTP 接口 —— 写一行 `ctx.routes.get(...)`，cloud-server 就多一个接口；
卸载插件，接口自动消失。

**属于哪一档**：后台框架能力段（`packages/cloud-server/src/serverFramework/routes.ts`）。

## 用法

```js
// 文件：<数据根>/server-plugins/demo-routes.js
export const name = 'demo-routes'

export function apply(ctx) {
  ctx.routes.get('/api/demo/hello', (c) => c.json({ ok: true }))
  ctx.routes.post('/api/demo/echo', async (c) => c.json({ got: await c.req.json() }))
}
```

Handler 就是 Hono 的 `Handler`：`(c, next) => ...`，`c.json(...)` / `c.text(...)` / `c.req.*` 都可用。

## 方法

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `get` | `get(path: string, handler: Handler): void` | 注册 GET |
| `post` | `post(path, handler): void` | 注册 POST |
| `put` | `put(path, handler): void` | 注册 PUT |
| `patch` | `patch(path, handler): void` | 注册 PATCH |
| `delete` | `delete(path, handler): void` | 注册 DELETE |
| `all` | `all(path, handler): void` | 所有方法都收（含 HEAD / OPTIONS） |
| `use` | `use(path: string, mw: Handler): void` | 挂中间件（对该 path 前缀生效，先于方法路由执行） |
| `mount` | `mount(prefix: string, app: Hono): void` | 挂子应用（按前缀整段转发；子应用路由要在 mount 之前建齐） |
| `adopt` | `adopt(app: Hono): void` | 把已有子应用的路由**逐条摊平**进来（保持原注册顺序） |

## 注册场

条目落在注册场 `server/route`（`ROUTE_FIELD`），键 = `METHOD path`，id = 注册方插件名；
挂载落 `server/route-mount`（`MOUNT_FIELD`），键 = 前缀。两条都可从 `@mini-canvas/...` 引常量名。

## 匹配语义

- **同 method + 同 path：先注册者优先**（与 Hono 原生一致）。不同插件各成一条、互不覆盖；读取取该键下第一条。
- `mount` 整段转发（剥掉 prefix 再交给子应用）。
- `adopt` 严格保持子应用原本的注册顺序（有静态 / 动态同层冲突时，顺序反了静态路由会被吃掉）。

## 注意事项

1. **路由必须在 `ctx.start()` 之前注册**（装载期）。Hono 首次 `fetch` 后路由表冻结；运行期新注册的 path 靠一条 catch-all 兜底代理命中，不改 Hono 路由表。
2. **路径会归一**：`normalizePath` 补前导 `/`、去尾斜杠（根除外）。
3. **卸载即摘**：条目归注册方插件，卸载自动从注册场移除，代理每次请求现查注册场。
4. **兜底类路由（ui 静态 / SPA 回落）必须在插件路由之后挂**，否则 `get('*')` 会把插件路由全吃掉。
